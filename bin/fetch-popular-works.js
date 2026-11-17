'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const AnnictClient = require('../lib/annict-client.js');
const { writePopularSplitAssets } = require('../scripts/build-popular-split.js');

const BUNDLED_POPULAR_DIR = path.resolve(__dirname, '../static/res/popular');
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
  console.log(`[PopularWorks] Annict人気作品を取得開始 (${totalPages}ページ)...`);

  const idToSeason = new Map();
  if (fs.existsSync(CACHE_DIR)) {
    const cacheFiles = fs.readdirSync(CACHE_DIR).filter(
      f => f.endsWith('.json') && !f.includes('genre') && !f.includes('hires')
    );
    for (const f of cacheFiles) {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
        for (const a of (d.animes || [])) {
          if (a.id && a.season) idToSeason.set(String(a.id), a.season);
        }
      } catch (e) {}
    }
  }

  const popularWorks = [];
  const seenIds = new Set();
  const concurrency = 6;

  for (let p = 1; p <= totalPages; p += concurrency) {
    const end = Math.min(p + concurrency - 1, totalPages);
    const promises = [];
    for (let page = p; page <= end; page++) {
      promises.push(fetchHtml(`https://annict.com/works/popular?page=${page}`).then(html => ({ page, html })));
    }
    const results = await Promise.all(promises);
    results.sort((a, b) => a.page - b.page);

    for (const { html } of results) {
      if (!html) continue;
      const $ = cheerio.load(html);
      const parsed = AnnictClient.parseWorkCards($, seenIds, id => idToSeason.get(id));
      popularWorks.push(...parsed);
    }

    process.stdout.write(`\r[PopularWorks] ページ ${end}/${totalPages} 取得完了 (${popularWorks.length} 作品)`);
    await new Promise(r => setTimeout(r, 150));
  }
  process.stdout.write('\n');

  writePopularSplitAssets(popularWorks, BUNDLED_POPULAR_DIR);
  console.log(`[PopularWorks] 分割アセット保存完了 (${popularWorks.length}作品)`);
  return { count: popularWorks.length, works: popularWorks };
}

if (require.main === module) {
  fetchPopularWorks(65).catch(console.error);
}

module.exports = { fetchPopularWorks };
