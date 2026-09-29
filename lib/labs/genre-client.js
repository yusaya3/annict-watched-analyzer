'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.resolve(__dirname, '../../data/cache/genre_cache.json');
const ANILIST_GRAPHQL_ENDPOINT = 'https://graphql.anilist.co';
const BATCH_SIZE = 20;
const REQUEST_DELAY_MS = 800;

// 18大公式ジャンル定義
const GENRE_DEFINITIONS = [
  { id: 'Action', label: 'アクション', icon: 'fa-solid fa-burst', color: '#ef4444' },
  { id: 'Adventure', label: 'アドベンチャー', icon: 'fa-solid fa-compass', color: '#f97316' },
  { id: 'Comedy', label: 'コメディ', icon: 'fa-solid fa-face-laugh-squint', color: '#f59e0b' },
  { id: 'Drama', label: 'ドラマ', icon: 'fa-solid fa-masks-theater', color: '#3b82f6' },
  { id: 'Ecchi', label: 'エッチ', icon: 'fa-solid fa-fire', color: '#f43f5e' },
  { id: 'Fantasy', label: 'ファンタジー', icon: 'fa-solid fa-wand-magic-sparkles', color: '#8b5cf6' },
  { id: 'Horror', label: 'ホラー', icon: 'fa-solid fa-spider', color: '#475569' },
  { id: 'Mahou Shoujo', label: '魔法少女', icon: 'fa-solid fa-star', color: '#fb7185' },
  { id: 'Mecha', label: 'メカ・ロボット', icon: 'fa-solid fa-robot', color: '#6b7280' },
  { id: 'Music', label: '音楽', icon: 'fa-solid fa-music', color: '#eab308' },
  { id: 'Mystery', label: 'ミステリー', icon: 'fa-solid fa-magnifying-glass', color: '#6366f1' },
  { id: 'Psychological', label: 'サイコ・サスペンス', icon: 'fa-solid fa-brain', color: '#d946ef' },
  { id: 'Romance', label: '恋愛・ラブコメ', icon: 'fa-solid fa-heart', color: '#ec4899' },
  { id: 'Sci-Fi', label: 'SF', icon: 'fa-solid fa-rocket', color: '#06b6d4' },
  { id: 'Slice of Life', label: '日常・青春', icon: 'fa-solid fa-mug-saucer', color: '#10b981' },
  { id: 'Sports', label: 'スポーツ', icon: 'fa-solid fa-futbol', color: '#14b8a6' },
  { id: 'Supernatural', label: '伝奇・オカルト', icon: 'fa-solid fa-ghost', color: '#a855f7' },
  { id: 'Thriller', label: 'スリラー', icon: 'fa-solid fa-skull', color: '#64748b' }
];

class GenreClient {
  constructor() {
    this.cache = this.loadCache();
  }

  loadCache() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        const valid = {};
        // 以前のバグで空配列になってしまったエントリを除外して再取得可能にする
        for (const [k, v] of Object.entries(raw)) {
          if (Array.isArray(v) && v.length > 0) {
            valid[k] = v;
          }
        }
        return valid;
      }
    } catch (e) {
      console.warn(`[GenreClient] キャッシュ読み込み失敗: ${e.message}`);
    }
    return {};
  }

  saveCache() {
    try {
      const dir = path.dirname(CACHE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(CACHE_FILE, JSON.stringify(this.cache, null, 2), 'utf8');
    } catch (e) {
      console.warn(`[GenreClient] キャッシュ保存失敗: ${e.message}`);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * タイトルのクレンジング（検索ヒット率向上のための正規化）
   */
  normalizeTitle(title, stage = 1) {
    if (!title) return '';
    let cleaned = title;

    // 全角英数を半角に変換
    cleaned = cleaned.replace(/[！-～]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
    // 括弧類とその中身の除去
    cleaned = cleaned.replace(/\s*[\(（][^\)）]+[\)）]/g, '');
    cleaned = cleaned.replace(/\s*\[[^\]]+\]/g, '');

    // 第1段階: シーズン・期数・映画表記の除去
    cleaned = cleaned
      .replace(/\s*(?:Season\s*\d+|第\d+期|第\d+クール|\d+(?:st|nd|rd|th)\s*Season|The\s*Final\s*Season|[1-9Ⅰ-Ⅹ]+).*$/i, '')
      .replace(/^(?:劇場版|映画|アニメ)\s*/i, '')
      .trim();

    // 第2段階: サブタイトル（～...～ や : ...）の除去
    if (stage >= 2) {
      cleaned = cleaned.replace(/\s*～[^～]+～/g, '');
      cleaned = cleaned.replace(/\s*:[^:]+$/g, '');
      cleaned = cleaned.replace(/\s*-.+$/g, '');
      cleaned = cleaned.trim();
    }

    return cleaned || title;
  }

  /**
   * バッチ単位で GraphQL (Pageクエリ) を実行（レートリミット時は自動指数バックオフで再試行）
   */
  async fetchBatchWithRetry(batchTitles, maxRetries = 4) {
    const fields = batchTitles.map((t, idx) => `
      m${idx}: Page(page: 1, perPage: 1) {
        media(search: ${JSON.stringify(t)}, type: ANIME) {
          id
          title { native romaji english }
          genres
        }
      }
    `).join('\n');

    const query = `query {\n${fields}\n}`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(ANILIST_GRAPHQL_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ query })
        });

        if (res.status === 429) {
          const waitTime = attempt * 3000;
          console.warn(`\n[GenreClient] レートリミット検知 (試行 ${attempt}/${maxRetries})。${waitTime / 1000}秒待機して再試行します...`);
          await this.sleep(waitTime);
          continue;
        }

        if (!res.ok) {
          console.warn(`[GenreClient] HTTPエラー ${res.status}: ${res.statusText}`);
          return {};
        }

        const json = await res.json();
        return json.data || {};
      } catch (err) {
        console.warn(`[GenreClient] 通信エラー: ${err.message}`);
        await this.sleep(2000);
      }
    }

    return {};
  }

  /**
   * 全タイトルのジャンルを高精度に解決して返す
   * @param {string[]} titles 
   * @param {Function} onProgress 
   */
  async resolveGenres(titles, onProgress = null) {
    const uniqueTitles = Array.from(new Set(titles.filter(t => typeof t === 'string' && t.trim().length > 0)));
    // キャッシュ未登録、またはジャンルが空の作品を抽出
    const missingTitles = uniqueTitles.filter(t => !this.cache[t] || !this.cache[t].length);

    if (missingTitles.length > 0) {
      console.log(`[GenreClient] 未取得・要再照合のアニメジャンルを照合中 (${missingTitles.length} / ${uniqueTitles.length} 作品)...`);

      let totalSuccess = 0;

      for (let i = 0; i < missingTitles.length; i += BATCH_SIZE) {
        const batch = missingTitles.slice(i, i + BATCH_SIZE);
        const data = await this.fetchBatchWithRetry(batch);

        const unhitTitles = [];
        batch.forEach((origTitle, idx) => {
          const media = data[`m${idx}`]?.media?.[0];
          if (media && Array.isArray(media.genres) && media.genres.length > 0) {
            this.cache[origTitle] = media.genres;
            totalSuccess++;
          } else {
            unhitTitles.push(origTitle);
          }
        });

        // 未ヒットの作品があれば、正規化してフォールバック検索
        if (unhitTitles.length > 0) {
          await this.sleep(400);
          const normalizedBatch = unhitTitles.map(t => this.normalizeTitle(t, 1));
          const fallbackData = await this.fetchBatchWithRetry(normalizedBatch);

          const stillUnhit = [];
          unhitTitles.forEach((origTitle, idx) => {
            const media = fallbackData[`m${idx}`]?.media?.[0];
            if (media && Array.isArray(media.genres) && media.genres.length > 0) {
              this.cache[origTitle] = media.genres;
              totalSuccess++;
            } else {
              stillUnhit.push(origTitle);
            }
          });

          // さらに第2段階の正規化（サブタイトル除去）で検索
          if (stillUnhit.length > 0) {
            await this.sleep(400);
            const subNormalizedBatch = stillUnhit.map(t => this.normalizeTitle(t, 2));
            const subFallbackData = await this.fetchBatchWithRetry(subNormalizedBatch);

            stillUnhit.forEach((origTitle, idx) => {
              const media = subFallbackData[`m${idx}`]?.media?.[0];
              if (media && Array.isArray(media.genres) && media.genres.length > 0) {
                this.cache[origTitle] = media.genres;
                totalSuccess++;
              } else {
                // ここまでやっても見つからない極めてマイナーな作品のみ空配列
                this.cache[origTitle] = [];
              }
            });
          }
        }

        // キャッシュの中間保存
        this.saveCache();

        const currentCount = Math.min(i + BATCH_SIZE, missingTitles.length);
        if (onProgress) {
          onProgress(currentCount, missingTitles.length);
        }
        process.stdout.write(`\r[GenreClient] 照合進捗: ${currentCount}/${missingTitles.length} 作品完了 (照合成功: ${totalSuccess}作)`);

        await this.sleep(REQUEST_DELAY_MS);
      }
      console.log(`\n[GenreClient] アニメジャンルの照合・キャッシュ保存が完了しました。(照合成功: ${totalSuccess}作)`);
    }

    // 解決済みマップを返す
    const resultMap = {};
    for (const title of uniqueTitles) {
      resultMap[title] = this.cache[title] || [];
    }
    return resultMap;
  }
}

module.exports = {
  GenreClient,
  GENRE_DEFINITIONS
};
