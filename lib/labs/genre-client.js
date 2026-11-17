'use strict';

const fs = require('fs');
const path = require('path');
const GenreEngine = require('../../static/core/genre-engine.js');
const { GENRE_DEFINITIONS, classifyAnimeScored } = GenreEngine;

const isVercel = !!process.env.VERCEL;
const BUNDLED_CACHE_FILE = path.resolve(__dirname, '../../data/cache/genre_cache.json');
const WRITABLE_CACHE_FILE = isVercel ? '/tmp/genre_cache.json' : BUNDLED_CACHE_FILE;
const ANILIST_GRAPHQL_ENDPOINT = 'https://graphql.anilist.co';
const BATCH_SIZE = 25;
const REQUEST_DELAY_MS = isVercel ? 200 : 600;
const DEFAULT_TIME_BUDGET_MS = isVercel ? 32000 : 300000;

/**
 * メイン公式の重み付けスコアリング分類へ一本化
 */
function classifyAnime(genres = [], tags = [], title = '') {
  return classifyAnimeScored(genres, tags, title);
}

class GenreClient {
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
            if (Array.isArray(v)) {
              valid[k] = { genres: v, tags: null };
            } else if (v && typeof v === 'object' && Array.isArray(v.genres)) {
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
      console.warn(`[GenreClient] キャッシュ保存失敗: ${e.message}`);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  normalizeTitle(title, stage = 1) {
    return GenreEngine.normalizeAniListTitle(title, stage);
  }

  selectBestMedia(candidates, searchTitle) {
    return GenreEngine.selectBestAniListMedia(candidates, searchTitle);
  }

  async fetchBatchWithRetry(batchTitles, maxRetries = 3) {
    const fields = batchTitles.map((t, idx) => `
      m${idx}: Page(page: 1, perPage: 6) {
        media(search: ${JSON.stringify(t)}, type: ANIME) {
          id
          format
          popularity
          title { native romaji english }
          synonyms
          genres
          tags { name rank isMediaSpoiler }
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
          body: JSON.stringify({ query }),
          signal: AbortSignal.timeout(12000)
        });

        if (res.status === 429) {
          const waitTime = isVercel ? 1500 : attempt * 2500;
          console.warn(`\n[GenreClient] レートリミット検知 (試行 ${attempt}/${maxRetries})。${waitTime / 1000}秒待機...`);
          await this.sleep(waitTime);
          continue;
        }

        if (!res.ok) {
          console.warn(`[GenreClient] HTTPエラー ${res.status}: ${res.statusText}`);
          return { ok: false, data: {} };
        }

        const json = await res.json();
        if (Array.isArray(json.errors) && json.errors.length > 0) {
          console.warn(`[GenreClient] GraphQLエラー応答: ${json.errors.map(e => e.message).join(', ')}`);
          return { ok: false, data: json.data || {} };
        }
        return { ok: true, data: json.data || {} };
      } catch (err) {
        console.warn(`[GenreClient] 通信エラー: ${err.message}`);
        await this.sleep(1000);
      }
    }

    return { ok: false, data: {} };
  }

  async resolveGenres(titles, onProgress = null, timeBudgetMs = DEFAULT_TIME_BUDGET_MS) {
    const startTime = Date.now();
    const uniqueTitles = Array.from(new Set(titles.filter(t => typeof t === 'string' && t.trim().length > 0)));
    const missingTitles = uniqueTitles.filter(t => {
      if (!(t in this.cache)) return true;
      const entry = this.cache[t];
      if (entry.tags === null && entry.genres.length > 0) return true;
      return false;
    });
    this.lastRemainingCount = 0;

    if (missingTitles.length > 0) {
      console.log(`[GenreClient] 未取得のアニメジャンル・タグを照合中 (${missingTitles.length} / ${uniqueTitles.length} 作品)...`);
      let totalSuccess = 0;
      const fallbackWait = isVercel ? 150 : 350;

      for (let i = 0; i < missingTitles.length; i += BATCH_SIZE) {
        if (Date.now() - startTime > timeBudgetMs) {
          this.lastRemainingCount = missingTitles.length - i;
          console.warn(`\n[GenreClient] 制限時間 (${timeBudgetMs}ms) に達したため残り ${this.lastRemainingCount} 作品を分割します。`);
          break;
        }

        const batch = missingTitles.slice(i, i + BATCH_SIZE);
        const res1 = await this.fetchBatchWithRetry(batch);
        const data = res1.data || {};
        let dirtyCache = false;

        const unhitTitles = [];
        batch.forEach((origTitle, idx) => {
          const candidates = data[`m${idx}`]?.media || [];
          const media = this.selectBestMedia(candidates, origTitle);
          if (media && Array.isArray(media.genres) && media.genres.length > 0) {
            this.cache[origTitle] = this._extractCacheEntry(media);
            totalSuccess++;
            dirtyCache = true;
          } else {
            unhitTitles.push(origTitle);
          }
        });

        if (unhitTitles.length > 0 && (Date.now() - startTime <= timeBudgetMs)) {
          await this.sleep(fallbackWait);
          const normalizedBatch = unhitTitles.map(t => this.normalizeTitle(t, 1));
          const res2 = await this.fetchBatchWithRetry(normalizedBatch);
          const fallbackData = res2.data || {};

          const stillUnhit = [];
          unhitTitles.forEach((origTitle, idx) => {
            const candidates = fallbackData[`m${idx}`]?.media || [];
            const media = this.selectBestMedia(candidates, origTitle);
            if (media && Array.isArray(media.genres) && media.genres.length > 0) {
              this.cache[origTitle] = this._extractCacheEntry(media);
              totalSuccess++;
              dirtyCache = true;
            } else {
              stillUnhit.push(origTitle);
            }
          });

          if (stillUnhit.length > 0 && (Date.now() - startTime <= timeBudgetMs)) {
            await this.sleep(fallbackWait);
            const subNormalizedBatch = stillUnhit.map(t => this.normalizeTitle(t, 2));
            const res3 = await this.fetchBatchWithRetry(subNormalizedBatch);
            const subFallbackData = res3.data || {};
            const allRequestsSucceeded = res1.ok && res2.ok && res3.ok;

            stillUnhit.forEach((origTitle, idx) => {
              const candidates = subFallbackData[`m${idx}`]?.media || [];
              const media = this.selectBestMedia(candidates, origTitle);
              if (media && Array.isArray(media.genres) && media.genres.length > 0) {
                this.cache[origTitle] = this._extractCacheEntry(media);
                totalSuccess++;
                dirtyCache = true;
              } else if (allRequestsSucceeded) {
                // 全段のAPI通信が正常完了して未ヒットだった場合のみネガティブキャッシュ保存
                this.cache[origTitle] = { genres: [], tags: [] };
                dirtyCache = true;
              }
            });
          }
        }

        if (dirtyCache) this.saveCache();

        const currentCount = Math.min(i + BATCH_SIZE, missingTitles.length);
        if (onProgress) onProgress(currentCount, missingTitles.length);
        process.stdout.write(`\r[GenreClient] 照合進捗: ${currentCount}/${missingTitles.length} 作品完了 (成功: ${totalSuccess}作)`);

        if (i + BATCH_SIZE < missingTitles.length) {
          await this.sleep(REQUEST_DELAY_MS);
        }
      }
      console.log(`\n[GenreClient] 照合完了 (成功: ${totalSuccess}作, 残り: ${this.lastRemainingCount}作)`);
    }

    const resultMap = {};
    for (const title of uniqueTitles) {
      const entry = this.cache[title] || { genres: [], tags: [] };
      const genres = entry.genres || [];
      const tags = entry.tags || [];
      resultMap[title] = {
        genres,
        tags,
        category: classifyAnimeScored(genres, tags, title)
      };
    }
    return resultMap;
  }

  _extractCacheEntry(media) {
    const genres = media.genres || [];
    const tags = (media.tags || [])
      .filter(t => !t.isMediaSpoiler)
      .map(t => ({ name: t.name, rank: t.rank }));
    return { genres, tags };
  }
}

module.exports = {
  GenreClient,
  GENRE_DEFINITIONS,
  classifyAnime
};
