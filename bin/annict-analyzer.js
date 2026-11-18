#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const AnnictClient = require('../lib/annict-client.js');
const { AnalyzerEngine, resolveCategoryId } = require('../static/core/analyzer-engine.js');
const {
  GENRE_DEFINITIONS,
  TITLE_ALIASES,
  scoreAnimeDetailed,
  classifyAnimeScored
} = require('../static/core/genre-engine.js');
const { buildBootstrapPayload } = require('../scripts/build-bootstrap.js');
const { buildWorkGenresMap } = require('../scripts/build-work-genres.js');
const { PersistentMapCache } = require('../lib/services/cache-service.js');
const { fetchAnnictOgImage, resolveSimilarityImage } = require('../lib/services/image-resolver.js');

const isVercel = !!process.env.VERCEL;
const BUNDLED_USERS_FILE = path.resolve(__dirname, '../config/users.json');
const WRITABLE_USERS_FILE = isVercel ? '/tmp/users.json' : BUNDLED_USERS_FILE;
const RES_DIR = isVercel ? '/tmp/res' : path.resolve(__dirname, '../static/res');
const BUNDLED_RES_DIR = path.resolve(__dirname, '../static/res');
const BOOTSTRAP_FILE = path.join(RES_DIR, 'bootstrap.json');
const BUNDLED_BOOTSTRAP_FILE = path.join(BUNDLED_RES_DIR, 'bootstrap.json');
const CACHE_DIR = isVercel ? '/tmp/annict-cache' : path.resolve(__dirname, '../data/cache');
const BUNDLED_CACHE_DIR = path.resolve(__dirname, '../data/cache');
const IMG_PREFIX = 'https://image.annict.com/';

function isValidUsername(username) {
  return typeof username === 'string' && /^[a-zA-Z0-9_-]{1,50}$/.test(username);
}

function parseUsersQuery(rawQuery) {
  if (!rawQuery) return { users: null, invalid: null };
  const rawList = String(rawQuery).split(',').map(u => u.trim().replace(/^@/, '')).filter(Boolean);
  const invalid = rawList.find(u => !isValidUsername(u));
  const dedup = new Map();
  for (const u of rawList) {
    const lower = u.toLowerCase();
    if (!dedup.has(lower)) dedup.set(lower, u);
  }
  return { users: Array.from(dedup.values()), invalid: invalid || null };
}

let userWriteLock = Promise.resolve();
function mutateUserList(mutator) {
  const next = userWriteLock.then(() => {
    const current = loadUserList();
    const updated = mutator(current);
    if (Array.isArray(updated)) saveUserList(updated);
    return updated;
  });
  userWriteLock = next.catch(() => {});
  return next;
}

let sharedGenreWriteLock = Promise.resolve();
function runWithGenreWriteLock(fn) {
  const next = sharedGenreWriteLock.then(fn);
  sharedGenreWriteLock = next.catch(() => {});
  return next;
}

function loadUserList() {
  for (const f of [WRITABLE_USERS_FILE, BUNDLED_USERS_FILE]) {
    if (fs.existsSync(f)) {
      try {
        return JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch (e) {}
    }
  }
  return ['saya15', 'hitobi_syuto'];
}

function saveUserList(users) {
  try {
    fs.mkdirSync(path.dirname(WRITABLE_USERS_FILE), { recursive: true });
    fs.writeFileSync(WRITABLE_USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (e) {
    console.warn('ユーザー設定保存エラー:', e.message);
  }
}

function expandBootstrapToWatchedLists(bootstrap) {
  if (!bootstrap || !bootstrap.works || !bootstrap.userWorkIds) return {};
  const result = {};
  for (const [user, ids] of Object.entries(bootstrap.userWorkIds)) {
    result[user] = (ids || []).map(id => {
      const w = bootstrap.works[id] || ['', '', ''];
      const rawImg = w[2] || '';
      const image = rawImg && !rawImg.startsWith('http') ? `${IMG_PREFIX}${rawImg}` : rawImg;
      return {
        id: String(id),
        title: w[0] || '',
        season: w[1] || '',
        image,
        episodesCount: w[3] || null,
        media: w[4] || '',
        url: `https://annict.com/works/${id}`
      };
    });
  }
  return result;
}

function loadCachedUserWatched(username) {
  if (!isValidUsername(username)) return null;
  const filename = `${username.toLowerCase()}.json`;
  for (const filePath of [path.join(CACHE_DIR, filename), path.join(BUNDLED_CACHE_DIR, filename)]) {
    if (fs.existsSync(filePath)) {
      try {
        const d = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (Array.isArray(d.animes)) return d.animes;
      } catch (e) {}
    }
  }
  return null;
}

function loadCompactGenreMap() {
  for (const staticPath of [path.join(RES_DIR, 'work-genres.json'), path.join(BUNDLED_RES_DIR, 'work-genres.json')]) {
    if (fs.existsSync(staticPath)) {
      try {
        return JSON.parse(fs.readFileSync(staticPath, 'utf8'));
      } catch (e) {}
    }
  }
  return {};
}

async function runAnalysis(userList, forceRefresh = false, options = {}) {
  const { persistBootstrap = true, onGenreUpdated = null } = options;
  const analysisStartTime = Date.now();
  const client = new AnnictClient();
  const watchedLists = {};

  console.log('=====================================================');
  console.log(`  データ取得＆分析開始 (対象: ${userList.length}人)`);
  console.log('=====================================================');

  for (const username of userList) {
    const shouldRefresh =
      forceRefresh === true ||
      (typeof forceRefresh === 'string' && forceRefresh.toLowerCase() === username.toLowerCase()) ||
      (Array.isArray(forceRefresh) && forceRefresh.some(u => u.toLowerCase() === username.toLowerCase()));
    watchedLists[username] = await client.fetchWatchedAnimes(username, shouldRefresh);
  }

  let genreMap = {};
  let remainingGenres = 0;
  try {
    const { GenreClient } = require('../lib/labs/genre-client.js');
    const allTitles = [];
    const allWorks = [];
    const workMetaByTitle = {};
    for (const animes of Object.values(watchedLists)) {
      for (const a of animes) {
        if (a?.title) {
          allTitles.push(a.title);
          if (!workMetaByTitle[a.title]) {
            workMetaByTitle[a.title] = { id: a.id, season: a.season || '' };
            allWorks.push(a);
          }
        }
      }
    }
    await runWithGenreWriteLock(async () => {
      const genreClient = new GenreClient();
      const elapsedMs = Date.now() - analysisStartTime;
      const timeBudgetMs = isVercel ? Math.max(4000, 46000 - elapsedMs) : 300000;
      genreMap = await genreClient.resolveGenres(allTitles, null, timeBudgetMs, { workMetaByTitle });
      remainingGenres = genreClient.lastRemainingCount || 0;

      const remainingBudget = (isVercel ? 48000 : 320000) - (Date.now() - analysisStartTime);
      if (remainingBudget > 4000) {
        await genreClient.enrichStudiosFromAnnict(allWorks, isVercel ? 10 : 40, Math.min(remainingBudget - 1000, isVercel ? 5000 : 25000));
        for (const t of Object.keys(genreMap)) {
          const cachedStudios = genreClient.cache[t]?.studios;
          if (Array.isArray(cachedStudios) && cachedStudios.length > 0 && (!genreMap[t].studios || genreMap[t].studios.length === 0)) {
            genreMap[t].studios = cachedStudios;
          }
        }
      }

      if (typeof onGenreUpdated === 'function') onGenreUpdated();

      if (!isVercel && persistBootstrap) {
        try {
          const compact = buildWorkGenresMap(genreClient.cache, path.join(BUNDLED_RES_DIR, 'story/index.json'));
          fs.mkdirSync(RES_DIR, { recursive: true });
          fs.writeFileSync(path.join(RES_DIR, 'work-genres.json'), JSON.stringify(compact), 'utf8');
        } catch (e) {}
      }
    });
  } catch (genreErr) {
    console.warn('[Genre] ジャンル解決スキップ:', genreErr.message);
  }

  const bootstrapPayload = buildBootstrapPayload(watchedLists, userList);
  if (persistBootstrap) {
    try {
      fs.mkdirSync(RES_DIR, { recursive: true });
      fs.writeFileSync(BOOTSTRAP_FILE, JSON.stringify(bootstrapPayload), 'utf8');
      console.log(`[Output] ブートストラップ保存: ${BOOTSTRAP_FILE} (${Math.round(fs.statSync(BOOTSTRAP_FILE).size / 1024)} KB)`);
    } catch (err) {
      console.warn(`[Output] ファイル保存スキップ: ${err.message}`);
    }
  }

  const analyzer = new AnalyzerEngine(watchedLists);
  const report = analyzer.buildFullReport(genreMap);
  report.remainingGenres = remainingGenres;
  report.bootstrap = bootstrapPayload;

  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const isFetchOnly = args.includes('--fetch-only');
  const isServeOnly = args.includes('--serve-only');
  const forceRefresh = args.includes('--refresh') || args.includes('-f');
  const port = parseInt(process.env.PORT || '3000', 10);

  const users = loadUserList();
  if (!users || users.length === 0) {
    console.error('ユーザーリストが空です。config/users.json を確認してください。');
    process.exit(1);
  }

  if (!isServeOnly) {
    await runAnalysis(users, forceRefresh);
    if (isFetchOnly) return;
  }

  startServer(port);
}

let analysisQueue = Promise.resolve();
function enqueueAnalysis(userList, forceRefresh = false, options = {}) {
  const current = analysisQueue.then(() => runAnalysis(userList, forceRefresh, options));
  analysisQueue = current.catch(() => {});
  return current;
}

function createGenreScoreIndex() {
  let cache = null;
  let searchEntries = null;

  const ensureLoaded = () => {
    if (cache && searchEntries) return;
    const { GenreClient } = require('../lib/labs/genre-client.js');
    const client = new GenreClient();
    cache = client.cache || {};
    searchEntries = Object.keys(cache).map(title => {
      const lower = title.toLowerCase();
      return { title, lower, clean: lower.replace(/[\s\-_・:：!！?？]/g, '') };
    });
  };

  const invalidate = () => { cache = null; searchEntries = null; };

  const search = (rawQuery) => {
    ensureLoaded();
    const queryForSearch = TITLE_ALIASES[rawQuery] || rawQuery;
    let targetTitle = queryForSearch;
    let entry = cache[targetTitle];
    const matches = [];

    if (!entry) {
      const qLower = queryForSearch.toLowerCase();
      const qClean = qLower.replace(/[\s\-_・:：!！?？]/g, '');
      const candidates = [];

      for (let i = 0; i < searchEntries.length; i++) {
        const item = searchEntries[i];
        if (item.lower === qLower || item.clean === qClean) {
          candidates.push({ title: item.title, score: 100 });
        } else if (item.lower.startsWith(qLower) || item.clean.startsWith(qClean)) {
          candidates.push({ title: item.title, score: 80 - Math.min(30, item.title.length - queryForSearch.length) });
        } else if (item.lower.includes(qLower) || item.clean.includes(qClean)) {
          candidates.push({ title: item.title, score: 60 - Math.min(30, item.title.length - queryForSearch.length) });
        }
      }

      candidates.sort((a, b) => b.score - a.score);
      if (candidates.length > 0) {
        targetTitle = candidates[0].title;
        entry = cache[targetTitle];
        for (let i = 0; i < Math.min(10, candidates.length); i++) {
          const cTitle = candidates[i].title;
          const e = cache[cTitle] || {};
          matches.push({ title: cTitle, category: classifyAnimeScored(e.genres || [], e.tags || [], cTitle) });
        }
      }
    } else {
      const qLower = queryForSearch.toLowerCase();
      for (let i = 0; i < searchEntries.length; i++) {
        const item = searchEntries[i];
        if (item.title !== targetTitle && item.lower.includes(qLower)) {
          const e = cache[item.title] || {};
          matches.push({ title: item.title, category: classifyAnimeScored(e.genres || [], e.tags || [], item.title) });
          if (matches.length >= 8) break;
        }
      }
    }

    const genres = entry ? (entry.genres || []) : [];
    const tags = entry ? (entry.tags || []) : [];
    const scoredDetail = scoreAnimeDetailed(genres, tags, targetTitle);

    return {
      foundInCache: !!entry,
      query: rawQuery,
      title: targetTitle,
      isExactMatch: targetTitle.toLowerCase() === rawQuery.toLowerCase(),
      matches,
      genres,
      tags,
      scored: scoredDetail,
      definitions: GENRE_DEFINITIONS
    };
  };

  return { search, invalidate };
}

function getBaseBootstrap() {
  for (const filePath of [BOOTSTRAP_FILE, BUNDLED_BOOTSTRAP_FILE]) {
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (e) {}
    }
  }
  return null;
}

function isSameUserList(listA, listB) {
  if (!Array.isArray(listA) || !Array.isArray(listB)) return false;
  const setA = new Set(listA.map(u => String(u).toLowerCase()));
  const setB = new Set(listB.map(u => String(u).toLowerCase()));
  if (setA.size !== setB.size) return false;
  for (const u of setB) {
    if (!setA.has(u)) return false;
  }
  return true;
}

function createApp() {
  const app = express();
  const staticDir = path.resolve(__dirname, '../static');
  const genreScoreIndex = createGenreScoreIndex();
  const recentlyDeletedUsers = new Map();

  const hiresCache = new PersistentMapCache(
    isVercel ? '/tmp/annict_hires_cache.json' : path.resolve(__dirname, '../data/cache/annict_hires_cache.json'),
    2500
  );
  const simHiresCache = new PersistentMapCache(
    isVercel ? '/tmp/similarity_hires_cache.json' : path.resolve(__dirname, '../data/cache/similarity_hires_cache.json'),
    2500
  );

  app.use(express.json());
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  // Vercel上での /tmp/res/popular 更新優先提供
  if (isVercel) {
    app.get('/res/popular/:file', (req, res, next) => {
      const file = path.basename(req.params.file || '');
      const tmpPath = path.join(RES_DIR, 'popular', file);
      if (file && fs.existsSync(tmpPath)) {
        return res.sendFile(tmpPath);
      }
      next();
    });
  }

  app.use(express.static(staticDir));

  const statusTokenPresent = !!new AnnictClient().apiToken;
  app.get('/api/status', (req, res) => {
    res.json({
      status: 'ok',
      version: '3.0.0',
      hasToken: statusTokenPresent,
      apiMode: statusTokenPresent ? '公式API接続中' : '公開データ取得',
      timestamp: new Date().toISOString()
    });
  });

  app.get('/api/users', (req, res) => {
    res.json(loadUserList());
  });

  app.get('/api/bootstrap', async (req, res) => {
    try {
      const { users: requestedUsers, invalid } = parseUsersQuery(req.query.users);
      if (invalid) {
        return res.status(400).json({ error: `無効なユーザーID形式です: ${invalid}` });
      }

      const base = getBaseBootstrap();
      const effectiveTarget = (requestedUsers && requestedUsers.length > 0) ? requestedUsers : loadUserList();
      if (base && isSameUserList(base.users, effectiveTarget)) {
        return res.json(base);
      }

      if (effectiveTarget.length > 0) {
        const baseLists = base ? expandBootstrapToWatchedLists(base) : {};
        const subWatched = {};
        const missingUsers = [];

        for (const u of effectiveTarget) {
          const matchedKey = Object.keys(baseLists).find(k => k.toLowerCase() === u.toLowerCase());
          if (matchedKey) {
            subWatched[u] = baseLists[matchedKey];
          } else {
            const cached = loadCachedUserWatched(u);
            if (cached) {
              subWatched[u] = cached;
            } else {
              missingUsers.push(u);
            }
          }
        }

        if (missingUsers.length === 0) {
          return res.json(buildBootstrapPayload(subWatched, effectiveTarget));
        }
      }

      const hasExplicitUsers = !!(requestedUsers && requestedUsers.length > 0);
      const report = await enqueueAnalysis(effectiveTarget, false, {
        persistBootstrap: !hasExplicitUsers,
        onGenreUpdated: () => genreScoreIndex.invalidate()
      });
      res.json(report.bootstrap);
    } catch (err) {
      console.error('[/api/bootstrap Error]:', err);
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.get('/api/analysis', async (req, res) => {
    try {
      const { users: requestedUsers, invalid } = parseUsersQuery(req.query.users);
      if (invalid) {
        return res.status(400).json({ error: `無効なユーザーID形式です: ${invalid}` });
      }
      const hasExplicitUsers = !!(requestedUsers && requestedUsers.length > 0);
      const targetUsers = hasExplicitUsers ? requestedUsers : loadUserList();
      const base = getBaseBootstrap();
      const genreMap = loadCompactGenreMap();

      let report = null;
      if (base && targetUsers.every(u => Object.keys(base.userWorkIds || {}).some(k => k.toLowerCase() === u.toLowerCase()))) {
        const allLists = expandBootstrapToWatchedLists(base);
        const subLists = {};
        for (const u of targetUsers) {
          const key = Object.keys(allLists).find(k => k.toLowerCase() === u.toLowerCase());
          if (key) subLists[key] = allLists[key];
        }
        report = new AnalyzerEngine(subLists).buildFullReport(genreMap);
      } else {
        report = await enqueueAnalysis(targetUsers, false, {
          persistBootstrap: !hasExplicitUsers,
          onGenreUpdated: () => genreScoreIndex.invalidate()
        });
      }

      let jsonStr = JSON.stringify(report);
      if (Buffer.byteLength(jsonStr) > 3.8 * 1024 * 1024) {
        const slim = { ...report, userWatchedLists: undefined, bootstrap: undefined, isPayloadSlim: true };
        jsonStr = JSON.stringify(slim);
        if (Buffer.byteLength(jsonStr) > 3.8 * 1024 * 1024 && slim.labs) {
          const compactLabs = { calorieReport: slim.labs.calorieReport };
          slim.labs = compactLabs;
          jsonStr = JSON.stringify(slim);
        }
      }
      res.setHeader('Content-Type', 'application/json');
      res.send(jsonStr);
    } catch (err) {
      console.error('[/api/analysis Error]:', err);
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.get('/api/popular_works', (req, res) => {
    for (const idxPath of [path.join(RES_DIR, 'popular/index.json'), path.join(BUNDLED_RES_DIR, 'popular/index.json')]) {
      if (fs.existsSync(idxPath)) {
        try {
          const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
          const works = (idx.items || []).map(([id, title, season]) => ({
            id: String(id),
            title: title || '',
            season: season || '',
            image: '',
            url: `https://annict.com/works/${id}`
          }));
          return res.json({ generatedAt: idx.generatedAt, count: works.length, works });
        } catch (e) {}
      }
    }
    res.status(404).json({ error: 'Popular works not found' });
  });

  app.get('/api/sync-new-works', async (req, res) => {
    try {
      const { syncNewestWorks } = require('./sync-new-works.js');
      const result = await syncNewestWorks(5);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/user-watched/:username', async (req, res) => {
    try {
      const username = (req.params.username || '').trim().replace(/^@/, '');
      if (!isValidUsername(username)) {
        return res.status(400).json({ error: '有効なAnnictユーザーID (英数字・アンダースコア・ハイフン) を指定してください' });
      }

      const reqStartedAt = Date.now();
      const forceRefresh = req.query.force === 'true' || req.query.refresh !== 'false';
      const client = new AnnictClient();
      const animes = await client.fetchWatchedAnimes(username, forceRefresh);

      await mutateUserList((users) => {
        const deletedAt = recentlyDeletedUsers.get(username.toLowerCase());
        if (deletedAt && deletedAt > reqStartedAt) {
          return null;
        }
        if (!users.some(u => u.toLowerCase() === username.toLowerCase())) {
          return [...users, username];
        }
        return null;
      });

      const workGenres = {};
      try {
        const titles = animes.map(a => a.title).filter(Boolean);
        const workMetaByTitle = {};
        for (const a of animes) {
          if (a?.title && !workMetaByTitle[a.title]) {
            workMetaByTitle[a.title] = { id: a.id, season: a.season || '' };
          }
        }
        const compactBase = loadCompactGenreMap();
        await runWithGenreWriteLock(async () => {
          const { GenreClient } = require('../lib/labs/genre-client.js');
          const genreClient = new GenreClient();
          const resolvedMap = await genreClient.resolveGenres(titles, null, 15000, { workMetaByTitle });
          await genreClient.enrichStudiosFromAnnict(animes, 12, 4000).catch(() => 0);
          genreScoreIndex.invalidate();
          for (const t of titles) {
            const cacheEntry = genreClient.cache[t];
            const entry = resolvedMap[t] || cacheEntry || { genres: [], tags: [], studios: [] };
            const genres = entry.genres || [];
            const tags = entry.tags || [];
            let c = classifyAnimeScored(genres, tags, t);
            if (c === 'other') {
              c = resolveCategoryId(t, compactBase);
            }
            const studios = (Array.isArray(cacheEntry?.studios) && cacheEntry.studios.length > 0)
              ? cacheEntry.studios
              : ((Array.isArray(entry.studios) && entry.studios.length > 0)
                  ? entry.studios
                  : (Array.isArray(compactBase[t]?.s) ? compactBase[t].s : []));
            workGenres[t] = studios.length > 0 ? { c, g: genres, s: studios } : { c, g: genres };
          }
        }).catch(() => {});
      } catch (genreErr) {}

      res.json({
        success: true,
        username,
        count: animes.length,
        fetchedAt: new Date().toISOString(),
        animes,
        workGenres
      });
    } catch (err) {
      const code = err.statusCode || 500;
      console.error(`[API /user-watched Error @${req.params.username}]:`, err.message);
      res.status(code).json({ success: false, error: err.message });
    }
  });

  app.get('/api/work-genres', (req, res) => {
    try {
      for (const staticJsonPath of [path.join(RES_DIR, 'work-genres.json'), path.join(BUNDLED_RES_DIR, 'work-genres.json')]) {
        if (fs.existsSync(staticJsonPath)) {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          return res.sendFile(staticJsonPath);
        }
      }
      const { GenreClient } = require('../lib/labs/genre-client.js');
      const genreClient = new GenreClient();
      const compactMap = buildWorkGenresMap(genreClient.cache, path.join(BUNDLED_RES_DIR, 'story/index.json'));
      res.json(compactMap);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/genre-score', async (req, res) => {
    const rawQuery = (req.query.title || '').trim();
    if (!rawQuery) return res.status(400).json({ error: 'タイトルを指定してください' });

    try {
      let result = genreScoreIndex.search(rawQuery);
      if (!result.foundInCache && req.query.live !== 'false') {
        await runWithGenreWriteLock(async () => {
          const { GenreClient } = require('../lib/labs/genre-client.js');
          const genreClient = new GenreClient();
          const resolved = await genreClient.resolveGenres([rawQuery], null, 4000);
          if (resolved[rawQuery] && (resolved[rawQuery].genres?.length > 0 || resolved[rawQuery].tags?.length > 0)) {
            genreScoreIndex.invalidate();
            result = genreScoreIndex.search(rawQuery);
          }
        }).catch(() => {});
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/users/:username', async (req, res) => {
    try {
      const username = (req.params.username || '').trim().replace(/^@/, '');
      if (!isValidUsername(username)) {
        return res.status(400).json({ error: '有効なAnnictユーザーIDを指定してください' });
      }
      let tooFew = false;
      const now = Date.now();
      for (const [k, ts] of recentlyDeletedUsers.entries()) {
        if (now - ts > 600000) recentlyDeletedUsers.delete(k);
      }
      const updatedUsers = await mutateUserList((users) => {
        if (req.query.currentUsers) {
          const { users: parsed, invalid } = parseUsersQuery(req.query.currentUsers);
          if (!invalid && parsed && parsed.length > 0) users = parsed;
        } else if (Array.isArray(req.body?.currentUsers) && req.body.currentUsers.length > 0) {
          const { users: sanitized } = parseUsersQuery(req.body.currentUsers.join(','));
          if (sanitized && sanitized.length > 0) users = sanitized;
        }
        const next = users.filter(u => u.toLowerCase() !== username.toLowerCase());
        if (next.length === 0) {
          tooFew = true;
          return null;
        }
        recentlyDeletedUsers.set(username.toLowerCase(), Date.now());
        return next;
      });
      if (tooFew) return res.status(400).json({ error: '最低1人のユーザーが必要です' });
      res.json({ success: true, users: updatedUsers, deletedUser: username });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sync', async (req, res) => {
    try {
      const action = String(req.body?.action || 'refresh');
      if (!['refresh', 'add'].includes(action)) {
        return res.status(400).json({ success: false, error: '無効なアクション種別です' });
      }
      const username = String(req.body?.username || '').trim().replace(/^@/, '');
      if (username && !isValidUsername(username)) {
        return res.status(400).json({ success: false, error: '無効なユーザーID形式です' });
      }
      const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      const repo = process.env.GITHUB_REPOSITORY || 'yusaya3/annict-watched-analyzer';
      if (!githubToken) {
        return res.json({ success: false, mode: 'manual', message: 'GITHUB_TOKEN 未設定です。' });
      }
      const response = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/update-users.yml/dispatches`, {
        method: 'POST',
        signal: AbortSignal.timeout(12000),
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'annict-watched-analyzer'
        },
        body: JSON.stringify({ ref: 'main', inputs: { action, username } })
      });
      if (!response.ok) {
        return res.status(response.status).json({ success: false, error: `GitHub Actions 起動エラー (HTTP ${response.status})` });
      }
      res.json({ success: true, mode: 'github-actions', action, username });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/annict-image/:workId', async (req, res) => {
    const workId = req.params.workId;
    if (!workId || !/^\d+$/.test(workId)) return res.status(400).json({ error: '無効な作品IDです' });
    const cached = hiresCache.get(workId);
    if (cached) return res.json({ workId, url: cached });
    try {
      const ogImage = await fetchAnnictOgImage(workId);
      if (ogImage) hiresCache.set(workId, ogImage);
      res.json({ workId, url: ogImage });
    } catch (err) {
      res.json({ workId, url: '' });
    }
  });

  app.get('/api/similarity-image', async (req, res) => {
    const workId = String(req.query.workId || '').trim();
    const title = String(req.query.title || '').trim();
    const annictId = String(req.query.annictId || '').trim();
    if (!workId && !title) return res.status(400).json({ error: 'workId または title が必要です' });
    const result = await resolveSimilarityImage({ workId, title, annictId }, simHiresCache);
    res.json(result);
  });

  return app;
}

function startServer(port) {
  const app = createApp();
  const client = new AnnictClient();
  const apiStatus = client.apiToken ? '有効 (公式 GraphQL API)' : '公開データ取得 (Webスクレイピング)';
  return app.listen(port, '0.0.0.0', () => {
    console.log(`\nAnnict Watched Analyzer v3.0 起動: http://localhost:${port} [${apiStatus}]\n`);
  });
}

if (require.main === module) {
  main().catch(err => {
    console.error('実行エラー:', err);
    process.exit(1);
  });
}

module.exports = { createApp, startServer, runAnalysis, main };
