'use strict';

const { chromium } = require('playwright');

async function testLabs() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  console.log('[Test] http://localhost:3000 にアクセス...');
  await page.goto('http://localhost:3000');
  await page.waitForSelector('#venn-chart svg');
  await new Promise(r => setTimeout(r, 1000));

  console.log('[Test] お試し実験室 (Labs) タブをクリック...');
  await page.click('button[data-tab="tab-labs"]');
  await page.waitForSelector('#labs-calorie-cards');
  await new Promise(r => setTimeout(r, 1500));

  const calorieCards = await page.$$('.calorie-card');
  console.log(`[Test] カロリーカード数: ${calorieCards.length}`);

  const studioCards = await page.$$('.studio-user-card');
  console.log(`[Test] スタジオカード数: ${studioCards.length}`);

  // スクリーンショット撮影
  await page.screenshot({ path: 'C:/Users/dorad/.gemini/antigravity/brain/cf8fea70-3ca2-46a1-81c6-f5b019678109/screenshot_labs.png', fullPage: false });
  console.log('[Test] Labs スクリーンショットを保存しました');

  await browser.close();
}

testLabs().catch(console.error);
