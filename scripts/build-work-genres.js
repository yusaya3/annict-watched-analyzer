'use strict';

const fs = require('fs');
const path = require('path');
const GenreEngine = require('../static/core/genre-engine.js');
const StudioDictionary = require('../static/core/studio-dictionary.js');
const { resolveCategoryId } = require('../static/core/analyzer-engine.js');

function normalizeStudiosList(rawStudios) {
  if (!Array.isArray(rawStudios) || rawStudios.length === 0) return [];
  const out = [];
  for (let i = 0; i < rawStudios.length; i++) {
    const n = StudioDictionary.normalizeStudioName(rawStudios[i]);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

function buildWorkGenresMap(rawGenreCache, storyIndexPath = path.join(__dirname, '../static/res/story/index.json')) {
  const compact = {};
  const emptyTitles = [];
  const cachedStudiosByTitle = new Map();

  // 第1パス: 公式ジャンル・タグ情報がある作品を確定（スタジオ情報も収集）
  for (const [title, entry] of Object.entries(rawGenreCache || {})) {
    const genres = entry?.genres || [];
    const tags = entry?.tags || [];
    const studios = normalizeStudiosList(entry?.studios);
    if (studios.length > 0) {
      cachedStudiosByTitle.set(title, studios);
    }

    if (genres.length > 0 || tags.length > 0) {
      compact[title] = {
        c: GenreEngine.classifyAnimeScored(genres, tags, title),
        g: genres
      };
      if (studios.length > 0) {
        compact[title].s = studios;
      }
    } else {
      emptyTitles.push(title);
    }
  }

  // 第2パス: story/index.json (全6,231作品) を取り込む（第1パス確定済みは上書きしない）
  const storyMap = {};
  if (storyIndexPath && fs.existsSync(storyIndexPath)) {
    try {
      const storyIdx = JSON.parse(fs.readFileSync(storyIndexPath, 'utf8'));
      for (const tuple of Object.values(storyIdx.works || {})) {
        const title = tuple?.[0];
        const rawG = tuple?.[2] || '';
        if (!title) continue;
        const mapped = GenreEngine.mapStoryGenresToCategory(rawG, title);
        if (mapped && mapped !== 'other') {
          storyMap[title] = mapped;
          if (!compact[title]) {
            compact[title] = { c: mapped };
          }
        }
      }
    } catch (e) {}
  }

  // 第3パス: 公式情報なしのエントリを本編シリーズ正規化(O(1)) -> story -> タイトル推論の順で解決
  const baseSource = { ...compact };
  const baseNormMap = new Map();
  if (GenreEngine.normalizeTitleLookupKey) {
    for (const [k, v] of Object.entries(baseSource)) {
      if (v?.c && v.c !== 'other') {
        const nk = GenreEngine.normalizeTitleLookupKey(k);
        if (nk && !baseNormMap.has(nk)) baseNormMap.set(nk, v.c);
      }
    }
  }
  for (const title of emptyTitles) {
    let resolved = 'other';
    if (GenreEngine.getTitleMatchCandidates) {
      const candidates = GenreEngine.getTitleMatchCandidates(title);
      for (let i = 0; i < candidates.length; i++) {
        const hit = baseNormMap.get(candidates[i]);
        if (hit) {
          resolved = hit;
          break;
        }
      }
    }
    if (resolved === 'other' && storyMap[title]) {
      resolved = storyMap[title];
    }
    if (resolved === 'other') {
      resolved = resolveCategoryId(title, baseSource);
    }
    compact[title] = { c: resolved || 'other', g: [] };
    const cachedStudios = cachedStudiosByTitle.get(title);
    if (cachedStudios && cachedStudios.length > 0) {
      compact[title].s = cachedStudios;
    }
  }

  // 第4パス: 残った other に対しても最終再解決を試行（スタジオ未設定の派生作品も親から補完可能に）
  const fullSnapshot = { ...compact };
  for (const [title, entry] of Object.entries(compact)) {
    if (!entry.c || entry.c === 'other') {
      const resolved = resolveCategoryId(title, fullSnapshot);
      if (resolved && resolved !== 'other') {
        entry.c = resolved;
      }
    }
  }

  // 第5パス: 念のため cachedStudiosByTitle にあってまだ s が付いていないエントリへ反映
  for (const [title, studios] of cachedStudiosByTitle.entries()) {
    if (compact[title] && (!compact[title].s || compact[title].s.length === 0)) {
      compact[title].s = studios;
    }
  }

  return compact;
}

function buildWorkGenres() {
  const cachePath = path.join(__dirname, '../data/cache/genre_cache.json');
  if (!fs.existsSync(cachePath)) {
    console.error('genre_cache.json not found at:', cachePath);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  const compact = buildWorkGenresMap(raw);
  const count = Object.keys(compact).length;

  const outDir = path.join(__dirname, '../static/res');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outPath = path.join(outDir, 'work-genres.json');
  fs.writeFileSync(outPath, JSON.stringify(compact));
  const sizeKb = Math.round(fs.statSync(outPath).size / 1024);

  console.log(`[Success] static/res/work-genres.json created: ${count} works (${sizeKb} KB)`);
  return { count, sizeKb };
}

if (require.main === module) {
  buildWorkGenres();
}

module.exports = { buildWorkGenres, buildWorkGenresMap };
