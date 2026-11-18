'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const GenreEngine = require('../../static/core/genre-engine.js');
const StudioDictionary = require('../../static/core/studio-dictionary.js');
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

  selectBestMedia(candidates, searchTitle, expectedYear = null) {
    return GenreEngine.selectBestAniListMedia(candidates, searchTitle, expectedYear);
  }

  async fetchBatchWithRetry(batchTitles, maxRetries = 3) {
    const fields = batchTitles.map((t, idx) => `
      m${idx}: Page(page: 1, perPage: 8) {
        media(search: ${JSON.stringify(t)}, type: ANIME, sort: SEARCH_MATCH) {
          id
          format
          popularity
          startDate { year }
          title { native romaji english }
          synonyms
          genres
          tags { name rank isMediaSpoiler }
          studios {
            edges {
              isMain
              node { name isAnimationStudio }
            }
          }
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

  async resolveGenres(titles, onProgress = null, timeBudgetMs = DEFAULT_TIME_BUDGET_MS, options = {}) {
    const startTime = Date.now();
    const workMetaByTitle = options?.workMetaByTitle || {};
    const uniqueTitles = Array.from(new Set(titles.filter(t => typeof t === 'string' && t.trim().length > 0)));
    const missingTitles = uniqueTitles.filter(t => {
      if (!(t in this.cache)) return true;
      const entry = this.cache[t];
      if (entry.tags === null && entry.genres.length > 0) return true;
      if (!Array.isArray(entry.studios)) return true;
      return false;
    });
    this.lastRemainingCount = 0;

    const getYearForTitle = (t) => {
      const meta = workMetaByTitle[t];
      return GenreEngine.extractYearHint(meta?.season || t);
    };

    const mergeCacheMedia = (origTitle, media) => {
      const extracted = this._extractCacheEntry(media);
      const prev = this.cache[origTitle];
      this.cache[origTitle] = {
        genres: (extracted.genres && extracted.genres.length > 0) ? extracted.genres : (prev?.genres || []),
        tags: (extracted.tags && extracted.tags.length > 0) ? extracted.tags : (prev?.tags || []),
        studios: extracted.studios.length > 0 ? extracted.studios : (Array.isArray(prev?.studios) ? prev.studios : [])
      };
    };

    if (missingTitles.length > 0) {
      console.log(`[GenreClient] 未取得のアニメジャンル・タグ・制作会社を照合中 (${missingTitles.length} / ${uniqueTitles.length} 作品)...`);
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
          const media = this.selectBestMedia(candidates, origTitle, getYearForTitle(origTitle));
          if (media && ((Array.isArray(media.genres) && media.genres.length > 0) || GenreEngine.extractAniListStudios(media).length > 0)) {
            mergeCacheMedia(origTitle, media);
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
            const media = this.selectBestMedia(candidates, origTitle, getYearForTitle(origTitle));
            if (media && ((Array.isArray(media.genres) && media.genres.length > 0) || GenreEngine.extractAniListStudios(media).length > 0)) {
              mergeCacheMedia(origTitle, media);
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
              const media = this.selectBestMedia(candidates, origTitle, getYearForTitle(origTitle));
              if (media && ((Array.isArray(media.genres) && media.genres.length > 0) || GenreEngine.extractAniListStudios(media).length > 0)) {
                mergeCacheMedia(origTitle, media);
                totalSuccess++;
                dirtyCache = true;
              } else if (allRequestsSucceeded) {
                // 全段のAPI通信が正常完了して未ヒットだった場合のみネガティブキャッシュ保存
                const prev = this.cache[origTitle];
                this.cache[origTitle] = {
                  genres: prev?.genres || [],
                  tags: Array.isArray(prev?.tags) ? prev.tags : [],
                  studios: Array.isArray(prev?.studios) ? prev.studios : []
                };
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
      const entry = this.cache[title] || { genres: [], tags: [], studios: [] };
      const genres = entry.genres || [];
      const tags = entry.tags || [];
      const studios = Array.isArray(entry.studios) ? entry.studios : [];
      resultMap[title] = {
        genres,
        tags,
        studios,
        category: classifyAnimeScored(genres, tags, title)
      };
    }
    return resultMap;
  }

  /**
   * AniListで見つからなかった制作会社をAnnict公式スタッフページから補完する
   */
  async enrichStudiosFromAnnict(works = [], maxFetch = 25, timeBudgetMs = 8000) {
    if (!Array.isArray(works) || works.length === 0) return 0;
    const startTime = Date.now();
    const targets = [];
    const seenTitle = new Set();

    for (const w of works) {
      if (!w?.id || !w?.title || seenTitle.has(w.title)) continue;
      seenTitle.add(w.title);
      const entry = this.cache[w.title];
      if (!entry || !Array.isArray(entry.studios) || entry.studios.length === 0) {
        targets.push(w);
        if (targets.length >= maxFetch) break;
      }
    }
    if (targets.length === 0) return 0;

    let updated = 0;
    const CONCURRENCY = isVercel ? 5 : 4;
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      if (Date.now() - startTime > timeBudgetMs) break;
      const chunk = targets.slice(i, i + CONCURRENCY);
      const list = await Promise.all(chunk.map(async (w) => {
        const studios = await GenreClient.fetchAnnictWorkStudios(w.id);
        return { title: w.title, studios };
      }));
      for (const { title, studios } of list) {
        if (studios.length > 0) {
          const prev = this.cache[title] || { genres: [], tags: [] };
          this.cache[title] = {
            genres: prev.genres || [],
            tags: Array.isArray(prev.tags) ? prev.tags : [],
            studios
          };
          updated++;
        }
      }
    }
    if (updated > 0) this.saveCache();
    return updated;
  }

  static extractStudiosFromStaffList(staffs = []) {
    const primaryRoles = /^(?:アニメーション制作|アニメ制作|アニメーション制作会社|アニメ制作会社|制作スタジオ|アニメーション・3DCG制作|3DCG制作|CG制作|制作プロダクション)$/;
    const primary = [];
    const fallbackProd = [];

    for (const row of staffs) {
      const role = String(row.role || '').trim();
      const entries = row.entries || [];
      if (primaryRoles.test(role) || /^アニメーション制作（/.test(role)) {
        for (const e of entries) {
          const norm = StudioDictionary.normalizeStudioName(e.name);
          if (norm && !primary.includes(norm)) primary.push(norm);
        }
      } else if (/^制作(?:\s+|$)/.test(role)) {
        for (const e of entries) {
          if (StudioDictionary.isKnownStudioName(e.name)) {
            const norm = StudioDictionary.normalizeStudioName(e.name);
            if (norm && !fallbackProd.includes(norm)) fallbackProd.push(norm);
          }
        }
      }
    }
    return primary.length > 0 ? primary : fallbackProd;
  }

  static async fetchAnnictWorkStudios(workId) {
    if (!workId) return [];
    try {
      const res = await fetch(`https://annict.com/works/${encodeURIComponent(workId)}/staffs`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'ja,en;q=0.8'
        },
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) return [];
      const html = await res.text();
      const $ = cheerio.load(html);
      const staffs = [];
      $('.g-3.row').each((_, row) => {
        const $cols = $(row).children('div');
        if ($cols.length >= 2) {
          const role = $cols.eq(0).text().replace(/\s+/g, ' ').trim();
          const $val = $cols.eq(1);
          const links = $val.find('a');
          const entries = [];
          if (links.length > 0) {
            links.each((__, a) => {
              const name = $(a).text().replace(/\s+/g, ' ').trim();
              if (name) entries.push({ name, href: $(a).attr('href') || '' });
            });
          } else {
            const txt = $val.text().replace(/\s+/g, ' ').trim();
            if (txt) entries.push({ name: txt, href: '' });
          }
          if (role && entries.length > 0) staffs.push({ role, entries });
        }
      });
      return GenreClient.extractStudiosFromStaffList(staffs);
    } catch (e) {
      return [];
    }
  }

  _extractCacheEntry(media) {
    const genres = media.genres || [];
    const tags = (media.tags || [])
      .filter(t => !t.isMediaSpoiler)
      .map(t => ({ name: t.name, rank: t.rank }));
    const rawStudios = GenreEngine.extractAniListStudios(media);
    const studios = [];
    for (const s of rawStudios) {
      const n = StudioDictionary.normalizeStudioName(s);
      if (n && !studios.includes(n)) studios.push(n);
    }
    return { genres, tags, studios };
  }
}

module.exports = {
  GenreClient,
  GENRE_DEFINITIONS,
  classifyAnime
};
