#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
dアニメストア作品の類似度Top30データとAnnictキービジュアルを統合し、
フロントエンド表示用の軽量・高速JSON (static/res/similarity-data.json) を生成するスクリプト。
"""

import os
import re
import json
import glob
import numpy as np
import pandas as pd

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIM_NPZ = os.path.join(ROOT_DIR, "類似度データ", "anime_similarity_matrix.npz")
METADATA_CSV = os.path.join(ROOT_DIR, "類似度データ", "anime_metadata.csv")
DANIME_JSON = "C:/App/アニメ類似度/danime_synopses_1990_2026_animeonly.json"
OUTPUT_JSON = os.path.join(ROOT_DIR, "static", "res", "similarity-data.json")
CACHE_HIRES = os.path.join(ROOT_DIR, "data", "cache", "similarity_hires_cache.json")

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
    t = re.sub(r'Season\s*[0-9]+/gi', ' ', t)
    t = re.sub(r'TV版|配信限定.*|OAD|OVA', ' ', t)
    t = re.sub(r'[\s\u3000!！?？:：・\-\～〜~]+', '', t)
    return t.lower()

def collect_annict_cache():
    exact_map = {}
    clean_map = {}
    
    # 既存の similarity-data.json や similarity_hires_cache.json を最優先で引き継ぐ
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

    if os.path.exists(OUTPUT_JSON):
        try:
            with open(OUTPUT_JSON, "r", encoding="utf-8") as f:
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
                    if title and img and "image.annict.com" in img:
                        if title not in exact_map:
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
    print("=== 類似度Top30 統合データビルド開始 ===")
    
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
        
        # Annict縦長画像突合
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
    
    # 類似度Top30を行列から直接計算
    print(f"▶ 全ペア類似度行列からTop30を高速算出中: {SIM_NPZ}")
    npz_data = np.load(SIM_NPZ)
    sim_mat = npz_data["similarity_matrix"]
    matrix_wids = [str(x) for x in npz_data["work_ids"]]
    
    top_k = 30
    n = len(matrix_wids)
    
    for i in range(n):
        wid = matrix_wids[i]
        if wid not in works_dict:
            continue
            
        scores = sim_mat[i].copy()
        scores[i] = -1.0  # 自身を除外
        
        top_indices = np.argsort(scores)[::-1][:top_k]
        top_list = []
        for rank, idx in enumerate(top_indices, 1):
            sim_wid = matrix_wids[idx]
            score = round(float(scores[idx]), 4)
            top_list.append([sim_wid, score, rank])
            
        works_dict[wid]["top"] = top_list
        
    print(f"✔ 全 {n} 作品のTop30算出完了！")
    
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
        "topK": top_k,
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
