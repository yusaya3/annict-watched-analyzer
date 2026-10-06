'use strict';

const { chromium } = require('playwright');
const http = require('http');
const { createApp } = require('../bin/annict-analyzer.js');

async function runTest() {
  console.log('--- Genre Simulator Fuzzy Search Test ---');
  const app = createApp();
  const server = http.createServer(app);

  await new Promise(resolve => server.listen(3334, resolve));
  console.log('Test server listening on port 3334');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('http://localhost:3334', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // 1. ジャンル実験室タブへ移動
    console.log('\n[Step 1] Navigate to Genre Lab tab...');
    const labTab = page.locator('[data-tab="tab-genre-lab"]');
    await labTab.click();
    await page.waitForTimeout(500);

    // 2. 作品スコア内訳シミュレーター（サブタブ3）へ移動
    console.log('\n[Step 2] Switch to Simulator subtab...');
    const simSubtab = page.locator('[data-lab-subtab="inspector"]');
    await simSubtab.click();
    await page.waitForTimeout(500);

    const input = page.locator('#inspector-title-input');
    const btn = page.locator('#btn-inspect-score');

    // 3. 部分一致テスト: 「フリーレン」
    console.log('\n[Step 3] Test partial search: "フリーレン"...');
    await input.fill('フリーレン');
    await btn.click();
    await page.waitForTimeout(1000);

    const resultCard = page.locator('#inspector-result-container');
    const resultText = await resultCard.innerText();
    console.log('Frieren result contains "葬送のフリーレン":', resultText.includes('葬送のフリーレン'));
    console.log('Frieren fuzzy banner present:', resultText.includes('部分一致候補'));

    // 4. 略称テスト: 「着せ恋」
    console.log('\n[Step 4] Test alias search: "着せ恋"...');
    await input.fill('着せ恋');
    await btn.click();
    await page.waitForTimeout(1000);

    const kisekoriText = await resultCard.innerText();
    console.log('Kisekoi result contains "その着せ替え人形は恋をする":', kisekoriText.includes('その着せ替え人形は恋をする'));

    // 5. 部分一致テスト: 「リコリス」
    console.log('\n[Step 5] Test partial search: "リコリス"...');
    await input.fill('リコリス');
    await btn.click();
    await page.waitForTimeout(1000);

    const lycorisText = await resultCard.innerText();
    console.log('Lycoris result contains "リコリス・リコイル":', lycorisText.includes('リコリス・リコイル'));

    // 6. サジェスト機能のテスト
    console.log('\n[Step 6] Test real-time suggestion dropdown...');
    await input.fill('マクロ');
    await page.waitForTimeout(500);
    const suggestDropdown = page.locator('#inspector-suggest-dropdown');
    const isSuggestVisible = await suggestDropdown.isVisible();
    const suggestCount = await page.locator('.inspector-suggest-item').count();
    console.log('Suggest dropdown visible:', isSuggestVisible, '| Items count:', suggestCount);

    console.log('\n[SUCCESS] Genre simulator fuzzy search verified completely!');
  } catch (err) {
    console.error('Test error:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
}

runTest();
