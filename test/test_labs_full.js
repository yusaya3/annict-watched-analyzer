'use strict';

const { chromium } = require('playwright');

async function snapFull() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto('http://localhost:3000');
  await page.click('button[data-tab="tab-labs"]');
  await new Promise(r => setTimeout(r, 1500));

  await page.screenshot({ path: 'C:/Users/dorad/.gemini/antigravity/brain/cf8fea70-3ca2-46a1-81c6-f5b019678109/screenshot_labs_full.png', fullPage: true });

  await browser.close();
  console.log('Full Labs screenshot saved.');
}

snapFull().catch(console.error);
