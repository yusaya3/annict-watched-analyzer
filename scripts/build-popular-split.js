#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const IMG_PREFIX = 'https://image.annict.com/';
const SHARD_COUNT = 16;

function shortenImg(url) {
  if (!url) return '';
  if (url.includes('no-image') || url.includes('color-white-')) return '';
  return url.startsWith(IMG_PREFIX) ? url.slice(IMG_PREFIX.length) : url;
}

function getShardIndex(id) {
  const n = parseInt(id, 10);
  if (!Number.isNaN(n)) return Math.abs(n) % SHARD_COUNT;
  let hash = 0;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % SHARD_COUNT;
}

/**
 * popular_works 配列から分割インデックス & 16画像シャードを出力
 * （新着の時期未設定ブロックが人気1位を占有しないよう人気作品順を維持して配置）
 */
function writePopularSplitAssets(works, outDir = path.join(ROOT_DIR, 'static/res/popular')) {
  fs.mkdirSync(outDir, { recursive: true });

  const items = [];
  const imgShards = Array.from({ length: SHARD_COUNT }, () => ({}));

  for (const w of works) {
    if (!w || !w.id) continue;
    const id = String(w.id);
    items.push([id, w.title || '', w.season || '']);
    const cleanImg = shortenImg(w.image || '');
    if (cleanImg) {
      const sIdx = getShardIndex(id);
      imgShards[sIdx][id] = cleanImg;
    }
  }

  const indexPayload = {
    version: 2,
    generatedAt: new Date().toISOString(),
    count: items.length,
    items
  };
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(indexPayload), 'utf8');

  for (let i = 0; i < SHARD_COUNT; i++) {
    const fileName = `imgs_${String(i).padStart(2, '0')}.json`;
    fs.writeFileSync(path.join(outDir, fileName), JSON.stringify(imgShards[i]), 'utf8');
  }

  return { count: items.length, outDir };
}

/**
 * 既存の popular/index.json 等から、先頭に混入していた「季節未設定の新着作品」を末尾へ整列し、
 * no-image エントリを除去するクリーンアップビルダー
 */
function cleanAndRebuildPopular() {
  const popularDir = path.join(ROOT_DIR, 'static/res/popular');
  const legacySrc = path.join(ROOT_DIR, 'static/res/popular_works.json');
  let rawWorks = [];

  if (fs.existsSync(path.join(popularDir, 'index.json'))) {
    const idx = JSON.parse(fs.readFileSync(path.join(popularDir, 'index.json'), 'utf8'));
    const shards = Array.from({ length: SHARD_COUNT }, (_, i) => {
      const f = path.join(popularDir, `imgs_${String(i).padStart(2, '0')}.json`);
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
    });
    rawWorks = (idx.items || []).map(([id, title, season]) => {
      const rawImg = shards[getShardIndex(id)]?.[id] || '';
      return {
        id: String(id),
        title: title || '',
        season: season || '',
        image: rawImg ? (rawImg.startsWith('http') ? rawImg : `${IMG_PREFIX}${rawImg}`) : ''
      };
    });
  } else if (fs.existsSync(legacySrc)) {
    const raw = JSON.parse(fs.readFileSync(legacySrc, 'utf8'));
    rawWorks = raw.works || [];
  } else {
    throw new Error('popular データソースが見つかりません');
  }

  // 先頭付近の「時期未設定かつ新着ID(>18000)」ブロックを人気ランキング末尾へ送る
  const mainPopular = [];
  const trailingNewest = [];
  let passedHead = false;
  for (const w of rawWorks) {
    const numId = parseInt(w.id, 10);
    if (!passedHead && !w.season && numId >= 18000) {
      trailingNewest.push(w);
    } else {
      passedHead = true;
      mainPopular.push(w);
    }
  }

  const ordered = [...mainPopular, ...trailingNewest];
  const res = writePopularSplitAssets(ordered, popularDir);
  console.log(`[BuildPopularSplit] クリーン＆再構築完了 (${res.count}作品 / 先頭作: ${ordered[0]?.title}, 先頭未季移動: ${trailingNewest.length}件)`);
  return res;
}

if (require.main === module) {
  cleanAndRebuildPopular();
}

module.exports = { writePopularSplitAssets, cleanAndRebuildPopular, getShardIndex };
