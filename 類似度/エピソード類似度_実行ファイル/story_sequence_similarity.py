"""
アニメ作品の時系列あらすじ（story_sequence_text）をもとに
埋め込みベクトルを生成し、作品間のコサイン類似度を算出・保存・可視化するプログラム。

使用モデル: google/embeddinggemma-2 (デフォルト)
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

# 日本語フォント設定（Windows / Mac / Linux / Colab マルチ環境対応）
def setup_japanese_font():
    """実行環境に応じた最適な日本語フォントを設定し、文字化けを防止する。"""
    try:
        import japanize_matplotlib
        return
    except ImportError:
        pass

    import matplotlib.font_manager as fm
    installed_font_names = {f.name for f in fm.fontManager.ttflist}

    # 各OS対応の優先フォント候補リスト
    candidates = [
        "Meiryo",
        "Yu Gothic",
        "MS Gothic",
        "BIZ UDPGothic",
        "Hiragino Sans",
        "Noto Sans CJK JP",
        "TakaoPGothic",
        "IPAPGothic",
        "VL PGothic",
        "IPAGothic",
        "IPAexGothic",
    ]

    matched = [f for f in candidates if f in installed_font_names]
    if matched:
        plt.rcParams["font.family"] = matched[0]
    else:
        plt.rcParams["font.family"] = "sans-serif"

    plt.rcParams["axes.unicode_minus"] = False


setup_japanese_font()


def truncate_long_text(text: str, max_chars: int = 8000) -> str:
    """極端な長文テキスト（長編アニメの全話あらすじ結合等）を安全な長さにトリムする。

    ストーリーの重要情報である序盤（導入）60%と終盤（結末）40%を保持。
    """
    if len(text) <= max_chars:
        return text
    half_head = int(max_chars * 0.6)
    half_tail = int(max_chars * 0.4)
    return text[:half_head] + "\n…(中略)…\n" + text[-half_tail:]


# デフォルト設定
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CSV_PATH = os.path.join(
    SCRIPT_DIR, "danime_works_with_story_sequence_1990_2026.csv"
)
DEFAULT_MODEL_NAME = "google/embeddinggemma-2"


def load_story_sequence_data(
    csv_path: str,
    limit: int = None,
    work_ids: list[str] = None,
) -> pd.DataFrame:
    """CSVからアニメ作品データを読み込み、story_sequence_text が有効な作品を抽出する。

    Parameters
    ----------
    csv_path : str
        入力CSVファイルのパス
    limit : int, optional
        取得する作品数の上限
    work_ids : list[str], optional
        対象とする特定のwork_idリスト

    Returns
    -------
    pd.DataFrame
        前処理済みの作品データ
    """
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"CSVファイルが見つかりません: {csv_path}")

    print(f"[1/5] CSVファイルを読み込み中: {csv_path}")
    df = pd.read_csv(csv_path)
    total_raw = len(df)

    # story_sequence_text が存在しない作品を除外 (NaN または 空白文字列)
    if "story_sequence_text" not in df.columns:
        raise KeyError(
            f"CSVに 'story_sequence_text' カラムが存在しません。カラム一覧: {list(df.columns)}"
        )

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


def compute_story_embeddings(
    df: pd.DataFrame,
    model_name: str = DEFAULT_MODEL_NAME,
    batch_size: int = None,
    num_cores: int = None,
    max_seq_length: int = 8192,
    max_chars: int = 8000,
) -> tuple[np.ndarray, np.ndarray]:
    """story_sequence_text から埋め込みベクトルを計算し、コサイン類似度行列を算出する。

    Parameters
    ----------
    df : pd.DataFrame
        story_sequence_text を含む作品データ
    model_name : str
        使用するSentenceTransformerモデル名
    batch_size : int, optional
        エンコード時のバッチサイズ
    num_cores : int, optional
        使用するCPUスレッド数（未指定時は利用可能最大数）
    max_seq_length : int, optional
        モデルの最大トークン長（Gemma-2の最大コンテキスト長。デフォルト: 8192）
    max_chars : int, optional
        テキストの最大文字数（デフォルト: 8000文字。序盤60%+終盤40%）

    Returns
    -------
    tuple[np.ndarray, np.ndarray]
        (embeddings, similarity_matrix)
    """
    # CPUスレッド数の設定
    available_cores = os.cpu_count() or 4
    threads = num_cores if num_cores is not None else available_cores
    torch.set_num_threads(threads)
    os.environ["OMP_NUM_THREADS"] = str(threads)
    os.environ["MKL_NUM_THREADS"] = str(threads)
    print(
        f"[2/5] CPU並列スレッド数を設定: {torch.get_num_threads()} "
        f"(物理/論理スレッド: {available_cores})"
    )

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"      使用デバイス: {device}")
    print(f"      モデルをロード中: {model_name} (数値安定性の高いfloat32を使用)...")
    start_load = time.time()
    model = SentenceTransformer(model_name, device=device)
    model.max_seq_length = max_seq_length
    print(f"      最大シーケンス長 (max_seq_length): {model.max_seq_length} tokens")
    print(f"      モデルロード完了: {time.time() - start_load:.2f}秒")

    # 極端な長文テキストの安全トリム (max_chars超は序盤60%と終盤40%を保持)
    raw_texts = df["story_sequence_text"].tolist()
    texts = [truncate_long_text(t, max_chars=max_chars) for t in raw_texts]

    actual_batch = batch_size or (8 if device == "cuda" else 4)
    print(
        f"[3/5] {len(texts)} 件の時系列あらすじをベクトル化中 (batch_size={actual_batch}, max_chars={max_chars})..."
    )
    start_time = time.time()
    embeddings = model.encode(
        texts,
        batch_size=actual_batch,
        show_progress_bar=True,
        normalize_embeddings=True,  # L2正規化（内積＝コサイン類似度）
    )

    # 万が一のNaN / Inf の安全保護処理
    if np.isnan(embeddings).any() or np.isinf(embeddings).any():
        print("      [補正] ベクトル内の非数(NaN/Inf)を0にクレンジングします。")
        embeddings = np.nan_to_num(embeddings, nan=0.0, posinf=1.0, neginf=-1.0)
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
    np.fill_diagonal(sim_matrix, 1.0)
    sim_matrix = np.nan_to_num(sim_matrix, nan=0.0)
    return embeddings, sim_matrix


def extract_top_similarities(
    df: pd.DataFrame, sim_matrix: np.ndarray, top_k: int = 10
) -> pd.DataFrame:
    """各作品について上位K件の類似作品を抽出したDataFrameを作成する。

    Parameters
    ----------
    df : pd.DataFrame
        作品メタ情報
    sim_matrix : np.ndarray
        コサイン類似度行列
    top_k : int
        抽出する類似作品の上位件数

    Returns
    -------
    pd.DataFrame
        上位類似作品ランキングDataFrame
    """
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


def save_results(
    output_dir: str,
    df: pd.DataFrame,
    embeddings: np.ndarray,
    sim_matrix: np.ndarray,
    df_top_sim: pd.DataFrame,
    file_prefix: str = "story_sequence",
):
    """算出結果を多様な形式（CSV, NPZ, NPY）で保存する。

    保存ファイル:
    1. {file_prefix}_top_similarities.csv : 上位類似作品ランキング（順位・スコア・ジャンル）
    2. {file_prefix}_similarity_matrix.csv : 全作品間の類似度マトリクス（作品名を行・列に配置）
    3. {file_prefix}_similarity_matrix.npz : 高速ロード用NumPy圧縮形式
    4. {file_prefix}_embeddings.npy : 埋め込みベクトル (float32)
    5. {file_prefix}_metadata.csv : 対象作品のメタデータ一覧
    """
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

    # タイトルが長い場合は省略表示
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
    """コンソールに対象作品の詳細と類似度算出結果をわかりやすく表示する。"""
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
    print("【作品間 コサイン類似度マトリクス表】")
    print("=" * 70)
    header = f"{'作品名 (短縮)':<20}" + "".join([f" [{i+1}]   " for i in range(len(df))])
    print(header)
    print("-" * 70)
    for i, row in df.iterrows():
        t = row["title"][:12] + "…" if len(row["title"]) > 12 else row["title"]
        scores_str = "".join([f" {sim_matrix[i, j]:.4f} " for j in range(len(df))])
        print(f"[{i+1}] {t:<15} {scores_str}")

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


def main():
    parser = argparse.ArgumentParser(
        description="アニメ時系列あらすじ（story_sequence_text）コサイン類似度算出プログラム"
    )
    parser.add_argument(
        "--csv",
        type=str,
        default=DEFAULT_CSV_PATH,
        help="入力CSVファイルパス (デフォルト: danime_works_with_story_sequence_1990_2026.csv)",
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
        help="処理対象作品数の上限（テストや部分検証用）",
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
        help="使用するCPUスレッド数（未指定時はCPU最大論理コア数）",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=None,
        help="エンコード時のバッチサイズ (未指定時はGPU: 8, CPU: 4)",
    )
    parser.add_argument(
        "--max-seq-length",
        type=int,
        default=8192,
        help="モデルの最大トークン長 (デフォルト: 8192)",
    )
    parser.add_argument(
        "--max-chars",
        type=int,
        default=8000,
        help="あらすじテキストの最大文字数 (長大作の安全トリム。デフォルト: 8000)",
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
        default=SCRIPT_DIR,
        help="結果保存先ディレクトリ（デフォルト: スクリプトと同じディレクトリ）",
    )

    args = parser.parse_args()

    # テストフラグまたはlimitの判定
    limit = 5 if args.test else args.limit
    work_id_list = [w.strip() for w in args.work_ids.split(",")] if args.work_ids else None
    file_prefix = "story_sequence_test" if (args.test or limit is not None or work_id_list is not None) else "story_sequence"

    print("=" * 70)
    print("      アニメ時系列あらすじ（story_sequence_text）類似度算出処理")
    print("=" * 70)

    # 1. データ読み込み
    df = load_story_sequence_data(args.csv, limit=limit, work_ids=work_id_list)
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
        max_chars=args.max_chars,
    )

    # 3. 上位類似作品の抽出
    df_top_sim = extract_top_similarities(df, sim_matrix, top_k=args.top_k)

    # 4. 結果のファイル保存
    save_results(
        output_dir=args.output_dir,
        df=df,
        embeddings=embeddings,
        sim_matrix=sim_matrix,
        df_top_sim=df_top_sim,
        file_prefix=file_prefix,
    )

    # 5. ヒートマップの生成
    heatmap_path = os.path.join(args.output_dir, f"{file_prefix}_similarity_heatmap.png")
    save_heatmap(df, sim_matrix, heatmap_path, max_display=15)

    # 6. 詳細結果の表示
    print_detailed_results(df, df_top_sim, sim_matrix)

    print("=" * 70)
    print("                      処理が正常に完了しました")
    print("=" * 70)


if __name__ == "__main__":
    main()
