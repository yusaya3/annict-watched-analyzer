"""
アニメストーリー構造類似度算出プログラム（アプローチ1: LLM構造化要約 ＋ デュアルベクトルハイブリッド）
【Google Colab 対応・完全無料枠 2アカウント分割実行版】

無料枠（Free Tier）2アカウント完全最適化仕様:
1. 【複数APIキー対応】2つのGemini APIキーを交互（ラウンドロビン）に利用し、2倍の速度で処理
2. 【レート自動制御】各キーが 15 RPM（4.1秒間隔）を超えないよう精密制御（全体で約2.0秒間隔）
3. 【1日上限安全停止】1キーあたり1,480件（2キーで計2,960件）に達すると、自動で進捗を保存して安全停止
   - 1日目: 約2,960件完了
   - 2日目: 約2,960件完了（累計約5,920件）
   - 3日目: 残り約347件完了 ＆ そのまま自動でEmbeddingGemma 2ベクトル化・ZIP出力まで完走！
4. 【中断・再開対応】10件ごとにチェックポイント保存。いつでも中断・再開可能
"""

import argparse
import json
import os
os.environ.setdefault("TRANSFORMERS_NO_TORCHVISION", "1")

import re
import sys
import time
import zipfile
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from tqdm.auto import tqdm

# ※ torch / sentence-transformers は重く、環境差異でimportエラーになりやすいため、
#    ベクトル化フェーズ（compute_dual_embeddings）内で遅延importします。
#    これにより、Gemini要約フェーズは埋め込み環境の問題に影響されず実行できます。

DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite"
DEFAULT_EMBEDDING_MODEL = "google/embeddinggemma-2"
FALLBACK_EMBEDDING_MODEL = "google/embeddinggemma-300m"
DEFAULT_DAILY_LIMIT = 500  # 無料枠 flash-lite の1日上限（RPD: 500/日・プロジェクト）


def safe_str(value) -> str:
    """NaN/None を空文字に変換して文字列化する（str(NaN) == 'nan' になる問題の防止）。"""
    if value is None:
        return ""
    try:
        if pd.isna(value):
            return ""
    except (TypeError, ValueError):
        pass
    return str(value).strip()


# ==========================================
# 環境判定 & パス解決ヘルパー
# ==========================================
def is_colab() -> bool:
    """実行環境が Google Colab かどうかを判定する。"""
    try:
        import google.colab  # noqa: F401
        return True
    except ImportError:
        return False


def get_base_dir() -> str:
    """スクリプト自身のディレクトリ、またはカレントディレクトリを取得。"""
    try:
        return os.path.dirname(os.path.abspath(__file__))
    except NameError:
        return os.getcwd()


def resolve_csv_path(specified_path: Optional[str], default_filename: str) -> str:
    """CSVファイルのパスを自動探索して解決する。"""
    if specified_path and str(specified_path).strip() and os.path.exists(specified_path.strip()):
        return os.path.abspath(specified_path.strip())

    candidates = [
        os.path.join("/content", default_filename),
        os.path.join("/content/drive/MyDrive", default_filename),
        os.path.join("/content/drive/MyDrive/アニメ類似度", default_filename),
        os.path.join("/content/drive/MyDrive/アニメストーリー構造類似度", default_filename),
        os.path.join(os.getcwd(), default_filename),
        os.path.join(get_base_dir(), default_filename),
    ]

    for c in candidates:
        if os.path.exists(c):
            return os.path.abspath(c)

    # 見つからない場合は詳細な案内を出してエラー
    searched = "\n".join([f"  - {c}" for c in candidates])
    raise FileNotFoundError(
        f"\n【エラー】CSVファイル '{default_filename}' が見つかりませんでした。\n"
        f"以下の候補を探索しました:\n{searched}\n"
        f"Colabの左メニュー（/content/）に '{default_filename}' をアップロードしてください。"
    )


# ==========================================
# 1. データ読み込み & 欠損作品除外
# ==========================================
def load_and_align_datasets(
    synopsis_csv_path: Optional[str] = None,
    sequence_csv_path: Optional[str] = None,
    limit: Optional[int] = None,
) -> pd.DataFrame:
    """全体あらすじCSVと全話あらすじCSVを読み込み、全体あらすじ欠損作品を除外して完全同期する。"""
    # ノートブックのセル4で設定された環境変数（SYNOPSIS_CSV / SEQUENCE_CSV）も考慮する
    synopsis_csv_path = resolve_csv_path(
        synopsis_csv_path if synopsis_csv_path and os.path.exists(synopsis_csv_path) else os.environ.get("SYNOPSIS_CSV"),
        "danime_synopses_1990_2026_animeonly.csv",
    )
    sequence_csv_path = resolve_csv_path(
        sequence_csv_path if sequence_csv_path and os.path.exists(sequence_csv_path) else os.environ.get("SEQUENCE_CSV"),
        "danime_works_with_story_sequence_1990_2026.csv",
    )

    print(f"\n[1/5] データセットの読み込みと整合性チェック...")
    print(f"      - 全体あらすじCSV: {synopsis_csv_path}")
    print(f"      - 全話あらすじCSV: {sequence_csv_path}")

    df_syn = pd.read_csv(synopsis_csv_path)
    df_seq = pd.read_csv(sequence_csv_path)

    raw_syn_count = len(df_syn)

    # 1. 全体あらすじ(synopsis)が存在しない作品を除外 (NaN または 空白文字列)
    df_syn_clean = df_syn.dropna(subset=["synopsis"]).copy()
    df_syn_clean["synopsis"] = df_syn_clean["synopsis"].astype(str).str.strip()
    df_syn_clean = df_syn_clean[df_syn_clean["synopsis"] != ""].copy()

    valid_work_ids = set(df_syn_clean["work_id"].astype(str))
    excluded_count = raw_syn_count - len(df_syn_clean)

    print(
        f"      ✔ 全体あらすじ有効作品: {len(df_syn_clean)} 件 "
        f"(あらすじ欠損除外: {excluded_count} 件)"
    )

    # 2. 全話エピソード側でも同じ作品IDのみに厳密に絞り込み（重複IDは先頭のみ採用）
    df_seq["work_id_str"] = df_seq["work_id"].astype(str)
    df_seq_clean = df_seq[df_seq["work_id_str"].isin(valid_work_ids)].copy()
    df_seq_clean = df_seq_clean.drop_duplicates(subset=["work_id_str"], keep="first")
    for col in ("total_episodes", "story_sequence_text"):
        if col not in df_seq_clean.columns:
            df_seq_clean[col] = None

    # 3. work_id をキーにしてマージ（両方のカラムを統合）
    df_syn_clean["work_id_str"] = df_syn_clean["work_id"].astype(str)
    df_syn_clean = df_syn_clean.drop_duplicates(subset=["work_id_str"], keep="first")
    merged = pd.merge(
        df_syn_clean,
        df_seq_clean[["work_id_str", "total_episodes", "story_sequence_text"]],
        on="work_id_str",
        how="inner",
    )

    merged = merged.drop(columns=["work_id_str"], errors="ignore")
    merged = merged.reset_index(drop=True)

    print(
        f"      ✔ 両データセット完全統合完了: {len(merged)} 作品 "
        f"(厳密に一致する母集団を確定)"
    )

    if limit is not None and limit > 0:
        merged = merged.head(limit).copy()
        print(f"      ※ テストモード実行: 先頭 {limit} 作品のみを対象とします。")

    return merged


# ==========================================
# 2. Gemini API による構造化プロット要約の生成
# ==========================================
SUMMARY_PROMPT_TEMPLATE = """あなたはアニメの物語構造分析の専門家です。
以下のアニメの「全話各話あらすじ」を分析し、作品全体のストーリー展開の骨格を以下のフォーマット（800〜1200文字程度）で構造化して出力してください。
※作品名やキャラクター固有の固有名詞に過度に依存せず、「どのような動機で」「どのような葛藤や事件があり」「どう転換し」「どう解決・結末を迎えるか」のプロット構造を明確に記述してください。

【基本設定・動機】主人公の境遇、物語を動かす根源的な動機・目的
【発端・展開】日常の崩壊、冒険や戦いの開始、仲間との出会い・対立
【転換点・危機】物語最大の試練、裏切り、隠された真実の発覚、絶望
【結末・解決】最終局面の展開、対立の決着、主人公や世界の帰結
【テーマ・トーン】作品全体を貫く主題（例: 運命への抗い、復讐の虚しさ、少年の精神的成熟）

---
【全話各話あらすじ】
{episodes_text}
"""


class DailyQuotaExceeded(Exception):
    """1日あたりのAPIクォータ上限（RPD）に達したことを示す例外"""
    pass


class InvalidApiKeyError(Exception):
    """APIキーが無効（期限切れ・誤入力・権限なし）であることを示す例外"""
    pass


class FatalGeminiError(Exception):
    """モデル名の誤り等、リトライしても回復しない致命的エラー"""
    pass


class SafetyBlockedError(Exception):
    """Gemini APIのセーフティフィルター等により過激描写としてブロックされたことを示す例外"""
    pass


def is_daily_quota_error(error_str: str) -> bool:
    """エラーメッセージから1日あたりの上限（RPD）に達したかを判定する。
    ※ 1分あたりの上限（RPM/TPM）と1日上限（RPD）を厳密に区別します。
    """
    lowered = error_str.lower()
    # 1. quotaId による明示的な判定（例: GenerateRequestsPerDayPerProjectPerModel-FreeTier）
    if "perday" in lowered or "per day" in lowered:
        return True
    # 2. 1分あたり上限（RPM/TPM）は一時的なので1日上限ではない
    if "perminute" in lowered or "per minute" in lowered:
        return False
    # 3. 数時間〜数日単位のリトライ指定（例: "retry in 14h38m35s", "retry in 1d"）
    if re.search(r"retry\s+in\s+\d+(?:\.\d+)?\s*[hd]", lowered):
        return True
    # 4. retryDelay が10分以上（例: 3600s, 52715s）
    delay_match = re.search(r"retrydelay['\":\s]+(\d+)", lowered)
    if delay_match and int(delay_match.group(1)) > 600:
        return True
    return False


def is_invalid_api_key_error(error_str: str) -> bool:
    lowered = error_str.lower()
    return (
        "api_key_invalid" in lowered
        or "api key not valid" in lowered
        or "api key expired" in lowered
        or "permission_denied" in lowered
    )


def is_model_not_found_error(error_str: str) -> bool:
    lowered = error_str.lower()
    return ("404" in lowered or "not_found" in lowered) and ("model" in lowered or "not found" in lowered)


def parse_retry_delay(error_str: str, default_wait: int = 55) -> float:
    """エラーメッセージから retryDelay または retry in XXs を抽出し、待機秒数（+2秒バッファ）を返す。"""
    lowered = error_str.lower()
    # "retry in 55.43s" や "retry in 55s"
    m = re.search(r"retry\s+in\s+([\d\.]+)\s*s", lowered)
    if m:
        try:
            return min(float(m.group(1)) + 2.0, 120.0)
        except ValueError:
            pass
    # "retryDelay": "55s" または retrydelay: 55
    m2 = re.search(r"retrydelay['\":\s]+(\d+)", lowered)
    if m2:
        try:
            return min(float(m2.group(1)) + 2.0, 120.0)
        except ValueError:
            pass
    return float(default_wait)


_GENAI_CLIENTS: Dict[str, object] = {}
_GENAI_CONFIG = None


def _get_genai_client(api_key: str):
    """APIキーごとに google-genai クライアントを使い回す（毎回生成するとオーバーヘッドが大きい）。"""
    from google import genai
    if api_key not in _GENAI_CLIENTS:
        _GENAI_CLIENTS[api_key] = genai.Client(api_key=api_key)
    return _GENAI_CLIENTS[api_key]


def _get_genai_config():
    """セーフティフィルターによる無言ブロック（空レスポンス）を防止する生成設定。"""
    global _GENAI_CONFIG
    if _GENAI_CONFIG is None:
        from google.genai import types
        categories = [
            types.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            types.HarmCategory.HARM_CATEGORY_HARASSMENT,
            types.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            types.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        ]
        _GENAI_CONFIG = types.GenerateContentConfig(
            safety_settings=[
                types.SafetySetting(category=c, threshold=types.HarmBlockThreshold.BLOCK_NONE)
                for c in categories
            ]
        )
    return _GENAI_CONFIG


def mask_key(api_key: str) -> str:
    return api_key[:6] + "..." + api_key[-4:] if len(api_key) > 10 else "***"


def resolve_gemini_model(api_keys: List[str], requested: str) -> str:
    """指定モデルが利用可能か確認し、利用不可（廃止等）なら最新の flash-lite / flash に自動切替する。"""
    for key in api_keys:
        try:
            client = _get_genai_client(key)
            available = []
            for m in client.models.list():
                name = str(getattr(m, "name", "")).replace("models/", "")
                actions = getattr(m, "supported_actions", None) or []
                if name and (not actions or "generateContent" in actions):
                    available.append(name)
        except Exception as e:
            print(f"      ※ モデル一覧の取得に失敗しました（{mask_key(key)}）: {str(e)[:200]}")
            continue

        if not available or requested.replace("models/", "") in available:
            return requested

        def version_key(n: str) -> float:
            mv = re.search(r"gemini-(\d+(?:\.\d+)?)", n)
            return float(mv.group(1)) if mv else 0.0

        for pattern in (r"^gemini-[\d\.]+-flash-lite$", r"^gemini-[\d\.]+-flash$", r"flash-lite", r"flash"):
            cands = sorted([n for n in available if re.search(pattern, n)], key=version_key, reverse=True)
            if cands:
                print(f"      ⚠️ 指定モデル '{requested}' は利用できません。'{cands[0]}' に自動切替します。")
                return cands[0]
        print(f"      ⚠️ 指定モデル '{requested}' が見つかりません。利用可能モデル: {available[:20]}")
        return requested
    return requested


def load_blocked_works(output_dir: str, default_filename: str = "blocked_works.csv") -> Dict[str, dict]:
    """除外・ブロックされた作品リスト（blocked_works.csv）を探索してロードする。"""
    candidates = [
        os.path.join(output_dir, default_filename) if output_dir else None,
        default_filename,
        f"/content/drive/MyDrive/アニメストーリー構造類似度/{default_filename}",
        f"/content/{default_filename}",
    ]
    for c in candidates:
        if c and os.path.exists(c):
            try:
                df_b = pd.read_csv(c)
                if "work_id" in df_b.columns:
                    result = {}
                    for _, row in df_b.iterrows():
                        wid = str(row["work_id"])
                        result[wid] = row.to_dict()
                    return result
            except Exception:
                pass
    return {}


def save_blocked_works_data(
    output_dir: str,
    blocked_works: Dict[str, dict],
    default_filename: str = "blocked_works.csv",
) -> List[str]:
    """除外された作品リストを CSV として output_dir およびカレントに即時保存する。"""
    rows = list(blocked_works.values())
    targets = set()
    if output_dir:
        targets.add(os.path.join(os.path.abspath(output_dir), default_filename))
    targets.add(os.path.abspath(default_filename))

    df_b = pd.DataFrame(rows) if rows else pd.DataFrame(columns=["work_id", "title", "year", "genre", "reason"])
    saved = []
    for path in sorted(list(targets)):
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            df_b.to_csv(path, index=False, encoding="utf-8-sig")
            saved.append(path)
        except Exception:
            pass
    return saved


def call_gemini_api(
    episodes_text: str,
    api_key: str,
    model_name: str = DEFAULT_GEMINI_MODEL,
    max_retries: int = 4,
) -> Optional[str]:
    """Gemini API を呼び出し、全話テキストから構造化プロット要約を生成する。

    ※ 1日上限（RPD）を検知した場合は待機せず直ちに DailyQuotaExceeded を送出します。
    ※ セーフティフィルターによる拒否を検知した場合は SafetyBlockedError を送出します。
    """
    if not episodes_text or len(episodes_text.strip()) == 0:
        return None

    # トークン超過防止（全話テキストが長すぎる場合は前後半を抽出）
    if len(episodes_text) > 30000:
        half_head = 18000
        half_tail = 12000
        episodes_text = episodes_text[:half_head] + "\n…(中略)…\n" + episodes_text[-half_tail:]

    prompt = SUMMARY_PROMPT_TEMPLATE.format(episodes_text=episodes_text)

    # Google公式最新SDK: google-genai のみを使用
    try:
        client = _get_genai_client(api_key)
        config = _get_genai_config()
    except ImportError:
        raise FatalGeminiError("google-genai ライブラリが見つかりません。!pip install -q -U google-genai を実行してください。")

    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=config,
            )
            text = None
            finish_reason = None
            block_reason = None

            # 1. prompt_feedback の確認（プロンプト全体が有害・セーフティでブロックされた場合）
            prompt_feedback = getattr(response, "prompt_feedback", None)
            if prompt_feedback:
                br = getattr(prompt_feedback, "block_reason", None)
                if br and str(br).upper() not in ("NONE", "BLOCK_REASON_UNSPECIFIED", "0"):
                    block_reason = str(br)

            # 2. candidates の確認
            candidates = getattr(response, "candidates", None) or []
            if candidates:
                cand0 = candidates[0]
                finish_reason = getattr(cand0, "finish_reason", None)
                s_ratings = getattr(cand0, "safety_ratings", None) or []
                for sr in s_ratings:
                    if getattr(sr, "blocked", False):
                        block_reason = f"SafetyRating Blocked ({getattr(sr, 'category', '')})"
                        break

            # 3. .text プロパティの取得
            try:
                text = response.text if response else None
            except Exception as e:
                err_lower = str(e).lower()
                if any(w in err_lower for w in ("safety", "blocked", "candidate", "finish_reason", "harm", "valueerror")):
                    raise SafetyBlockedError(f"セーフティフィルターにより生成がブロックされました（{e}）")

            if text and text.strip():
                return text.strip()

            # 4. ブロック理由が明示されている場合
            fr_upper = str(finish_reason).upper() if finish_reason else ""
            if block_reason:
                raise SafetyBlockedError(f"セーフティフィルターによりプロンプトがブロックされました（reason: {block_reason}）")
            if any(w in fr_upper for w in ("SAFETY", "BLOCKLIST", "PROHIBITED", "RECITATION", "OTHER")):
                raise SafetyBlockedError(f"セーフティフィルターにより生成がブロックされました（finish_reason: {finish_reason}）")

            # 5. candidates が空、または正常レスポンスなのにテキストが一切返ってこなかった場合
            # APIエラー（通信障害等）ではないのにテキストが空 = コンテンツ内容に起因するモデルの出力拒否
            if not candidates or not text or not text.strip():
                raise SafetyBlockedError(
                    f"モデルがコンテンツを拒否しました（空レスポンス / candidates={len(candidates)}, finish_reason={finish_reason}）"
                )

            if attempt == max_retries - 1:
                return None
            time.sleep(2)
        except SafetyBlockedError:
            raise
        except Exception as e:
            err_str = str(e)
            err_lower = err_str.lower()
            # セーフティブロック関連キーワードが含まれる場合
            if any(w in err_lower for w in ("safety", "blocked", "harm", "policy", "sensitive", "inappropriate")):
                raise SafetyBlockedError(f"セーフティフィルターにより生成がブロックされました: {err_str[:200]}")

            # 生のエラーメッセージを出力（長すぎる場合は省略）
            print(f"\n      [Gemini API Error] {err_str[:500]}", flush=True)

            if is_daily_quota_error(err_str):
                raise DailyQuotaExceeded(f"1日上限 (RPD): {err_str[:300]}")
            if is_invalid_api_key_error(err_str):
                raise InvalidApiKeyError(err_str[:300])
            if is_model_not_found_error(err_str):
                raise FatalGeminiError(
                    f"モデル '{model_name}' が見つかりません（廃止・名称誤りの可能性）。"
                    f" --model で利用可能なモデル名を指定してください。\n{err_str[:300]}"
                )

            if attempt == max_retries - 1:
                return None

            if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str:
                wait_time = parse_retry_delay(err_str, default_wait=55)
            elif "503" in err_str or "UNAVAILABLE" in err_str or "500" in err_str or "INTERNAL" in err_str:
                wait_time = 5 + (attempt * 5)
            else:
                wait_time = (2 ** attempt) + 1
            time.sleep(wait_time)

    return None


def clean_plot_summary_for_embedding(text: str) -> str:
    """冒頭のAI挨拶文やタイトル言及を除去し、【基本設定・動機】以降のプロット構造本文のみを抽出する。

    ※ Markdown見出し記号（##, ###）や太字記号（**）、末尾・途中の（○○文字）表記を除去し、
      テキスト先頭の空行・改行を完全に排除した上で、各セクション見出しの間に空行1行（\\n\\n）を配置して完全統一します。
    """
    if not text:
        return ""

    # 改行コードの統一
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    # 1. 冒頭の挨拶文や前置きカット:
    # 記号（#, *, -, 1., ■ 等）や空白を挟んで「【基本設定」または最初の「【」がある場所を探す
    match = re.search(r"(?:^|\n)[ \t#\*\-\d\.\■]*(【基本設定[・/].*?$)", text, re.DOTALL)
    if match:
        body = match.group(1).strip()
    else:
        match_any = re.search(r"(?:^|\n)[ \t#\*\-\d\.\■]*(【.*?】.*$)", text, re.DOTALL)
        body = match_any.group(1).strip() if match_any else text.strip()

    # 2. 各行頭・行末の Markdown 記号（#, * 等）を除去（太字 **【見出し】** や ### 【見出し】 を除去）
    body = re.sub(r"(?m)^[ \t#\*\-\■]+\s*", "", body)
    body = re.sub(r"(【[^】\n]+】)[ \t\*]+", r"\1", body)
    body = re.sub(r"[ \t\*]+(【[^】\n]+】)", r"\1", body)

    # 3. （○○文字）や (約1000文字) などの文字数カウント表記を除去
    char_count_pattern = r"[（\(]\s*(?:約|全|計|合計[：:]?\s*約?|文字数[：:]?\s*約?)?\s*[\d,，]+\s*(?:文字|字)(?:程度|前後)?\s*[）\)]"
    body = re.sub(char_count_pattern, "", body)

    # 4. 見出し直後に改行がなければ改行を挿入
    body = re.sub(r"(【[^】\n]+】)(?!\n)", r"\1\n", body)

    # 5. 各セクション見出し【...】の直前の改行をすべて「空行1行（\n\n）」に統一
    body = re.sub(r"(?:\n)+\s*(【[^】\n]+】)", r"\n\n\1", body)

    # 6. 3つ以上連続する空行を整理し、先頭と末尾の空白・全角スペース・改行を完全除去
    body = re.sub(r"\n{3,}", "\n\n", body)
    body = body.strip(" \t\n\r\u3000\u00a0")
    return body


def export_cleaned_plot_summaries(
    output_dir: str,
    df: pd.DataFrame,
    summaries: Dict[str, str],
    only_completed: bool = False,
) -> str:
    """ベクトル化入力用プロット構造テキスト（冒頭挨拶文・タイトルをカットし純粋なプロット構造本文のみ抽出）をCSVとして出力する。

    ※ ZIPファイルとは別に単独ファイルとして出力します。
    """
    os.makedirs(output_dir, exist_ok=True)
    cleaned_rows = []
    for _, row in df.iterrows():
        wid = str(row["work_id"])
        summary = summaries.get(wid, "").strip()
        if only_completed and not summary:
            continue
        cleaned_text = clean_plot_summary_for_embedding(summary) if summary else ""
        cleaned_rows.append({
            "work_id": wid,
            "title": str(row.get("title", "")),
            "cleaned_plot_summary": cleaned_text,
        })
    cleaned_df = pd.DataFrame(cleaned_rows)
    cleaned_csv_path = os.path.join(output_dir, "story_plot_summaries_cleaned.csv")
    cleaned_df.to_csv(cleaned_csv_path, index=False, encoding="utf-8-sig")
    print(f"      - ベクトル化入力用クリーン済み要約CSV (ZIP外・単独出力): {cleaned_csv_path} ({len(cleaned_df)} 件)")
    return cleaned_csv_path


def save_checkpoint_data(
    output_dir: str,
    checkpoint_file: str,
    summaries: Dict[str, str],
) -> List[str]:
    """チェックポイントを checkpoint_summaries.json として output_dir およびカレントディレクトリに確実に即時保存する。
    ※ os.fsync によりOSの書き込みバッファを強制フラッシュし、ColabやDrive上で即座に確認できるようにします。
    """
    targets = set()
    if checkpoint_file:
        targets.add(os.path.abspath(checkpoint_file))
        dir_name = os.path.dirname(os.path.abspath(checkpoint_file))
        targets.add(os.path.join(dir_name, "checkpoint_summaries.json"))

    if output_dir:
        targets.add(os.path.join(os.path.abspath(output_dir), "checkpoint_summaries.json"))

    # カレント作業ディレクトリ（Colabの /content/ 等）にも直接配置
    targets.add(os.path.abspath("checkpoint_summaries.json"))

    saved_paths = []
    for path in sorted(list(targets)):
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(summaries, f, ensure_ascii=False, indent=2)
                f.flush()
                os.fsync(f.fileno())
            saved_paths.append(path)
        except Exception:
            pass
    return saved_paths


def find_and_load_checkpoint(
    output_dir: str,
    checkpoint_file: str,
) -> Tuple[Dict[str, str], Optional[str]]:
    """既存のチェックポイント（checkpoint_summaries.json）を自動探索してロードする。"""
    candidates = [
        checkpoint_file,
        os.path.join(output_dir, "checkpoint_summaries.json") if output_dir else None,
        "checkpoint_summaries.json",
        "/content/drive/MyDrive/アニメストーリー構造類似度/checkpoint_summaries.json",
        "/content/checkpoint_summaries.json",
        # 過去互換性用フォールバック
        os.path.join(output_dir, "checkpoint.json") if output_dir else None,
        "checkpoint.json",
        "/content/drive/MyDrive/アニメストーリー構造類似度/checkpoint.json",
        "/content/checkpoint.json",
    ]

    best_data: Dict[str, str] = {}
    best_path = None

    for c in candidates:
        if not c or not os.path.exists(c):
            continue
        try:
            with open(c, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and len(data) > len(best_data):
                best_data = data
                best_path = os.path.abspath(c)
        except Exception:
            continue

    return best_data, best_path


def _load_failed_counts(path: str) -> Dict[str, int]:
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                return {str(k): int(v) for k, v in data.items()}
    except Exception:
        pass
    return {}


def _save_failed_counts(path: str, failed: Dict[str, int]) -> None:
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(failed, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def generate_all_plot_summaries(
    df: pd.DataFrame,
    api_keys: List[str],
    checkpoint_file: str,
    model_name: str = DEFAULT_GEMINI_MODEL,
    daily_limit: int = DEFAULT_DAILY_LIMIT,
    per_key_interval: float = 4.1,
    max_failures_per_work: int = 3,
    max_consecutive_failures: int = 0,
) -> Tuple[Dict[str, str], bool]:
    """全作品の構造化プロット要約を生成する（複数キー無料枠最適化・レジューム対応・1日上限安全停止）。

    Returns
    -------
    Tuple[Dict[str, str], bool]
        (summaries, is_all_completed)
        全件完了した場合は True を返す。
    """
    output_dir = os.path.dirname(os.path.abspath(checkpoint_file))
    print(f"\n[2/5] Gemini APIによるプロット構造化要約の生成 (無料枠マルチキー最適化)...")
    print(f"      使用モデル: {model_name}")
    print(f"      登録APIキー数: {len(api_keys)} 個 (アカウント数)")
    print(f"      本日の最大処理枠: {daily_limit * len(api_keys)} 件 (1キーあたり {daily_limit} 件)")

    # 1. 既存チェックポイントの自動探索とロード（checkpoint.json と checkpoint_summaries.json の両方を探索）
    summaries, loaded_from = find_and_load_checkpoint(output_dir, checkpoint_file)
    if loaded_from:
        print(f"      ✔ チェックポイントから既存 {len(summaries)} 件の要約をロードしました")
        print(f"        (ロード元: {loaded_from})")

        # 【安全機構1】エラー混入等で不完全なデータを自動検出し、再生成対象に戻す
        valid_summaries = {}
        corrupted_count = 0
        for wid, text in summaries.items():
            if text and ("【基本設定" in text) and len(text.strip()) >= 500:
                valid_summaries[wid] = text
            else:
                corrupted_count += 1
        if corrupted_count > 0:
            print(f"      ※ 不完全な要約データ（APIエラー混入等）{corrupted_count} 件を自動検出し、再生成対象に戻しました")
            summaries = valid_summaries
    else:
        print(f"      ※ 既存のチェックポイントは見つかりませんでした（新規作成します）")

    # 【重要】実行開始の瞬間に直ちに初期チェックポイントファイルをディスク上に確定
    initial_saved = save_checkpoint_data(output_dir, checkpoint_file, summaries)
    print(f"      💾 チェックポイント保存先（即時同期・常時更新）:")
    for sp in initial_saved:
        print(f"         - {sp}")

    # 既存の除外・ブロック作品リスト（blocked_works.csv）をロード
    blocked_works = load_blocked_works(output_dir)
    if blocked_works:
        print(f"      ✔ 除外作品リストから既存 {len(blocked_works)} 件の記録をロードしました (blocked_works.csv)")

    # 何度試しても要約できない作品（通常APIエラー等）の失敗回数を記録
    failed_path = os.path.join(output_dir, "failed_summaries.json")
    failed_counts = _load_failed_counts(failed_path)

    # 未完了の作品をリストアップ（要約済み、またはすでに除外記録済みの作品は除外）
    tasks = []
    for _, row in df.iterrows():
        wid = str(row["work_id"])
        if summaries.get(wid) or wid in blocked_works:
            continue
        seq_text = safe_str(row.get("story_sequence_text"))
        if not seq_text:
            seq_text = safe_str(row.get("synopsis"))
        title = safe_str(row.get("title"))
        year = row.get("year")
        genre = safe_str(row.get("genre"))
        tasks.append((wid, seq_text, title, year, genre))

    total_needed = len(tasks)
    print(f"      - 残り未処理作品: {total_needed} 件 / 全 {len(df)} 件")
    if blocked_works:
        print(f"      - 過激描写等による除外記録済み: {len(blocked_works)} 件 (blocked_works.csv)")

    if not tasks:
        print(f"      🎉 すべての作品（全{len(df):,}件）の要約および仕分けが完了しています！")
        return summaries, True

    # 指定モデルの利用可否を確認（廃止モデルなら自動切替）
    model_name = resolve_gemini_model(api_keys, model_name)
    print(f"      使用モデル（確定）: {model_name}")

    # 1日に処理する最大件数（例: 2キーなら 500 * 2 = 1,000件）
    max_today = min(total_needed, daily_limit * len(api_keys))
    today_tasks = tasks[:max_today]

    active_keys = list(api_keys)
    key_usage: Dict[str, int] = {k: 0 for k in api_keys}
    last_call: Dict[str, float] = {k: 0.0 for k in api_keys}
    processed_today = 0
    blocked_today = 0
    failed_today = 0
    consecutive_failures = 0
    key_idx = 0
    quota_reached_all = False
    fatal_error: Optional[str] = None

    est_interval = max(0.5, per_key_interval / len(active_keys))
    est_minutes = (len(today_tasks) * est_interval) / 60
    print(f"      ▶ 本日の処理実行: {len(today_tasks)} 件 (想定時間: 約 {est_minutes:.1f} 分〜 / 平均間隔: {est_interval:.2f}秒)")

    pbar = tqdm(total=len(today_tasks), desc="本日のプロット要約生成", unit="作")

    def _drop_key(key: str, reason: str) -> None:
        if key in active_keys:
            active_keys.remove(key)
        print(f"\n      ⚠️ キー ({mask_key(key)}) を使用停止: {reason}")
        if active_keys:
            print(f"      🔄 残り {len(active_keys)} 個のAPIキーで処理を継続します...")
        else:
            print(f"      🛑 利用可能なAPIキーがなくなりました。")

    try:
        for wid, text, title, year, genre in today_tasks:
            if not active_keys:
                quota_reached_all = True
                break

            success = False
            is_blocked = False
            block_reason = ""
            attempts_left = len(active_keys)
            while active_keys and attempts_left > 0:
                attempts_left -= 1
                cur_api_key = active_keys[key_idx % len(active_keys)]
                key_idx += 1

                # キーごとの本日の上限件数チェック
                if key_usage[cur_api_key] >= daily_limit:
                    _drop_key(cur_api_key, f"本日の設定上限 {daily_limit} 件に到達")
                    attempts_left = min(attempts_left, len(active_keys))
                    continue

                # キーごとのRPM制御（前回呼び出しから per_key_interval 秒以上空ける）
                wait = last_call[cur_api_key] + per_key_interval - time.time()
                if wait > 0:
                    time.sleep(wait)

                try:
                    last_call[cur_api_key] = time.time()
                    key_usage[cur_api_key] += 1
                    summary_text = call_gemini_api(text, api_key=cur_api_key, model_name=model_name)
                    last_call[cur_api_key] = time.time()

                    if summary_text:
                        summaries[wid] = summary_text
                        processed_today += 1
                        consecutive_failures = 0
                        success = True

                        # ★ 1件成功するごとにチェックポイント（checkpoint_summaries.json）を全箇所に即時保存
                        save_checkpoint_data(output_dir, checkpoint_file, summaries)

                        # ★ 10件ごとにクリーン済み要約CSVも即時更新出力
                        if processed_today % 10 == 0:
                            export_cleaned_plot_summaries(output_dir, df, summaries, only_completed=False)
                        break
                except SafetyBlockedError as sb_err:
                    # 過激描写等によるセーフティ拒否 → 同一プロンプトでは別キーでも同じなので即座に除外フラグを立てて終了
                    is_blocked = True
                    block_reason = str(sb_err)
                    break
                except DailyQuotaExceeded:
                    _drop_key(cur_api_key, "本日の無料枠上限（RPD）に到達")
                    attempts_left = len(active_keys)
                except InvalidApiKeyError as e:
                    _drop_key(cur_api_key, f"APIキーが無効です（{str(e)[:120]}）")
                    attempts_left = len(active_keys)
                except FatalGeminiError as e:
                    fatal_error = str(e)
                    break

            if fatal_error:
                break

            if not active_keys and not success and not is_blocked:
                quota_reached_all = True

            # 【ユーザー要望】セーフティ拒否された作品はチェックポイントに書き込まず、別途 blocked_works.csv に書き留める
            if is_blocked:
                year_val = None
                try:
                    if pd.notnull(year):
                        year_val = int(float(year))
                except Exception:
                    pass

                blocked_works[wid] = {
                    "work_id": wid,
                    "title": title,
                    "year": year_val,
                    "genre": genre,
                    "reason": block_reason or "Safety Filter Blocked (過激描写・性的描写によるセーフティ拒否)",
                }
                save_blocked_works_data(output_dir, blocked_works)
                blocked_today += 1
                consecutive_failures = 0  # システム障害ではないため安全停止カウンターはリセット
                print(f"\n      🚫 作品 {wid} ({title[:25]}) は過激描写等のため除外（blocked_works.csv に書き留め）")
            elif not success and not quota_reached_all:
                failed_today += 1
                consecutive_failures += 1
                failed_counts[wid] = failed_counts.get(wid, 0) + 1
                _save_failed_counts(failed_path, failed_counts)
                print(f"\n      ✖ 作品 {wid} ({title[:25]}) の要約に失敗。次の作品へ進みます。")
                if max_consecutive_failures > 0 and consecutive_failures >= max_consecutive_failures:
                    print(
                        f"\n      ⚠️ 【連続失敗警告】{consecutive_failures} 件連続で要約に失敗しましたが、"
                        f"中断せずに後続作品の処理を続行します..."
                    )
                    consecutive_failures = 0

            # 成功・除外・失敗にかかわらずプログレスバーを1進め、進捗をリアルタイム表示
            pbar.update(1)
            pbar.set_postfix({"本日要約": processed_today, "除外": blocked_today, "失敗": failed_today, "累計要約": len(summaries)})

            if fatal_error:
                break
            if quota_reached_all:
                print(f"\n      💾 これまでの進捗（要約 {len(summaries)} 件, 除外 {len(blocked_works)} 件）を安全に保存して本日の処理を停止します。")
                break

    finally:
        pbar.close()
        # 中断・停止・正常終了を問わず、直前の進捗を確実に全保存先にディスクフラッシュ保存
        save_checkpoint_data(output_dir, checkpoint_file, summaries)
        save_blocked_works_data(output_dir, blocked_works)
        _save_failed_counts(failed_path, failed_counts)
        export_cleaned_plot_summaries(output_dir, df, summaries, only_completed=False)

    # 残り件数は df に含まれる作品のみで数える（要約完了 + 除外記録済み = 処理完了）
    df_ids = [str(x) for x in df["work_id"]]
    done_in_df = sum(1 for w in df_ids if summaries.get(w))
    blocked_in_df = sum(1 for w in df_ids if w in blocked_works)
    remaining_after_today = sum(1 for w in df_ids if not summaries.get(w) and w not in blocked_works)
    print(f"\n      ✔ 本日の処理完了: 本日 {processed_today} 件要約成功 / {blocked_today} 件除外記録 / {failed_today} 件失敗")
    print(f"        (全 {len(df)} 作品中: 要約完了 {done_in_df} 件, 除外記録 {blocked_in_df} 件, 残り未処理 {remaining_after_today} 件)")

    if fatal_error:
        print("=" * 65)
        print(f"  ❌ 【致命的エラーのため処理を中断しました】")
        print(f"  {fatal_error}")
        print(f"  これまでの進捗はチェックポイントに保存済みです。原因を解消して再実行してください。")
        print("=" * 65)
        return summaries, False

    if remaining_after_today > 0:
        print("=" * 65)
        if quota_reached_all:
            print(f"  🔔 【本日の無料枠上限（RPD）に達したため安全に自動停止しました】")
        else:
            print(f"  🔔 【本日の設定上限（{len(today_tasks)}件）に達しました】")
        print(f"  残り未処理作品: {remaining_after_today} 件")
        print(f"  要約進捗: {checkpoint_file} (要約済み: {done_in_df} 件)")
        print(f"  除外記録: {os.path.join(output_dir, 'blocked_works.csv')} (除外: {blocked_in_df} 件)")
        print(f"  明日（上限リセット後）、再度このノートブックのセル 6 を実行してください！")
        print("=" * 65)
        return summaries, False
    else:
        print(f"      🎉 全作品（全{len(df):,}件）の要約および除外仕分けが完了しました！後続のベクトル化処理へ進みます。")
        return summaries, True


# ==========================================
# 3. EmbeddingGemma 2 によるデュアルベクトル化
# ==========================================
def _load_embedding_model(model_name: str, device: str):
    """埋め込みモデルをロードする（失敗時は段階的にフォールバック）。"""
    import torch
    from sentence_transformers import SentenceTransformer

    # EmbeddingGemma 系は float16 だと NaN になるため、bf16（Ampere以降）か float32 を使用
    if device == "cuda" and torch.cuda.get_device_capability(0)[0] >= 8:
        dtype = torch.bfloat16
    else:
        dtype = torch.float32
    print(f"      推論精度: {dtype}")

    hf_token = os.environ.get("HF_TOKEN") or None
    attempts = []
    if "embeddinggemma-2" in model_name:
        # テキストのみ使用するため、画像・音声エンコーダは読み込まない（270M相当に軽量化）
        attempts.append((model_name, {
            "model_kwargs": {"torch_dtype": dtype},
            "config_kwargs": {"vision_config": None, "audio_config": None},
        }))
    attempts.append((model_name, {"model_kwargs": {"torch_dtype": dtype}}))
    if model_name != FALLBACK_EMBEDDING_MODEL:
        attempts.append((FALLBACK_EMBEDDING_MODEL, {"model_kwargs": {"torch_dtype": dtype}}))

    last_err = None
    for name, kwargs in attempts:
        try:
            print(f"      モデルロード中: {name} {'(テキストのみ)' if 'config_kwargs' in kwargs else ''} ...")
            model = SentenceTransformer(name, device=device, token=hf_token, **kwargs)
            return model, name
        except Exception as e:
            last_err = e
            print(f"      ⚠️ ロード失敗: {name}: {str(e)[:300]}")
    raise RuntimeError(
        f"埋め込みモデルのロードに失敗しました: {last_err}\n"
        f"  → '!pip install -q -U sentence-transformers transformers' を実行し、ランタイムを再起動してください。"
    )


def _pick_similarity_prompt(model) -> Tuple[Optional[str], str]:
    """類似度計測用のタスクプロンプト名を選ぶ（モデルに未定義なら手動プレフィックス）。"""
    prompts = getattr(model, "prompts", None) or {}
    for name in ("SentenceSimilarity", "STS", "Clustering"):
        if name in prompts:
            return name, ""
    return None, "task: sentence similarity | query: "


def _encode_with_oom_fallback(model, texts: List[str], batch_size: int, prompt_name: Optional[str]) -> np.ndarray:
    """GPUメモリ不足時はバッチサイズを半減して再試行する。"""
    import torch
    bs = max(1, batch_size)
    while True:
        try:
            kwargs = dict(
                batch_size=bs,
                show_progress_bar=True,
                normalize_embeddings=True,
                convert_to_numpy=True,
            )
            if prompt_name:
                kwargs["prompt_name"] = prompt_name
            emb = model.encode(texts, **kwargs)
            return np.asarray(emb, dtype=np.float32)
        except torch.cuda.OutOfMemoryError:
            if bs == 1:
                raise
            torch.cuda.empty_cache()
            bs = max(1, bs // 2)
            print(f"      ⚠️ GPUメモリ不足のためバッチサイズを {bs} に縮小して再試行します...")


def compute_dual_embeddings(
    df: pd.DataFrame,
    summaries: Dict[str, str],
    model_name: str = DEFAULT_EMBEDDING_MODEL,
    batch_size: int = 16,
    max_seq_length: int = 2048,
) -> Tuple[np.ndarray, np.ndarray]:
    """世界観ベクトル(v_setting)とストーリー展開ベクトル(v_plot)を算出する。

    ※タイトル・ジャンルは入力テキストから完全に除外します。
    """
    import torch

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"\n[3/5] EmbeddingGemma によるデュアルベクトル化...")
    print(f"      使用デバイス: {device}")
    if device == "cuda":
        gpu_name = torch.cuda.get_device_name(0)
        gpu_vram = torch.cuda.get_device_properties(0).total_memory / (1024**3)
        print(f"      GPU: {gpu_name} (VRAM: {gpu_vram:.1f} GB)")
    else:
        print("      ⚠️ GPUが見つかりません。CPUで実行するため非常に時間がかかります（ランタイムのタイプでGPUを選択推奨）。")

    model, loaded_name = _load_embedding_model(model_name, device)
    print(f"      ✔ モデルロード完了: {loaded_name}")
    try:
        if max_seq_length and getattr(model, "max_seq_length", None):
            model.max_seq_length = min(int(model.max_seq_length), int(max_seq_length))
    except Exception:
        pass

    prompt_name, manual_prefix = _pick_similarity_prompt(model)
    print(f"      タスクプロンプト: {prompt_name or repr(manual_prefix)}")

    # 【ユーザー要望】要約のない除外作品はベクトルの対象外とする
    valid_mask = [str(wid) in summaries and bool(str(summaries[str(wid)]).strip()) for wid in df["work_id"]]
    if not all(valid_mask):
        excluded_count = len(df) - sum(valid_mask)
        print(f"      ※ 要約のない除外作品 {excluded_count} 件をベクトルの対象外としました。")
        df = df[valid_mask].copy().reset_index(drop=True)

    # 1. 世界観テキスト（全体あらすじ synopsis のみ。タイトル・ジャンルは含めない）
    setting_texts = [manual_prefix + safe_str(s) for s in df["synopsis"]]

    # 2. ストーリー展開テキスト（冒頭挨拶文・タイトルをカットし、純粋なプロット構造本文のみを抽出）
    plot_texts = [
        manual_prefix + clean_plot_summary_for_embedding(summaries[str(wid)])
        for wid in df["work_id"]
    ]

    # エンコード（L2正規化）
    print("      ▶ 1. 世界観テキストのエンコード中 (v_setting)...")
    v_setting = _encode_with_oom_fallback(model, setting_texts, batch_size, prompt_name)

    print("      ▶ 2. ストーリー展開要約のエンコード中 (v_plot)...")
    v_plot = _encode_with_oom_fallback(model, plot_texts, batch_size, prompt_name)

    # NaN 混入チェック（精度設定ミス等の検出）
    for label, arr in (("v_setting", v_setting), ("v_plot", v_plot)):
        nan_rows = int(np.isnan(arr).any(axis=1).sum())
        if nan_rows:
            print(f"      ⚠️ {label} に NaN を含む行が {nan_rows} 件あります（0ベクトルに置換）。")
            arr[np.isnan(arr).any(axis=1)] = 0.0

    print(f"      ✔ ベクトル化完了:")
    print(f"        - v_setting: shape {v_setting.shape}")
    print(f"        - v_plot:    shape {v_plot.shape}")
    return v_setting, v_plot


# ==========================================
# 4. 上位候補プールの抽出 (Top 50 ∪ Top 50)
# ==========================================
def extract_candidate_pools(
    df: pd.DataFrame,
    v_setting: np.ndarray,
    v_plot: np.ndarray,
    summaries: Dict[str, str],
    top_k_each: int = 50,
) -> Dict[str, dict]:
    """各作品について、世界観Top50とプロットTop50をマージした上位候補プールを作成する。"""
    print(f"\n[4/5] ハイブリッド上位候補プールの高速抽出 (各作品 Top {top_k_each} ∪ Top {top_k_each})...")
    n = len(df)
    work_ids = [str(x) for x in df["work_id"]]

    print("      ▶ コサイン類似度行列の計算...")
    s_setting = np.dot(v_setting, v_setting.T)
    s_plot = np.dot(v_plot, v_plot.T)

    results: Dict[str, dict] = {}
    pbar = tqdm(total=n, desc="候補プール抽出中", unit="作")

    for i in range(n):
        wid = work_ids[i]
        row = df.iloc[i]

        scores_set = s_setting[i].copy()
        scores_set[i] = -999.0  # 自身を除外

        scores_plt = s_plot[i].copy()
        scores_plt[i] = -999.0  # 自身を除外

        top_set_idx = [j for j in np.argsort(scores_set)[::-1] if j != i][:top_k_each]
        top_plt_idx = [j for j in np.argsort(scores_plt)[::-1] if j != i][:top_k_each]

        # 和集合 (Union)
        candidate_idx_set = set(top_set_idx).union(set(top_plt_idx))

        candidate_list = []
        for c_idx in candidate_idx_set:
            c_wid = work_ids[c_idx]
            sim_setting = float(round(scores_set[c_idx], 4))
            sim_plot = float(round(scores_plt[c_idx], 4))
            candidate_list.append([c_wid, sim_setting, sim_plot])

        # デフォルト（5:5のバランス時）のスコア順で初期ソート
        candidate_list.sort(key=lambda x: (x[1] * 0.5 + x[2] * 0.5), reverse=True)

        year_val = None
        try:
            if pd.notnull(row.get("year")):
                year_val = int(float(row.get("year")))
        except (TypeError, ValueError):
            year_val = None

        results[wid] = {
            "id": wid,
            "t": safe_str(row.get("title")),
            "y": year_val,
            "g": safe_str(row.get("genre")),
            "s": safe_str(row.get("synopsis")),
            "summary": summaries.get(wid, ""),
            "url": safe_str(row.get("url")),
            "candidates": candidate_list,
        }
        pbar.update(1)

    pbar.close()
    print(f"      ✔ 全 {n} 作品の候補プール抽出完了！")
    return results


# ==========================================
# 5. 成果物の保存とZIP出力
# ==========================================
def save_and_package_results(
    output_dir: str,
    df: pd.DataFrame,
    summaries: Dict[str, str],
    v_setting: np.ndarray,
    v_plot: np.ndarray,
    candidate_pools: Dict[str, dict],
) -> str:
    """すべての成果物をファイルに書き出し、ZIPファイルを作成する。"""
    print(f"\n[5/5] 成果物の保存とパッケージング中: {output_dir}")
    os.makedirs(output_dir, exist_ok=True)

    # 1. 構造化要約テキスト CSV
    summary_df = pd.DataFrame([
        {
            "work_id": str(row["work_id"]),
            "title": str(row.get("title", "")),
            "plot_summary": summaries.get(str(row["work_id"]), ""),
        }
        for _, row in df.iterrows()
    ])
    summary_csv_path = os.path.join(output_dir, "story_plot_summaries.csv")
    summary_df.to_csv(summary_csv_path, index=False, encoding="utf-8-sig")
    print(f"      - プロット要約CSV: {summary_csv_path}")

    # 2. ベクトル化入力用プロット構造テキスト（冒頭挨拶文・タイトルをカットし純粋なプロット構造本文のみ抽出） CSV（ZIPとは別個に出力）
    export_cleaned_plot_summaries(output_dir, df, summaries, only_completed=False)

    # 3. 埋め込みベクトル (npy)
    v_set_path = os.path.join(output_dir, "setting_embeddings.npy")
    v_plt_path = os.path.join(output_dir, "plot_embeddings.npy")
    np.save(v_set_path, v_setting)
    np.save(v_plt_path, v_plot)
    print(f"      - 世界観ベクトル: {v_set_path}")
    print(f"      - ストーリー展開ベクトル: {v_plt_path}")

    # 4. ハイブリッド候補プール JSON
    json_path = os.path.join(output_dir, "story_structure_candidates.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "generatedAt": pd.Timestamp.now().isoformat(),
                "total": len(candidate_pools),
                "topKEach": 50,
                "works": candidate_pools,
            },
            f,
            ensure_ascii=False,
            separators=(',', ':'),
        )
    print(f"      - ハイブリッド候補プールJSON: {json_path}")

    # 5. ZIPアーカイブ作成（※クリーン済み要約CSVはZIPに含めず単独ファイルとして出力）
    zip_path = os.path.join(output_dir, "story_structure_similarity_results.zip")
    print(f"      ▶ ZIPファイル作成中: {zip_path} ...")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(summary_csv_path, arcname="story_plot_summaries.csv")
        zf.write(json_path, arcname="story_structure_candidates.json")
        zf.write(v_set_path, arcname="setting_embeddings.npy")
        zf.write(v_plt_path, arcname="plot_embeddings.npy")
        blocked_csv_path = os.path.join(output_dir, "blocked_works.csv")
        if os.path.exists(blocked_csv_path):
            zf.write(blocked_csv_path, arcname="blocked_works.csv")
            print(f"      - 除外作品リストもZIPに同梱: {blocked_csv_path}")

    zip_size_mb = os.path.getsize(zip_path) / (1024 * 1024)
    print(f"      ✔ ZIPアーカイブ作成完了: {zip_path} ({zip_size_mb:.2f} MB)")
    return zip_path


# ==========================================
# メインエントリーポイント
# ==========================================
def main():
    parser = argparse.ArgumentParser(
        description="アニメストーリー構造類似度（アプローチ1）無料枠2アカウント分割実行プログラム"
    )
    parser.add_argument(
        "--synopsis-csv",
        type=str,
        default="danime_synopses_1990_2026_animeonly.csv",
        help="全体あらすじCSVファイルパス",
    )
    parser.add_argument(
        "--sequence-csv",
        type=str,
        default="danime_works_with_story_sequence_1990_2026.csv",
        help="全話各話あらすじCSVファイルパス",
    )
    parser.add_argument(
        "--gemini-api-key",
        type=str,
        default=None,
        help="Gemini API Key (カンマ区切りで複数指定可能: KEY1,KEY2)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=DEFAULT_GEMINI_MODEL,
        help=f"要約生成に使用するGeminiモデル名 (デフォルト: {DEFAULT_GEMINI_MODEL}。利用不可なら自動切替)",
    )
    parser.add_argument(
        "--embedding-model",
        type=str,
        default=DEFAULT_EMBEDDING_MODEL,
        help=f"埋め込みモデル名 (デフォルト: {DEFAULT_EMBEDDING_MODEL}。ロード失敗時は {FALLBACK_EMBEDDING_MODEL})",
    )
    parser.add_argument(
        "--daily-limit",
        type=int,
        default=DEFAULT_DAILY_LIMIT,
        help=f"1キーあたりの1日リクエスト上限 (デフォルト: {DEFAULT_DAILY_LIMIT}件)",
    )
    parser.add_argument(
        "--min-interval",
        type=float,
        default=4.1,
        help="同一キーでのリクエスト最小間隔秒 (デフォルト: 4.1秒 = 15RPM以下)",
    )
    parser.add_argument(
        "--max-consecutive-failures",
        type=int,
        default=0,
        help="連続失敗時の強制停止件数 (デフォルト: 0 = 中断せず後続作品を続行)",
    )
    parser.add_argument(
        "--force-embed",
        action="store_true",
        help="要約が未完了でもベクトル化・ZIP出力まで実行（未要約作品は全体あらすじで代替）",
    )
    parser.add_argument(
        "--skip-summaries",
        action="store_true",
        help="Gemini要約を行わず、既存チェックポイントのみでベクトル化・ZIP出力する（APIキー不要）",
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help="動作確認テストモード（先頭5作品のみ処理）",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="処理対象作品数の上限",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=16,
        help="ベクトル化バッチサイズ (デフォルト: 16)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=None,
        help="出力先ディレクトリ",
    )
    parser.add_argument(
        "--checkpoint-file",
        type=str,
        default=None,
        help="チェックポイントJSONファイルパス (デフォルト: output_dir/checkpoint_summaries.json)",
    )

    # Jupyter/Colab カーネル内で実行された場合の余分な引数（-f kernel.json 等）を無視
    args, _unknown = parser.parse_known_args()

    # APIキーの取得（カンマ区切りで複数受け付け）
    raw_key = args.gemini_api_key or os.environ.get("GEMINI_API_KEY")
    if not raw_key and is_colab():
        try:
            from google.colab import userdata
            raw_key = userdata.get("GEMINI_API_KEY")
        except Exception:
            pass

    api_keys: List[str] = []
    for k in str(raw_key or "").split(","):
        k = k.strip()
        if k and k not in api_keys:
            api_keys.append(k)

    if not api_keys and not args.skip_summaries:
        print("\n【エラー】Gemini API Key が見つかりません。")
        print("以下のいずれかで指定してください:")
        print("  - 引数: --gemini-api-key \"KEY_1,KEY_2\"")
        print("  - 環境変数: GEMINI_API_KEY=\"KEY_1,KEY_2\"（ノートブックのセル3）")
        sys.exit(1)

    # 出力先ディレクトリ
    if args.output_dir:
        output_dir = args.output_dir
    elif os.environ.get("OUTPUT_DIR"):
        output_dir = os.environ["OUTPUT_DIR"]
    elif is_colab():
        if os.path.exists("/content/drive/MyDrive"):
            output_dir = "/content/drive/MyDrive/アニメストーリー構造類似度"
        else:
            output_dir = "/content/story_structure_output"
    else:
        output_dir = os.path.join(get_base_dir(), "output")

    os.makedirs(output_dir, exist_ok=True)
    if args.checkpoint_file:
        checkpoint_file = args.checkpoint_file
    else:
        checkpoint_file = os.path.join(output_dir, "checkpoint_summaries.json")

    limit = 5 if args.test else args.limit

    print("=" * 65)
    print("  アニメストーリー構造類似度（アプローチ1）無料枠分割パイプライン")
    print("=" * 65)
    print(f"  出力先: {output_dir}")

    # 1. データ読み込み & 全体あらすじ欠損作品の除外
    df = load_and_align_datasets(
        synopsis_csv_path=args.synopsis_csv,
        sequence_csv_path=args.sequence_csv,
        limit=limit,
    )

    # 2. Gemini API によるプロット要約生成（本日分を実行）
    if args.skip_summaries:
        summaries, loaded_from = find_and_load_checkpoint(output_dir, checkpoint_file)
        print(f"\n[2/5] 要約生成をスキップ（既存チェックポイント {len(summaries)} 件を使用: {loaded_from}）")
        is_all_completed = True
    else:
        summaries, is_all_completed = generate_all_plot_summaries(
            df=df,
            api_keys=api_keys,
            checkpoint_file=checkpoint_file,
            model_name=args.model,
            daily_limit=args.daily_limit,
            per_key_interval=args.min_interval,
            max_consecutive_failures=args.max_consecutive_failures,
        )

    # 全作品の要約がまだ揃っていない場合は、本日の処理で安全に終了
    if not is_all_completed and not args.force_embed:
        return
    if not is_all_completed and args.force_embed:
        print("\n      ※ --force-embed 指定のため、未要約作品は全体あらすじで代替してベクトル化を実行します。")

    # 全作品（全6,267件）の要約または除外仕分けが完了した場合は、自動で後続のベクトル化・ZIP出力へ進む
    # 【ユーザー要望】除外された作品（要約がない作品）はベクトルの対象外とする
    df_valid = df[df["work_id"].astype(str).isin([k for k, v in summaries.items() if v and v.strip()])].copy().reset_index(drop=True)
    excluded_count = len(df) - len(df_valid)
    if excluded_count > 0:
        print(f"\n      ※ 【ユーザー指示】要約のない除外作品 {excluded_count} 件をベクトルの対象外としました。")
        print(f"        (ベクトル化・候補プール対象: {len(df_valid)} 作品 / 元データ: {len(df)} 作品)")

    # 3. EmbeddingGemma 2 によるデュアルベクトル化
    v_setting, v_plot = compute_dual_embeddings(
        df=df_valid,
        summaries=summaries,
        model_name=args.embedding_model,
        batch_size=args.batch_size,
    )

    # 4. 上位候補プール抽出
    candidate_pools = extract_candidate_pools(
        df=df_valid,
        v_setting=v_setting,
        v_plot=v_plot,
        summaries=summaries,
        top_k_each=50,
    )

    # 5. 成果物の保存とZIP出力
    zip_path = save_and_package_results(
        output_dir=output_dir,
        df=df_valid,
        summaries=summaries,
        v_setting=v_setting,
        v_plot=v_plot,
        candidate_pools=candidate_pools,
    )

    print("\n" + "=" * 65)
    print("  🎉 全パイプライン処理が正常に完了しました！")
    print(f"  ダウンロード用ZIP: {zip_path}")
    print("=" * 65)


if __name__ == "__main__":
    main()
