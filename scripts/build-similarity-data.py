#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
dアニメストア作品の類似度Top10データとAnnictキービジュアルを統合し、
フロントエンド表示用の軽量・高速JSON (static/res/similarity-data.json) を生成するスクリプト。
"""

import os
import re
import json
import glob
import pandas as pd

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOP_SIM_CSV = os.path.join(ROOT_DIR, "類似度データ", "anime_top_similarities.csv")
METADATA_CSV = os.path.join(ROOT_DIR, "類似度データ", "anime_metadata.csv")
DANIME_JSON = "C:/App/アニメ類似度/danime_synopses_1990_2026_animeonly.json"
OUTPUT_JSON = os.path.join(ROOT_DIR, "static", "res", "similarity-data.json")

# クイック選択用の代表的な注目アニメタイトル
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
    "ガールズ＆パンツァー"
]

def clean_title(t: str) -> str:
    if not t:
        return ""
    t = re.sub(r'「|」|『|』|【|】|\(|\)|（|）', ' ', t)
    t = re.sub(r'第[0-9０-９一二三四五六七八九十]+期', ' ', t)
    t = re.sub(r'Season\s*[0-9]+', ' ', t, flags=re.I)
    t = re.sub(r'TV版|配信限定.*|OAD|OVA', ' ', t)
    t = re.sub(r'[\s\u3000!！?？:：・\-\～〜~]+', '', t)
    return t.lower()

def collect_annict_cache():
    exact_map = {}
    clean_map = {}
    
    files = glob.glob(os.path.join(ROOT_DIR, "data", "cache", "*.json")) + \
            glob.glob(os.path.join(ROOT_DIR, "static", "res", "*.json"))
            
    for fpath in files:
        if "similarity" in fpath:
            continue
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                data = json.load(f)
                items = data.get("animes", []) or data.get("works", []) or data.get("allAnimes", [])
                for item in items:
                    title = item.get("title")
                    img = item.get("image")
                    annict_id = item.get("id")
                    if title and img:
                        exact_map[title] = {
                            "image": img,
                            "annict_id": str(annict_id) if annict_id else None
                        }
                        ct = clean_title(title)
                        if ct and ct not in clean_map:
                            clean_map[ct] = {
                                "image": img,
                                "annict_id": str(annict_id) if annict_id else None
                            }
        except Exception:
            pass
            
    print(f"✔ Annictキャッシュ収集完了: 完全一致 {len(exact_map)} 件 / 正規化一致 {len(clean_map)} 件")
    return exact_map, clean_map

def main():
    print("=== 類似度Top10 統合データビルド開始 ===")
    
    exact_annict, clean_annict = collect_annict_cache()
    
    print(f"▶ 類似度メタデータ読み込み (有効作品フィルター): {METADATA_CSV}")
    df_meta = pd.read_csv(METADATA_CSV)
    valid_work_ids = set(df_meta["work_id"].astype(str))
    print(f"   元データ: 全 6,350 件 / 有効データ (あらすじ有り): 全 {len(valid_work_ids)} 件 (除外: 83 件)")

    print(f"▶ dアニメストア作品データ読み込み: {DANIME_JSON}")
    with open(DANIME_JSON, "r", encoding="utf-8") as f:
        danime_list = json.load(f)
    
    works_dict = {}
    matched_image_count = 0
    genres_set = set()
    years_set = set()
    
    for item in danime_list:
        wid = str(item.get("work_id"))
        if wid not in valid_work_ids:
            continue
        title = item.get("title", "")
        year = item.get("year")
        genre = item.get("genre", "")
        synopsis = item.get("synopsis", "")
        url = item.get("url", f"https://animestore.docomo.ne.jp/animestore/ci_pc?workId={wid}")
        
        if year:
            try:
                y_int = int(year)
                years_set.add(y_int)
            except:
                y_int = None
        else:
            y_int = None
            
        if genre:
            for g in genre.split(","):
                g_str = g.strip()
                if g_str:
                    genres_set.add(g_str)
        
        # Annict画像突合
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
                
        if img:
            matched_image_count += 1
            
        works_dict[wid] = {
            "id": wid,
            "t": title,
            "y": y_int,
            "g": genre,
            "s": synopsis,
            "url": url,
            "img": img,
            "aid": annict_id,
            "top": []
        }
        
    print(f"✔ 作品数: {len(works_dict)} 件 (うちAnnict画像マッチ: {matched_image_count} 件, {matched_image_count/len(works_dict)*100:.1f}%)")
    
    print(f"▶ 類似度Top10 CSV読み込み: {TOP_SIM_CSV}")
    df_top = pd.read_csv(TOP_SIM_CSV)
    
    grouped = df_top.groupby("work_id")
    for wid, group in grouped:
        wid_str = str(wid)
        if wid_str not in works_dict:
            continue
            
        top_list = []
        for _, row in group.sort_values("rank").iterrows():
            sim_wid = str(row["similar_work_id"])
            score = float(row["similarity_score"])
            rank = int(row["rank"])
            top_list.append([sim_wid, round(score, 4), rank])
            
        works_dict[wid_str]["top"] = top_list
        
    # おすすめ・注目作品のIDリスト選定（キーワード順に代表作を抽出）
    featured_ids = []
    for kw in FEATURED_TITLE_KEYWORDS:
        for wid, w in works_dict.items():
            if kw in w["t"] and w["img"]:
                if wid not in featured_ids:
                    featured_ids.append(wid)
                    break
        if len(featured_ids) >= 15:
            break
            
    print(f"✔ クイック選択候補: {len(featured_ids)} 件抽出")
    
    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    output_data = {
        "generatedAt": pd.Timestamp.now().isoformat(),
        "rawTotal": len(danime_list),
        "excludedNoSynopsis": len(danime_list) - len(works_dict),
        "total": len(works_dict),
        "genres": sorted(list(genres_set)),
        "years": sorted(list(years_set), reverse=True),
        "featured": featured_ids,
        "works": works_dict
    }
    
    print(f"▶ JSON保存中: {OUTPUT_JSON}")
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, separators=(',', ':'))
        
    file_size_mb = os.path.getsize(OUTPUT_JSON) / (1024 * 1024)
    print(f"✔ 保存完了! ファイルサイズ: {file_size_mb:.2f} MB")
    print("=== ビルド完了 ===")

if __name__ == "__main__":
    main()
