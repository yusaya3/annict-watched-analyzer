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

  // 【新方式】指定された1人の最新視聴データのみを取得して返す超軽量API
  // 1〜2秒で数十KBのみを返却するため、60秒タイムアウトや4.5MB制限とは100%無縁
  app.get('/api/user-watched/:username', async (req, res) => {
    try {
      const username = (req.params.username || '').trim().replace(/^@/, '');
      if (!username) {
        return res.status(400).json({ error: 'ユーザー名が指定されていません' });
      }

      const forceRefresh = req.query.force === 'true' || req.query.refresh !== 'false';
      const client = new AnnictClient();
      console.log(`[API /user-watched] @${username} の最新データを取得中...`);
      const animes = await client.fetchWatchedAnimes(username, forceRefresh);

      // ユーザー設定リストにも追加同期
      let users = loadUserList();
      if (!users.some(u => u.toLowerCase() === username.toLowerCase())) {
        users.push(username);
        saveUserList(users);
      }

      // 新規作品のジャンル・タグをAniListから自動解決
      const workGenres = {};
      try {
        const { GenreClient } = require('../lib/labs/genre-client.js');
        const { classifyAnimeScored } = require('../lib/labs/genre-scorer.js');
        const genreClient = new GenreClient();
        const titles = animes.map(a => a.title).filter(Boolean);

        // キャッシュにない新規作品があればAniListと自動照合（タイムバジェット15秒）
        const resolvedMap = await genreClient.resolveGenres(titles, null, 15000);

        // 新規ユーザーの全作品の分類結果マップを生成（超軽量）
        titles.forEach(t => {
          const entry = resolvedMap[t] || genreClient.cache[t] || { genres: [], tags: [] };
          const genres = entry.genres || [];
          const tags = entry.tags || [];
          const category = classifyAnimeScored(genres, tags, t);
          workGenres[t] = {
            category,
            genres,
            tags: (tags || []).slice(0, 5) // 上位5タグのみ
          };
        });
      } catch (genreErr) {
        console.warn(`[API /user-watched] ジャンル自動解決エラー (スキップ): ${genreErr.message}`);
      }

      res.json({
        success: true,
        username,
        count: animes.length,
        fetchedAt: new Date().toISOString(),
        animes,
        workGenres
      });
    } catch (err) {
      console.error(`[API /user-watched Error @${req.params.username}]:`, err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 全作品の軽量ジャンル辞書取得API（Local-First用: 約237KB）
  app.get('/api/work-genres', (req, res) => {
    try {
      const staticJsonPath = path.resolve(__dirname, '../static/res/work-genres.json');
      if (fs.existsSync(staticJsonPath)) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.sendFile(staticJsonPath);
      }

      const { GenreClient } = require('../lib/labs/genre-client.js');
      const { classifyAnimeScored } = require('../lib/labs/genre-scorer.js');
      const genreClient = new GenreClient();
      const compactMap = {};

      for (const [title, entry] of Object.entries(genreClient.cache || {})) {
        const genres = entry.genres || [];
        const tags = entry.tags || [];
        compactMap[title] = {
          c: classifyAnimeScored(genres, tags, title),
          g: genres
        };
      }

      res.json(compactMap);
    } catch (err) {
      console.error('[API /work-genres Error]:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Vercel 4.5MB レスポンスサイズ上限対策ヘルパー
  function buildSafeReportPayload(report, users, extra = {}) {
    if (!report) {
      return { success: true, users, ...extra };
    }
    try {
      const reportStr = JSON.stringify(report);
      // 3.5MB未満であればそのまま返却
      if (Buffer.byteLength(reportStr) < 3.5 * 1024 * 1024) {
        return { success: true, users, report, ...extra };
      }
    } catch (e) {}

    // 3.5MB超過時は巨大なlabsを除外したコアレポートを返却（4.5MB制限エラーを防止）
    const slimReport = { ...report, labs: null, isSlim: true };
    return {
      success: true,
      users,
      report: slimReport,
      isPayloadTruncated: true,
      generatedAt: report.generatedAt,
      ...extra
    };
  }

  // GitHub Actions 自動更新トリガーAPI
  app.post('/api/sync', async (req, res) => {
    try {
      const action = req.body.action || 'refresh'; // 'refresh', 'add', 'remove'
      const username = (req.body.username || '').trim().replace(/^@/, '');
      const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      const repo = process.env.GITHUB_REPOSITORY || 'yusaya3/annict-watched-analyzer';

      if (!githubToken) {
        return res.json({
          success: false,
          mode: 'manual',
          message: 'GitHub Actions 連携トークン (GITHUB_TOKEN) が未設定です。'
        });
      }

      const dispatchUrl = `https://api.github.com/repos/${repo}/actions/workflows/update-users.yml/dispatches`;
      const response = await fetch(dispatchUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'annict-watched-analyzer'
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: { action, username }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({
          success: false,
          error: `GitHub APIエラー (${response.status}): ${errorText}`
        });
      }

      res.json({
        success: true,
        mode: 'github-actions',
        action,
        username,
        message: 'GitHub Actions で最新データの同期を開始しました（約1〜2分で自動反映されます）'
      });
    } catch (err) {
      console.error('GitHub Actions 起動エラー:', err);
      res.status(500).json({ success: false, error: err.message });
    }
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
      res.json(buildSafeReportPayload(report, users, { updatedUser: username }));
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
        return res.json(buildSafeReportPayload(report, users, { deletedUser: username }));
      }

      const report = await enqueueAnalysis(users, false);
      res.json(buildSafeReportPayload(report, users, { deletedUser: username }));
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
      res.json(buildSafeReportPayload(report, users));
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

  // 類似アニメ検索用: Annict公式高解像度キービジュアル（s:640:853）自動解決・検索・キャッシュAPI
  const simHiresCacheFile = isVercel
    ? '/tmp/similarity_hires_cache.json'
    : path.resolve(__dirname, '../data/cache/similarity_hires_cache.json');
  let simHiresCache = {};
  try {
    if (fs.existsSync(simHiresCacheFile)) {
      simHiresCache = JSON.parse(fs.readFileSync(simHiresCacheFile, 'utf8'));
    }
  } catch (e) {}

  function cleanSimSearchTitle(t) {
    if (!t) return '';
    return t
      .replace(/「|」|『|』|【|】|\(|\)|（|）/g, ' ')
      .replace(/第[0-9０-９一二三四五六七八九十]+期/g, ' ')
      .replace(/Season\s*[0-9]+/gi, ' ')
      .replace(/TV版|配信限定.*|OAD|OVA/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  app.get('/api/similarity-image', async (req, res) => {
    const workId = String(req.query.workId || '').trim();
    const title = String(req.query.title || '').trim();
    let annictId = String(req.query.annictId || '').trim();

    if (!workId && !title) {
      return res.status(400).json({ error: 'workId または title が必要です' });
    }

    const cacheKey = workId || title;
    if (simHiresCache[cacheKey] && simHiresCache[cacheKey].url) {
      return res.json(simHiresCache[cacheKey]);
    }

    try {
      const cheerio = require('cheerio');

      // 1. Annict IDが指定されている場合 (s:640:853 高解像度)
      if (annictId && /^\d+$/.test(annictId)) {
        const fetchRes = await fetch(`https://annict.com/works/${annictId}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (fetchRes.ok) {
          const html = await fetchRes.text();
          const $ = cheerio.load(html);
          let ogImage = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || '';
          if (ogImage && !ogImage.includes('color-white-') && !ogImage.includes('no-image')) {
            const result = { workId, title, annictId, url: ogImage, source: 'annict_hires' };
            simHiresCache[cacheKey] = result;
            try { fs.writeFileSync(simHiresCacheFile, JSON.stringify(simHiresCache, null, 2), 'utf8'); } catch (e) {}
            return res.json(result);
          }
        }
      }

      // 2. Annict検索
      if (title) {
        const queries = [title, cleanSimSearchTitle(title)].filter(Boolean);
        for (const q of queries) {
          const searchRes = await fetch(`https://annict.com/search?q=${encodeURIComponent(q)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
          });
          if (searchRes.ok) {
            const html = await searchRes.text();
            const $ = cheerio.load(html);
            let foundWorkId = null;
            let foundImg = null;

            $('a').each((i, el) => {
              const href = $(el).attr('href') || '';
              const match = href.match(/\/works\/(\d+)$/);
              if (match && !foundWorkId) {
                foundWorkId = match[1];
                foundImg = $(el).find('img').attr('src');
              }
            });

            if (foundWorkId) {
              const workRes = await fetch(`https://annict.com/works/${foundWorkId}`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
              });
              if (workRes.ok) {
                const workHtml = await workRes.text();
                const $w = cheerio.load(workHtml);
                const ogImage = $w('meta[property="og:image"]').attr('content') || $w('meta[name="twitter:image"]').attr('content') || '';
                if (ogImage && !ogImage.includes('color-white-') && !ogImage.includes('no-image')) {
                  const result = { workId, title, annictId: foundWorkId, url: ogImage, source: 'annict_search_hires' };
                  simHiresCache[cacheKey] = result;
                  try { fs.writeFileSync(simHiresCacheFile, JSON.stringify(simHiresCache, null, 2), 'utf8'); } catch (e) {}
                  return res.json(result);
                }
              }
              if (foundImg) {
                const result = { workId, title, annictId: foundWorkId, url: foundImg, source: 'annict_search_thumb' };
                simHiresCache[cacheKey] = result;
                try { fs.writeFileSync(simHiresCacheFile, JSON.stringify(simHiresCache, null, 2), 'utf8'); } catch (e) {}
                return res.json(result);
              }
            }
          }
        }
      }

      // 3. dアニメストア公式画像フォールバック
      if (workId) {
        const danimeRes = await fetch(`https://animestore.docomo.ne.jp/animestore/ci_pc?workId=${workId}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (danimeRes.ok) {
          const html = await danimeRes.text();
          const $ = cheerio.load(html);
          const ogImage = $('meta[property="og:image"]').attr('content') || '';
          if (ogImage && ogImage.startsWith('http')) {
            const result = { workId, title, annictId: null, url: ogImage, source: 'danime_store' };
            simHiresCache[cacheKey] = result;
            try { fs.writeFileSync(simHiresCacheFile, JSON.stringify(simHiresCache, null, 2), 'utf8'); } catch (e) {}
            return res.json(result);
          }
        }
      }

      const emptyResult = { workId, title, annictId: null, url: '', source: 'none' };
      simHiresCache[cacheKey] = emptyResult;
      res.json(emptyResult);
    } catch (err) {
      console.warn(`[SimilarityImage] 画像取得エラー (${title}):`, err.message);
      res.json({ workId, title, annictId: null, url: '', source: 'error' });
    }
  });

  // 作品のジャンルスコア内訳・新旧比較取得API（ジャンル実験室用・あいまい検索対応）
  app.get('/api/genre-score', (req, res) => {
    const rawQuery = (req.query.title || '').trim();
    if (!rawQuery) {
      return res.status(400).json({ error: 'タイトルを指定してください' });
    }

    try {
      const { GenreClient, classifyAnime, GENRE_DEFINITIONS } = require('../lib/labs/genre-client.js');
      const { scoreAnimeDetailed } = require('../lib/labs/genre-scorer.js');
      const genreClient = new GenreClient();
      const cache = genreClient.cache || {};

      // 一般的な略称・通称マッピング
      const ALIASES = {
        '着せ恋': 'その着せ替え人形は恋をする',
        'このすば': 'この素晴らしい世界に祝福を！',
        'ごちうさ': 'ご注文はうさぎですか？',
        'リゼロ': 'Re:ゼロから始める異世界生活',
        'まどマギ': '魔法少女まどか☆マギカ',
        '俺ガイル': 'やはり俺の青春ラブコメはまちがっている。',
        '青ブタ': '青春ブタ野郎はバニーガール先輩の夢を見ない',
        'ダンまち': 'ダンジョンに出会いを求めるのは間違っているだろうか',
        '防振り': '痛いのは嫌なので防御力に極振りしたいと思います。',
        'わたてん': '私に天使が舞い降りた！',
        'よりもい': '宇宙よりも遠い場所',
        'ガルパン': 'ガールズ＆パンツァー',
        'ハルヒ': '涼宮ハルヒの憂鬱',
        'ヒロアカ': '僕のヒーローアカデミア',
        '東リベ': '東京リベンジャーズ',
        'マケイン': '負けヒロインが多すぎる！',
        'ロシデレ': '時々ボソッとロシア語でデレる隣のアーリャさん',
        'ガルクラ': 'ガールズバンドクライ',
        'ぼざろ': 'ぼっち・ざ・ろっく！',
        'シュタゲ': 'STEINS;GATE',
        'エヴァ': '新世紀エヴァンゲリオン'
      };

      const queryForSearch = ALIASES[rawQuery] || rawQuery;
      let targetTitle = queryForSearch;
      let entry = cache[targetTitle];
      const matches = [];

      // 完全一致がない場合は部分一致・あいまい検索を実行
      if (!entry) {
        const qLower = queryForSearch.toLowerCase();
        const qClean = qLower.replace(/[\s\-_・:：!！?？]/g, '');

        const candidates = [];
        for (const t of Object.keys(cache)) {
          const tLower = t.toLowerCase();
          const tClean = tLower.replace(/[\s\-_・:：!！?？]/g, '');

          if (tLower === qLower || tClean === qClean) {
            candidates.push({ title: t, score: 100 });
          } else if (tLower.startsWith(qLower) || tClean.startsWith(qClean)) {
            candidates.push({ title: t, score: 80 - Math.min(30, t.length - queryForSearch.length) });
          } else if (tLower.includes(qLower) || tClean.includes(qClean)) {
            candidates.push({ title: t, score: 60 - Math.min(30, t.length - queryForSearch.length) });
          }
        }

        candidates.sort((a, b) => b.score - a.score);

        if (candidates.length > 0) {
          targetTitle = candidates[0].title;
          entry = cache[targetTitle];

          // 上位10件の候補（代表作以外も含む）
          candidates.slice(0, 10).forEach(c => {
            const e = cache[c.title] || {};
            matches.push({
              title: c.title,
              category: classifyAnime(e.genres || [], e.tags || [], c.title)
            });
          });
        }
      } else {
        // 完全一致した場合も、関連シリーズ作を候補に含める
        const qLower = queryForSearch.toLowerCase();
        for (const t of Object.keys(cache)) {
          if (t !== targetTitle && t.toLowerCase().includes(qLower)) {
            const e = cache[t] || {};
            matches.push({
              title: t,
              category: classifyAnime(e.genres || [], e.tags || [], t)
            });
            if (matches.length >= 8) break;
          }
        }
      }

      const genres = entry ? (entry.genres || []) : [];
      const tags = entry ? (entry.tags || []) : [];

      const legacyCategory = classifyAnime(genres, tags, targetTitle);
      const scoredDetail = scoreAnimeDetailed(genres, tags, targetTitle);

      res.json({
        query: rawQuery,
        title: targetTitle,
        isExactMatch: targetTitle.toLowerCase() === rawQuery.toLowerCase(),
        matches,
        genres,
        tags,
        legacyCategory,
        scored: scoredDetail,
        definitions: GENRE_DEFINITIONS
      });
    } catch (err) {
      console.error('[API /genre-score Error]:', err);
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

