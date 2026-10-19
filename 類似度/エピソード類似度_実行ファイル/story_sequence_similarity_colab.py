"""
アニメ作品の時系列あらすじ（story_sequence_text）をもとに
埋め込みベクトルを生成し、作品間のコサイン類似度を算出・保存・可視化するプログラム
【Google Colab 対応版】

特徴:
- Google Colab環境を自動認識し、パスを柔軟に解決
  ( /content 直下、Google Driveマウント先、カレントディレクトリ等を自動探索 )
- GPU (CUDA) を自動検出してバッチ処理を高速化
- 日本語フォントの文字化け防止 (japanize_matplotlib 自動対応)
- Google Drive への自動保存対応 (マウントされている場合)

データソース: danime_works_with_story_sequence_1990_2026.csv
"""

import argparse
import os
import sys
import time
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
import torch
from sentence_transformers import SentenceTransformer
from sklearn.metrics.pairwise import cosine_similarity

import logging
import warnings

# matplotlibのfindfont警告を完全に非表示にする（ログ・警告両対応）
logging.getLogger("matplotlib.font_manager").setLevel(logging.ERROR)
logging.getLogger("matplotlib").setLevel(logging.ERROR)
warnings.filterwarnings("ignore", message=".*findfont.*")
warnings.filterwarnings("ignore", category=UserWarning, module="matplotlib")

# ==========================================
# Google Colab / 環境判定 & 日本語フォント設定
# ==========================================
def is_colab() -> bool:
    """実行環境が Google Colab かどうかを判定する。"""
    try:
        import google.colab  # noqa: F401
        return True
    except ImportError:
        return False


def setup_japanese_font():
    """実行環境に応じた日本語フォントの設定"""
    import logging
    logging.getLogger("matplotlib.font_manager").setLevel(logging.ERROR)

    # 1. japanize_matplotlib の利用（Colab環境で自動インストール対応）
    try:
        import japanize_matplotlib
        return
    except ImportError:
        if is_colab():
            try:
                import subprocess
                subprocess.run(
                    [sys.executable, "-m", "pip", "install", "-q", "japanize-matplotlib"],
                    check=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                import japanize_matplotlib
                return
            except Exception:
                pass

    # 2. 実在するフォントのみを安全に設定（存在しないフォント名は一切登録しない）
    import matplotlib.font_manager as fm
    installed_font_names = {f.name for f in fm.fontManager.ttflist}

    if is_colab():
        candidates = ["Noto Sans CJK JP", "TakaoPGothic", "IPAPGothic", "VL PGothic", "IPAGothic", "IPAexGothic"]
    else:
        candidates = ["Meiryo", "Yu Gothic", "MS Gothic", "Hiragino Sans", "BIZ UDPGothic"]

    matched = [f for f in candidates if f in installed_font_names]
    if matched:
        plt.rcParams["font.family"] = matched[0]
    else:
        # 見つからない場合は標準sans-serifに設定（警告はロガー抑制済み）
        plt.rcParams["font.family"] = "sans-serif"

    plt.rcParams["axes.unicode_minus"] = False


setup_japanese_font()

# ==========================================
# パス解決ヘルパー (Colab / ローカル両対応)
# ==========================================
CSV_FILENAME = "danime_works_with_story_sequence_1990_2026.csv"


def get_base_dir() -> str:
    """スクリプト自身のディレクトリ、またはカレントディレクトリを取得。"""
    try:
        return os.path.dirname(os.path.abspath(__file__))
    except NameError:
        return os.getcwd()


def resolve_input_csv_path(user_specified_path: str = None) -> str:
    """CSVファイルのパスを自動探索して解決する。"""
    if user_specified_path and os.path.exists(user_specified_path):
        return os.path.abspath(user_specified_path)

    # 探索候補リスト
    candidate_paths = [
        # 1. ユーザー指定パス
        user_specified_path,
        # 2. スクリプトと同じフォルダ
        os.path.join(get_base_dir(), CSV_FILENAME),
        # 3. カレントディレクトリ
        os.path.join(os.getcwd(), CSV_FILENAME),
        # 4. Colab デフォルト作業ディレクトリ
        os.path.join("/content", CSV_FILENAME),
        # 5. Google Drive マウント先 (代表的なフォルダ構成)
        os.path.join("/content/drive/MyDrive/アニメ類似度", CSV_FILENAME),
        os.path.join("/content/drive/MyDrive/anime_similarity", CSV_FILENAME),
        os.path.join("/content/drive/MyDrive", CSV_FILENAME),
    ]

    for p in candidate_paths:
        if p and os.path.exists(p):
            return os.path.abspath(p)

    # 見つからなかった場合は候補一覧を表示してエラー
    valid_candidates = [p for p in candidate_paths if p]
    msg = (
        f"エラー: CSVファイル '{CSV_FILENAME}' が見つかりませんでした。\n"
        f"探索したパス一覧:\n" + "\n".join(f" - {p}" for p in valid_candidates) + "\n\n"
        f"【解決方法】\n"
        f"・Colabの左メニュー「ファイル」に '{CSV_FILENAME}' をアップロードしてください。\n"
        f"・または Google Drive をマウントし、--csv 引数でフルパスを指定してください。"
    )
    raise FileNotFoundError(msg)


def resolve_output_dir(user_specified_dir: str = None) -> str:
    """結果保存先ディレクトリを自動決定する。"""
    if user_specified_dir:
        os.makedirs(user_specified_dir, exist_ok=True)
        return os.path.abspath(user_specified_dir)

    # Google Drive がマウントされている場合は優先的に保存
    gdrive_target = "/content/drive/MyDrive/アニメ類似度"
    if os.path.exists("/content/drive/MyDrive"):
        os.makedirs(gdrive_target, exist_ok=True)
        return gdrive_target

    if is_colab():
        return "/content"

    return get_base_dir()


DEFAULT_MODEL_NAME = "google/embeddinggemma-2"


# ==========================================
# 1. データ読み込み & 前処理
# ==========================================
def load_story_sequence_data(
    csv_path: str,
    limit: int = None,
    work_ids: list[str] = None,
) -> pd.DataFrame:
    """CSVからアニメ作品データを読み込み、story_sequence_text が有効な作品を抽出する。"""
    print(f"[1/5] CSVファイルを読み込み中: {csv_path}")
    df = pd.read_csv(csv_path)
    total_raw = len(df)

    if "story_sequence_text" not in df.columns:
        raise KeyError(
            f"CSVに 'story_sequence_text' カラムが存在しません。カラム一覧: {list(df.columns)}"
        )

    # 空白・欠損を除外
    df = df.dropna(subset=["story_sequence_text"]).copy()
    df["story_sequence_text"] = df["story_sequence_text"].astype(str).str.strip()
    df = df[df["story_sequence_text"] != ""].copy()
    df = df.reset_index(drop=True)

    print(
        f"      全 {total_raw} 件中、有効な時系列あらすじを持つ作品数: {len(df)} 件 "
        f"(除外: {total_raw - len(df)} 件)"
    )

    # 特定IDでの絞り込み
    if work_ids:
        work_ids_str = [str(wid).strip() for wid in work_ids]
        df = df[df["work_id"].astype(str).isin(work_ids_str)].copy()
        df = df.reset_index(drop=True)
        print(f"      ※ 指定された {len(work_ids)} 件の work_id に絞り込み: {len(df)} 件")

    # 件数上限（テスト用）
    if limit is not None and limit > 0:
        df = df.head(limit).copy()
        print(f"      ※ テストモード: 先頭 {limit} 作品を対象に処理します。")

    return df


# ==========================================
# 2. ベクトル化 & 類似度計算
# ==========================================
def truncate_long_text(text: str, max_chars: int = 8000) -> str:
    """極端な長文テキスト（長編作の全話あらすじ結合等）を安全な長さにトリムする。

    序盤と終盤の重要情報を残すため、先頭60%と末尾40%を保持。
    """
    if len(text) <= max_chars:
        return text
    half_head = int(max_chars * 0.6)
    half_tail = int(max_chars * 0.4)
    return text[:half_head] + "\n…(中略)…\n" + text[-half_tail:]


def compute_story_embeddings(
    df: pd.DataFrame,
    model_name: str = DEFAULT_MODEL_NAME,
    batch_size: int = None,
    num_cores: int = None,
    max_seq_length: int = 8192,
) -> tuple[np.ndarray, np.ndarray]:
    """story_sequence_text から埋め込みベクトルを計算し、コサイン類似度行列を算出する。

    OOM対策:
    - max_seq_length=8192 に明示設定（Gemma-2の最大コンテキスト長8192トークンを活用）
    - GPU推論時はFP16（半精度）を自動適用してVRAM消費を半減
    - 長文向けに安全なバッチサイズ（GPU時デフォルト: 8）
    - OOM発生時の自動バッチ縮小リトライ
    """
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[2/5] 実行環境の設定:")
    print(f"      使用デバイス: {device}")

    if device == "cuda":
        gpu_name = torch.cuda.get_device_name(0)
        gpu_vram = torch.cuda.get_device_properties(0).total_memory / (1024**3)
        print(f"      GPUデバイス名: {gpu_name} (VRAM: {gpu_vram:.1f} GB)")
        actual_batch_size = batch_size or 8
    else:
        available_cores = os.cpu_count() or 4
        threads = num_cores if num_cores is not None else available_cores
        torch.set_num_threads(threads)
        os.environ["OMP_NUM_THREADS"] = str(threads)
        os.environ["MKL_NUM_THREADS"] = str(threads)
        print(f"      CPUスレッド数: {torch.get_num_threads()} (利用可能コア: {available_cores})")
        actual_batch_size = batch_size or 4

    print(f"      モデルをロード中: {model_name} (数値安定性の高いfloat32を使用)...")
    start_load = time.time()

    # Gemma-2はfloat16で数値オーバーフロー（NaN発生）する特性があるため、安定したfloat32を使用
    model = SentenceTransformer(model_name, device=device)

    # 最大トークン数を明示設定（数万文字によるOOMを防止）
    model.max_seq_length = max_seq_length
    print(f"      最大シーケンス長 (max_seq_length): {model.max_seq_length} tokens")
    print(f"      モデルロード完了: {time.time() - start_load:.2f}秒")

    # 極端な長文（数万文字〜10万文字）の事前安全トリム
    raw_texts = df["story_sequence_text"].tolist()
    texts = [truncate_long_text(t, max_chars=8000) for t in raw_texts]

    print(
        f"[3/5] {len(texts)} 件の時系列あらすじをベクトル化中 (batch_size={actual_batch_size})..."
    )
    start_time = time.time()

    # OOMセーフティループ（万が一OOMが発生した場合はバッチサイズを半減してリトライ）
    curr_batch_size = actual_batch_size
    embeddings = None

    while curr_batch_size >= 1:
        try:
            if device == "cuda":
                torch.cuda.empty_cache()
            embeddings = model.encode(
                texts,
                batch_size=curr_batch_size,
                show_progress_bar=True,
                normalize_embeddings=True,  # L2正規化
            )
            break
        except torch.OutOfMemoryError:
            if curr_batch_size == 1:
                print("\n[エラー] batch_size=1 でもGPUメモリが不足しました。CPUでフォールバック実行します。")
                model = model.to("cpu")
                embeddings = model.encode(texts, batch_size=2, show_progress_bar=True, normalize_embeddings=True)
                break
            else:
                next_batch = max(1, curr_batch_size // 2)
                print(f"\n[警告] GPUメモリ不足を検出。batch_size を {curr_batch_size} -> {next_batch} に縮小して再試行します...")
                curr_batch_size = next_batch
                if device == "cuda":
                    torch.cuda.empty_cache()

    # 万が一のNaN / Inf の安全保護処理
    if np.isnan(embeddings).any() or np.isinf(embeddings).any():
        print("      [補正] ベクトル内の非数(NaN/Inf)を0にクレンジングします。")
        embeddings = np.nan_to_num(embeddings, nan=0.0, posinf=1.0, neginf=-1.0)
        # 再度正規化
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        embeddings = embeddings / norms

    elapsed = time.time() - start_time
    print(
        f"      ベクトル化完了: {elapsed:.2f}秒 "
        f"(平均 {elapsed / max(1, len(texts)):.2f}秒/件, 次元数: {embeddings.shape[1]})"
    )

    # コサイン類似度行列の計算
    print("      コサイン類似度行列を計算中...")
    sim_matrix = cosine_similarity(embeddings)
    # 行列内の微小な数値誤差や自己類似度の正規化
    np.fill_diagonal(sim_matrix, 1.0)
    sim_matrix = np.nan_to_num(sim_matrix, nan=0.0)
    return embeddings, sim_matrix


# ==========================================
# 3. 上位類似作品の抽出
# ==========================================
def extract_top_similarities(
    df: pd.DataFrame, sim_matrix: np.ndarray, top_k: int = 10
) -> pd.DataFrame:
    """各作品について上位K件の類似作品を抽出したDataFrameを作成する。"""
    n = len(df)
    k = min(top_k, max(0, n - 1))

    records = []
    titles = df["title"].tolist()
    work_ids = df["work_id"].tolist()
    genres = df["genre"].tolist() if "genre" in df.columns else [""] * n
    years = df["year"].tolist() if "year" in df.columns else [None] * n

    for i in range(n):
        scores = sim_matrix[i].copy()
        scores[i] = -1.0  # 自分自身は除外

        if k > 0:
            top_indices = np.argsort(scores)[::-1][:k]
            for rank, idx in enumerate(top_indices, 1):
                records.append(
                    {
                        "work_id": work_ids[i],
                        "title": titles[i],
                        "year": years[i],
                        "genre": genres[i],
                        "rank": rank,
                        "similar_work_id": work_ids[idx],
                        "similar_title": titles[idx],
                        "similar_year": years[idx],
                        "similar_genre": genres[idx],
                        "similarity_score": round(float(scores[idx]), 4),
                    }
                )

    return pd.DataFrame(records)


# ==========================================
# 4. ファイル保存
# ==========================================
def save_results(
    output_dir: str,
    df: pd.DataFrame,
    embeddings: np.ndarray,
    sim_matrix: np.ndarray,
    df_top_sim: pd.DataFrame,
    file_prefix: str = "story_sequence",
):
    """算出結果を多様な形式（CSV, NPZ, NPY）で保存する。"""
    os.makedirs(output_dir, exist_ok=True)
    print(f"[4/5] 結果をファイルに保存中 (保存先: {output_dir})...")

    # 1. 上位類似作品ランキングCSV
    top_csv_path = os.path.join(output_dir, f"{file_prefix}_top_similarities.csv")
    df_top_sim.to_csv(top_csv_path, index=False, encoding="utf-8-sig")
    print(f"      - 上位類似作品ランキング: {top_csv_path}")

    # 2. 全ペア類似度マトリクスCSV
    matrix_csv_path = os.path.join(output_dir, f"{file_prefix}_similarity_matrix.csv")
    df_matrix = pd.DataFrame(
        np.round(sim_matrix, 4),
        index=df["title"],
        columns=df["title"],
    )
    df_matrix.to_csv(matrix_csv_path, encoding="utf-8-sig")
    print(f"      - 全ペア類似度マトリクスCSV: {matrix_csv_path}")

    # 3. 全ペア類似度行列 (NumPy圧縮形式)
    matrix_npz_path = os.path.join(output_dir, f"{file_prefix}_similarity_matrix.npz")
    np.savez_compressed(
        matrix_npz_path,
        similarity_matrix=sim_matrix.astype(np.float32),
        work_ids=df["work_id"].values,
    )
    print(f"      - 全ペア類似度行列(NumPy圧縮): {matrix_npz_path}")

    # 4. 埋め込みベクトル (npy形式)
    emb_path = os.path.join(output_dir, f"{file_prefix}_embeddings.npy")
    np.save(emb_path, embeddings.astype(np.float32))
    print(f"      - 埋め込みベクトル: {emb_path}")

    # 5. 作品メタデータCSV
    meta_path = os.path.join(output_dir, f"{file_prefix}_metadata.csv")
    meta_cols = [
        c
        for c in [
            "work_id",
            "title",
            "year",
            "genre",
            "total_episodes",
            "episodes_with_synopsis",
        ]
        if c in df.columns
    ]
    df[meta_cols].to_csv(meta_path, index=False, encoding="utf-8-sig")
    print(f"      - 作品メタデータ: {meta_path}")


# ==========================================
# 5. ヒートマップ可視化
# ==========================================
def save_heatmap(
    df: pd.DataFrame,
    sim_matrix: np.ndarray,
    output_path: str,
    max_display: int = 15,
):
    """類似度ヒートマップを生成して画像ファイルとして保存する。"""
    num_display = min(max_display, len(df))
    if num_display <= 1:
        return

    titles = [
        t[:14] + "…" if len(t) > 14 else t
        for t in df["title"].iloc[:num_display]
    ]
    sub_matrix = sim_matrix[:num_display, :num_display]

    plt.figure(figsize=(10, 8))
    sns.heatmap(
        sub_matrix,
        annot=True,
        fmt=".3f",
        cmap="YlGnBu",
        xticklabels=titles,
        yticklabels=titles,
        vmin=0.0,
        vmax=1.0,
        cbar_kws={"label": "コサイン類似度"},
    )
    plt.title(f"アニメ時系列あらすじ コサイン類似度マトリクス (先頭{num_display}作品)", fontsize=13)
    plt.xticks(rotation=45, ha="right", fontsize=9)
    plt.yticks(rotation=0, fontsize=9)
    plt.tight_layout()
    plt.savefig(output_path, dpi=300)
    plt.close()
    print(f"[5/5] 類似度ヒートマップ画像を保存: {output_path}")


def print_detailed_results(df: pd.DataFrame, df_top_sim: pd.DataFrame, sim_matrix: np.ndarray):
    """コンソールに対象作品の詳細と類似度算出結果を表示する。"""
    print("\n" + "=" * 70)
    print("【対象作品一覧】")
    print("=" * 70)
    for i, row in df.iterrows():
        text_len = len(str(row.get("story_sequence_text", "")))
        print(
            f"[{i+1}] ID:{row['work_id']} | {row['title']} "
            f"({row.get('year', '')}年 / {row.get('genre', '')}) "
            f"[全{row.get('total_episodes', '')}話 / あらすじ文字数: {text_len:,}字]"
        )

    print("\n" + "=" * 70)
    print("【各作品の類似作品ランキング (上位)】")
    print("=" * 70)
    for title in df["title"].unique():
        sub = df_top_sim[df_top_sim["title"] == title]
        if sub.empty:
            continue
        print(f"\n■ 対象: {title}")
        for _, row in sub.iterrows():
            print(
                f"   ▶ {row['rank']}位: {row['similar_title']} "
                f"(スコア: {row['similarity_score']:.4f} | ジャンル: {row['similar_genre']})"
            )
    print("=" * 70 + "\n")


# ==========================================
# メインエントリーポイント
# ==========================================
def main():
    parser = argparse.ArgumentParser(
        description="アニメ時系列あらすじコサイン類似度算出 (Google Colab対応版)"
    )
    parser.add_argument(
        "--csv",
        type=str,
        default=None,
        help="入力CSVファイルパス（未指定時は自動探索）",
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help="テストモード（先頭5作品のみで類似度算出を実行）",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="処理対象作品数の上限",
    )
    parser.add_argument(
        "--work-ids",
        type=str,
        default=None,
        help="対象work_idのカンマ区切り指定（例: 28902,28611,29069）",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=DEFAULT_MODEL_NAME,
        help=f"SentenceTransformerモデル名 (デフォルト: {DEFAULT_MODEL_NAME})",
    )
    parser.add_argument(
        "--cores",
        type=int,
        default=None,
        help="使用するCPUスレッド数",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=None,
        help="エンコード時のバッチサイズ (GPU時デフォルト: 8, CPU時: 4)",
    )
    parser.add_argument(
        "--max-seq-length",
        type=int,
        default=8192,
        help="モデルの最大トークン長 (デフォルト: 8192)",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=5,
        help="各作品の上位類似作品抽出数（デフォルト: 5）",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=None,
        help="結果保存先ディレクトリ（未指定時はColab/Driveを自動判定）",
    )

    args = parser.parse_args()

    # パスの自動解決
    csv_path = resolve_input_csv_path(args.csv)
    output_dir = resolve_output_dir(args.output_dir)

    limit = 5 if args.test else args.limit
    work_id_list = [w.strip() for w in args.work_ids.split(",")] if args.work_ids else None
    file_prefix = (
        "story_sequence_test"
        if (args.test or limit is not None or work_id_list is not None)
        else "story_sequence"
    )

    print("=" * 70)
    print("      アニメ時系列あらすじ類似度算出処理 (Google Colab対応版)")
    print("=" * 70)
    print(f"入力CSVパス: {csv_path}")
    print(f"出力保存先 : {output_dir}")

    # 1. データ読み込み
    df = load_story_sequence_data(csv_path, limit=limit, work_ids=work_id_list)
    if len(df) == 0:
        print("エラー: 処理対象の作品データが0件です。")
        sys.exit(1)

    # 2. ベクトル化と類似度計算
    embeddings, sim_matrix = compute_story_embeddings(
        df=df,
        model_name=args.model,
        batch_size=args.batch_size,
        num_cores=args.cores,
        max_seq_length=args.max_seq_length,
    )

    # 3. 上位類似作品の抽出
    df_top_sim = extract_top_similarities(df, sim_matrix, top_k=args.top_k)

    # 4. 結果のファイル保存
    save_results(
        output_dir=output_dir,
        df=df,
        embeddings=embeddings,
        sim_matrix=sim_matrix,
        df_top_sim=df_top_sim,
        file_prefix=file_prefix,
    )

    # 5. ヒートマップの生成
    heatmap_path = os.path.join(output_dir, f"{file_prefix}_similarity_heatmap.png")
    save_heatmap(df, sim_matrix, heatmap_path, max_display=15)

    # 6. 詳細結果の表示
    print_detailed_results(df, df_top_sim, sim_matrix)

    print("=" * 70)
    print(f"  処理が正常に完了しました！ 結果は '{output_dir}' に保存されました。")
    print("=" * 70)


if __name__ == "__main__":
    main()
