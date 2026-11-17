#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const SOURCE_FILE = path.join(ROOT_DIR, 'static/res/story-similarity-data.json');
const COLAB_CANDIDATES_FILE = path.join(ROOT_DIR, '類似度/ストーリー構造類似度_実行ファイル/output/story_structure_candidates.json');
const HIRES_CACHE_FILE = path.join(ROOT_DIR, 'data/cache/similarity_hires_cache.json');
const POPULAR_DIR = path.join(ROOT_DIR, 'static/res/popular');
const OUT_DIR = path.join(ROOT_DIR, 'static/res/story');
const BUCKETS_DIR = path.join(OUT_DIR, 'buckets');
const BUCKET_COUNT = 128;

const FEATURED_KEYWORDS = [
  '葬送のフリーレン', 'ぼっち・ざ・ろっく！', '推しの子', '呪術廻戦', '鬼滅の刃',
  'チェンソーマン', 'SPY×FAMILY', 'リコリス・リコイル', '薬屋のひとりごと',
  '魔法少女まどか☆マギカ', 'STEINS;GATE', 'ソードアート・オンライン',
  '進撃の巨人', 'コードギアス 反逆のルルーシュ', '幼女戦記', 'ダンジョン飯',
  '無職転生', 'Re:ゼロから始める異世界生活', 'ガールズ＆パンツァー'
];

function getBucketIndex(wid) {
  const num = parseInt(wid, 10);
  if (!Number.isNaN(num)) {
    return Math.abs(num) % BUCKET_COUNT;
  }
  let hash = 0;
  const str = String(wid);
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % BUCKET_COUNT;
}

function shortenAnnictImg(url) {
  if (!url || url.includes('no-image') || url.includes('color-white-')) return '';
  if (url.startsWith('https://image.annict.com/')) {
    return url.slice('https://image.annict.com/'.length);
  }
  return url;
}

function clampPermille(val) {
  const n = Math.round(Number(val || 0) * 1000);
  return Math.max(0, Math.min(1000, Number.isFinite(n) ? n : 0));
}

function loadImageFallbacks() {
  const titleToImg = new Map();
  if (fs.existsSync(HIRES_CACHE_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(HIRES_CACHE_FILE, 'utf8'));
      for (const entry of Object.values(data)) {
        if (entry?.title && entry?.url && entry.url.includes('image.annict.com') && !entry.url.includes('no-image')) {
          titleToImg.set(entry.title, { img: shortenAnnictImg(entry.url), aid: entry.annictId ? String(entry.annictId) : '' });
        }
      }
    } catch (e) {}
  }

  const popIdxFile = path.join(POPULAR_DIR, 'index.json');
  if (fs.existsSync(popIdxFile)) {
    try {
      const popIdx = JSON.parse(fs.readFileSync(popIdxFile, 'utf8'));
      const shards = Array.from({ length: 16 }, (_, i) => {
        const f = path.join(POPULAR_DIR, `imgs_${String(i).padStart(2, '0')}.json`);
        if (fs.existsSync(f)) {
          try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
        }
        return {};
      });
      for (const [id, title] of (popIdx.items || [])) {
        if (!title || titleToImg.has(title)) continue;
        const n = parseInt(id, 10);
        const sIdx = Number.isNaN(n) ? 0 : Math.abs(n) % 16;
        const rawImg = shards[sIdx]?.[id];
        if (rawImg && !rawImg.includes('no-image') && !rawImg.includes('color-white-')) {
          titleToImg.set(title, { img: rawImg, aid: String(id) });
        }
      }
    } catch (e) {}
  }
  return titleToImg;
}

function buildStoryBuckets() {
  let raw = null;
  if (fs.existsSync(SOURCE_FILE)) {
    console.log(`[BuildStory] ソース読み込み: ${SOURCE_FILE}`);
    raw = JSON.parse(fs.readFileSync(SOURCE_FILE, 'utf8'));
  } else if (fs.existsSync(COLAB_CANDIDATES_FILE)) {
    console.log(`[BuildStory] Colabソース読み込み: ${COLAB_CANDIDATES_FILE}`);
    raw = JSON.parse(fs.readFileSync(COLAB_CANDIDATES_FILE, 'utf8'));
  } else {
    throw new Error('ストーリー元データ (story-similarity-data.json または Colab出力) が見つかりません');
  }

  const imgFallbacks = loadImageFallbacks();
  const works = raw.works || {};
  const workIds = Object.keys(works);
  console.log(`[BuildStory] 対象作品数: ${workIds.length} 件`);

  if (fs.existsSync(BUCKETS_DIR)) {
    for (const f of fs.readdirSync(BUCKETS_DIR)) {
      if (f.endsWith('.json')) {
        fs.unlinkSync(path.join(BUCKETS_DIR, f));
      }
    }
  } else {
    fs.mkdirSync(BUCKETS_DIR, { recursive: true });
  }

  const indexWorks = {};
  const genresSet = new Set();
  const yearsSet = new Set();
  const buckets = Array.from({ length: BUCKET_COUNT }, () => ({}));

  for (const wid of workIds) {
    const w = works[wid];
    const title = w.t || '';
    const year = w.y ? parseInt(w.y, 10) : null;
    const genre = w.g || '';

    let imgShort = shortenAnnictImg(w.img || '');
    let aid = w.aid ? String(w.aid) : '';
    if ((!imgShort || !aid) && imgFallbacks.has(title)) {
      const fb = imgFallbacks.get(title);
      if (!imgShort) imgShort = fb.img;
      if (!aid) aid = fb.aid;
    }

    if (year) yearsSet.add(year);
    if (genre) {
      genre.split(',').map(s => s.trim()).filter(s => s && s !== 'その他').forEach(s => genresSet.add(s));
    }

    indexWorks[wid] = [title, year, genre, imgShort, aid];

    const compressedCandidates = (w.candidates || []).map(c => [
      String(c[0]),
      clampPermille(c[1]),
      clampPermille(c[2])
    ]);

    const bIdx = getBucketIndex(wid);
    buckets[bIdx][wid] = {
      s: w.s || '',
      sum: w.summary || '',
      url: w.url || '',
      c: compressedCandidates
    };
  }

  let featuredIds = Array.isArray(raw.featured) ? raw.featured.map(id => String(id)).filter(id => indexWorks[id]) : [];
  if (featuredIds.length === 0) {
    for (const kw of FEATURED_KEYWORDS) {
      for (const [wid, tuple] of Object.entries(indexWorks)) {
        if (tuple[0].includes(kw) && tuple[3] && !featuredIds.includes(wid)) {
          featuredIds.push(wid);
          break;
        }
      }
      if (featuredIds.length >= 15) break;
    }
  }

  const indexPayload = {
    version: 3,
    bucketCount: BUCKET_COUNT,
    generatedAt: raw.generatedAt || new Date().toISOString(),
    dataSource: raw.dataSource || 'colab_production',
    total: workIds.length,
    genres: Array.from(genresSet).sort((a, b) => a.localeCompare(b, 'ja')),
    years: Array.from(yearsSet).sort((a, b) => b - a),
    featured: featuredIds,
    works: indexWorks
  };

  const indexPath = path.join(OUT_DIR, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(indexPayload), 'utf8');

  let totalBucketBytes = 0;
  let maxBucketBytes = 0;
  for (let b = 0; b < BUCKET_COUNT; b++) {
    const bName = `${String(b).padStart(3, '0')}.json`;
    const bPath = path.join(BUCKETS_DIR, bName);
    const content = JSON.stringify(buckets[b]);
    fs.writeFileSync(bPath, content, 'utf8');
    const bytes = Buffer.byteLength(content);
    totalBucketBytes += bytes;
    if (bytes > maxBucketBytes) maxBucketBytes = bytes;
  }

  const indexKb = Math.round(fs.statSync(indexPath).size / 1024);
  const avgBucketKb = Math.round((totalBucketBytes / BUCKET_COUNT) / 1024);
  const maxBucketKb = Math.round(maxBucketBytes / 1024);

  console.log(`[BuildStory] 完了！ index.json: ${indexKb} KB / ${BUCKET_COUNT}バケット (平均 ${avgBucketKb} KB, 最大 ${maxBucketKb} KB)`);
  return { total: workIds.length, indexKb, avgBucketKb, maxBucketKb };
}

if (require.main === module) {
  buildStoryBuckets();
}

module.exports = { buildStoryBuckets, getBucketIndex };
