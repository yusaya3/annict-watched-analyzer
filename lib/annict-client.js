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

  // .env ファイルからの読み込み（ローカル環境用）
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

  // config/token.json からの読み込み（ローカル環境用フォールバック）
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
  const seasons = {
    WINTER: '冬',
    SPRING: '春',
    SUMMER: '夏',
    AUTUMN: '秋'
  };
  const s = seasonName ? (seasons[String(seasonName).toUpperCase()] || seasonName) : '';
  if (year && s) return `${year}年${s}`;
  if (year) return `${year}年`;
  return s;
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
    const filename = `${username.toLowerCase()}.json`;
    // 書き込み先
    return path.join(WRITABLE_CACHE_DIR, filename);
  }

  loadCache(username) {
    const filename = `${username.toLowerCase()}.json`;
    const writableFile = path.join(WRITABLE_CACHE_DIR, filename);
    const bundledFile = path.join(BUNDLED_CACHE_DIR, filename);

    const targetFile = fs.existsSync(writableFile) ? writableFile : (fs.existsSync(bundledFile) ? bundledFile : null);

    if (this.useCache && targetFile) {
      try {
        const data = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
        console.log(`[Cache] ユーザー @${username} のキャッシュを使用します (${data.animes.length} 作品)`);
        return data.animes;
      } catch (err) {
        console.warn(`[Cache] キャッシュの読み込みに失敗しました: ${err.message}`);
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
      console.log(`[Cache] ユーザー @${username} のデータをキャッシュに保存しました: ${cacheFile}`);
    } catch (err) {
      console.warn(`[Cache] キャッシュの保存に失敗しました: ${err.message}`);
    }
  }

  /**
   * ユーザーの視聴済み（Watched）アニメ一覧を取得する
   * @param {string} username 対象ユーザー名
   * @param {boolean|string} forceRefresh 強制更新フラグ (true: 差分更新, 'full': 完全再取得, false: キャッシュ優先)
   * @param {object} options オプション ({ forceFull: boolean })
   */
  async fetchWatchedAnimes(username, forceRefresh = false, options = {}) {
    const isForceFull = options.forceFull === true || forceRefresh === 'full';
    const existingCache = this.loadCache(username);

    if (!forceRefresh) {
      if (existingCache) return existingCache;
    }

    const fetchOptions = {
      existingCache: isForceFull ? null : existingCache,
      forceFull: isForceFull
    };

    if (this.apiToken) {
      try {
        console.log(`[API] Annict 公式 GraphQL API を使用して @${username} のデータを取得します... ${fetchOptions.existingCache ? '(⚡差分更新モード)' : '(全件取得モード)'}`);
        return await this.fetchViaGraphQL(username, fetchOptions);
      } catch (err) {
        console.warn(`[API] GraphQL API の取得に失敗したため、Webスクレイピングにフォールバックします: ${err.message}`);
      }
    } else {
      console.log(`[Scraper] APIトークン未設定のため、Webスクレイピングを使用します (@${username}) ${fetchOptions.existingCache ? '(⚡差分更新モード)' : '(全件取得モード)'}`);
    }

    return await this.fetchViaScraping(username, fetchOptions);
  }

  /**
   * AnnictのWebサイトから直接スクレイピング
   */
  async fetchViaScraping(username, options = {}) {
    const { existingCache } = options;
    const isIncremental = Array.isArray(existingCache) && existingCache.length > 0;
    console.log(`[Scraper] @${username} の視聴データを取得開始... ${isIncremental ? '(⚡差分更新)' : '(全件取得)'}`);
    const baseUrl = `https://annict.com/@${username}/watched`;

    // 1ページ目を取得して最大ページ数と総件数を確認
    const firstPageHtml = await this.fetchHtml(`${baseUrl}?page=1`);
    if (!firstPageHtml) {
      console.error(`[Scraper] @${username} のページを取得できませんでした。ユーザー名が存在するか確認してください。`);
      return existingCache || [];
    }

    const $first = cheerio.load(firstPageHtml);

    // 見た件数の取得
    let totalWatched = 0;
    const watchedBadge = $first(`a[href="/@${username}/watched"] .badge`).text().trim();
    if (watchedBadge) {
      totalWatched = parseInt(watchedBadge, 10) || 0;
    }

    // 最大ページ数の取得
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

    // 1ページ目のパース
    this.parsePageAnimes($first, animesMap);
    const firstPageAnimes = Array.from(animesMap.values());

    // 差分判定: 1ページ目の作品のうち既存キャッシュに既に含まれる作品があるか
    let shouldFetchRemaining = true;
    if (isIncremental) {
      const existingIdSet = new Set(existingCache.map(a => String(a.id)).filter(Boolean));
      const existingTitleSet = new Set(existingCache.map(a => a.title).filter(Boolean));
      let matchCount = 0;
      for (const a of firstPageAnimes) {
        if ((a.id && existingIdSet.has(String(a.id))) || existingTitleSet.has(a.title)) {
          matchCount++;
        }
      }

      // 1ページ目の中に既知作品が2件以上あれば、それ以前は既存キャッシュに存在するため2ページ目以降はスキップ
      if (matchCount >= 2 || (firstPageAnimes.length > 0 && matchCount === firstPageAnimes.length)) {
        console.log(`[Scraper] @${username}: 既存キャッシュとの重複を確認 (${matchCount}件)。差分取得を即座に完了します (2〜${maxPage}ページをスキップ)`);
        shouldFetchRemaining = false;
      }
    }

    // 2ページ目以降の取得（差分で完了した場合はスキップ）
    if (shouldFetchRemaining && maxPage > 1) {
      const CONCURRENCY = isVercel ? 6 : 4;
      for (let startPage = 2; startPage <= maxPage; startPage += CONCURRENCY) {
        const endPage = Math.min(startPage + CONCURRENCY - 1, maxPage);
        process.stdout.write(`\r[Scraper] @${username}: ページ ${startPage}-${endPage}/${maxPage} 取得中...`);

        const pagePromises = [];
        for (let page = startPage; page <= endPage; page++) {
          pagePromises.push(
            this.fetchHtml(`${baseUrl}?page=${page}`).then(html => ({ page, html }))
          );
        }

        const results = await Promise.all(pagePromises);
        for (const { html } of results) {
          if (!html) continue;
          const $page = cheerio.load(html);
          this.parsePageAnimes($page, animesMap);
        }

        if (endPage < maxPage) {
          await this.sleep(this.sleepMs);
        }
      }
      process.stdout.write('\n');
    }

    // 新着データと既存キャッシュを統合（IDまたはTitle優先で重複排除）
    const mergedMap = new Map();
    // 1. 今回取得した新しいデータを優先追加
    for (const anime of animesMap.values()) {
      const key = anime.id || anime.title;
      if (key && !mergedMap.has(key)) {
        mergedMap.set(key, anime);
      }
    }
    // 2. 既存キャッシュの作品を追加（差分更新時）
    if (isIncremental) {
      for (const anime of existingCache) {
        const key = anime.id || anime.title;
        if (key && !mergedMap.has(key)) {
          mergedMap.set(key, anime);
        }
      }
    }

    const animes = Array.from(mergedMap.values());
    console.log(`[Scraper] @${username}: 取得完了！ 計 ${animes.length} 作品`);

    this.saveCache(username, animes);
    return animes;
  }

  parsePageAnimes($, animesMap) {
    const extractCardData = ($card, season = '') => {
      const $titleLink = $card.find('.c-work-card__work-title');
      const title = $titleLink.attr('title') || $titleLink.text().trim();
      const href = $card.find('a[href^="/works/"]').attr('href') || '';
      const idMatch = href.match(/\/works\/(\d+)/);
      const id = idMatch ? idMatch[1] : null;

      // 高画質画像サムネイル (source の 2x srcset を最優先取得)
      let image = '';
      const sources = $card.find('source');
      sources.each((_, s) => {
        const srcset = $(s).attr('srcset') || '';
        const match2x = srcset.match(/([^\s,]+)\s+2x/);
        if (match2x && !image) {
          image = match2x[1];
        }
      });

      if (!image) {
        sources.each((_, s) => {
          const srcset = $(s).attr('srcset') || '';
          const match = srcset.split(',')[0].trim().split(' ')[0];
          if (match && !image) {
            image = match;
          }
        });
      }

      if (!image) {
        image = $card.find('img').attr('src') || '';
      }

      if (image && image.includes('color-white-')) {
        image = '';
      }

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

    // 1. 各 h2（シーズン見出し: "2026年夏", "2025年冬" 等）ごとに直後の作品コンテナを正確に紐付け
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

    // 2. 万一 h2 が取れなかった場合や、h2 の外にある作品カードの救済
    $('.c-work-card').each((_, el) => {
      extractCardData($(el), '');
    });

    // 万一 .c-work-card のクラス名が変わった場合のフォールバック
    if (animesMap.size === 0) {
      $('a[href^="/works/"]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const idMatch = href.match(/^\/works\/(\d+)$/);
        if (idMatch) {
          const id = idMatch[1];
          const title = $(el).text().trim();
          if (title && !animesMap.has(id) && title.length > 1) {
            animesMap.set(id, {
              id,
              title,
              image: '',
              season: '',
              url: `https://annict.com/works/${id}`
            });
          }
        }
      });
    }
  }

  async fetchHtml(url) {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
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
        return null;
      }
      return await res.text();
    } catch (err) {
      console.error(`[Fetch Error] ${url}: ${err.message}`);
      return null;
    }
  }

  /**
   * GraphQL API による取得（トークン指定時）
   */
  async fetchViaGraphQL(username, options = {}) {
    const { existingCache } = options;
    const isIncremental = Array.isArray(existingCache) && existingCache.length > 0;
    const existingIdSet = isIncremental ? new Set(existingCache.map(a => String(a.id)).filter(Boolean)) : null;

    const endpoint = 'https://api.annict.com/graphql';
    let hasNextPage = true;
    let afterCursor = null;
    const animes = [];
    let pageCount = 0;
    let knownHits = 0;

    while (hasNextPage) {
      pageCount++;
      const query = `
        query($username: String!, $after: String) {
          user(username: $username) {
            libraryEntries(states: [WATCHED], after: $after, first: 50, orderBy: { field: CREATED_AT, direction: DESC }) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                work {
                  annictId
                  title
                  seasonYear
                  seasonName
                  image {
                    recommendedImageUrl
                    facebookOgImageUrl
                  }
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
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiToken}`
          },
          body: JSON.stringify({
            query,
            variables: { username, after: afterCursor }
          })
        });
      } catch (networkErr) {
        throw new Error(`Annict API ネットワークエラー: ${networkErr.message}`);
      }

      if (res.status === 401) {
        throw new Error('Annict API トークンが無効または失効しています (HTTP 401 Unauthorized)');
      }

      if (res.status === 429) {
        console.warn(`[API] レート制限 (HTTP 429)。少し待機して再試行します...`);
        await this.sleep(2000);
        res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiToken}`
          },
          body: JSON.stringify({
            query,
            variables: { username, after: afterCursor }
          })
        });
      }

      if (!res.ok) {
        throw new Error(`Annict API HTTPエラー (${res.status} ${res.statusText})`);
      }

      const json = await res.json();
      if (json.errors && json.errors.length > 0) {
        throw new Error(`Annict API GraphQLエラー: ${json.errors.map(e => e.message).join(', ')}`);
      }

      const user = json.data?.user;
      if (!user) {
        console.warn(`[API] ユーザー @${username} が見つかりませんでした。`);
        break;
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
              image,
              season: formatSeason(node.work.seasonYear, node.work.seasonName),
              url: `https://annict.com/works/${id}`
            });
          }
        }
      }

      // 差分判定: 既存キャッシュに含まれる作品に到達したら、以降は既に取得済みのため即座に終了
      if (isIncremental && knownHits >= 3) {
        console.log(`\n[API] @${username}: 既存キャッシュの作品を確認 (${knownHits}件)。差分取得を完了 (${animes.length}件の新着作品を追加)`);
        hasNextPage = false;
        break;
      }

      hasNextPage = !!library.pageInfo?.hasNextPage;
      afterCursor = library.pageInfo?.endCursor;

      process.stdout.write(`\r[API] @${username}: 視聴作品 ${animes.length} 件 取得中 (ページ ${pageCount})...`);

      if (hasNextPage) {
        await this.sleep(this.sleepMs);
      }
    }
    process.stdout.write('\n');

    // 重複IDの排除および既存キャッシュとのマージ
    const uniqueMap = new Map();
    for (const anime of animes) {
      if (anime.id && !uniqueMap.has(anime.id)) {
        uniqueMap.set(anime.id, anime);
      }
    }
    if (isIncremental) {
      for (const anime of existingCache) {
        if (anime.id && !uniqueMap.has(anime.id)) {
          uniqueMap.set(anime.id, anime);
        }
      }
    }
    const uniqueAnimes = Array.from(uniqueMap.values());

    console.log(`[API] @${username}: 取得完了！ 計 ${uniqueAnimes.length} 作品`);

    this.saveCache(username, uniqueAnimes);
    return uniqueAnimes;
  }
}

module.exports = AnnictClient;
