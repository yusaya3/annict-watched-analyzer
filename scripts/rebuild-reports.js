'use strict';

const fs = require('fs');
const path = require('path');
const Analyzer = require('../lib/analyzer.js');
const ExperimentalAnalyzer = require('../lib/labs/experimental-analyzer.js');
const { GenreClient, classifyAnime } = require('../lib/labs/genre-client.js');

async function main() {
  console.log('=== Annict純正画像仕様で全レポート（analysis.json & venns.json）の再ビルド開始 ===');
  const cacheDir = path.resolve(__dirname, '../data/cache');
  const resDir = path.resolve(__dirname, '../static/res');

  const userFiles = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json') && !f.includes('genre') && !f.includes('image'));
  const userWatchedLists = {};

  for (const f of userFiles) {
    try {
      const u = JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf8'));
      if (u.username && u.animes) {
        userWatchedLists[u.username] = u.animes;
      }
    } catch (e) {}
  }

  const users = Object.keys(userWatchedLists);
  console.log(`対象ユーザー (${users.length}名):`, users.join(', '));

  const analyzer = new Analyzer(userWatchedLists);
  const report = analyzer.buildFullReport();

  // Labs レポート
  try {
    const exp = new ExperimentalAnalyzer(analyzer.userWatchedLists);
    const genreClient = new GenreClient();
    const genreMap = {};
    for (const [u, list] of Object.entries(analyzer.userWatchedLists)) {
      for (const a of list) {
        if (!genreMap[a.title]) {
          const entry = genreClient.cache[a.title] || { genres: [], tags: [] };
          genreMap[a.title] = {
            genres: entry.genres || [],
            tags: entry.tags || [],
            category: classifyAnime(entry.genres || [], entry.tags || [], a.title)
          };
        }
      }
    }
    report.labs = exp.generateLabsReport(genreMap);
  } catch (labsErr) {
    console.warn('Labs生成エラー:', labsErr.message);
  }

  // analysis.json 保存
  const analysisFile = path.join(resDir, 'analysis.json');
  fs.writeFileSync(analysisFile, JSON.stringify(report, null, 2), 'utf8');
  console.log(`analysis.json を更新しました (${(fs.statSync(analysisFile).size / 1024 / 1024).toFixed(2)} MB)`);

  // venns.json 生成（初期3ユーザー）
  const vennSets = analyzer.generateVennSets(users.slice(0, 3));
  const vennFile = path.join(resDir, 'venns.json');
  fs.writeFileSync(vennFile, JSON.stringify({ users: users.slice(0, 3), vennSets }, null, 2), 'utf8');
  console.log(`venns.json を更新しました`);

  console.log('=== 再ビルド完了（Annict純正仕様） ===');
}

main().catch(console.error);
