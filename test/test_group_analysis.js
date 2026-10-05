'use strict';

const path = require('path');
const { chromium } = require('playwright');
const { startServer } = require('../bin/annict-analyzer.js');

const ARTIFACT_DIR = 'C:/Users/dorad/.gemini/antigravity/brain/cf8fea70-3ca2-46a1-81c6-f5b019678109';

async function testGroupAnalysis() {
  const PORT = 3015;
  const server = startServer(PORT);
  console.log(`Test server running on port ${PORT}...`);

  const browser = await chromium.launch({ headless: true });

  try {
    // 1. PCビューでの検証
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`http://localhost:${PORT}`);
    await page.waitForSelector('#meta-updated');
    await page.waitForTimeout(1000);

    // グループ分析タブをクリック
    console.log('Switching to Group Analysis tab...');
    await page.click('button[data-tab="tab-group"]');
    await page.waitForTimeout(800);

    // 和集合の初期表示（PC）
    const unionCount = await page.textContent('#badge-group-union-count');
    const unwatchedCount = await page.textContent('#badge-group-unwatched-count');
    const resultsCount = await page.textContent('#group-results-count-text');
    console.log(`[PC] Union: ${unionCount}, Unwatched: ${unwatchedCount}, Results: ${resultsCount}`);

    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'group_analysis_pc_union.png') });

    // 未視聴人気作300選サブタブをクリック
    console.log('Switching to Unwatched 300 subtab...');
    await page.click('button[data-subtab="unwatched"]');
    await page.waitForTimeout(600);

    const unwatchedResultsCount = await page.textContent('#group-results-count-text');
    console.log(`[PC] Unwatched Results: ${unwatchedResultsCount}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'group_analysis_pc_unwatched.png') });

    // 検索フィルターのテスト
    console.log('Testing search filter...');
    await page.fill('#group-search-input', 'ガンダム');
    await page.waitForTimeout(400);
    const searchResultsCount = await page.textContent('#group-results-count-text');
    console.log(`[PC Search 'ガンダム'] Results: ${searchResultsCount}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'group_analysis_pc_search.png') });

    // 検索クリア
    await page.click('#btn-group-clear-search');
    await page.waitForTimeout(300);

    // 年代フィルターのテスト（2020年代）
    console.log('Testing era filter (2020s)...');
    await page.click('button[data-era="2020s"]');
    await page.waitForTimeout(400);
    const eraResultsCount = await page.textContent('#group-results-count-text');
    console.log(`[PC Era '2020s'] Results: ${eraResultsCount}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'group_analysis_pc_era_2020s.png') });

    // すべてに戻す
    await page.click('button[data-era="all"]');
    await page.waitForTimeout(300);

    // ユーザー選択変更のテスト (全解除 ➔ 2人選択)
    console.log('Testing user selection change...');
    await page.click('#btn-group-deselect-all');
    await page.waitForTimeout(300);
    console.log(`[Deselect all] Results: ${await page.textContent('#group-results-count-text')}`);

    // @saya15 と @hanu をチェック（labelをクリック）
    await page.click('#group-user-checkboxes label:has-text("saya15")');
    await page.waitForTimeout(200);
    await page.click('#group-user-checkboxes label:has-text("hanu")');
    await page.waitForTimeout(500);

    const twoUsersUnion = await page.textContent('#badge-group-union-count');
    const twoUsersUnwatched = await page.textContent('#badge-group-unwatched-count');
    console.log(`[Select 2 users] Union: ${twoUsersUnion}, Unwatched: ${twoUsersUnwatched}`);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'group_analysis_pc_2users.png') });

    await page.close();

    // 2. スマホビューでの検証
    console.log('Testing mobile view...');
    const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    await mobilePage.goto(`http://localhost:${PORT}`);
    await mobilePage.waitForSelector('#meta-updated');
    await mobilePage.waitForTimeout(800);

    await mobilePage.click('button[data-tab="tab-group"]');
    await mobilePage.waitForTimeout(800);
    await mobilePage.screenshot({ path: path.join(ARTIFACT_DIR, 'group_analysis_mobile_union.png') });

    await mobilePage.click('button[data-subtab="unwatched"]');
    await mobilePage.waitForTimeout(600);
    await mobilePage.screenshot({ path: path.join(ARTIFACT_DIR, 'group_analysis_mobile_unwatched.png') });

    await mobilePage.close();
    console.log('All tests completed successfully!');

  } finally {
    await browser.close();
    server.close();
  }
}

testGroupAnalysis().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
