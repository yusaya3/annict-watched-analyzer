'use strict';

const { chromium } = require('playwright');
const path = require('path');

async function testRadarWorks() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  console.log('1. Navigating to http://localhost:3000 ...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  console.log('2. Opening Party Lab tab ...');
  await page.click('button[data-tab="tab-party"]');
  await page.waitForTimeout(500);

  console.log('3. Opening Creator/VA Radar subtab ...');
  await page.click('button[data-party-subtab="radar"]');
  await page.waitForTimeout(500);

  // 4. Verify preview chips exist
  const previewChips = await page.$$('.radar-work-mini-chip');
  console.log(`Found ${previewChips.length} work preview chips.`);
  if (previewChips.length === 0) {
    throw new Error('No preview chips found!');
  }

  // 5. Click the first "+他○作" button to expand
  const moreBtn = await page.$('.radar-more-chip');
  if (moreBtn) {
    console.log('Clicking "+他○作" button...');
    await moreBtn.click();
    await page.waitForTimeout(400);

    const expandedGrid = await page.$('.radar-works-expanded[style*="display: block"]');
    if (!expandedGrid) {
      throw new Error('Expanded works grid did not appear after clicking more button!');
    }
    console.log('Expanded works grid successfully appeared.');

    // Count work cards inside
    const cards = await expandedGrid.$$('.radar-work-card');
    console.log(`Found ${cards.length} work cards in expanded grid.`);
  }

  // 6. Test "全展開" button on user card
  const toggleAllBtn = await page.$('.radar-toggle-user-all-btn');
  if (toggleAllBtn) {
    console.log('Clicking "全展開" button...');
    await toggleAllBtn.click();
    await page.waitForTimeout(400);
    const visibleGrids = await page.$$('.radar-works-expanded[style*="display: block"]');
    console.log(`Visible expanded grids: ${visibleGrids.length}`);
  }

  // 7. Test battle table cell click to open modal
  const cellBtn = await page.$('.radar-cell-btn');
  if (cellBtn) {
    console.log('Clicking battle table cell button...');
    await cellBtn.click();
    await page.waitForTimeout(500);

    const modal = await page.$('#radar-works-modal[style*="display: flex"]');
    if (!modal) {
      throw new Error('Radar works modal did not appear!');
    }
    console.log('Radar works modal opened successfully.');

    const modalCards = await page.$$('#radar-modal-content .radar-work-card');
    console.log(`Found ${modalCards.length} work cards in modal.`);

    // Close modal
    await page.click('#btn-close-radar-modal');
    await page.waitForTimeout(300);
    const modalHidden = await page.$('#radar-works-modal[style*="display: none"]');
    if (!modalHidden) {
      throw new Error('Radar works modal did not close!');
    }
    console.log('Modal closed successfully.');
  }

  // Take screenshot
  const screenshotPath = 'test/screenshot_radar_works.png';
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`Screenshot saved to ${screenshotPath}`);

  await browser.close();
  console.log('All radar works tests passed successfully!');
}

testRadarWorks().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
