#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const AnnictClient = require('../lib/annict-client.js');
const Analyzer = require('../lib/analyzer.js');

const isVercel = !!process.env.VERCEL;
const BUNDLED_USERS_FILE = path.resolve(__dirname, '../config/users.json');
const WRITABLE_USERS_FILE = isVercel ? '/tmp/users.json' : BUNDLED_USERS_FILE;
const RES_DIR = isVercel ? '/tmp/res' : path.resolve(__dirname, '../static/res');
const BUNDLED_RES_DIR = path.resolve(__dirname, '../static/res');
const ANALYSIS_FILE = path.join(RES_DIR, 'analysis.json');
const BUNDLED_ANALYSIS_FILE = path.join(BUNDLED_RES_DIR, 'analysis.json');
const LEGACY_VENN_FILE = path.join(RES_DIR, 'venns.json');

function loadUserList() {
  if (fs.existsSync(WRITABLE_USERS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(WRITABLE_USERS_FILE, 'utf8'));
    } catch (e) {}
  }
  if (fs.existsSync(BUNDLED_USERS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(BUNDLED_USERS_FILE, 'utf8'));
    } catch (e) {}
  }
  return ['saya15', 'hitobi_syuto'];
}

function saveUserList(users) {
  try {
    const dir = path.dirname(WRITABLE_USERS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(WRITABLE_USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (e) {
    console.warn('ユーザー設定保存エラー (読み取り専用環境):', e.message);
  }
}

async function runAnalysis(userList, forceRefresh = false) {
  const analysisStartTime = Date.now();
  const client = new AnnictClient();
  const watchedLists = {};

  const apiModeStr = client.apiToken ? '⚡ 公式 GraphQL API モード (高速取得)' : '🌐 Webスクレイピングモード (通常取得)';
  console.log('=====================================================');
  console.log(`  データ取得＆分析開始 (対象: ${userList.length}人)`);
  console.log(`  取得方式: ${apiModeStr}`);
  console.log('=====================================================');

  for (const username of userList) {
    console.log(`\n--- @${username} のデータを取得中 ---`);
    const shouldRefresh =
      forceRefresh === true ||
      (typeof forceRefresh === 'string' && forceRefresh.toLowerCase() === username.toLowerCase()) ||
      (Array.isArray(forceRefresh) && forceRefresh.some(u => u.toLowerCase() === username.toLowerCase()));
    const animes = await client.fetchWatchedAnimes(username, shouldRefresh);
    watchedLists[username] = animes;
  }

  console.log('\n--- 集合演算・シンクロ率・インサイトの分析中 ---');
  const analyzer = new Analyzer(watchedLists);
  const report = analyzer.buildFullReport();

  // お試し機能 (Labs) が存在する場合は分析を追加（完全分離設計）
  try {
    const ExperimentalAnalyzer = require('../lib/labs/experimental-analyzer.js');
    console.log('\n--- [Labs] お試し機能（カロリー・年代・スタジオ・ジャンル）を分析中 ---');
    const expAnalyzer = new ExperimentalAnalyzer(watchedLists);

    // ジャンル取得は独立して試行（タイムアウトしてもLabs全体は返す）
    let genreMap = {};
    let remainingGenres = 0;
    try {
      const { GenreClient } = require('../lib/labs/genre-client.js');
      const allTitles = [];
      for (const animes of Object.values(watchedLists)) {
        for (const a of animes) {
          if (a.title) allTitles.push(a.title);
        }
      }
      const genreClient = new GenreClient();
      const elapsedMs = Date.now() - analysisStartTime;
      // Vercelの60秒制限を超えないよう、全体で46秒以内に収める動的タイムバジェット
      const timeBudgetMs = isVercel ? Math.max(4000, 46000 - elapsedMs) : 300000;
      genreMap = await genreClient.resolveGenres(allTitles, null, timeBudgetMs);
      remainingGenres = genreClient.lastRemainingCount || 0;
    } catch (genreErr) {
      console.warn('[Labs] ジャンル取得をスキップ:', genreErr.message);
    }

    report.labs = expAnalyzer.generateLabsReport(genreMap);
    report.remainingGenres = remainingGenres;
  } catch (err) {
    console.warn('[Labs] Labs分析の実行中にスキップまたはエラーが発生しました:', err.message);
  }

  try {
    if (!fs.existsSync(RES_DIR)) {
      fs.mkdirSync(RES_DIR, { recursive: true });
    }

    // analysis.json 保存
    fs.writeFileSync(ANALYSIS_FILE, JSON.stringify(report, null, 2), 'utf8');
    console.log(`[Output] 分析結果を保存しました: ${ANALYSIS_FILE}`);

    // 旧フォーマット venns.json との互換出力
    const legacyVenns = [];
    for (const set of report.vennSets) {
      legacyVenns.push({
        area: set.sets,
        animes: set.animes
      });
    }
    fs.writeFileSync(LEGACY_VENN_FILE, JSON.stringify(legacyVenns, null, 2), 'utf8');
  } catch (err) {
    console.warn(`[Output] ファイル保存をスキップ (読み取り専用環境): ${err.message}`);
  }

  console.log('=====================================================');
  console.log('  分析完了！');
  console.log('=====================================================');
  for (const summary of report.userSummary) {
    console.log(`  - @${summary.username.padEnd(16)}: 視聴 ${summary.count} 作 / 独自推し ${summary.exclusiveCount} 作`);
  }

  if (report.similarity.ranking.length > 0) {
    const top = report.similarity.ranking[0];
    console.log(`\n  🏆 最も趣味が合うペア: @${top.pair[0]} × @${top.pair[1]} (シンクロ率 ${top.percentage}%, 共通 ${top.intersection}作)`);
  }

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

  // 1. データ取得フェーズ
  if (!isServeOnly) {
    await runAnalysis(users, forceRefresh);
    if (isFetchOnly) {
      console.log('\n--fetch-only が指定されたため終了します。');
      return;
    }
  }

  // 2. ローカルサーバー起動フェーズ
  startServer(port);
}

let analysisQueue = Promise.resolve();

function enqueueAnalysis(userList, forceRefresh = false) {
  const current = analysisQueue.then(async () => {
    return await runAnalysis(userList, forceRefresh);
  });
  analysisQueue = current.catch(() => {});
  return current;
}

function createApp() {
  const app = express();
  const staticDir = path.resolve(__dirname, '../static');

  app.use(express.json());
  // APIレスポンスがブラウザやCDNにキャッシュされないように設定
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });
  app.use(express.static(staticDir));

  // システムステータス＆Annict API接続状態確認API
  app.get('/api/status', (req, res) => {
    const client = new AnnictClient();
    res.json({
      status: 'ok',
      hasToken: !!client.apiToken,
      apiMode: client.apiToken ? 'GraphQL API (高速)' : 'Webスクレイピング (通常)',
      timestamp: new Date().toISOString()
    });
  });

  // ユーザー設定の取得API
  app.get('/api/users', (req, res) => {
    res.json(loadUserList());
  });

  // Annict人気作品リストの取得API
  app.get('/api/popular_works', (req, res) => {
    const tmpFile = path.join(RES_DIR, 'popular_works.json');
    const bundledFile = path.join(BUNDLED_RES_DIR, 'popular_works.json');
    const targetFile = fs.existsSync(tmpFile) ? tmpFile : (fs.existsSync(bundledFile) ? bundledFile : null);
    if (targetFile) {
      try {
        const data = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
        return res.json(data);
      } catch (e) {}
    }
    res.status(404).json({ error: 'Popular works not found' });
  });

  // ユーザー追加＆取得＆再集計API
  app.post('/api/users', async (req, res) => {
    try {
      const username = (req.body.username || '').trim().replace(/^@/, '');
      if (!username) {
        return res.status(400).json({ error: 'ユーザー名を入力してください' });
      }

      let users = loadUserList();
      // フロントエンド側が保持している現在のユーザー一覧があれば同期（Vercel複数インスタンス対策）
      if (Array.isArray(req.body.currentUsers) && req.body.currentUsers.length > 0) {
        users = req.body.currentUsers.map(u => String(u).trim().replace(/^@/, '')).filter(Boolean);
      }

      const existingIdx = users.findIndex(u => u.toLowerCase() === username.toLowerCase());
      if (existingIdx === -1) {
        users.push(username);
      }
      saveUserList(users);

      // 明示的に forceRefresh: false が渡された場合（ジャンル継続ステップ）以外は、対象ユーザーのAnnict最新データを必ず再取得する
      const refreshTarget = req.body.forceRefresh === false ? false : (req.body.forceRefresh === true ? true : username);
      const report = await enqueueAnalysis(users, refreshTarget);
      res.json({ success: true, users, report });
    } catch (err) {
      console.error('ユーザー追加エラー:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 既存の解析データ（/tmp または static/res）を取得するヘルパー
  function getBaseReport() {
    try {
      if (fs.existsSync(ANALYSIS_FILE)) {
        return JSON.parse(fs.readFileSync(ANALYSIS_FILE, 'utf8'));
      }
    } catch (e) {}
    try {
      if (fs.existsSync(BUNDLED_ANALYSIS_FILE)) {
        return JSON.parse(fs.readFileSync(BUNDLED_ANALYSIS_FILE, 'utf8'));
      }
    } catch (e) {}
    return null;
  }

  // 既存の視聴データから指定ユーザー群のサブセット解析結果を即座に（0.1秒未満で）生成する関数
  function extractSubsetReport(base, targetUsers) {
    const subWatched = {};
    targetUsers.forEach(u => {
      subWatched[u] = base.userWatchedLists[u] || [];
    });

    const Analyzer = require('../lib/analyzer.js');
    const analyzer = new Analyzer(subWatched);
    const report = analyzer.buildFullReport();

    try {
      const ExperimentalAnalyzer = require('../lib/labs/experimental-analyzer.js');
      const exp = new ExperimentalAnalyzer(subWatched);
      const { GenreClient, classifyAnime } = require('../lib/labs/genre-client.js');
      const genreClient = new GenreClient();
      const allTitles = [];
      for (const animes of Object.values(subWatched)) {
        for (const a of animes) if (a.title) allTitles.push(a.title);
      }
      const uniqueTitles = Array.from(new Set(allTitles));
      const genreMap = {};
      for (const title of uniqueTitles) {
        const entry = genreClient.cache[title] || { genres: [], tags: [] };
        genreMap[title] = {
          genres: entry.genres || [],
          tags: entry.tags || [],
          category: classifyAnime(entry.genres || [], entry.tags || [], title)
        };
      }
      report.labs = exp.generateLabsReport(genreMap);
    } catch (e) {
      console.warn('[SubsetReport] Labs再計算スキップ:', e.message);
    }

    try {
      if (!fs.existsSync(RES_DIR)) fs.mkdirSync(RES_DIR, { recursive: true });
      fs.writeFileSync(ANALYSIS_FILE, JSON.stringify(report, null, 2), 'utf8');
    } catch (e) {}

    return report;
  }

  // ユーザー削除＆再集計API（既存データがある場合は0.1秒で即座に完了）
  app.delete('/api/users/:username', async (req, res) => {
    try {
      const username = req.params.username.trim().replace(/^@/, '');
      let users = loadUserList();
      if (req.query.currentUsers) {
        const parsed = String(req.query.currentUsers).split(',').map(u => u.trim().replace(/^@/, '')).filter(Boolean);
        if (parsed.length > 0) users = parsed;
      } else if (Array.isArray(req.body?.currentUsers) && req.body.currentUsers.length > 0) {
        users = req.body.currentUsers.map(u => String(u).trim().replace(/^@/, '')).filter(Boolean);
      }

      users = users.filter(u => u.toLowerCase() !== username.toLowerCase());

      if (users.length === 0) {
        return res.status(400).json({ error: '最低1人のユーザーが必要です' });
      }

      saveUserList(users);

      // 既存の解析データに対象ユーザー全員の視聴リストがある場合、外部通信なしで即時再集計（超高速・タイムアウトなし）
      const base = getBaseReport();
      if (base && base.userWatchedLists && users.every(u => Array.isArray(base.userWatchedLists[u]))) {
        const report = extractSubsetReport(base, users);
        return res.json({ success: true, users, report });
      }

      const report = await enqueueAnalysis(users, false);
      res.json({ success: true, users, report });
    } catch (err) {
      console.error('ユーザー削除エラー:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 全データの強制再取得API
  app.post('/api/refresh', async (req, res) => {
    try {
      let users = loadUserList();
      if (Array.isArray(req.body?.currentUsers) && req.body.currentUsers.length > 0) {
        users = req.body.currentUsers.map(u => String(u).trim().replace(/^@/, '')).filter(Boolean);
        saveUserList(users);
      }
      const report = await enqueueAnalysis(users, true);
      res.json({ success: true, users, report });
    } catch (err) {
      console.error('全データ更新エラー:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // 2つのユーザー配列が同じメンバー構成か判定するヘルパー（順不同で判定）
  function isSameUserList(listA, listB) {
    if (!Array.isArray(listA) || !Array.isArray(listB)) return false;
    if (listA.length !== listB.length) return false;
    const setA = new Set(listA.map(u => String(u).toLowerCase()));
    return listB.every(u => setA.has(String(u).toLowerCase()));
  }

  // Annict公式高解像度OGP画像（s:640:853）オンデマンド取得・キャッシュAPI
  const hiresCacheFile = isVercel
    ? '/tmp/annict_hires_cache.json'
    : path.resolve(__dirname, '../data/cache/annict_hires_cache.json');
  let hiresCache = {};
  try {
    if (fs.existsSync(hiresCacheFile)) {
      hiresCache = JSON.parse(fs.readFileSync(hiresCacheFile, 'utf8'));
    }
  } catch (e) {}

  app.get('/api/annict-image/:workId', async (req, res) => {
    const workId = req.params.workId;
    if (!workId || !/^\d+$/.test(workId)) {
      return res.status(400).json({ error: '無効な作品IDです' });
    }

    if (hiresCache[workId]) {
      return res.json({ workId, url: hiresCache[workId] });
    }

    try {
      const cheerio = require('cheerio');
      const fetchRes = await fetch(`https://annict.com/works/${workId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      if (!fetchRes.ok) {
        return res.json({ workId, url: '' });
      }
      const html = await fetchRes.text();
      const $ = cheerio.load(html);
      let ogImage = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || '';
      if (ogImage && (ogImage.includes('color-white-') || ogImage.includes('no-image'))) {
        ogImage = '';
      }

      if (ogImage) {
        hiresCache[workId] = ogImage;
        try {
          fs.writeFileSync(hiresCacheFile, JSON.stringify(hiresCache, null, 2), 'utf8');
        } catch (e) {}
      }

      res.json({ workId, url: ogImage });
    } catch (err) {
      console.warn(`[AnnictImage] 作品ID ${workId} の高画質画像取得エラー:`, err.message);
      res.json({ workId, url: '' });
    }
  });

  // 作品のジャンルスコア内訳・新旧比較取得API（ジャンル実験室用）
  app.get('/api/genre-score', (req, res) => {
    const title = (req.query.title || '').trim();
    if (!title) {
      return res.status(400).json({ error: 'タイトルを指定してください' });
    }

    try {
      const { GenreClient, classifyAnime, GENRE_DEFINITIONS } = require('../lib/labs/genre-client.js');
      const { scoreAnimeDetailed } = require('../lib/labs/genre-scorer.js');
      const genreClient = new GenreClient();
      const entry = genreClient.cache[title] || { genres: [], tags: [] };
      const genres = entry.genres || [];
      const tags = entry.tags || [];

      const legacyCategory = classifyAnime(genres, tags, title);
      const scoredDetail = scoreAnimeDetailed(genres, tags, title);

      res.json({
        title,
        genres,
        tags,
        legacyCategory,
        scored: scoredDetail,
        definitions: GENRE_DEFINITIONS
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });


  // 分析結果の取得API（Vercel環境用 + ローカル共通）
  app.get('/api/analysis', async (req, res) => {
    try {
      // クライアント側（localStorage）に保存されたユーザーリストが指定されている場合
      const requestedUsers = req.query.users
        ? String(req.query.users).split(',').map(u => u.trim().replace(/^@/, '')).filter(Boolean)
        : null;

      const base = getBaseReport();

      if (base) {
        // 要求された構成と完全一致していればそのまま返す
        if (!requestedUsers || isSameUserList(base.users, requestedUsers)) {
          return res.json(base);
        }

        // 要求されたユーザー全員の視聴データがベースにある場合（例: ユーザー削除後の3人や2人の場合）
        // 外部スクレイピングを一切行わず、即座（0.1秒未満）にサブセット再集計して返す！（タイムアウト皆無）
        if (requestedUsers && requestedUsers.length > 0 && base.userWatchedLists) {
          const allExist = requestedUsers.every(u => Array.isArray(base.userWatchedLists[u]));
          if (allExist) {
            saveUserList(requestedUsers);
            const report = extractSubsetReport(base, requestedUsers);
            return res.json(report);
          }
        }
      }

      // 指定されたユーザー構成と異なる場合、またはファイルがない場合はオンデマンドで再集計
      const targetUsers = (requestedUsers && requestedUsers.length > 0) ? requestedUsers : loadUserList();
      saveUserList(targetUsers);
      const report = await enqueueAnalysis(targetUsers, false);
      res.json(report);
    } catch (err) {
      console.error('分析データ取得エラー:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

function startServer(port) {
  const app = createApp();
  const client = new AnnictClient();
  const apiStatus = client.apiToken ? '有効 (公式 GraphQL API 接続)' : '無効 (Webスクレイピングに自動フォールバック)';
  const server = app.listen(port, '0.0.0.0', () => {
    console.log('\n=====================================================');
    console.log(`  Webダッシュボードが起動しました:`);
    console.log(`  👉 http://localhost:${port}`);
    console.log(`  👉 http://127.0.0.1:${port}`);
    console.log(`  🔑 Annict API: ${apiStatus}`);
    console.log('=====================================================');
    console.log('ブラウザで開いてベン図やシンクロ率をご確認ください。');
    console.log('Ctrl + C で終了できます。\n');
  });

  return server;
}

if (require.main === module) {
  main().catch(err => {
    console.error('実行エラー:', err);
    process.exit(1);
  });
}

module.exports = { createApp, startServer, runAnalysis, main };

