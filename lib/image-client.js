'use strict';

const fs = require('fs');
const path = require('path');

const isVercel = !!process.env.VERCEL;
const BUNDLED_CACHE_FILE = path.resolve(__dirname, '../data/cache/image_cache.json');
const WRITABLE_CACHE_FILE = isVercel ? '/tmp/image_cache.json' : BUNDLED_CACHE_FILE;
const ANILIST_GRAPHQL_ENDPOINT = 'https://graphql.anilist.co';
const BATCH_SIZE = 25;
const REQUEST_DELAY_MS = isVercel ? 400 : 850; // AniList レートリミット (90req/分) を下回る安全な間隔

class ImageClient {
  constructor() {
    this.cache = this.loadCache();
    this.lastRemainingCount = 0;
  }

  loadCache() {
    const valid = {};
    const loadFrom = (filePath) => {
      try {
        if (fs.existsSync(filePath)) {
          const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          for (const [k, v] of Object.entries(raw)) {
            if (typeof v === 'string' && v) {
              valid[k] = v;
            }
          }
        }
      } catch (e) {}
    };

    loadFrom(BUNDLED_CACHE_FILE);
    if (WRITABLE_CACHE_FILE !== BUNDLED_CACHE_FILE) {
      loadFrom(WRITABLE_CACHE_FILE);
    }
    return valid;
  }

  saveCache() {
    try {
      const dir = path.dirname(WRITABLE_CACHE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(WRITABLE_CACHE_FILE, JSON.stringify(this.cache, null, 2), 'utf8');
    } catch (e) {
      console.warn(`[ImageClient] キャッシュ保存失敗: ${e.message}`);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  normalizeTitle(title, stage = 1) {
    if (!title) return '';
    let cleaned = title;

    cleaned = cleaned.replace(/[！-～]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
    cleaned = cleaned.replace(/\s*[\(（][^\)）]+[\)）]/g, '');
    cleaned = cleaned.replace(/\s*\[[^\]]+\]/g, '');

    cleaned = cleaned
      .replace(/\s*(?:Season\s*\d+|第\d+期|第\d+クール|\d+(?:st|nd|rd|th)\s*Season|The\s*Final\s*Season|[1-9Ⅰ-Ⅹ]+).*$/i, '')
      .replace(/^(?:劇場版|映画|アニメ)\s*/i, '')
      .trim();

    if (stage >= 2) {
      cleaned = cleaned.replace(/\s*～[^～]+～/g, '');
      cleaned = cleaned.replace(/\s*:[^:]+$/g, '');
      cleaned = cleaned.replace(/\s*-.+$/g, '');
      cleaned = cleaned.trim();
    }

    return cleaned || title;
  }

  async fetchBatchWithRetry(batchTitles, maxRetries = 4) {
    const fields = batchTitles.map((t, idx) => {
      const norm = this.normalizeTitle(t);
      return `
        m${idx}: Page(page: 1, perPage: 1) {
          media(search: ${JSON.stringify(norm)}, type: ANIME) {
            id
            coverImage { extraLarge large medium }
          }
        }
      `;
    }).join('\n');

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
          const retryAfter = parseInt(res.headers.get('Retry-After') || '15', 10);
          const waitTime = Math.max(retryAfter * 1000, attempt * 10000);
          console.warn(`\n[ImageClient] レートリミット検知 (試行 ${attempt}/${maxRetries})。${Math.round(waitTime / 1000)}秒待機して再開します...`);
          await this.sleep(waitTime);
          continue;
        }

        if (!res.ok) {
          console.warn(`[ImageClient] HTTPエラー ${res.status}: ${res.statusText}`);
          return {};
        }

        const json = await res.json();
        return json.data || {};
      } catch (err) {
        if (attempt === maxRetries) {
          console.warn(`[ImageClient] 通信エラー: ${err.message}`);
          return {};
        }
        await this.sleep(3000 * attempt);
      }
    }
    return {};
  }

  /**
   * タイトルリストに対して高解像度AniList画像URLを取得・キャッシュ
   * @param {string[]} titles
   * @param {number} timeBudgetMs
   * @returns {Promise<Object.<string, string>>}
   */
  async resolveImages(titles = [], timeBudgetMs = 600000) {
    const startTime = Date.now();
    const uniqueTitles = Array.from(new Set(titles.filter(Boolean)));
    const missingTitles = uniqueTitles.filter(t => !this.cache[t]);

    if (missingTitles.length === 0) {
      this.lastRemainingCount = 0;
      return this.cache;
    }

    console.log(`[ImageClient] 未キャッシュの高画質画像を取得中 (${missingTitles.length} / ${uniqueTitles.length} 作品)...`);
    this.lastRemainingCount = missingTitles.length;

    let totalSuccess = 0;
    let currentCount = 0;

    for (let i = 0; i < missingTitles.length; i += BATCH_SIZE) {
      if (Date.now() - startTime > timeBudgetMs) {
        console.warn(`\n[ImageClient] 制限時間 (${timeBudgetMs}ms) に達したため中断。残り ${this.lastRemainingCount} 作品。`);
        break;
      }

      const chunk = missingTitles.slice(i, i + BATCH_SIZE);
      const data = await this.fetchBatchWithRetry(chunk);

      for (let j = 0; j < chunk.length; j++) {
        const title = chunk[j];
        const media = data[`m${j}`]?.media?.[0];
        const img = media?.coverImage?.extraLarge || media?.coverImage?.large || '';
        if (img) {
          this.cache[title] = img;
          totalSuccess++;
        }
      }

      // バッチごとに即座にキャッシュ保存して進捗を失わない
      this.saveCache();

      currentCount += chunk.length;
      this.lastRemainingCount = missingTitles.length - currentCount;

      process.stdout.write(`\r[ImageClient] 画像取得進捗: ${currentCount}/${missingTitles.length} 作品完了 (ヒット: ${totalSuccess}作)`);

      if (i + BATCH_SIZE < missingTitles.length) {
        await this.sleep(REQUEST_DELAY_MS);
      }
    }

    this.saveCache();
    console.log(`\n[ImageClient] 高画質画像の取得・キャッシュ保存が完了しました。(新規取得: ${totalSuccess}作, 残り: ${this.lastRemainingCount}作)`);
    return this.cache;
  }
}

module.exports = {
  ImageClient,
  BUNDLED_CACHE_FILE
};
