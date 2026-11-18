'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert');
const { chromium } = require('playwright');
const { createApp } = require('../bin/annict-analyzer.js');
const GenreEngine = require('../static/core/genre-engine.js');
const StudioDictionary = require('../static/core/studio-dictionary.js');
const { AnalyzerEngine, matchEra, resolveCategoryId } = require('../static/core/analyzer-engine.js');
const { GenreClient } = require('../lib/labs/genre-client.js');
const { buildBootstrapPayload } = require('../scripts/build-bootstrap.js');
const { PersistentMapCache } = require('../lib/services/cache-service.js');
const { resolveSimilarityImage } = require('../lib/services/image-resolver.js');

const SS_DIR = path.resolve(__dirname, '../scratch/v3_audit');

async function run() {
  fs.mkdirSync(SS_DIR, { recursive: true });

  console.log('[1/4] コアエンジン単体ロジック検証...');
  const genreCases = [
    { title: '葬送のフリーレン', genres: ['Adventure', 'Drama', 'Fantasy'], tags: [{ name: 'Iyashikei', rank: 70 }], expected: 'sf_fantasy' },
    { title: 'ダンジョンに出会いを求めるのは間違っているだろうか', genres: ['Action', 'Adventure', 'Fantasy'], tags: [{ name: 'Dungeon', rank: 90 }], expected: 'sf_fantasy' },
    { title: 'かぐや様は告らせたい', genres: ['Comedy', 'Psychological', 'Romance'], tags: [{ name: 'Romantic Comedy', rank: 95 }], expected: 'romance' },
    { title: '機動戦士ガンダム 水星の魔女', genres: ['Action', 'Mecha', 'Sci-Fi'], tags: [{ name: 'Real Robot', rank: 95 }], expected: 'mecha' },
    { title: '魔法少女まどか☆マギカ', genres: ['Drama', 'Mahou Shoujo', 'Psychological'], tags: [{ name: 'Magical Girl', rank: 98 }], expected: 'mahou_shoujo' },
    { title: 'ぼっち・ざ・ろっく！', genres: ['Comedy', 'Music'], tags: [{ name: 'Band', rank: 95 }], expected: 'idol_music' },
    { title: 'ゆるキャン△', genres: ['Comedy', 'Slice of Life'], tags: [{ name: 'Camping', rank: 95 }, { name: 'Iyashikei', rank: 90 }], expected: 'nichijou' },
    { title: '無職転生 ～異世界行ったら本気だす～', genres: ['Adventure', 'Drama', 'Fantasy'], tags: [{ name: 'Isekai', rank: 98 }], expected: 'isekai' }
  ];
  for (const tc of genreCases) {
    const res = GenreEngine.scoreAnimeDetailed(tc.genres, tc.tags, tc.title);
    assert.strictEqual(res.category, tc.expected, `${tc.title} expected ${tc.expected} got ${res.category}`);
  }
  assert.strictEqual(GenreEngine.scoreAnimeDetailed([], [], '銀魂').category, 'comedy');
  assert.strictEqual(GenreEngine.scoreAnimeDetailed(['Adventure', 'Comedy', 'Fantasy'], [], 'ダンジョン飯').category, 'sf_fantasy');
  assert.strictEqual(GenreEngine.scoreAnimeDetailed(['Adventure', 'Fantasy', 'Slice of Life'], [], '29歳独身中堅冒険者の日常').category, 'nichijou');
  assert.strictEqual(resolveCategoryId('超かぐや姫！(劇場版)', { '超かぐや姫！': { c: 'sf_fantasy' } }), 'sf_fantasy');
  assert.strictEqual(resolveCategoryId('藤本タツキ 17-26 Part1', { '藤本タツキ 17-26': { c: 'sf_fantasy' } }), 'sf_fantasy');
  assert.strictEqual(resolveCategoryId('Wake Up, Girls! 続・劇場版', { 'Wake Up, Girls！': { c: 'idol_music' } }), 'idol_music');
  assert.strictEqual(resolveCategoryId('ちっちゃな雪使いシュガー 特別編「その胸にあるもの」', { 'ちっちゃな雪使いシュガー': { c: 'sf_fantasy' } }), 'sf_fantasy');
  assert.strictEqual(resolveCategoryId('モンスター娘のいる日常OAD', { 'モンスター娘のいる日常': { c: 'romance' } }), 'romance');
  assert.strictEqual(resolveCategoryId('約束のネバーランド', {}), 'horror_suspense');
  const builtWg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../static/res/work-genres.json'), 'utf8'));
  assert.strictEqual(builtWg['ツインズひなひま']?.c, 'drama');
  assert.strictEqual(builtWg['プラノサウルス ガチコセイブツ部']?.c, 'comedy');
  assert.strictEqual(builtWg['坂本ですが？']?.c, 'comedy');
  assert(builtWg['憑物語']?.c && builtWg['憑物語'].c !== 'other', '憑物語 must not be other');
  assert.strictEqual(builtWg['超かぐや姫！(劇場版)']?.c, 'sf_fantasy');
  assert.strictEqual(matchEra('', 'classic'), false);
  assert.strictEqual(matchEra('', 'unknown'), true);
  assert.strictEqual(matchEra('1995年春', 'classic'), true);
  assert.strictEqual(StudioDictionary.identifyStudio('男子高校生の日常')?.name, 'サンライズ');
  assert.strictEqual(StudioDictionary.identifyStudio('異能バトルは日常系のなかで')?.name, 'TRIGGER');
  assert.strictEqual(StudioDictionary.identifyStudio('ワンパンマン 第2期')?.name, 'J.C.STAFF');
  assert.strictEqual(StudioDictionary.identifyStudio('BNA ビー・エヌ・エー')?.name, 'TRIGGER');
  assert.strictEqual(StudioDictionary.identifyStudio('先輩はおとこのこ')?.name, 'project No.9');
  assert.strictEqual(StudioDictionary.identifyStudio('ゆるゆり さん☆ハイ！')?.name, 'TYOアニメーションズ');
  assert.strictEqual(StudioDictionary.identifyStudio('HUNTER×HUNTER')?.name, '日本アニメーション');
  assert.strictEqual(StudioDictionary.identifyStudio('HUNTER×HUNTER(2011)')?.name, 'マッドハウス');
  assert.strictEqual(StudioDictionary.identifyStudio('Kanon')?.name, '東映アニメーション');
  assert.strictEqual(StudioDictionary.identifyStudio('Kanon（新）')?.name, '京都アニメーション');
  assert.deepStrictEqual(StudioDictionary.identifyStudios('SPY×FAMILY'), ['WIT STUDIO', 'CloverWorks']);
  assert.strictEqual(StudioDictionary.normalizeStudioName('Kyoto Animation'), '京都アニメーション');
  assert.strictEqual(StudioDictionary.normalizeStudioName('SHAFT (シャフト)'), 'シャフト');
  assert.strictEqual(StudioDictionary.normalizeStudioName('Bandai Namco Filmworks'), 'サンライズ');
  assert.strictEqual(StudioDictionary.normalizeStudioName('NHK'), null);
  assert.deepStrictEqual(StudioDictionary.resolveStudiosForAnime('負けヒロインが多すぎる！', builtWg), ['A-1 Pictures']);
  assert.deepStrictEqual(StudioDictionary.resolveStudiosForAnime('アキバ冥途戦争', builtWg), ['P.A.WORKS']);
  assert.deepStrictEqual(StudioDictionary.resolveStudiosForAnime('アイカツ！-アイドルカツドウ！-', builtWg), ['サンライズ']);
  assert.deepStrictEqual(StudioDictionary.resolveStudiosForAnime('無彩限のファントム・ワールド', builtWg), ['京都アニメーション']);
  assert.deepStrictEqual(StudioDictionary.resolveStudiosForAnime('怪物王女-Princess Resurrection-', builtWg), ['マッドハウス']);
  assert.deepStrictEqual(StudioDictionary.resolveStudiosForAnime('THE IDOLM@STER', builtWg), ['A-1 Pictures']);

  // story 全128バケットスコア[0, 1000]クランプ & featured正規化 & popular #1 検証
  const popIndex = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../static/res/popular/index.json'), 'utf8'));
  assert(popIndex.items.length > 17000, 'popular index item count too low');
  assert(popIndex.items[0][1].includes('まどか'), `popular #1 expected Madoka got ${popIndex.items[0][1]}`);
  const storyIdx = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../static/res/story/index.json'), 'utf8'));
  assert(storyIdx.featured.every(id => typeof id === 'string'), 'story featured IDs must be strings');
  for (let b = 0; b < 128; b++) {
    const bPath = path.resolve(__dirname, `../static/res/story/buckets/${String(b).padStart(3, '0')}.json`);
    const bucketObj = JSON.parse(fs.readFileSync(bPath, 'utf8'));
    for (const d of Object.values(bucketObj)) {
      for (const c of (d.c || [])) {
        assert(c[1] >= 0 && c[1] <= 1000, `bucket ${b} setting score out of bounds: ${c[1]}`);
        assert(c[2] >= 0 && c[2] <= 1000, `bucket ${b} plot score out of bounds: ${c[2]}`);
      }
    }
  }

  const sampleLists = {
    alice: [
      { id: '1', title: '作品A', season: '2024年春', image: '' },
      { id: '2', title: '作品B', season: '2023年冬', image: '' },
      { id: '3', title: '作品C', season: '2020年秋', image: '' }
    ],
    bob: [
      { id: '1', title: '作品A', season: '2024年春', image: '' },
      { id: '4', title: '作品D', season: '2021年夏', image: '' }
    ],
    carol: [
      { id: '1', title: '作品A', season: '2024年春', image: '' },
      { id: '2', title: '作品B', season: '2023年冬', image: '' },
      { id: '5', title: '劇場版 作品E', season: '2018年春', image: '' }
    ]
  };
  const report0 = new AnalyzerEngine({}).buildFullReport({});
  assert.strictEqual(report0.users.length, 0);
  assert.strictEqual(report0.insights.watchedByAll.length, 0);
  const report1 = new AnalyzerEngine({ solo: [{ id: '1', title: '作品A', season: '2024年春' }] }).buildFullReport({});
  assert.strictEqual(report1.users.length, 1);
  assert.strictEqual(report1.similarity.ranking.length, 0);
  assert.strictEqual(report1.insights.watchedByAll.length, 0);
  const report2 = new AnalyzerEngine({ u1: sampleLists.alice, u2: sampleLists.bob }).buildFullReport({});
  assert.strictEqual(report2.similarity.ranking.length, 1);
  assert.strictEqual(report2.insights.missingPerUser.u1.length, 0); // 3人以上で有効

  const engine = new AnalyzerEngine(sampleLists);
  const report = engine.buildFullReport({ '作品A': { c: 'action' } });
  assert.strictEqual(report.insights.watchedByAll.length, 1);
  assert.strictEqual(report.insights.watchedByAll[0].id, '1');
  assert.strictEqual(report.insights.missingPerUser.bob.length, 1);
  assert.strictEqual(report.insights.missingPerUser.bob[0].id, '2');
  assert.strictEqual(report.labs.genreReportScored.statsByUser.alice.genres.find(g => g.id === 'action').count, 1);

  // 重複IDを含む生配列でも Venn / getIntersection / timeline / insights が二重カウントしないこと
  const dupEngine = new AnalyzerEngine({
    u1: [{ id: '1', title: 'X', season: '2024年春' }, { id: '1', title: 'X', season: '2024年春' }],
    u2: [{ id: '1', title: 'X', season: '2024年春' }]
  });
  assert.strictEqual(dupEngine.getIntersection(['u1', 'u2']).length, 1);
  assert.strictEqual(dupEngine.generateVennSets(['u1', 'u2'])[0].size, 1);
  const dupTimeline = dupEngine.calculateTimeline();
  assert.strictEqual(dupTimeline.yearsByUser.u1.maxYearCount, 1);
  assert.strictEqual(dupTimeline.yearStats[0].totalCount, 2);
  const dupInsights = dupEngine.generateInsights();
  assert.strictEqual(dupInsights.watchedByAll.length, 1);

  // bootstrap episodesCount / media 往復検証
  const epLists = { u1: [{ id: '99', title: '長編アニメ', season: '2020年春', episodesCount: 48, media: 'tv' }] };
  const bsTupleTest = buildBootstrapPayload(epLists, ['u1']);
  assert.strictEqual(bsTupleTest.works['99'][3], 48);
  assert.strictEqual(bsTupleTest.works['99'][4], 'tv');
  const epCalc = new AnalyzerEngine({
    u1: [{ id: '99', title: '長編アニメ', season: '2020年春', episodesCount: bsTupleTest.works['99'][3], media: bsTupleTest.works['99'][4] }]
  }).calculateCalories();
  assert.strictEqual(epCalc.u1.totalHours, 19.2);

  // GenreClient P0回帰テスト (未登録作品の解決 + 通信失敗/GraphQLエラー時ネガティブキャッシュ汚染防止)
  const gc = new GenreClient();
  assert.strictEqual(typeof gc.normalizeTitle('葬送のフリーレン 第2期'), 'string');
  assert.strictEqual(GenreEngine.normalizeAniListTitle('山田くんとLv999の恋をする'), '山田くんとLv999の恋をする');
  assert.strictEqual(GenreEngine.normalizeAniListTitle('宇宙戦艦ヤマト2199'), '宇宙戦艦ヤマト2199');
  assert.strictEqual(GenreEngine.normalizeAniListTitle('Re:ゼロから始める異世界生活', 2), 'Re:ゼロから始める異世界生活');
  assert.strictEqual(GenreEngine.normalizeAniListTitle('PSYCHO-PASS サイコパス', 2), 'PSYCHO-PASS サイコパス');
  assert.strictEqual(GenreEngine.normalizeAniListTitle('けいおん！ -ライブ編-', 2), 'けいおん!');
  assert.strictEqual(GenreEngine.normalizeAniListTitle('魔法科高校の劣等生 ～来訪者編～', 2), '魔法科高校の劣等生');
  const tvTitleMovieCal = new AnalyzerEngine({
    u1: [{ id: '888', title: '劇場版 鬼滅の刃 無限列車編', season: '2021年秋', episodesCount: 7, media: 'tv' }]
  }).calculateCalories();
  assert.strictEqual(tvTitleMovieCal.u1.breakdown.tvCount, 1);
  assert.strictEqual(tvTitleMovieCal.u1.breakdown.movieCount, 0);
  assert.strictEqual(tvTitleMovieCal.u1.totalHours, 2.8);
  const uncachedTitle = `__TEST_UNCACHED_ANIME_${Date.now()}__`;
  const origFetch = global.fetch;
  try {
    // 1. 正常解決
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          m0: {
            media: [{ id: 1, format: 'TV', popularity: 5000, title: { native: uncachedTitle }, synonyms: [], genres: ['Action'], tags: [{ name: 'Battle', rank: 90, isMediaSpoiler: false }] }]
          }
        }
      })
    });
    const origSave = gc.saveCache.bind(gc);
    gc.saveCache = () => {}; // 本番キャッシュファイルを汚さない
    const resMapOk = await gc.resolveGenres([uncachedTitle], null, 5000);
    assert.strictEqual(resMapOk[uncachedTitle].category, 'action');
    delete gc.cache[uncachedTitle];

    // 2. 通信失敗時 (HTTP 500) にネガティブキャッシュへ書き込まないこと
    global.fetch = async () => ({ ok: false, status: 500, statusText: 'Err', json: async () => ({}) });
    await gc.resolveGenres([uncachedTitle], null, 5000);
    assert.strictEqual(uncachedTitle in gc.cache, false, 'Temporary fetch failure must not poison negative cache');

    // 3. HTTP 200 + GraphQL errors 時もネガティブキャッシュへ書き込まないこと
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ data: null, errors: [{ message: 'Rate limited' }] }) });
    await gc.resolveGenres([uncachedTitle], null, 5000);
    assert.strictEqual(uncachedTitle in gc.cache, false, 'GraphQL errors response must not poison negative cache');
    gc.saveCache = origSave;
  } finally {
    global.fetch = origFetch;
  }

  // PersistentMapCache + image-resolver ホスト厳密検証
  const tmpCache = new PersistentMapCache(path.join(SS_DIR, '_test_tmp_cache.json'), 2, 100);
  tmpCache.set('k1', 'v1', false);
  tmpCache.set('k2', 'v2', false);
  tmpCache.set('k3', 'v3', false);
  assert.strictEqual(tmpCache.get('k1'), undefined, 'LRU eviction failed');
  tmpCache.set('spoof', { workId: '1', url: 'https://evil.com/?x=image.annict.com' }, false);
  const origImgFetch = global.fetch;
  try {
    global.fetch = async () => ({ ok: false, status: 404, text: async () => '' });
    const spoofRes = await resolveSimilarityImage({ workId: 'spoof', title: '' }, tmpCache);
    assert.strictEqual(spoofRes.url, '', 'Spoofed host passed isAnnictImageHost');
    assert.strictEqual(tmpCache.get('spoof').source, 'none');
  } finally {
    global.fetch = origImgFetch;
  }
  try { fs.unlinkSync(path.join(SS_DIR, '_test_tmp_cache.json')); } catch (_) {}

  console.log('  ✔ 全単体ロジック検証 合格');

  // 2. サーバー＆APIテスト
  console.log('\n[2/4] サーバー起動 & APIパフォーマンス検証...');
  const app = createApp();
  const server = http.createServer(app);
  const PORT = 3456;
  await new Promise(resolve => server.listen(PORT, resolve));
  const baseUrl = `http://127.0.0.1:${PORT}`;

  try {
    const t0 = Date.now();
    const bootstrapRes = await fetch(`${baseUrl}/api/bootstrap`);
    assert.strictEqual(bootstrapRes.status, 200);
    const bootstrapText = await bootstrapRes.text();
    const tBootstrap = Date.now() - t0;
    const bootstrapJson = JSON.parse(bootstrapText);
    const bootstrapKb = Math.round(Buffer.byteLength(bootstrapText) / 1024);
    assert(bootstrapKb < 1024, `bootstrap too large: ${bootstrapKb}KB`);
    assert(bootstrapJson.users.length >= 2);
    console.log(`  ✔ GET /api/bootstrap: ${bootstrapKb} KB (${tBootstrap} ms) / ${bootstrapJson.users.length}人`);

    // 大文字・小文字混在ユーザーのクエリ互換検証 (config/users.json と bootstrap.json を書き換えないことも検証)
    const usersBefore = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/users.json'), 'utf8'));
    const bootstrapFileBefore = fs.readFileSync(path.resolve(__dirname, '../static/res/bootstrap.json'), 'utf8');
    const sampleU = bootstrapJson.users[0];
    const mixedU = sampleU.slice(0, 1).toUpperCase() + sampleU.slice(1).toLowerCase();
    const ciRes = await fetch(`${baseUrl}/api/bootstrap?users=${encodeURIComponent(mixedU)}`);
    assert.strictEqual(ciRes.status, 200);
    const ciJson = await ciRes.json();
    assert(ciJson.users.length === 1 && Object.keys(ciJson.userWorkIds || {}).length === 1, 'Case-insensitive user lookup failed');
    const usersAfter = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/users.json'), 'utf8'));
    const bootstrapFileAfter = fs.readFileSync(path.resolve(__dirname, '../static/res/bootstrap.json'), 'utf8');
    assert.deepStrictEqual(usersAfter, usersBefore, 'GET /api/bootstrap?users= must not overwrite config/users.json');
    assert.strictEqual(bootstrapFileAfter, bootstrapFileBefore, 'GET /api/bootstrap?users= must not overwrite static/res/bootstrap.json');

    // パストラバーサル・不正ユーザー名拒否 (400) 検証
    const travRes1 = await fetch(`${baseUrl}/api/user-watched/${encodeURIComponent('../../package')}`);
    assert.strictEqual(travRes1.status, 400, `Expected 400 for path traversal, got ${travRes1.status}`);
    const travRes2 = await fetch(`${baseUrl}/api/bootstrap?users=${encodeURIComponent('../config')}`);
    assert.strictEqual(travRes2.status, 400, `Expected 400 for query traversal, got ${travRes2.status}`);
    const travRes3 = await fetch(`${baseUrl}/api/users/${encodeURIComponent('..%2Fpackage')}`, { method: 'DELETE' });
    assert.strictEqual(travRes3.status, 400, `Expected 400 for delete traversal, got ${travRes3.status}`);

    // 重複大文字小文字クエリ (Saya15,saya15) が1人に正規化されること + /api/analysis + POST /api/sync 検証
    const dupQueryRes = await fetch(`${baseUrl}/api/bootstrap?users=${encodeURIComponent(`${mixedU},${sampleU}`)}`);
    assert.strictEqual(dupQueryRes.status, 200);
    const dupQueryJson = await dupQueryRes.json();
    assert.strictEqual(dupQueryJson.users.length, 1, `Duplicate CI users should dedup to 1, got ${dupQueryJson.users.length}`);

    const analysisRes = await fetch(`${baseUrl}/api/analysis?users=${encodeURIComponent(sampleU)}`);
    assert.strictEqual(analysisRes.status, 200);
    const analysisJson = await analysisRes.json();
    assert(analysisJson.users?.length === 1 && analysisJson.labs?.calorieReport, 'GET /api/analysis response malformed');

    const badSyncRes = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'refresh', username: '../bad' })
    });
    assert.strictEqual(badSyncRes.status, 400);

    const invalidActionSyncRes = await fetch(`${baseUrl}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_all', username: sampleU })
    });
    assert.strictEqual(invalidActionSyncRes.status, 400);

    const lastUserDelRes = await fetch(
      `${baseUrl}/api/users/${encodeURIComponent(sampleU)}?currentUsers=${encodeURIComponent(sampleU)}`,
      { method: 'DELETE' }
    );
    assert.strictEqual(lastUserDelRes.status, 400);
    const usersAfterLastDel = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/users.json'), 'utf8'));
    assert.deepStrictEqual(usersAfterLastDel, usersBefore, 'Last-user delete rejection must not modify config/users.json');

    // 存在しないユーザーの404エラー検証
    const missingRes = await fetch(`${baseUrl}/api/user-watched/nonexistent_annict_user_xyz_998877`);
    assert.strictEqual(missingRes.status, 404, `Expected 404 for nonexistent user, got ${missingRes.status}`);
    console.log(`  ✔ CI一致・重複排除・/api/analysis・ファイル非破壊・400/404 検証完了`);

    const t1 = Date.now();
    const gsRes = await fetch(`${baseUrl}/api/genre-score?title=${encodeURIComponent('着せ恋')}`);
    assert.strictEqual(gsRes.status, 200);
    const gsJson = await gsRes.json();
    const tGs = Date.now() - t1;
    assert.strictEqual(gsJson.scored.category, 'romance');
    console.log(`  ✔ GET /api/genre-score?title=着せ恋 -> ${gsJson.title} (${gsJson.scored.category}, ${tGs} ms)`);

    // 3. Playwright PC E2Eテスト
    console.log('\n[3/4] Playwright PC (1440x900) 全8ビュー総合検証...');
    const browser = await chromium.launch({ headless: true });
    const consoleErrors = [];
    const failedRequests = [];

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => consoleErrors.push(err.message));
    page.on('response', res => {
      if (res.status() >= 400 && !res.url().includes('favicon')) {
        console.warn(`  [HTTP ${res.status()}] ${res.url()}`);
        if (res.url().startsWith(baseUrl)) {
          failedRequests.push(`${res.status()} ${res.url()}`);
        }
      }
    });

    const navStart = Date.now();
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('#venn-chart svg', { timeout: 10000 });
    await page.waitForSelector('#venn-chart svg .venn-intersection-label', { timeout: 5000 });
    const vennIntersectionCount = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#venn-chart svg .venn-intersection-label')).filter(el => /^\d+$/.test(el.textContent.trim())).length
    );
    assert(vennIntersectionCount >= 1, `Expected Venn SVG intersection count labels >= 1, got ${vennIntersectionCount}`);
    const initialLoadMs = Date.now() - navStart;
    console.log(`  ✔ 初期起動＆ベン図SVG描画・交差ラベル(${vennIntersectionCount}個)確認完了 (${initialLoadMs} ms)`);
    await page.screenshot({ path: path.join(SS_DIR, 'pc_01_venn_dark.png') });

    // XSS sanitizeUrl + escapeHtml ブラウザ検証 & PCサイドバー閉じるボタン非表示検証
    const layoutCheck = await page.evaluate(() => {
      const closeBtn = document.getElementById('btn-sidebar-close-mobile');
      const menuBtn = document.getElementById('btn-mobile-menu');
      return {
        closeDisplay: closeBtn ? getComputedStyle(closeBtn).display : null,
        menuDisplay: menuBtn ? getComputedStyle(menuBtn).display : null,
        xssJs: window.UIUtils.sanitizeUrl('javascript:alert(1)'),
        xssProto: window.UIUtils.sanitizeUrl('//evil.com/x'),
        xssBackslash: window.UIUtils.sanitizeUrl('/\\evil.com/x'),
        xssHtml: window.UIUtils.escapeHtml('<img src=x onerror=alert(1)>'),
        safeHttp: window.UIUtils.sanitizeUrl('https://annict.com/works/1')
      };
    });
    assert.strictEqual(layoutCheck.closeDisplay, 'none', 'sidebar-close-mobile must be hidden on PC');
    assert.strictEqual(layoutCheck.menuDisplay, 'none', 'mobile-menu-btn must be hidden on PC');
    assert.strictEqual(layoutCheck.xssJs, '#');
    assert.strictEqual(layoutCheck.xssProto, '#');
    assert.strictEqual(layoutCheck.xssBackslash, '#');
    assert(!layoutCheck.xssHtml.includes('<img'), 'escapeHtml failed');
    assert.strictEqual(layoutCheck.safeHttp, 'https://annict.com/works/1');

    // ベン図領域ボタン確認
    const vennRegionBtns = await page.locator('.js-venn-region-btn').count();
    assert(vennRegionBtns >= 3, 'Venn region buttons missing');

    const waitVisibleThumbs = async (p, selector) => {
      await p.waitForFunction((sel) => {
        const vh = window.innerHeight || 900;
        const all = Array.from(document.querySelectorAll(sel));
        const inView = all.filter(img => {
          const r = img.getBoundingClientRect();
          return r.width > 0 && r.bottom >= 0 && r.top <= vh + 40;
        });
        const imgs = (inView.length > 0 ? inView : all).slice(0, 12);
        return imgs.length === 0 || imgs.every(img =>
          !img.isConnected ||
          (img.complete && (img.naturalWidth === 0 || (img.classList.contains('is-loaded') && getComputedStyle(img).opacity === '1')))
        );
      }, selector, { timeout: 10000 }).catch(() => {});
      await p.waitForTimeout(260);
    };

    // シンクロ率ビュー & 小数第1位統一 + ペアモーダル検索検証
    await page.click('.nav-item[data-view="similarity"]');
    await page.waitForSelector('#sim-matrix-table .js-pair-cell', { timeout: 5000 });
    await page.waitForTimeout(280);
    const simCellText = await page.locator('#sim-matrix-table .js-pair-cell').first().textContent();
    assert(/\d+\.\d%/.test(simCellText), `Similarity % format expected X.Y%, got: ${simCellText}`);
    await page.screenshot({ path: path.join(SS_DIR, 'pc_02_similarity_dark.png') });
    await page.locator('#sim-matrix-table .js-pair-cell').first().click();
    await page.waitForSelector('#pair-common-modal', { state: 'visible' });
    assert.strictEqual(await page.locator('#pair-modal-search').count(), 1, 'Pair modal search missing');
    assert.strictEqual(await page.locator('#pair-modal-sort').count(), 1, 'Pair modal sort missing');
    await page.waitForSelector('#pair-modal-grid .anime-card', { timeout: 5000 });
    await waitVisibleThumbs(page, '#pair-modal-grid .anime-card-thumb');
    await page.screenshot({ path: path.join(SS_DIR, 'pc_02b_pair_modal.png') });
    await page.click('#btn-done-pair-modal');
    console.log('  ✔ シンクロ率 & ペア共通モーダル(検索/ソート) 確認完了');

    // インサイトビュー (初期表示で空画面にならないこと)
    await page.click('.nav-item[data-view="insights"]');
    await page.waitForSelector('.insight-kpi-card', { timeout: 5000 });
    const initialInsightCards = await page.locator('#insight-grid .anime-card').count();
    assert(initialInsightCards > 0, 'Insights initial view rendered 0 cards');
    await waitVisibleThumbs(page, '#insight-grid .anime-card-thumb');
    await page.screenshot({ path: path.join(SS_DIR, 'pc_03_insights_dark.png') });
    await page.click('.insight-kpi-card[data-insight-mode="exclusive"]');
    await page.waitForTimeout(200);
    await page.click('.insight-kpi-card[data-insight-mode="missing"]');
    await page.waitForTimeout(200);
    console.log(`  ✔ 視聴インサイト 初期表示(${initialInsightCards}件) & 3モード切替 確認完了`);

    // グループ作品カタログビュー
    await page.click('.nav-item[data-view="group"]');
    await page.waitForSelector('#group-works-grid .anime-card', { timeout: 5000 });
    await waitVisibleThumbs(page, '#group-works-grid .anime-card-thumb');
    await page.screenshot({ path: path.join(SS_DIR, 'pc_04_group_union.png') });
    await page.click('[data-group-subtab="unwatched"]');
    await page.waitForFunction(() => {
      const b = document.getElementById('badge-group-unwatched');
      return b && b.textContent !== '読込中' && parseInt(b.textContent.replace(/,/g, ''), 10) > 10000;
    }, { timeout: 10000 });
    await page.waitForSelector('#group-works-grid .anime-card-thumb', { timeout: 8000 });
    await page.waitForFunction(() => {
      const imgs = Array.from(document.querySelectorAll('#group-works-grid .anime-card-thumb')).slice(0, 6);
      return imgs.length >= 1 && imgs.some(img => img.complete && img.naturalWidth > 0 && img.classList.contains('is-loaded'));
    }, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SS_DIR, 'pc_04b_group_unwatched.png') });
    console.log('  ✔ グループカタログ (和集合 + 未視聴17,350作分割ロード + 画像シャード) 確認完了');

    // 視聴アナリティクスビュー
    await page.click('.nav-item[data-view="analytics"]');
    await page.waitForSelector('#analytics-profile-grid .member-profile-card', { timeout: 5000 });
    await page.waitForTimeout(280);
    assert.strictEqual(await page.locator('#analytics-golden-years').count(), 0, 'analytics-golden-years must be removed');
    const profileText = await page.locator('#analytics-profile-grid').textContent();
    assert(profileText.includes('A-1 Pictures ('), 'Expected full studio name A-1 Pictures in profile overview');
    assert(profileText.includes('SILVER LINK. ('), 'Expected full studio name SILVER LINK. in profile overview');
    assert(profileText.includes('J.C.STAFF ('), 'Expected full studio name J.C.STAFF in profile overview');
    assert(profileText.includes('P.A.WORKS ('), 'Expected full studio name P.A.WORKS in profile overview');
    await page.screenshot({ path: path.join(SS_DIR, 'pc_05_analytics_dark.png') });
    await page.locator('#analytics-timeline-list').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SS_DIR, 'pc_05b_analytics_timeline.png') });
    await page.locator('.timeline-row-head').first().click();
    await page.waitForSelector('.timeline-drawer .anime-card', { timeout: 3000 });
    await page.locator('#analytics-studio-grid').scrollIntoViewIfNeeded();
    await page.waitForSelector('#analytics-studio-grid .studio-card .studio-item', { timeout: 5000 });
    await page.locator('#analytics-studio-grid .studio-item-head').first().click();
    await page.waitForSelector('#analytics-studio-grid .studio-item.open .anime-card', { timeout: 5000 });
    const moreStudioBtns = await page.locator('#analytics-studio-grid .js-studio-more-btn').count();
    assert(moreStudioBtns >= 1, 'Expected expandable full-studio toggle button');
    await page.locator('#analytics-studio-grid .js-studio-more-btn').first().click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SS_DIR, 'pc_05c_analytics_studios.png') });
    console.log('  ✔ 視聴アナリティクス (プロフィール・時間・1年タイムライン遅延展開・スタジオ) 確認完了');

    // ジャンル分析 & 診断ビュー
    await page.click('.nav-item[data-view="genre"]');
    await page.waitForSelector('#genre-accordion-list .genre-accordion-card', { timeout: 5000 });
    await page.waitForTimeout(260);
    await page.screenshot({ path: path.join(SS_DIR, 'pc_06_genre_dark.png') });
    await page.locator('.genre-accordion-head').first().click();
    await page.waitForSelector('.genre-accordion-card.open .anime-card', { timeout: 5000 });
    await waitVisibleThumbs(page, '.genre-accordion-card.open .anime-card-thumb');
    await page.screenshot({ path: path.join(SS_DIR, 'pc_06c_genre_expanded.png') });
    await page.click('[data-genre-subtab="inspector"]');
    await page.click('.js-inspector-preset[data-title="葬送のフリーレン"]');
    await page.waitForSelector('.inspector-score-row.winner', { timeout: 5000 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SS_DIR, 'pc_06b_genre_inspector.png') });
    console.log('  ✔ ジャンル分析15カテゴリ & スコア内訳診断 確認完了');

    // 作品検索ビュー
    await page.click('.nav-item[data-view="search"]');
    await page.waitForSelector('#global-search-input', { timeout: 5000 });
    await page.fill('#global-search-input', 'まどか');
    await page.waitForSelector('#global-search-results .anime-card', { timeout: 5000 });
    await waitVisibleThumbs(page, '#global-search-results .anime-card-thumb');
    await page.screenshot({ path: path.join(SS_DIR, 'pc_07_search_dark.png') });
    console.log('  ✔ 作品検索・逆引き 確認完了');

    // ストーリー構造類似検索ビュー (スコア<=100%, プリセット順確認)
    await page.click('.nav-item[data-view="story"]');
    await page.waitForSelector('#story-top30-section .sim-card', { timeout: 15000 });
    const simCardsCount = await page.locator('#story-top30-section .sim-card').count();
    assert(simCardsCount === 30, `Expected 30 story cards, got ${simCardsCount}`);
    const storyStats = await page.evaluate(() => {
      const pills = Array.from(document.querySelectorAll('.sim-card-score-pill')).map(el => parseFloat(el.textContent));
      const presets = Array.from(document.querySelectorAll('.js-story-preset')).map(el => parseFloat(el.getAttribute('data-w')));
      const genres = Array.from(document.querySelectorAll('#story-filter-genre option')).map(el => el.value);
      return { pills, presets, genres };
    });
    assert(storyStats.pills.every(p => p >= 0 && p <= 100), `Found story score > 100%: ${JSON.stringify(storyStats.pills)}`);
    assert.deepStrictEqual(storyStats.presets, [0.2, 0.5, 0.8], `Preset order mismatch: ${storyStats.presets}`);
    assert(!storyStats.genres.some(g => g !== 'ALL' && g.includes(',')), 'Composite comma-joined genres still present in dropdown');
    assert(!storyStats.genres.includes('etc.'), 'Genre slash split corrupted dropdown (found etc.)');
    assert(storyStats.genres.includes('SF/ファンタジー'), 'Expected slash genre SF/ファンタジー intact');
    await waitVisibleThumbs(page, '#story-top30-section .anime-card-thumb');
    await page.screenshot({ path: path.join(SS_DIR, 'pc_08_story_dark.png') });
    await page.locator('#story-top30-section .card-header').scrollIntoViewIfNeeded();
    await waitVisibleThumbs(page, '#story-top30-section .anime-card-thumb');
    await page.screenshot({ path: path.join(SS_DIR, 'pc_08b_story_cards.png') });
    await page.click('.js-story-preset[data-w="0.8"]');
    await page.waitForTimeout(200);
    const weightLbl = await page.textContent('#story-weight-label');
    const centerLbl = await page.textContent('#story-weight-ratio-center');
    assert(weightLbl.includes('プロット 80%'), `Weight label mismatch: ${weightLbl}`);
    assert(centerLbl.includes('20 : 80'), `Center ratio label mismatch: ${centerLbl}`);
    console.log('  ✔ ストーリー構造類似検索 (128バケット分割 + スコア<=100% + 中央比率連動) 確認完了');

    // ライトモード切替検証 (主要4画面撮影)
    await page.click('#btn-theme-toggle');
    await page.waitForTimeout(260);
    await page.click('.nav-item[data-view="venn"]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SS_DIR, 'pc_09_venn_light.png') });
    await page.click('.nav-item[data-view="similarity"]');
    await page.waitForTimeout(260);
    await page.screenshot({ path: path.join(SS_DIR, 'pc_09b_similarity_light.png') });
    await page.click('.nav-item[data-view="genre"]');
    await page.waitForTimeout(260);
    await page.screenshot({ path: path.join(SS_DIR, 'pc_09c_genre_light.png') });
    await page.click('.nav-item[data-view="story"]');
    await waitVisibleThumbs(page, '#story-top30-section .anime-card-thumb');
    await page.screenshot({ path: path.join(SS_DIR, 'pc_09d_story_light.png') });
    await page.click('.nav-item[data-view="venn"]');
    await page.waitForTimeout(260);
    console.log('  ✔ ライトテーマ切替 & 主要ビュー検証 確認完了');

    // リロード (Local-First IndexedDB) 検証 (/api/bootstrap を叩かないこと)
    let bootstrapFetchedOnReload = false;
    const reloadHandler = (req) => {
      if (req.url().includes('/api/bootstrap')) bootstrapFetchedOnReload = true;
    };
    page.on('request', reloadHandler);
    const reloadStart = Date.now();
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#venn-chart svg', { timeout: 5000 });
    page.off('request', reloadHandler);
    assert.strictEqual(bootstrapFetchedOnReload, false, 'Reload fetched /api/bootstrap despite IndexedDB cache');
    console.log(`  ✔ IndexedDB Local-First リロード完了・API非送信確認 (${Date.now() - reloadStart} ms)`);

    await context.close();

    // 4. モバイル (390x844) 検証
    console.log('\n[4/4] モバイル (390x844) レスポンシブ & 横はみ出しゼロ検証...');
    const mobCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const mobPage = await mobCtx.newPage();
    mobPage.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(`[Mobile] ${msg.text()}`);
    });
    mobPage.on('response', res => {
      if (res.status() >= 400 && !res.url().includes('favicon')) {
        console.warn(`  [Mobile HTTP ${res.status()}] ${res.url()}`);
        if (res.url().startsWith(baseUrl)) {
          failedRequests.push(`[Mobile] ${res.status()} ${res.url()}`);
        }
      }
    });

    await mobPage.goto(baseUrl, { waitUntil: 'networkidle' });
    await mobPage.waitForSelector('#venn-chart svg', { timeout: 10000 });

    const checkNoHorizontalOverflow = async (viewName) => {
      const overflow = await mobPage.evaluate(() => {
        const scrollW = document.documentElement.scrollWidth;
        const innerW = window.innerWidth;
        const clipped = [];
        document.querySelectorAll('.view-pane.active select, .view-pane.active .input-text').forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > innerW - 4) {
            clipped.push(`${el.id || el.className}:${Math.round(r.right)}>${innerW}`);
          }
        });
        return { scrollW, innerW, clipped };
      });
      assert(overflow.scrollW <= overflow.innerW, `Horizontal overflow on mobile (${viewName}): ${overflow.scrollW} > ${overflow.innerW}`);
      assert.strictEqual(overflow.clipped.length, 0, `Control overflows viewport on mobile (${viewName}): ${overflow.clipped.join(', ')}`);
    };

    await checkNoHorizontalOverflow('venn');
    await mobPage.screenshot({ path: path.join(SS_DIR, 'mob_01_venn.png') });

    // ドロワーメニュー開閉 & PC用折りたたみボタン非表示確認
    await mobPage.click('#btn-mobile-menu');
    await mobPage.waitForTimeout(250);
    const mobCollapseDisplay = await mobPage.evaluate(() => getComputedStyle(document.getElementById('btn-sidebar-collapse')).display);
    assert.strictEqual(mobCollapseDisplay, 'none', 'sidebar-collapse-btn must be hidden on mobile');
    await mobPage.screenshot({ path: path.join(SS_DIR, 'mob_00_drawer.png') });

    for (const v of ['similarity', 'insights', 'group', 'analytics', 'genre', 'search', 'story']) {
      const isDrawerOpen = await mobPage.locator('#app-shell.mobile-menu-open').count();
      if (isDrawerOpen === 0) {
        await mobPage.click('#btn-mobile-menu');
        await mobPage.waitForTimeout(200);
      }
      await mobPage.click(`.nav-item[data-view="${v}"]`);
      if (v === 'story') {
        await mobPage.waitForSelector('#story-top30-section .sim-card', { timeout: 10000 }).catch(() => {});
      } else {
        await mobPage.waitForTimeout(350);
      }
      await waitVisibleThumbs(mobPage, '.view-pane.active .anime-card-thumb');
      await checkNoHorizontalOverflow(v);
      await mobPage.screenshot({ path: path.join(SS_DIR, `mob_${v}.png`) });
    }
    console.log('  ✔ モバイル全8ビュー 横スクロールゼロ & ドロワー確認完了');

    const nonResourceConsoleErrors = consoleErrors.filter(e => !e.includes('Failed to load resource'));
    assert.strictEqual(nonResourceConsoleErrors.length, 0, `JS Console errors detected:\n${nonResourceConsoleErrors.join('\n')}`);
    assert.strictEqual(failedRequests.length, 0, `Failed local HTTP requests:\n${failedRequests.join('\n')}`);
    console.log('  ✔ JSエラー・ローカルHTTPエラー 0件');

    await browser.close();
  } finally {
    server.close();
  }

  console.log('\n🎉 v3.0 総合自動テスト 全項目合格！\n');
}

run().catch(err => {
  console.error('\n❌ テスト失敗:', err);
  process.exit(1);
});
