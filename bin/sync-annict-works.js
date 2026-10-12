'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const ALL_WORKS_FILE = path.resolve(__dirname, '../static/res/annict_all_works.json');
const POPULAR_FILE = path.resolve(__dirname, '../static/res/popular_works.json');
const CACHE_DIR = path.resolve(__dirname, '../data/cache');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8'
      }
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    return null;
  }
}

function parseCardsFromHtml(html, idToSeason = new Map()) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const list = [];

  $('.c-work-card').each((_, el) => {
    const $card = $(el);
    const $titleLink = $card.find('.c-work-card__work-title a, a[title]');
    const title = $card.find('.c-work-card__work-title').text().trim() || $titleLink.attr('title') || '';
    const href = $card.find('a[href^="/works/"]').attr('href') || '';
    const idMatch = href.match(/\/works\/(\d+)/);
    if (!idMatch) return;
    const id = idMatch[1];

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

    list.push({
      id,
      title,
      image,
      season
    });
  });

  return list;
}

// 既存のシーズンマップ（キャッシュおよび既存JSONから構築）
function buildExistingSeasonMap() {
  const map = new Map();
  const filesToCheck = [ALL_WORKS_FILE, POPULAR_FILE];
  for (const file of filesToCheck) {
    if (fs.existsSync(file)) {
      try {
        const d = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const w of (d.works || [])) {
          if (w.id && w.season) map.set(String(w.id), w.season);
        }
      } catch (e) {}
    }
  }

  if (fs.existsSync(CACHE_DIR)) {
    try {
      const cacheFiles = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json') && !f.includes('genre'));
      for (const f of cacheFiles) {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
          for (const a of (d.animes || [])) {
            if (a.id && a.season) map.set(String(a.id), a.season);
          }
        } catch (e) {}
      }
    } catch (e) {}
  }
  return map;
}

// 既存のマスター作品データをロード
function loadExistingWorks() {
  const targetFile = fs.existsSync(ALL_WORKS_FILE) ? ALL_WORKS_FILE : (fs.existsSync(POPULAR_FILE) ? POPULAR_FILE : null);
  if (targetFile) {
    try {
      const d = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
      if (Array.isArray(d.works)) return d.works;
    } catch (e) {}
  }
  return [];
}

// 保存処理（annict_all_works.json と popular_works.json 両方を更新）
function saveWorks(works) {
  const payload = {
    generatedAt: new Date().toISOString(),
    count: works.length,
    works
  };

  const jsonStr = JSON.stringify(payload);

  const outDir = path.dirname(ALL_WORKS_FILE);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(ALL_WORKS_FILE, jsonStr, 'utf8');
  fs.writeFileSync(POPULAR_FILE, jsonStr, 'utf8');
  console.log(`[AnnictSync] 保存完了: ${works.length} 作品 (${(jsonStr.length / 1024 / 1024).toFixed(2)} MB)`);
  return payload;
}

/**
 * 新着作品の差分自動同期（https://annict.com/works/newest をチェック）
 * 新規登録作品があればマスターの先頭に追加
 */
async function syncNewestWorks(pagesToCheck = 3) {
  console.log(`[AnnictSync] 新着作品の差分同期を開始 (最新 ${pagesToCheck} ページをチェック)...`);
  const existingWorks = loadExistingWorks();
  const existingIdSet = new Set(existingWorks.map(w => String(w.id)));
  const existingIdToWork = new Map(existingWorks.map(w => [String(w.id), w]));
  const seasonMap = buildExistingSeasonMap();

  const newlyAdded = [];

  for (let p = 1; p <= pagesToCheck; p++) {
    const html = await fetchHtml(`https://annict.com/works/newest?page=${p}`);
    if (!html) continue;
    const cards = parseCardsFromHtml(html, seasonMap);
    for (const card of cards) {
      if (!existingIdSet.has(String(card.id))) {
        existingIdSet.add(String(card.id));
        newlyAdded.push(card);
        console.log(`[AnnictSync] ✨ 新規作品を検知: [ID: ${card.id}] ${card.title}`);
      } else {
        // 画像やタイトルが更新されていれば最新化
        const old = existingIdToWork.get(String(card.id));
        if (old) {
          if (!old.image && card.image) old.image = card.image;
          if (!old.season && card.season) old.season = card.season;
        }
      }
    }
  }

  if (newlyAdded.length > 0) {
    console.log(`[AnnictSync] 新規 ${newlyAdded.length} 作品をリストに追加しました！`);
    const updatedList = [...newlyAdded, ...existingWorks];
    return saveWorks(updatedList);
  } else {
    console.log(`[AnnictSync] 新規追加作品はありませんでした (現在の全作品数: ${existingWorks.length})`);
    return { count: existingWorks.length, works: existingWorks };
  }
}

/**
 * 全作品フル同期（https://annict.com/works/popular を全ページ走査）
 */
async function syncAllWorksFull() {
  console.log('[AnnictSync] 全作品フル同期を開始...');
  const firstHtml = await fetchHtml('https://annict.com/works/popular?page=1');
  if (!firstHtml) {
    throw new Error('Annict にアクセスできませんでした');
  }

  const $ = cheerio.load(firstHtml);
  let totalPages = 592;
  $('.c-pagination-button-group a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/page=(\d+)/);
    if (m) {
      const p = parseInt(m[1], 10);
      if (p > totalPages) totalPages = p;
    }
  });

  console.log(`[AnnictSync] 総ページ数: ${totalPages} ページ (約 ${totalPages * 30} 作品)`);

  const seasonMap = buildExistingSeasonMap();
  const allWorks = [];
  const seenIds = new Set();
  const concurrency = 8;

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
      const cards = parseCardsFromHtml(html, seasonMap);
      for (const card of cards) {
        if (!seenIds.has(String(card.id))) {
          seenIds.add(String(card.id));
          allWorks.push(card);
        }
      }
    }

    process.stdout.write(`\r[AnnictSync] 進行状況: ${end}/${totalPages} ページ完了 (${allWorks.length} 作品収集済)`);
    await new Promise(r => setTimeout(r, 100));
  }
  process.stdout.write('\n');

  // 新着順の上位ページからも未取得作品がないかチェック＆マージ
  console.log('[AnnictSync] 新着順（newest）からもマージチェック中...');
  for (let p = 1; p <= 5; p++) {
    const html = await fetchHtml(`https://annict.com/works/newest?page=${p}`);
    if (!html) continue;
    const cards = parseCardsFromHtml(html, seasonMap);
    for (const card of cards) {
      if (!seenIds.has(String(card.id))) {
        seenIds.add(String(card.id));
        allWorks.unshift(card); // 新着は先頭へ
      }
    }
  }

  return saveWorks(allWorks);
}

async function main() {
  const args = process.argv.slice(2);
  const isFull = args.includes('--full') || args.includes('-f');
  if (isFull) {
    await syncAllWorksFull();
  } else {
    await syncNewestWorks(5);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { syncAllWorksFull, syncNewestWorks, loadExistingWorks };
