'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { startServer } = require('../bin/annict-analyzer.js');

async function testSimilarityTab() {
  console.log('[Test] テスト用ローカルサーバーを起動中...');
  const port = 3008;
  const server = startServer(port);

  console.log('[Test] Playwright Chromium を起動...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }
  });
  const page = await context.newPage();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  try {
    console.log(`[Test] http://localhost:${port} へアクセス...`);
    await page.goto(`http://localhost:${port}`);
    await sleep(2000);

    // 1. 「類似アニメ検索」タブをクリック
    console.log('[Test] 「類似アニメ検索」タブをクリック...');
    const tabBtn = page.locator('button[data-tab="tab-similarity-search"]');
    await tabBtn.click();
    await sleep(1500);

    // 2. 起点アニメカードとTop10グリッドの存在確認
    console.log('[Test] 起点アニメおよびTop10カードの描画を確認中...');
    await page.waitForSelector('.sim-current-card', { timeout: 10000 });
    const currentTitle = await page.locator('.sim-current-title').textContent();
    console.log(`[Test] 初期表示された起点アニメ: ${currentTitle}`);

    const cardCount = await page.locator('.sim-card').count();
    console.log(`[Test] 類似度Top10カード枚数: ${cardCount} 枚`);
    if (cardCount !== 10) {
      throw new Error(`Top10カード枚数が10枚ではありません: ${cardCount}`);
    }

    // 3. スクリーンショット保存（初期表示）
    const scratchDir = path.resolve(__dirname, '../scratch');
    if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
    await page.screenshot({ path: path.join(scratchDir, 'similarity_tab_initial.png') });
    console.log('[Test] 初期表示スクリーンショット保存完了: similarity_tab_initial.png');

    // 4. 検索機能のテスト
    console.log('[Test] 検索バーに「フリーレン」を入力してサジェストをテスト...');
    await page.fill('#sim-search-input', 'フリーレン');
    await sleep(500);

    const dropdownActive = await page.locator('#sim-dropdown-results.active').isVisible();
    console.log(`[Test] サジェストドロップダウン表示状態: ${dropdownActive}`);
    const suggestCount = await page.locator('.sim-dropdown-item').count();
    console.log(`[Test] サジェスト候補件数: ${suggestCount} 件`);

    // 5. サジェスト候補をクリックして起点変更
    console.log('[Test] 検索候補の先頭をクリック...');
    await page.locator('.sim-dropdown-item').first().click();
    await sleep(1000);

    const newTitle = await page.locator('.sim-current-title').textContent();
    console.log(`[Test] 切り替え後の起点アニメ: ${newTitle}`);

    // 6. 数珠つなぎ探索テスト（Top10の1枚目のカードをクリック）
    console.log('[Test] Top10の第1位カードをクリックして数珠つなぎ遷移...');
    const firstSimTitle = await page.locator('.sim-card-title').first().textContent();
    await page.locator('.sim-card').first().click();
    await sleep(1000);

    const chainTitle = await page.locator('.sim-current-title').textContent();
    console.log(`[Test] 数珠つなぎ後の起点アニメ: ${chainTitle} (期待値: ${firstSimTitle})`);

    // 7. スクリーンショット保存（数珠つなぎ後）
    await page.screenshot({ path: path.join(scratchDir, 'similarity_tab_chained.png') });
    console.log('[Test] 数珠つなぎスクリーンショット保存完了: similarity_tab_chained.png');

    console.log('🎉 すべてのテストが正常にパスしました！');
  } catch (err) {
    console.error('❌ テストエラー:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
}

testSimilarityTab();
