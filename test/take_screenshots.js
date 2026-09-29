'use strict';

const { chromium } = require('playwright');
const { startServer } = require('../bin/annict-analyzer.js');

async function snap() {
  const server = startServer(3008);
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });

  await p.goto('http://localhost:3008');
  await p.waitForSelector('#venn-chart svg');
  await new Promise(r => setTimeout(r, 1000));
  await p.screenshot({ path: 'C:/Users/dorad/.gemini/antigravity/brain/cf8fea70-3ca2-46a1-81c6-f5b019678109/screenshot_venn.png' });

  await p.click('button[data-tab="tab-similarity"]');
  await new Promise(r => setTimeout(r, 1000));
  await p.screenshot({ path: 'C:/Users/dorad/.gemini/antigravity/brain/cf8fea70-3ca2-46a1-81c6-f5b019678109/screenshot_similarity.png' });

  await p.click('button[data-tab="tab-insights"]');
  await new Promise(r => setTimeout(r, 1000));
  await p.screenshot({ path: 'C:/Users/dorad/.gemini/antigravity/brain/cf8fea70-3ca2-46a1-81c6-f5b019678109/screenshot_insights.png' });

  await b.close();
  server.close();
  console.log('All screenshots saved.');
}

snap().catch(console.error);
