'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const OUTPUT_FILE = path.resolve(__dirname, '../static/res/popular_works.json');
const CACHE_DIR = path.resolve(__dirname, '../data/cache');

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    }
  });
  if (!res.ok) return null;
  return await res.text();
}

async function fetchPopularWorks(totalPages = 65) {
  console.log(`[PopularWorks] Annict人気作品を取得開始 (${totalPages}ページ = 約${totalPages * 30}作品)...`);

  // 既存キャッシュから既知のシーズンマップを構築
  const idToSeason = new Map();
  if (fs.existsSync(CACHE_DIR)) {
    const cacheFiles = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json') && !f.includes('genre'));
    for (const f of cacheFiles) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
        for (const a of (d.animes || [])) {
          if (a.id && a.season) {
            idToSeason.set(String(a.id), a.season);
          }
        }
      } catch (e) {}
    }
  }
  console.log(`[PopularWorks] 既存キャッシュから既知のシーズン情報を読込: ${idToSeason.size}件`);

  const popularWorks = [];
  const seenIds = new Set();
  const concurrency = 6;

  for (let p = 1; p <= totalPages; p += concurrency) {
    const end = Math.min(p + concurrency - 1, totalPages);
    const promises = [];
    for (let page = p; page <= end; page++) {
      promises.push(
        fetchHtml(`https://annict.com/works/popular?page=${page}`).then(html => ({ page, html }))
      );
    }
    const results = await Promise.all(promises);
    results.sort((a, b) => a.page - b.page);

    for (const { page, html } of results) {
      if (!html) continue;
      const $ = cheerio.load(html);

      $('.c-work-card').each((_, el) => {
        const $card = $(el);
        const $titleLink = $card.find('.c-work-card__work-title a, a[title]');
        const title = $card.find('.c-work-card__work-title').text().trim() || $titleLink.attr('title') || '';
        const href = $card.find('a[href^="/works/"]').attr('href') || '';
        const idMatch = href.match(/\/works\/(\d+)/);
        if (!idMatch) return;
        const id = idMatch[1];
        if (seenIds.has(id)) return;
        seenIds.add(id);

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
        if (image && image.includes('color-white-')) {
          image = '';
        }

        const season = idToSeason.get(id) || '';

        popularWorks.push({
          id,
          title,
          image,
          season,
          url: `https://annict.com/works/${id}`
        });
      });
    }

    process.stdout.write(`\r[PopularWorks] ページ ${end}/${totalPages} 取得完了 (現在 ${popularWorks.length} 作品)`);
    await new Promise(r => setTimeout(r, 150));
  }
  process.stdout.write('\n');

  // 出力先ディレクトリの確保と保存
  const outDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    count: popularWorks.length,
    works: popularWorks
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`[PopularWorks] 保存完了: ${OUTPUT_FILE} (${popularWorks.length}作品)`);
  return payload;
}

if (require.main === module) {
  fetchPopularWorks(65).catch(console.error);
}

module.exports = { fetchPopularWorks };
