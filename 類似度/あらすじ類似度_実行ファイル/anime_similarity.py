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

# 日本語フォント設定（Windows環境での文字化け防止）
plt.rcParams["font.sans-serif"] = ["Meiryo", "Yu Gothic", "MS Gothic", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False

# スクリプトの配置ディレクトリ
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CSV_PATH = os.path.join(SCRIPT_DIR, "danime_synopses_1990_2026_animeonly.csv")


def load_anime_data(csv_path: str, limit: int = None) -> pd.DataFrame:
    """CSVからアニメデータを読み込み、あらすじが存在しない作品を除外する。

    Parameters
    ----------
    csv_path : str
        入力CSVファイルのパス
    limit : int, optional
        取得する作品数の上限（テスト実行用）

    Returns
    -------
    pd.DataFrame
        前処理済みのアニメデータ
    """
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"CSVファイルが見つかりません: {csv_path}")

    print(f"[1/4] CSVファイルを読み込み中: {csv_path}")
    df = pd.read_csv(csv_path)
    total_raw = len(df)

    # あらすじが存在しない作品を除外 (NaN または 空白文字列)
    df = df.dropna(subset=["synopsis"]).copy()
    df["synopsis"] = df["synopsis"].astype(str).str.strip()
    df = df[df["synopsis"] != ""].copy()
    df = df.reset_index(drop=True)

    print(
        f"      全 {total_raw} 件中、有効なあらすじを持つ作品数: {len(df)} 件 "
        f"(除外: {total_raw - len(df)} 件)"
    )

    if limit is not None and limit > 0:
        df = df.head(limit).copy()
        print(f"      ※ テストモード: 先頭 {limit} 作品を対象に処理します。")

    return df


def compute_similarities(
    df: pd.DataFrame,
    model_name: str = "google/embeddinggemma-2",
    batch_size: int = 32,
    num_cores: int = 30,
):
    """あらすじテキストから埋め込みベクトルを計算し、コサイン類似度行列を算出する。

    Parameters
    ----------
    df : pd.DataFrame
        あらすじを含むアニメデータ
    model_name : str
        使用するSentenceTransformerモデル名
    batch_size : int
        エンコード時のバッチサイズ
    num_cores : int
        使用するCPUコア（スレッド）数

    Returns
    -------
    tuple[np.ndarray, np.ndarray]
        (embeddings, similarity_matrix)
    """
    # 実行環境のコア数（30コア）設定
    torch.set_num_threads(num_cores)
    os.environ["OMP_NUM_THREADS"] = str(num_cores)
    os.environ["MKL_NUM_THREADS"] = str(num_cores)
    print(
        f"[2/4] CPU並列スレッド数を設定: {torch.get_num_threads()} "
        f"(指定コア数: {num_cores})"
    )

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"      使用デバイス: {device}")
    print(f"      モデルをロード中: {model_name} ...")
    model = SentenceTransformer(model_name, device=device)

    texts = df["synopsis"].tolist()
    print(
        f"      {len(texts)} 件のあらすじをベクトル化中 (batch_size={batch_size})..."
    )
    start_time = time.time()
    embeddings = model.encode(
        texts,
        batch_size=batch_size,
        show_progress_bar=True,
        normalize_embeddings=True,
    )
    elapsed = time.time() - start_time
    print(
        f"      ベクトル化完了: {elapsed:.2f}秒 (平均 {elapsed / max(1, len(texts)):.3f}秒/件)"
    )

    # L2正規化済みベクトルのため、内積 (dot product) = コサイン類似度
    print("[3/4] コサイン類似度行列を計算中...")
    sim_matrix = cosine_similarity(embeddings)
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

    for i in range(n):
        scores = sim_matrix[i].copy()
        scores[i] = -1.0  # 自身を除外

        if k > 0:
            top_indices = np.argsort(scores)[::-1][:k]
            for rank, idx in enumerate(top_indices, 1):
                records.append(
                    {
                        "work_id": work_ids[i],
                        "title": titles[i],
                        "rank": rank,
                        "similar_work_id": work_ids[idx],
                        "similar_title": titles[idx],
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
    file_prefix: str = "anime",
):
    """算出結果を適切な形式のファイルに保存する。

    保存形式:
    1. 上位類似作品ランキングCSV ({prefix}_top_similarities.csv): 実用・閲覧用
    2. 全ペア類似度マトリクスCSV ({prefix}_similarity_matrix.csv): 作品間の類似度クロス集計表
    3. 全ペア類似度行列NumPy圧縮形式 ({prefix}_similarity_matrix.npz): 再計算不要の高精度行列データ
    4. 埋め込みベクトルNumPyバイナリ ({prefix}_embeddings.npy): 検索・追加計算用
    5. 作品メタデータCSV ({prefix}_metadata.csv): 行列のインデックス対応表
    """
    os.makedirs(output_dir, exist_ok=True)
    print(f"[4/4] 結果をファイルに保存中 (保存先: {output_dir})...")

    # 1. 上位類似作品ランキングCSV
    top_csv_path = os.path.join(output_dir, f"{file_prefix}_top_similarities.csv")
    df_top_sim.to_csv(top_csv_path, index=False, encoding="utf-8-sig")
    print(f"      - 上位類似作品ランキング: {top_csv_path}")

    # 2. 全ペア類似度行列 (CSV形式: Excelやスプレッドシート等での閲覧・分析用)
    matrix_csv_path = os.path.join(output_dir, f"{file_prefix}_similarity_matrix.csv")
    df_matrix = pd.DataFrame(
        np.round(sim_matrix, 4),
        index=df["title"],
        columns=df["title"],
    )
    df_matrix.to_csv(matrix_csv_path, encoding="utf-8-sig")
    print(f"      - 全ペア類似度マトリクスCSV: {matrix_csv_path}")

    # 3. 全ペア類似度行列 (npz形式で高圧縮・高速ロード)
    matrix_path = os.path.join(output_dir, f"{file_prefix}_similarity_matrix.npz")
    np.savez_compressed(
        matrix_path,
        similarity_matrix=sim_matrix.astype(np.float32),
        work_ids=df["work_id"].values,
    )
    print(f"      - 全ペア類似度行列(NumPy圧縮): {matrix_path}")

    # 4. 埋め込みベクトル (npy形式)
    emb_path = os.path.join(output_dir, f"{file_prefix}_embeddings.npy")
    np.save(emb_path, embeddings.astype(np.float32))
    print(f"      - 埋め込みベクトル: {emb_path}")

    # 4. 作品メタデータCSV
    meta_path = os.path.join(output_dir, f"{file_prefix}_metadata.csv")
    meta_cols = [
        c
        for c in [
            "work_id",
            "title",
            "year",
            "genre",
            "episodes",
            "synopsis_length",
            "url",
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
    """類似度ヒートマップをPNG画像として保存する。"""
    num_display = min(max_display, len(df))
    if num_display <= 1:
        return

    titles = [
        t[:12] + "…" if len(t) > 12 else t
        for t in df["title"].iloc[:num_display]
    ]
    sub_matrix = sim_matrix[:num_display, :num_display]

    plt.figure(figsize=(10, 8))
    sns.heatmap(
        sub_matrix,
        annot=True,
        fmt=".2f",
        cmap="YlGnBu",
        xticklabels=titles,
        yticklabels=titles,
    )
    plt.title(f"アニメ作品 コサイン類似度マトリクス (先頭{num_display}作品)")
    plt.xticks(rotation=45, ha="right")
    plt.yticks(rotation=0)
    plt.tight_layout()
    plt.savefig(output_path, dpi=300)
    plt.close()
    print(f"      - 類似度ヒートマップ画像: {output_path}")


def print_sample_results(df_top_sim: pd.DataFrame, num_samples: int = 5):
    """コンソールに類似作品の算出結果を表示する。"""
    if df_top_sim.empty:
        return

    unique_titles = df_top_sim["title"].unique()[:num_samples]
    print("\n" + "=" * 60)
    print("【類似作品 算出結果一覧】")
    print("=" * 60)
    for title in unique_titles:
        sub = df_top_sim[df_top_sim["title"] == title]
        print(f"\n■ 対象作品: {title}")
        for _, row in sub.iterrows():
            print(
                f"   {row['rank']}位: {row['similar_title']} "
                f"(スコア: {row['similarity_score']:.4f}, ID: {row['similar_work_id']})"
            )
    print("=" * 60 + "\n")


def main():
    parser = argparse.ArgumentParser(
        description="アニメあらすじ類似度算出プログラム"
    )
    parser.add_argument(
        "--csv",
        type=str,
        default=DEFAULT_CSV_PATH,
        help="入力CSVファイルパス (デフォルト: danime_synopses_1990_2026_animeonly.csv)",
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help="動作テストモード（先頭5作品のみで類似度算出を実行）",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="処理対象作品数の上限（テストや検証用。未指定時は全作品）",
    )
    parser.add_argument(
        "--cores",
        type=int,
        default=30,
        help="使用するCPUコア数/スレッド数（デフォルト: 30）",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=32,
        help="エンコード時のバッチサイズ（デフォルト: 32）",
    )
    parser.add_argument(
        "--top-k",
        type=int,
        default=10,
        help="各作品の上位類似作品抽出数（デフォルト: 10）",
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
    file_prefix = "anime_test" if limit is not None else "anime"

    print("==================================================")
    print("        アニメあらすじ類似度算出処理 開始         ")
    print("==================================================")

    # 1. データ読み込み（あらすじ欠損除外）
    df = load_anime_data(args.csv, limit=limit)
    if len(df) == 0:
        print("エラー: 対象のアニメデータが0件です。")
        sys.exit(1)

    # 2. ベクトル化と類似度計算
    embeddings, sim_matrix = compute_similarities(
        df=df,
        batch_size=args.batch_size,
        num_cores=args.cores,
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

    # 6. コンソールに結果を表示
    print_sample_results(df_top_sim, num_samples=min(5, len(df)))

    print("==================================================")
    print("                  処理が完了しました              ")
    print("==================================================")


if __name__ == "__main__":
    main()