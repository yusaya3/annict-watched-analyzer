'use strict';

const { chromium } = require('playwright');

async function testFeatures() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  console.log('[Test] http://localhost:3000 にアクセス...');
  await page.goto('http://localhost:3000');
  await page.waitForSelector('#venn-chart svg');
  await new Promise(r => setTimeout(r, 1000));

  // 1. ユーザー管理モーダルのテスト
  console.log('[Test] ユーザー管理モーダルを開く...');
  await page.click('#btn-open-user-modal');
  await page.waitForSelector('#user-modal', { state: 'visible' });
  const modalUsers = await page.$$('.modal-user-item');
  console.log(`[Test] モーダル内のユーザー数: ${modalUsers.length}`);

  await page.screenshot({ path: 'C:/Users/dorad/.gemini/antigravity/brain/cf8fea70-3ca2-46a1-81c6-f5b019678109/screenshot_user_modal.png' });

  // 閉じる
  await page.click('#btn-done-user-modal');
  await page.waitForSelector('#user-modal', { state: 'hidden' });

  // 2. 高画質キービジュアルのテスト
  console.log('[Test] インサイトタブでキービジュアル確認...');
  await page.click('button[data-tab="tab-insights"]');
  await page.waitForSelector('.grid-card-thumb');
  const imgUrl = await page.$eval('.grid-card-thumb', el => el.src);
  console.log(`[Test] キービジュアル画像URL: ${imgUrl}`);

  await page.screenshot({ path: 'C:/Users/dorad/.gemini/antigravity/brain/cf8fea70-3ca2-46a1-81c6-f5b019678109/screenshot_highres_insights.png' });

  await browser.close();
  console.log('[Test] 全検証完了！');
}

testFeatures().catch(console.error);
