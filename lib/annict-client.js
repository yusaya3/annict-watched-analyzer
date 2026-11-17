'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const isVercel = !!process.env.VERCEL;
const BUNDLED_CACHE_DIR = path.resolve(__dirname, '../data/cache');
const WRITABLE_CACHE_DIR = isVercel ? '/tmp/annict-cache' : BUNDLED_CACHE_DIR;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function resolveToken(optionsToken) {
  if (optionsToken) return optionsToken;
  if (process.env.ANNICT_TOKEN) return process.env.ANNICT_TOKEN.trim();

  try {
    const envPath = path.resolve(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^ANNICT_TOKEN\s*=\s*(.*)$/);
        if (match) {
          const val = match[1].trim().replace(/^['"]|['"]$/g, '');
          if (val) return val;
        }
      }
    }
  } catch (e) {}

  try {
    const tokenJsonPath = path.resolve(__dirname, '../config/token.json');
    if (fs.existsSync(tokenJsonPath)) {
      const tokenConfig = JSON.parse(fs.readFileSync(tokenJsonPath, 'utf8'));
      const val = tokenConfig.ANNICT_TOKEN || tokenConfig.token;
      if (val) return String(val).trim();
    }
  } catch (e) {}

  return null;
}

function formatSeason(year, seasonName) {
  if (!year && !seasonName) return '';
  const seasons = { WINTER: '冬', SPRING: '春', SUMMER: '夏', AUTUMN: '秋' };
  const s = seasonName ? (seasons[String(seasonName).toUpperCase()] || seasonName) : '';
  if (year && s) return `${year}年${s}`;
  if (year) return `${year}年`;
  return s;
}

class UserNotFoundError extends Error {
  constructor(username) {
    super(`Annictユーザー @${username} が見つかりませんでした`);
    this.name = 'UserNotFoundError';
    this.statusCode = 404;
  }
}

class AnnictClient {
  constructor(options = {}) {
    this.apiToken = resolveToken(options.apiToken);
    this.sleepMs = options.sleepMs !== undefined ? options.sleepMs : (isVercel ? 100 : 300);
    this.useCache = options.useCache !== undefined ? options.useCache : true;

    if (!fs.existsSync(WRITABLE_CACHE_DIR)) {
      try {
        fs.mkdirSync(WRITABLE_CACHE_DIR, { recursive: true });
      } catch (e) {}
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getCachePath(username) {
    const clean = String(username || '').trim().replace(/^@/, '');
    if (!/^[a-zA-Z0-9_-]{1,50}$/.test(clean)) {
      throw new Error(`無効なユーザー名です: ${clean}`);
    }
    return path.join(WRITABLE_CACHE_DIR, `${clean.toLowerCase()}.json`);
  }

  loadCache(username) {
    const clean = String(username || '').trim().replace(/^@/, '');
    if (!/^[a-zA-Z0-9_-]{1,50}$/.test(clean)) return null;
    const filename = `${clean.toLowerCase()}.json`;
    const writableFile = path.join(WRITABLE_CACHE_DIR, filename);
    const bundledFile = path.join(BUNDLED_CACHE_DIR, filename);
    const targetFile = fs.existsSync(writableFile) ? writableFile : (fs.existsSync(bundledFile) ? bundledFile : null);

    if (this.useCache && targetFile) {
      try {
        const data = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
        console.log(`[Cache] ユーザー @${username} のキャッシュを使用 (${data.animes.length} 作品)`);
        return data.animes;
      } catch (err) {
        console.warn(`[Cache] キャッシュの読み込み失敗: ${err.message}`);
      }
    }
    return null;
  }

  saveCache(username, animes) {
    const cacheFile = this.getCachePath(username);
    try {
      const payload = {
        username,
        fetchedAt: new Date().toISOString(),
        count: animes.length,
        animes
      };
      fs.writeFileSync(cacheFile, JSON.stringify(payload, null, 2), 'utf8');
      console.log(`[Cache] ユーザー @${username} のデータを保存: ${cacheFile}`);
    } catch (err) {
      console.warn(`[Cache] キャッシュの保存失敗: ${err.message}`);
    }
  }

  /**
   * 共通 .c-work-card パーサー（人気作品・新着同期と単一ソース共有）
   */
  static parseWorkCards($, seenIds = null, seasonResolver = null) {
    const works = [];
    $('.c-work-card').each((_, el) => {
      const $card = $(el);
      const $titleLink = $card.find('.c-work-card__work-title a, a[title]');
      const title = $card.find('.c-work-card__work-title').attr('title') ||
                    $card.find('.c-work-card__work-title').text().trim() ||
                    $titleLink.attr('title') || '';
      const href = $card.find('a[href^="/works/"]').attr('href') || '';
      const idMatch = href.match(/\/works\/(\d+)/);
      if (!idMatch) return;
      const id = idMatch[1];
      if (seenIds && seenIds.has(String(id))) return;
      if (seenIds) seenIds.add(String(id));

      let image = '';
      $card.find('source').each((_, s) => {
        const srcset = $(s).attr('srcset') || '';
        const match2x = srcset.match(/([^\s,]+)\s+2x/);
        if (match2x && !image) image = match2x[1];
      });
      if (!image) {
        $card.find('source').each((_, s) => {
          const srcset = $(s).attr('srcset') || '';
          const match = srcset.split(',')[0].trim().split(' ')[0];
          if (match && !image) image = match;
        });
      }
      if (!image) {
        image = $card.find('img').attr('src') || '';
      }
      if (image && (image.includes('color-white-') || image.includes('no-image'))) {
        image = '';
      }

      const season = typeof seasonResolver === 'function' ? (seasonResolver(id) || '') : '';
      works.push({
        id,
        title,
        image,
        season,
        url: `https://annict.com/works/${id}`
      });
    });
    return works;
  }

  async fetchWatchedAnimes(username, forceRefresh = false, options = {}) {
    const isForceFull = options.forceFull === true || forceRefresh === 'full';
    const existingCache = this.loadCache(username);

    if (!forceRefresh && existingCache) {
      return existingCache;
    }

    const fetchOptions = {
      existingCache: isForceFull ? null : existingCache,
      forceFull: isForceFull
    };

    if (this.apiToken) {
      try {
        console.log(`[API] GraphQL API で @${username} を取得中... ${fetchOptions.existingCache ? '(差分更新)' : '(全件取得)'}`);
        return await this.fetchViaGraphQL(username, fetchOptions);
      } catch (err) {
        if (err instanceof UserNotFoundError) throw err;
        console.warn(`[API] GraphQL失敗のためWebスクレイピングへフォールバック: ${err.message}`);
      }
    } else {
      console.log(`[Scraper] Webスクレイピングで @${username} を取得中...`);
    }

    return await this.fetchViaScraping(username, fetchOptions);
  }

  async fetchViaScraping(username, options = {}) {
    const { existingCache, forceFull = false } = options;
    const isIncremental = !forceFull && Array.isArray(existingCache) && existingCache.length > 0;
    const baseUrl = `https://annict.com/@${username}/watched`;

    const firstRes = await this.fetchHtmlWithRetry(`${baseUrl}?page=1`, 2, true);
    if (firstRes.status === 404) {
      throw new UserNotFoundError(username);
    }
    if (!firstRes.html) {
      if (existingCache) return existingCache;
      throw new Error(`@${username} のページ取得に失敗しました`);
    }

    const $first = cheerio.load(firstRes.html);

    let totalWatched = 0;
    const lowerTargetHref = `/@${username.toLowerCase()}/watched`;
    $first('a[href*="/watched"]').each((_, el) => {
      const href = ($first(el).attr('href') || '').toLowerCase();
      if (href === lowerTargetHref) {
        const badgeText = $first(el).find('.badge').text().trim();
        if (badgeText) totalWatched = parseInt(badgeText.replace(/,/g, ''), 10) || 0;
      }
    });

    let maxPage = 1;
    $first('.c-pagination-button-group a').each((_, el) => {
      const href = $first(el).attr('href') || '';
      const match = href.match(/page=(\d+)/);
      if (match) {
        const p = parseInt(match[1], 10);
        if (p > maxPage) maxPage = p;
      }
    });

    console.log(`[Scraper] @${username}: 視聴作品数 約 ${totalWatched} 件 (全 ${maxPage} ページ)`);

    const animesMap = new Map();
    this.parsePageAnimes($first, animesMap);
    const firstPageAnimes = Array.from(animesMap.values());

    if (isIncremental && totalWatched > 0) {
      const existingIdSet = new Set(existingCache.map(a => String(a.id)).filter(Boolean));
      const existingTitleSet = new Set(existingCache.map(a => a.title).filter(Boolean));
      const hasNewOnPage1 = firstPageAnimes.some(a => {
        const hasId = a.id && existingIdSet.has(String(a.id));
        const hasTitle = existingTitleSet.has(a.title);
        return !hasId && !hasTitle;
      });

      if (!hasNewOnPage1 && totalWatched === existingCache.length) {
        console.log(`[Scraper] @${username}: 差分なし (${totalWatched}件)。既存キャッシュを使用`);
        return existingCache;
      }
    }

    let failedPages = 0;
    if (maxPage > 1) {
      const CONCURRENCY = isVercel ? 6 : 4;
      for (let startPage = 2; startPage <= maxPage; startPage += CONCURRENCY) {
        const endPage = Math.min(startPage + CONCURRENCY - 1, maxPage);
        const pagePromises = [];
        for (let page = startPage; page <= endPage; page++) {
          pagePromises.push(
            this.fetchHtmlWithRetry(`${baseUrl}?page=${page}`, 2).then(html => ({ page, html }))
          );
        }

        const results = await Promise.all(pagePromises);
        for (const { html, page } of results) {
          if (!html) {
            failedPages++;
            console.warn(`[Scraper] @${username}: ページ ${page} 取得失敗`);
            continue;
          }
          const $page = cheerio.load(html);
          this.parsePageAnimes($page, animesMap);
        }

        if (endPage < maxPage) {
          await this.sleep(this.sleepMs);
        }
      }
    }

    const existingCacheMap = new Map();
    if (isIncremental || (failedPages > 0 && Array.isArray(existingCache))) {
      for (const a of (existingCache || [])) {
        const key = a.id !== undefined && a.id !== null ? String(a.id) : a.title;
        if (key) {
          existingCacheMap.set(key, a);
          if (failedPages > 0 && !animesMap.has(key)) {
            animesMap.set(key, a);
          }
        }
      }
    }

    const animes = [];
    for (const anime of animesMap.values()) {
      const key = anime.id !== undefined && anime.id !== null ? String(anime.id) : anime.title;
      const cached = existingCacheMap.get(key);
      if (cached) {
        if (!anime.image && cached.image) anime.image = cached.image;
        if (!anime.season && cached.season) anime.season = cached.season;
        if (cached.episodesCount) anime.episodesCount = cached.episodesCount;
        if (cached.media) anime.media = cached.media;
      }
      animes.push(anime);
    }

    console.log(`[Scraper] @${username}: 取得完了 計 ${animes.length} 作品${failedPages > 0 ? ` (取得失敗ページ: ${failedPages})` : ''}`);
    if (failedPages === 0) {
      this.saveCache(username, animes);
    } else {
      console.warn(`[Scraper] @${username}: 一部ページ取得失敗のためキャッシュ上書きをスキップします`);
    }
    return animes;
  }

  parsePageAnimes($, animesMap) {
    const extractCardData = ($card, season = '') => {
      const $titleLink = $card.find('.c-work-card__work-title');
      const title = $titleLink.attr('title') || $titleLink.text().trim();
      const href = $card.find('a[href^="/works/"]').attr('href') || '';
      const idMatch = href.match(/\/works\/(\d+)/);
      const id = idMatch ? idMatch[1] : null;

      let image = '';
      const sources = $card.find('source');
      sources.each((_, s) => {
        const srcset = $(s).attr('srcset') || '';
        const match2x = srcset.match(/([^\s,]+)\s+2x/);
        if (match2x && !image) image = match2x[1];
      });
      if (!image) {
        sources.each((_, s) => {
          const srcset = $(s).attr('srcset') || '';
          const match = srcset.split(',')[0].trim().split(' ')[0];
          if (match && !image) image = match;
        });
      }
      if (!image) image = $card.find('img').attr('src') || '';
      if (image && (image.includes('color-white-') || image.includes('no-image'))) image = '';

      if (id && title && !animesMap.has(id)) {
        animesMap.set(id, {
          id,
          title,
          image,
          season,
          url: `https://annict.com/works/${id}`
        });
      }
    };

    $('h2').each((_, h2El) => {
      const rawSeason = $(h2El).text().trim();
      if (!rawSeason.includes('年') && rawSeason !== 'その他') return;
      const season = rawSeason === 'その他' ? '' : rawSeason;
      const $h2Container = $(h2El).closest('.container');
      const $worksContainer = $h2Container.next();
      $worksContainer.find('.c-work-card').each((_, cardEl) => {
        extractCardData($(cardEl), season);
      });
    });

    $('.c-work-card').each((_, el) => extractCardData($(el), ''));

    if (animesMap.size === 0) {
      $('a[href^="/works/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const idMatch = href.match(/^\/works\/(\d+)$/);
        if (idMatch) {
          const id = idMatch[1];
          const title = $(el).text().trim();
          if (title && !animesMap.has(id) && title.length > 1) {
            animesMap.set(id, { id, title, image: '', season: '', url: `https://annict.com/works/${id}` });
          }
        }
      });
    }
  }

  async fetchHtml(url) {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(12000),
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });
      if (!res.ok) {
        console.warn(`[HTTP ${res.status}] ${url}`);
        return { status: res.status, html: null };
      }
      return { status: res.status, html: await res.text() };
    } catch (err) {
      console.error(`[Fetch Error] ${url}: ${err.message}`);
      return { status: 0, html: null };
    }
  }

  async fetchHtmlWithRetry(url, maxRetries = 2, withStatus = false) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await this.fetchHtml(url);
      if (result.html) return withStatus ? result : result.html;
      if (result.status === 404) return withStatus ? result : null;
      if (attempt < maxRetries) {
        await this.sleep(400 * (attempt + 1));
      }
    }
    return withStatus ? { status: 0, html: null } : null;
  }

  async fetchViaGraphQL(username, options = {}) {
    const { existingCache } = options;
    const isIncremental = Array.isArray(existingCache) && existingCache.length > 0;
    const existingIdSet = isIncremental ? new Set(existingCache.map(a => String(a.id)).filter(Boolean)) : null;

    const endpoint = 'https://api.annict.com/graphql';
    let hasNextPage = true;
    let afterCursor = null;
    const animes = [];
    let knownHits = 0;

    while (hasNextPage) {
      const query = `
        query($username: String!, $after: String) {
          user(username: $username) {
            libraryEntries(states: [WATCHED], after: $after, first: 50, orderBy: { field: CREATED_AT, direction: DESC }) {
              pageInfo { hasNextPage endCursor }
              nodes {
                work {
                  annictId
                  title
                  media
                  episodesCount
                  seasonYear
                  seasonName
                  image { recommendedImageUrl facebookOgImageUrl }
                }
              }
            }
          }
        }
      `;

      let res;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          signal: AbortSignal.timeout(15000),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiToken}`
          },
          body: JSON.stringify({ query, variables: { username, after: afterCursor } })
        });
      } catch (networkErr) {
        throw new Error(`Annict API ネットワークエラー: ${networkErr.message}`);
      }

      if (res.status === 401) {
        throw new Error('Annict API トークンが無効または失効しています (HTTP 401)');
      }

      if (res.status === 429) {
        await this.sleep(2000);
        res = await fetch(endpoint, {
          method: 'POST',
          signal: AbortSignal.timeout(15000),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiToken}`
          },
          body: JSON.stringify({ query, variables: { username, after: afterCursor } })
        });
      }

      if (!res.ok) {
        throw new Error(`Annict API HTTPエラー (${res.status})`);
      }

      const json = await res.json();
      if (json.errors && json.errors.length > 0) {
        throw new Error(`Annict API GraphQLエラー: ${json.errors.map(e => e.message).join(', ')}`);
      }

      const user = json.data?.user;
      if (!user) {
        throw new UserNotFoundError(username);
      }

      const library = user.libraryEntries;
      if (!library || !library.nodes) break;

      for (const node of library.nodes) {
        if (node && node.work) {
          let image = node.work.image?.recommendedImageUrl || node.work.image?.facebookOgImageUrl || '';
          if (image && (image.includes('color-white-') || image.includes('no-image'))) {
            image = '';
          }
          const id = String(node.work.annictId);
          if (isIncremental && existingIdSet.has(id)) {
            knownHits++;
          } else {
            animes.push({
              id,
              title: node.work.title,
              media: node.work.media || '',
              episodesCount: node.work.episodesCount || null,
              image,
              season: formatSeason(node.work.seasonYear, node.work.seasonName),
              url: `https://annict.com/works/${id}`
            });
          }
        }
      }

      if (isIncremental && knownHits >= 3) {
        hasNextPage = false;
        break;
      }

      hasNextPage = !!library.pageInfo?.hasNextPage;
      afterCursor = library.pageInfo?.endCursor;
      if (hasNextPage) await this.sleep(this.sleepMs);
    }

    const uniqueMap = new Map();
    for (const anime of animes) {
      if (anime.id && !uniqueMap.has(anime.id)) uniqueMap.set(anime.id, anime);
    }
    if (isIncremental) {
      for (const anime of existingCache) {
        if (anime.id && !uniqueMap.has(anime.id)) uniqueMap.set(anime.id, anime);
      }
    }
    const uniqueAnimes = Array.from(uniqueMap.values());

    console.log(`[API] @${username}: 取得完了 計 ${uniqueAnimes.length} 作品`);
    this.saveCache(username, uniqueAnimes);
    return uniqueAnimes;
  }
}

AnnictClient.UserNotFoundError = UserNotFoundError;

module.exports = AnnictClient;
