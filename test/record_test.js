'use strict';

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { startServer } = require('../bin/annict-analyzer.js');

async function record() {
  console.log('[Test & Record] ローカルサーバーを起動中...');
  const port = 3007;
  const server = startServer(port);

  const videoDir = path.resolve(__dirname, 'videos');
  if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true });
  }

  console.log('[Test & Record] Playwright Chromium を起動し録画を開始します...');
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: videoDir,
      size: { width: 1280, height: 720 }
    }
  });

  const page = await context.newPage();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  try {
    console.log('[Test & Record] ダッシュボードへアクセス...');
    await page.goto(`http://localhost:${port}`);
    await page.waitForSelector('#venn-chart svg', { timeout: 10000 });
    await sleep(2000);

    // 1. ベン図タブの操作
    console.log('[Test & Record] ベン図の領域をクリックして作品リストを検証...');
    const vennCircles = await page.$$('.venn-circle');
    console.log(`[Test & Record] ベン図領域数: ${vennCircles.length}`);

    if (vennCircles.length > 0) {
      // 最初の領域をクリック
      await vennCircles[0].click({ force: true });
      await sleep(1500);

      // 交差領域をクリック（もしあれば）
      if (vennCircles.length >= 2) {
        await vennCircles[1].click({ force: true });
        await sleep(1500);
      }
    }

    // 作品リストのスクロール
    console.log('[Test & Record] 作品リストをスクロール...');
    await page.evaluate(() => {
      const el = document.getElementById('detail-anime-list');
      if (el) el.scrollTop = 300;
    });
    await sleep(1000);

    // 絞り込み検索
    console.log('[Test & Record] 詳細リスト内の絞り込み検索をテスト...');
    await page.fill('#detail-search', 'けいおん');
    await sleep(1500);
    await page.fill('#detail-search', '');
    await sleep(1000);

    // ユーザー選択チップの切り替えテスト
    console.log('[Test & Record] ユーザーチップのトグルテスト...');
    let chips = await page.$$('.user-chip');
    if (chips.length >= 2) {
      await chips[1].click(); // 外す
      await sleep(1500);
      chips = await page.$$('.user-chip');
      if (chips.length >= 2) {
        await chips[1].click(); // 再び選択
        await sleep(1500);
      }
    }

    // 2. シンクロ率マトリクスタブ
    console.log('[Test & Record] シンクロ率マトリクスタブへ移動...');
    await page.click('button[data-tab="tab-similarity"]');
    await sleep(2500);

    // 3. インサイトタブ
    console.log('[Test & Record] インサイトタブへ移動...');
    await page.click('button[data-tab="tab-insights"]');
    await sleep(2500);

    // 孤高の推しユーザー切り替え
    console.log('[Test & Record] 独自推しアニメのユーザー切り替え...');
    const exclChips = await page.$$('#exclusive-user-selector .chip-btn');
    if (exclChips.length >= 2) {
      await exclChips[1].click();
      await sleep(2000);
    }

    // 4. 作品検索・逆引きタブ
    console.log('[Test & Record] 作品検索タブへ移動...');
    await page.click('button[data-tab="tab-search"]');
    await sleep(1500);
    await page.fill('#global-search-input', 'まどか');
    await sleep(2000);
    await page.fill('#global-search-input', 'シュタインズ');
    await sleep(2000);

    // ベン図タブに戻る
    await page.click('button[data-tab="tab-venn"]');
    await sleep(2000);

    console.log('[Test & Record] 操作完了！動画を保存します...');
  } catch (err) {
    console.error('[Test & Record Error]', err);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    server.close();
  }

  // 録画されたファイル名を取得
  const videoFiles = fs.readdirSync(videoDir).filter(f => f.endsWith('.webm') || f.endsWith('.mp4'));
  if (videoFiles.length > 0) {
    const latestVideo = path.join(videoDir, videoFiles[videoFiles.length - 1]);
    const finalDest = path.join(videoDir, 'annict_analysis_demo.webm');
    fs.copyFileSync(latestVideo, finalDest);
    console.log(`[Test & Record] 録画完了！ 保存先: ${finalDest}`);
    return finalDest;
  }
}

if (require.main === module) {
  record().catch(console.error);
}

module.exports = { record };
