'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const isVercel = !!process.env.VERCEL;
const RES_DIR = isVercel ? '/tmp/res' : path.resolve(__dirname, '../static/res');
const BUNDLED_RES_DIR = path.resolve(__dirname, '../static/res');
const POPULAR_WORKS_FILE = path.join(RES_DIR, 'popular_works.json');
const BUNDLED_POPULAR_WORKS_FILE = path.join(BUNDLED_RES_DIR, 'popular_works.json');

async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    return null;
  }
}

function parseCards($, seenIds) {
  const works = [];
  $('.c-work-card').each((_, el) => {
    const $card = $(el);
    const $titleLink = $card.find('.c-work-card__work-title a, a[title]');
    const title = $card.find('.c-work-card__work-title').text().trim() || $titleLink.attr('title') || '';
    const href = $card.find('a[href^="/works/"]').attr('href') || '';
    const idMatch = href.match(/\/works\/(\d+)/);
    if (!idMatch) return;
    const id = idMatch[1];
    if (seenIds && seenIds.has(String(id))) return;

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

    works.push({
      id,
      title,
      image,
      season: '',
      url: `https://annict.com/works/${id}`
    });
  });
  return works;
}

/**
 * Annictの新規登録アニメ (/works/newest) をチェックし、
 * 既存マスターに含まれていない作品があれば自動取得して popular_works.json に追記保存する。
 */
async function syncNewestWorks(maxCheckPages = 5) {
  // 1. 既存の popular_works.json を読み込み
  let targetFile = fs.existsSync(POPULAR_WORKS_FILE) ? POPULAR_WORKS_FILE : BUNDLED_POPULAR_WORKS_FILE;
  let masterData = { count: 0, works: [] };
  if (fs.existsSync(targetFile)) {
    try {
      masterData = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
    } catch (e) {}
  }

  const existingIdSet = new Set((masterData.works || []).map(w => String(w.id)));
  console.log(`[SyncWorks] 既存のAnnict作品マスター: ${existingIdSet.size}作品`);

  const newWorks = [];

  for (let page = 1; page <= maxCheckPages; page++) {
    const url = `https://annict.com/works/newest?page=${page}`;
    const html = await fetchHtml(url);
    if (!html) break;

    const $ = cheerio.load(html);
    const pageCards = parseCards($);
    if (pageCards.length === 0) break;

    let newCountOnPage = 0;
    for (const work of pageCards) {
      if (!existingIdSet.has(String(work.id))) {
        existingIdSet.add(String(work.id));
        newWorks.push(work);
        newCountOnPage++;
      }
    }

    console.log(`[SyncWorks] ページ ${page}: 新規作品 ${newCountOnPage} 件検出`);

    // もしこのページで新規作品が0件、または既知作品との重複が大部分なら、それ以降の過去ページはすでに登録済みなので終了
    if (newCountOnPage === 0) {
      console.log(`[SyncWorks] 既知の作品に到達したため、新着作品チェックを完了します。`);
      break;
    }
  }

  if (newWorks.length > 0) {
    console.log(`[SyncWorks] 合計 ${newWorks.length} 件の新規追加作品を検出！作品マスターを更新します...`);
    // 新着作品を先頭に追加（マスター全体を最新化）
    const updatedWorks = [...newWorks, ...(masterData.works || [])];
    const payload = {
      generatedAt: new Date().toISOString(),
      count: updatedWorks.length,
      works: updatedWorks
    };

    try {
      const outDir = path.dirname(POPULAR_WORKS_FILE);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(POPULAR_WORKS_FILE, JSON.stringify(payload, null, 2), 'utf8');

      if (BUNDLED_POPULAR_WORKS_FILE !== POPULAR_WORKS_FILE) {
        fs.writeFileSync(BUNDLED_POPULAR_WORKS_FILE, JSON.stringify(payload, null, 2), 'utf8');
      }
      console.log(`[SyncWorks] 作品マスター更新完了: 計 ${updatedWorks.length} 作品`);
    } catch (e) {
      console.warn(`[SyncWorks] ファイル保存エラー:`, e.message);
    }
    return { added: newWorks.length, total: updatedWorks.length };
  } else {
    console.log(`[SyncWorks] 新規追加作品はありません（最新状態です）。`);
    return { added: 0, total: existingIdSet.size };
  }
}

if (require.main === module) {
  syncNewestWorks(5).catch(console.error);
}

module.exports = { syncNewestWorks };
