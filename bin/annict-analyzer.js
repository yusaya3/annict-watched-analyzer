#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

const AnnictClient = require('../lib/annict-client.js');
const Analyzer = require('../lib/analyzer.js');

const USERS_FILE = path.resolve(__dirname, '../config/users.json');
const RES_DIR = path.resolve(__dirname, '../static/res');
const ANALYSIS_FILE = path.join(RES_DIR, 'analysis.json');
const LEGACY_VENN_FILE = path.join(RES_DIR, 'venns.json');

async function runAnalysis(userList, forceRefresh = false) {
  const client = new AnnictClient();
  const watchedLists = {};

  console.log('=====================================================');
  console.log(`  データ取得＆分析開始 (対象: ${userList.length}人)`);
  console.log('=====================================================');

  for (const username of userList) {
    console.log(`\n--- @${username} のデータを取得中 ---`);
    const animes = await client.fetchWatchedAnimes(username, forceRefresh);
    watchedLists[username] = animes;
  }

  console.log('\n--- 集合演算・シンクロ率・インサイトの分析中 ---');
  const analyzer = new Analyzer(watchedLists);
  const report = analyzer.buildFullReport();

  // お試し機能 (Labs) が存在する場合は分析を追加（完全分離設計）
  try {
    const ExperimentalAnalyzer = require('../lib/labs/experimental-analyzer.js');
    const { GenreClient } = require('../lib/labs/genre-client.js');
    console.log('\n--- [Labs] お試し機能（カロリー・年代・スタジオ・ジャンル）を分析中 ---');
    const expAnalyzer = new ExperimentalAnalyzer(watchedLists);

    const allTitles = [];
    for (const animes of Object.values(watchedLists)) {
      for (const a of animes) {
        if (a.title) allTitles.push(a.title);
      }
    }
    const genreClient = new GenreClient();
    const genreMap = await genreClient.resolveGenres(allTitles);

    report.labs = expAnalyzer.generateLabsReport(genreMap);
  } catch (err) {
    console.warn('[Labs] Labs分析の実行中にスキップまたはエラーが発生しました:', err.message);
  }

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

  if (!fs.existsSync(USERS_FILE)) {
    console.error(`設定ファイルが見つかりません: ${USERS_FILE}`);
    process.exit(1);
  }

  const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));

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

function startServer(port) {
  const app = express();
  const staticDir = path.resolve(__dirname, '../static');

  app.use(express.json());
  app.use(express.static(staticDir));

  // ユーザー設定の取得API
  app.get('/api/users', (req, res) => {
    if (fs.existsSync(USERS_FILE)) {
      res.json(JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')));
    } else {
      res.json([]);
    }
  });

  // ユーザー追加＆取得＆再集計API
  app.post('/api/users', async (req, res) => {
    try {
      const username = (req.body.username || '').trim().replace(/^@/, '');
      if (!username) {
        return res.status(400).json({ error: 'ユーザー名を入力してください' });
      }

      let users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) : [];
      if (!users.includes(username)) {
        users.push(username);
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
      }

      const report = await enqueueAnalysis(users, req.body.forceRefresh || false);
      res.json({ success: true, users, report });
    } catch (err) {
      console.error('ユーザー追加エラー:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ユーザー削除＆再集計API
  app.delete('/api/users/:username', async (req, res) => {
    try {
      const username = req.params.username.trim().replace(/^@/, '');
      let users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) : [];
      users = users.filter(u => u.toLowerCase() !== username.toLowerCase());

      if (users.length === 0) {
        return res.status(400).json({ error: '最低1人のユーザーが必要です' });
      }

      fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
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
      let users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) : [];
      const report = await enqueueAnalysis(users, true);
      res.json({ success: true, users, report });
    } catch (err) {
      console.error('全データ更新エラー:', err);
      res.status(500).json({ error: err.message });
    }
  });

  const server = app.listen(port, '0.0.0.0', () => {
    console.log('\n=====================================================');
    console.log(`  Webダッシュボードが起動しました:`);
    console.log(`  👉 http://localhost:${port}`);
    console.log(`  👉 http://127.0.0.1:${port}`);
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

module.exports = { main, startServer, runAnalysis };
