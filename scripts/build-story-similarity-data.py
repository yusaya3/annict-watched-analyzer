#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
ストーリー構造類似度検索用フロントエンドJSON (static/res/story-similarity-data.json) 生成スクリプト。

機能:
1. Google Colab 成果物（story_structure_candidates.json または ZIP）が存在する場合はそれを最優先で読み込み、
   Annict高画質画像キャッシュをマージして本番用JSONをビルド。
2. Colab成果物がまだない場合でも、既存の similarity-data.json と episode-similarity-data.json から
   プレースホルダー用ハイブリッド候補データを生成し、UI動作確認を可能にする。
"""

import glob
import json
import os
import re
import zipfile
import pandas as pd

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_JSON = os.path.join(ROOT_DIR, "static", "res", "story-similarity-data.json")
CACHE_HIRES = os.path.join(ROOT_DIR, "data", "cache", "similarity_hires_cache.json")
EXISTING_SIM_JSON = os.path.join(ROOT_DIR, "static", "res", "similarity-data.json")
EXISTING_EP_JSON = os.path.join(ROOT_DIR, "static", "res", "episode-similarity-data.json")

# Colab成果物の探索先
COLAB_SEARCH_DIRS = [
    os.path.join(ROOT_DIR, "類似度", "ストーリー構造類似度_実行ファイル", "output"),
    os.path.join(ROOT_DIR, "類似度"),
    os.path.join(ROOT_DIR, "類似度", "ストーリー構造類似度_実行ファイル"),
    os.path.join(ROOT_DIR, "類似度データ"),
    ROOT_DIR,
]

FEATURED_TITLE_KEYWORDS = [
    "葬送のフリーレン",
    "ぼっち・ざ・ろっく！",
    "推しの子",
    "呪術廻戦",
    "鬼滅の刃",
    "チェンソーマン",
    "スパイファミリー",
    "SPY×FAMILY",
    "リコリス・リコイル",
    "薬屋のひとりごと",
    "魔法少女まどか☆マギカ",
    "STEINS;GATE",
    "ソードアート・オンライン",
    "進撃の巨人",
    "コードギアス 反逆のルルーシュ",
    "幼女戦記",
    "ダンジョン飯",
    "無職転生",
    "Re:ゼロから始める異世界生活",
    "ガールズ＆パンツァー",
]


def clean_title(t: str) -> str:
    if not t:
        return ""
    t = re.sub(r'「|」|『|』|【|】|\(|\)|（|）', ' ', t)
    t = re.sub(r'第[0-9０-９一二三四五六七八九十]+期', ' ', t)
    t = re.sub(r'Season\s*[0-9]+/gi', ' ', t)
    t = re.sub(r'TV版|配信限定.*|OAD|OVA', ' ', t)
    t = re.sub(r'[\s\u3000!！?？:：・\-\～〜~]+', '', t)
    return t.lower()


def collect_annict_cache():
    """Annict高画質キービジュアル画像キャッシュを収集"""
    exact_map = {}
    clean_map = {}

    if os.path.exists(CACHE_HIRES):
        try:
            with open(CACHE_HIRES, "r", encoding="utf-8") as f:
                cdata = json.load(f)
                for k, v in cdata.items():
                    u = v.get("url")
                    aid = v.get("annictId")
                    title = v.get("title")
                    if u and "image.annict.com" in u:
                        if title:
                            exact_map[title] = {"image": u, "annict_id": str(aid) if aid else None}
                            ct = clean_title(title)
                            if ct:
                                clean_map[ct] = {"image": u, "annict_id": str(aid) if aid else None}
        except Exception:
            pass

    # 既存の similarity-data.json も活用
    for base_file in [EXISTING_SIM_JSON, EXISTING_EP_JSON]:
        if os.path.exists(base_file):
            try:
                with open(base_file, "r", encoding="utf-8") as f:
                    odata = json.load(f)
                    for wid, w in odata.get("works", {}).items():
                        u = w.get("img")
                        aid = w.get("aid")
                        title = w.get("t")
                        if u and "image.annict.com" in u and title:
                            exact_map[title] = {"image": u, "annict_id": str(aid) if aid else None}
                            ct = clean_title(title)
                            if ct:
                                clean_map[ct] = {"image": u, "annict_id": str(aid) if aid else None}
            except Exception:
                pass

    return exact_map, clean_map


def find_colab_results():
    """Colab成果物ファイル（JSONまたはZIP）を探索（展開済みJSONを最優先）"""
    for d in COLAB_SEARCH_DIRS:
        if not os.path.exists(d):
            continue
        # 展開済みJSONを最優先探索
        jsons = glob.glob(os.path.join(d, "*story_structure_candidates*.json"))
        if jsons:
            return "json", jsons[0]
        # ZIP探索
        zips = glob.glob(os.path.join(d, "*similarity_results*.zip"))
        if zips:
            return "zip", zips[0]
    return None, None


def clean_plot_summary(text: str) -> str:
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


def build_from_colab_data(data_type: str, file_path: str, exact_annict: dict, clean_annict: dict):
    """Colab成果物から本番用JSONを構築"""
    print(f"▶ Colab成果物からビルド中: [{data_type}] {file_path}")
    raw_json_str = None
    if data_type == "zip":
        with zipfile.ZipFile(file_path, "r") as zf:
            for name in zf.namelist():
                if "story_structure_candidates.json" in name:
                    raw_json_str = zf.read(name).decode("utf-8")
                    break
    else:
        with open(file_path, "r", encoding="utf-8") as f:
            raw_json_str = f.read()

    if not raw_json_str:
        raise ValueError("成果物内に story_structure_candidates.json が見つかりませんでした")

    colab_data = json.loads(raw_json_str)
    raw_works = colab_data.get("works", {})

    genres_set = set()
    years_set = set()
    works_dict = {}

    for wid, w in raw_works.items():
        title = w.get("t", "")
        year = w.get("y")
        genre = w.get("g", "")
        synopsis = w.get("s", "")
        summary = clean_plot_summary(w.get("summary", ""))
        url = w.get("url", "")
        candidates = w.get("candidates", [])

        if year:
            years_set.add(int(year))
        if genre and genre != "その他":
            genres_set.add(genre)

        # 画像とAnnict ID解決
        img = None
        annict_id = None
        if title in exact_annict:
            img = exact_annict[title]["image"]
            annict_id = exact_annict[title]["annict_id"]
        else:
            ct = clean_title(title)
            if ct in clean_annict:
                img = clean_annict[ct]["image"]
                annict_id = clean_annict[ct]["annict_id"]

        works_dict[wid] = {
            "id": wid,
            "t": title,
            "y": int(year) if year else None,
            "g": genre,
            "s": synopsis,
            "summary": summary,
            "url": url,
            "img": img,
            "aid": annict_id,
            "candidates": candidates,
        }

    # クイック候補
    featured_ids = []
    for kw in FEATURED_TITLE_KEYWORDS:
        for wid, w in works_dict.items():
            if kw in w["t"] and w["img"]:
                if wid not in featured_ids:
                    featured_ids.append(wid)
                    break
        if len(featured_ids) >= 15:
            break

    return {
        "generatedAt": pd.Timestamp.now().isoformat(),
        "dataSource": "colab_production",
        "total": len(works_dict),
        "genres": sorted(list(genres_set)),
        "years": sorted(list(years_set), reverse=True),
        "featured": featured_ids,
        "works": works_dict,
    }


def build_placeholder_data(exact_annict: dict, clean_annict: dict):
    """既存の similarity-data.json と episode-similarity-data.json を合成したプレースホルダーJSONを構築"""
    print("▶ 既存データを合成してUIプレースホルダー用JSONを生成中...")
    if not os.path.exists(EXISTING_SIM_JSON) or not os.path.exists(EXISTING_EP_JSON):
        raise FileNotFoundError("既存の similarity-data.json または episode-similarity-data.json が見つかりません")

    with open(EXISTING_SIM_JSON, "r", encoding="utf-8") as f:
        sim_data = json.load(f)
    with open(EXISTING_EP_JSON, "r", encoding="utf-8") as f:
        ep_data = json.load(f)

    sim_works = sim_data.get("works", {})
    ep_works = ep_data.get("works", {})

    genres_set = set(sim_data.get("genres", []))
    years_set = set(sim_data.get("years", []))
    works_dict = {}

    for wid, w_sim in sim_works.items():
        w_ep = ep_works.get(wid, {})

        title = w_sim.get("t", "")
        year = w_sim.get("y")
        genre = w_sim.get("g", "")
        synopsis = w_sim.get("s", "")
        url = w_sim.get("url", "")
        img = w_sim.get("img")
        aid = w_sim.get("aid")

        # 候補マージ（世界観Top30 と エピソードTop30 の合体）
        top_sim = w_sim.get("top", [])  # [[wid, score, rank], ...]
        top_ep = w_ep.get("top", [])

        sim_score_map = {str(item[0]): float(item[1]) for item in top_sim}
        ep_score_map = {str(item[0]): float(item[1]) for item in top_ep}

        all_cand_ids = set(sim_score_map.keys()).union(set(ep_score_map.keys()))

        candidates = []
        for c_wid in all_cand_ids:
            s_set = sim_score_map.get(c_wid, 0.60)
            s_plt = ep_score_map.get(c_wid, 0.60)
            candidates.append([c_wid, round(s_set, 4), round(s_plt, 4)])

        candidates.sort(key=lambda x: (x[1] * 0.5 + x[2] * 0.5), reverse=True)

        works_dict[wid] = {
            "id": wid,
            "t": title,
            "y": int(year) if year else None,
            "g": genre,
            "s": synopsis,
            "summary": "【プレースホルダー】Google Colabでの要約生成完了後に本番の起承転結プロット構造要約が表示されます。",
            "url": url,
            "img": img,
            "aid": aid,
            "candidates": candidates,
        }

    return {
        "generatedAt": pd.Timestamp.now().isoformat(),
        "dataSource": "hybrid_placeholder (Colabデータ受け取り前テスト用)",
        "total": len(works_dict),
        "genres": sorted(list(genres_set)),
        "years": sorted(list(years_set), reverse=True),
        "featured": sim_data.get("featured", []),
        "works": works_dict,
    }


def main():
    print("=== ストーリー構造類似検索 JSON ビルダー開始 ===")
    exact_annict, clean_annict = collect_annict_cache()
    print(f"✔ Annict画像キャッシュ収集完了: {len(exact_annict)} 件")

    data_type, file_path = find_colab_results()

    if data_type and file_path:
        out_data = build_from_colab_data(data_type, file_path, exact_annict, clean_annict)
    else:
        out_data = build_placeholder_data(exact_annict, clean_annict)

    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(out_data, f, ensure_ascii=False, separators=(',', ':'))

    size_mb = os.path.getsize(OUTPUT_JSON) / (1024 * 1024)
    print(f"✔ 出力完了: {OUTPUT_JSON} ({size_mb:.2f} MB)")
    print(f"  総作品数: {out_data['total']} 件, データソース: {out_data['dataSource']}")
    print("=== ビルド完了 ===")


if __name__ == "__main__":
    main()
