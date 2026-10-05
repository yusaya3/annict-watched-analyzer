'use strict';

const fs = require('fs');
const path = require('path');
const { ImageClient } = require('../lib/image-client.js');

async function main() {
  console.log('=== 全アニメ作品の高画質AniListカバー画像取得開始 ===');
  const cacheDir = path.resolve(__dirname, '../data/cache');
  const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json') && f !== 'genre_cache.json' && f !== 'image_cache.json');
  
  const allTitles = new Set();
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf8'));
      for (const a of d.animes || []) {
        if (a.title) allTitles.add(a.title);
      }
    } catch (e) {}
  }

  // analysis.json も含める
  try {
    const analysisFile = path.resolve(__dirname, '../static/res/analysis.json');
    if (fs.existsSync(analysisFile)) {
      const an = JSON.parse(fs.readFileSync(analysisFile, 'utf8'));
      for (const list of Object.values(an.userWatchedLists || {})) {
        for (const a of list) if (a.title) allTitles.add(a.title);
      }
    }
  } catch (e) {}

  const titlesArray = Array.from(allTitles);
  console.log(`対象アニメ作品数: ${titlesArray.length} 作品`);

  const client = new ImageClient();
  console.log(`既存の画像キャッシュ数: ${Object.keys(client.cache).length} 件`);

  // タイムバジェット 10分 (600,000ms)
  await client.resolveImages(titlesArray, 600000);

  const finalCount = Object.keys(client.cache).length;
  console.log(`=== 完了！ 総キャッシュ件数: ${finalCount} 件 ===`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
