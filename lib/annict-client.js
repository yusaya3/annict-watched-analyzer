'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const isVercel = !!process.env.VERCEL;
const BUNDLED_CACHE_DIR = path.resolve(__dirname, '../data/cache');
const WRITABLE_CACHE_DIR = isVercel ? '/tmp/annict-cache' : BUNDLED_CACHE_DIR;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

class AnnictClient {
  constructor(options = {}) {
    this.apiToken = options.apiToken || process.env.ANNICT_TOKEN || null;
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
   */
  async fetchWatchedAnimes(username, forceRefresh = false) {
    if (!forceRefresh) {
      const cached = this.loadCache(username);
      if (cached) return cached;
    }

    if (this.apiToken) {
      try {
        console.log(`[API] GraphQL API を使用して @${username} のデータを取得します...`);
        return await this.fetchViaGraphQL(username);
      } catch (err) {
        console.warn(`[API] GraphQL API の取得に失敗したため、Webスクレイピングにフォールバックします: ${err.message}`);
      }
    }

    return await this.fetchViaScraping(username);
  }

  /**
   * AnnictのWebサイトから直接スクレイピング
   */
  async fetchViaScraping(username) {
    console.log(`[Scraper] @${username} の視聴データを取得開始...`);
    const baseUrl = `https://annict.com/@${username}/watched`;

    // 1ページ目を取得して最大ページ数と総件数を確認
    const firstPageHtml = await this.fetchHtml(`${baseUrl}?page=1`);
    if (!firstPageHtml) {
      console.error(`[Scraper] @${username} のページを取得できませんでした。ユーザー名が存在するか確認してください。`);
      return [];
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

    // 2ページ目以降の取得
    for (let page = 2; page <= maxPage; page++) {
      await this.sleep(this.sleepMs);
      process.stdout.write(`\r[Scraper] @${username}: ページ ${page}/${maxPage} 取得中...`);
      const pageHtml = await this.fetchHtml(`${baseUrl}?page=${page}`);
      if (!pageHtml) continue;
      const $page = cheerio.load(pageHtml);
      this.parsePageAnimes($page, animesMap);
    }
    process.stdout.write('\n');

    const animes = Array.from(animesMap.values());
    console.log(`[Scraper] @${username}: 取得完了！ 計 ${animes.length} 作品`);

    this.saveCache(username, animes);
    return animes;
  }

  parsePageAnimes($, animesMap) {
    // Annictの各シーズンブロックまたはカード一覧を走査
    $('.c-work-card').each((_, el) => {
      const $card = $(el);
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
        // ロゴ画像がデフォルトプレースホルダーの場合は空にする
        image = '';
      }

      // シーズン情報（親コンテナを遡って season 見出しを探す）
      let season = '';
      const $seasonHeader = $card.closest('.vstack').find('h2').first();
      if ($seasonHeader.length) {
        season = $seasonHeader.text().trim();
      }

      if (id && title) {
        if (!animesMap.has(id)) {
          animesMap.set(id, {
            id,
            title,
            image,
            season,
            url: `https://annict.com/works/${id}`
          });
        }
      }
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
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
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
  async fetchViaGraphQL(username) {
    const endpoint = 'https://api.annict.com/graphql';
    let hasNextPage = true;
    let afterCursor = null;
    const animes = [];

    while (hasNextPage) {
      const query = `
        query($username: String!, $after: String) {
          user(username: $username) {
            libraryEntries(states: [WATCHED], after: $after, first: 50) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                work {
                  annictId
                  title
                  seasonName
                  image {
                    recommendedImageUrl
                  }
                }
              }
            }
          }
        }
      `;

      const res = await fetch(endpoint, {
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

      const json = await res.json();
      if (json.errors) {
        throw new Error(json.errors.map(e => e.message).join(', '));
      }

      const library = json.data?.user?.libraryEntries;
      if (!library) break;

      for (const node of library.nodes) {
        if (node.work) {
          animes.push({
            id: String(node.work.annictId),
            title: node.work.title,
            image: node.work.image?.recommendedImageUrl || '',
            season: node.work.seasonName || '',
            url: `https://annict.com/works/${node.work.annictId}`
          });
        }
      }

      hasNextPage = library.pageInfo.hasNextPage;
      afterCursor = library.pageInfo.endCursor;
      await this.sleep(100);
    }

    this.saveCache(username, animes);
    return animes;
  }
}

module.exports = AnnictClient;
