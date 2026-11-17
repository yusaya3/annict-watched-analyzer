'use strict';

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const AnnictClient = require('../lib/annict-client.js');
const { writePopularSplitAssets, getShardIndex } = require('../scripts/build-popular-split.js');

const isVercel = !!process.env.VERCEL;
const RES_DIR = isVercel ? '/tmp/res' : path.resolve(__dirname, '../static/res');
const BUNDLED_RES_DIR = path.resolve(__dirname, '../static/res');
const POPULAR_DIR = path.join(RES_DIR, 'popular');
const BUNDLED_POPULAR_DIR = path.join(BUNDLED_RES_DIR, 'popular');
const IMG_PREFIX = 'https://image.annict.com/';

async function fetchHtml(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(12000),
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

function loadExistingWorks() {
  const targetPopularDir = fs.existsSync(path.join(POPULAR_DIR, 'index.json')) ? POPULAR_DIR : BUNDLED_POPULAR_DIR;
  const indexFile = path.join(targetPopularDir, 'index.json');
  if (fs.existsSync(indexFile)) {
    try {
      const idxData = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      const imgMaps = Array.from({ length: 16 }, (_, i) => {
        const f = path.join(targetPopularDir, `imgs_${String(i).padStart(2, '0')}.json`);
        if (fs.existsSync(f)) {
          try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
        }
        return {};
      });
      return (idxData.items || []).map(([id, title, season]) => {
        const shard = imgMaps[getShardIndex(id)];
        const rawImg = shard ? (shard[id] || '') : '';
        const image = rawImg && !rawImg.startsWith('http') ? `${IMG_PREFIX}${rawImg}` : rawImg;
        return {
          id: String(id),
          title: title || '',
          season: season || '',
          image,
          url: `https://annict.com/works/${id}`
        };
      });
    } catch (e) {}
  }
  return [];
}

/**
 * Annictの新規登録アニメ (/works/newest) をチェックし、
 * 人気順リストのランキング秩序を壊さないよう末尾へ追記して分割インデックスを更新する
 */
async function syncNewestWorks(maxCheckPages = 5) {
  const existingWorks = loadExistingWorks();
  const existingIdSet = new Set(existingWorks.map(w => String(w.id)));
  console.log(`[SyncWorks] 既存のAnnict作品マスター: ${existingIdSet.size}作品`);

  const newWorks = [];

  for (let page = 1; page <= maxCheckPages; page++) {
    const url = `https://annict.com/works/newest?page=${page}`;
    const html = await fetchHtml(url);
    if (!html) break;

    const $ = cheerio.load(html);
    const pageCards = AnnictClient.parseWorkCards($, existingIdSet);
    if (pageCards.length === 0) break;

    newWorks.push(...pageCards);
    console.log(`[SyncWorks] ページ ${page}: 新規作品 ${pageCards.length} 件検出`);
  }

  if (newWorks.length > 0) {
    console.log(`[SyncWorks] 合計 ${newWorks.length} 件の新規追加作品を検出！末尾に追記して更新します...`);
    const updatedWorks = [...existingWorks, ...newWorks];

    try {
      writePopularSplitAssets(updatedWorks, POPULAR_DIR);
      if (BUNDLED_POPULAR_DIR !== POPULAR_DIR) {
        writePopularSplitAssets(updatedWorks, BUNDLED_POPULAR_DIR);
      }
      console.log(`[SyncWorks] 作品マスター更新完了: 計 ${updatedWorks.length} 作品`);
    } catch (e) {
      console.warn('[SyncWorks] ファイル保存エラー:', e.message);
    }
    return { added: newWorks.length, total: updatedWorks.length };
  } else {
    console.log('[SyncWorks] 新規追加作品はありません（最新状態です）。');
    return { added: 0, total: existingIdSet.size };
  }
}

if (require.main === module) {
  syncNewestWorks(5).catch(console.error);
}

module.exports = { syncNewestWorks };
