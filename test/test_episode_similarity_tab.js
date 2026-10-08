'use strict';

const { chromium } = require('playwright');

async function testEpisodeSimilarityTab() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  console.log('1. Navigating to http://localhost:3000 ...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  console.log('2. Opening Episode Similarity tab ...');
  const tabBtn = await page.$('button[data-tab="tab-episode-similarity"]');
  if (!tabBtn) {
    throw new Error('Episode similarity tab button not found in navigation!');
  }
  await tabBtn.click();
  await page.waitForTimeout(600);

  // 3. Verify section and banner
  const banner = await page.$('#tab-episode-similarity .sim-hero-banner');
  if (!banner) {
    throw new Error('Episode similarity banner not found!');
  }
  const bannerText = await banner.innerText();
  console.log('Banner text snippet:', bannerText.substring(0, 60));

  // 4. Verify current work card
  const currentCard = await page.$('#ep-sim-current-section .sim-current-card');
  if (!currentCard) {
    throw new Error('Current work card not rendered!');
  }
  const currentTitle = await page.$eval('#ep-sim-current-section .sim-current-title', el => el.innerText);
  console.log('Current work title:', currentTitle);

  // 5. Verify Top30 cards grid
  const cards = await page.$$('#ep-sim-top30-section .sim-card');
  console.log(`Rendered Top cards count: ${cards.length}`);
  if (cards.length !== 30) {
    throw new Error(`Expected 30 cards, but got ${cards.length}!`);
  }

  // 6. Test clicking a similar work card for chaining navigation
  const secondCard = cards[1];
  const secondTitle = await secondCard.$eval('.sim-card-title', el => el.innerText);
  console.log(`Clicking second card: ${secondTitle} ...`);
  await secondCard.click();
  await page.waitForTimeout(500);

  const updatedTitle = await page.$eval('#ep-sim-current-section .sim-current-title', el => el.innerText);
  console.log(`Updated current title: ${updatedTitle}`);
  if (updatedTitle !== secondTitle) {
    throw new Error(`Chaining navigation failed! Expected ${secondTitle}, got ${updatedTitle}`);
  }

  // 7. Verify Top30 cards after chaining
  const updatedCards = await page.$$('#ep-sim-top30-section .sim-card');
  console.log(`Updated Top cards count: ${updatedCards.length}`);
  if (updatedCards.length !== 30) {
    throw new Error(`Expected 30 cards after chaining, got ${updatedCards.length}!`);
  }

  // 8. Test incremental search input
  const searchInput = await page.$('#ep-sim-search-input');
  await searchInput.fill('フリーレン');
  await page.waitForTimeout(300);

  const dropdownItems = await page.$$('#ep-sim-dropdown-results .sim-dropdown-item');
  console.log(`Search dropdown items count: ${dropdownItems.length}`);
  if (dropdownItems.length === 0) {
    throw new Error('Search dropdown returned 0 results for "フリーレン"!');
  }

  // Take screenshot
  const screenshotPath = 'test/screenshot_episode_similarity.png';
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`Screenshot saved to ${screenshotPath}`);

  await browser.close();
  console.log('✔ All Episode Similarity Tab E2E tests passed successfully!');
}

testEpisodeSimilarityTab().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
