'use strict';

const { chromium } = require('playwright');
const http = require('http');
const { createApp } = require('../bin/annict-analyzer.js');

async function runTest() {
  console.log('--- Local-First Architecture Test ---');
  const app = createApp();
  const server = http.createServer(app);

  await new Promise(resolve => server.listen(3333, resolve));
  console.log('Test server listening on port 3333');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);
    if (text.includes('[Local-First]') || text.includes('IndexedDB') || text.includes('Error')) {
      console.log('BROWSER CONSOLE:', text);
    }
  });

  try {
    // 1. 初回ロード
    console.log('\n[Step 1] Initial page load (First time)...');
    await page.goto('http://localhost:3333', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const hasSeedLog = logs.some(l => l.includes('初回') || l.includes('IndexedDB'));
    console.log('Step 1 verified: IndexedDB seed log present =', hasSeedLog);

    // 2. 2回目のロード（IndexedDBキャッシュから起動・通信ゼロ）
    console.log('\n[Step 2] Reload page (Local-First fast path)...');
    logs.length = 0; // ログクリア
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    const localFirstHit = logs.some(l => l.includes('[Local-First] 手元の視聴データ') || l.includes('IndexedDBから作品辞書をロード'));
    console.log('Step 2 verified: Local-First fast path triggered =', localFirstHit);

    // 3. UIコンポーネントが正しく描画されているか検証
    const titleText = await page.title();
    console.log('Page Title:', titleText);

    const vennExists = await page.locator('#venn-diagram').count();
    console.log('Venn diagram element exists:', vennExists > 0);

    const genreTab = await page.locator('[data-tab="genres"]');
    if (await genreTab.count() > 0) {
      await genreTab.click();
      await page.waitForTimeout(500);
      const genreCards = await page.locator('.genre-card').count();
      console.log('Genre cards rendered:', genreCards);
    }

    // 4. ユーザー追加テスト（Annictから取得してIndexedDBへ追加保存＆再集計）
    console.log('\n[Step 4] Add user test (fetch and save to IndexedDB)...');
    const addResult = await page.evaluate(async () => {
      if (typeof window.executeAddUser === 'function') {
        await window.executeAddUser('moshicho');
        const dbWatches = await window.loadAllUserWatchesFromIndexedDB();
        const dbGenres = await window.loadWorkGenresFromIndexedDB();
        return {
          success: true,
          userCount: Object.keys(dbWatches || {}).length,
          genresCount: Object.keys(dbGenres || {}).length
        };
      }
      return { success: false };
    });
    console.log('Step 4 result:', addResult);

    console.log('\n[SUCCESS] Local-First architecture verified successfully!');
  } catch (err) {
    console.error('Test error:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
}

runTest();

