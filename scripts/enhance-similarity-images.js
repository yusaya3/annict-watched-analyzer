'use strict';

/**
 * similarity-data.json の各作品に対して、Annictの検索および高画質キービジュアル（s:640:853）
 * またはdアニメストア公式画像を補完・高画質化するバッチスクリプト。
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const DATA_FILE = path.resolve(__dirname, '../static/res/similarity-data.json');
const CACHE_FILE = path.resolve(__dirname, '../data/cache/similarity_hires_cache.json');

function cleanTitle(t) {
  if (!t) return '';
  return t
    .replace(/「|」|『|』|【|】|\(|\)|（|）/g, ' ')
    .replace(/第[0-9０-９一二三四五六七八九十]+期/g, ' ')
    .replace(/Season\s*[0-9]+/gi, ' ')
    .replace(/TV版|配信限定.*|OAD|OVA/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveImage(danimeWorkId, title, annictId) {
  // 1. Annict ID既知の場合 -> 高解像度OGP (s:640:853)
  if (annictId && /^\d+$/.test(annictId)) {
    try {
      const res = await fetch(`https://annict.com/works/${annictId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      if (res.ok) {
        const html = await res.text();
        const $ = cheerio.load(html);
        const og = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || '';
        if (og && !og.includes('color-white-') && !og.includes('no-image')) {
          return { url: og, annictId, source: 'annict_hires' };
        }
      }
    } catch (e) {}
  }

  // 2. Annict検索
  const queries = [title, cleanTitle(title)].filter(Boolean);
  for (const q of queries) {
    try {
      const res = await fetch(`https://annict.com/search?q=${encodeURIComponent(q)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      if (res.ok) {
        const html = await res.text();
        const $ = cheerio.load(html);
        let foundWorkId = null;
        let foundThumb = null;

        $('a').each((i, el) => {
          const href = $(el).attr('href') || '';
          const match = href.match(/\/works\/(\d+)$/);
          if (match && !foundWorkId) {
            foundWorkId = match[1];
            foundThumb = $(el).find('img').attr('src');
          }
        });

        if (foundWorkId) {
          // 作品ページから高解像度OGPを取得
          const workRes = await fetch(`https://annict.com/works/${foundWorkId}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
          });
          if (workRes.ok) {
            const workHtml = await workRes.text();
            const $w = cheerio.load(workHtml);
            const og = $w('meta[property="og:image"]').attr('content') || $w('meta[name="twitter:image"]').attr('content') || '';
            if (og && !og.includes('color-white-') && !og.includes('no-image')) {
              return { url: og, annictId: foundWorkId, source: 'annict_search_hires' };
            }
          }
          if (foundThumb) {
            return { url: foundThumb, annictId: foundWorkId, source: 'annict_search_thumb' };
          }
        }
      }
    } catch (e) {}
  }

  // 3. dアニメストア公式画像フォールバック
  if (danimeWorkId) {
    try {
      const res = await fetch(`https://animestore.docomo.ne.jp/animestore/ci_pc?workId=${danimeWorkId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      if (res.ok) {
        const html = await res.text();
        const $ = cheerio.load(html);
        const og = $('meta[property="og:image"]').attr('content') || '';
        if (og && og.startsWith('http')) {
          return { url: og, annictId: null, source: 'danime_store' };
        }
      }
    } catch (e) {}
  }

  return { url: '', annictId: null, source: 'none' };
}

async function main() {
  console.log('=== 類似アニメ画像 高画質化・Annict補完処理開始 ===');
  if (!fs.existsSync(DATA_FILE)) {
    console.error('similarity-data.json が見つかりません');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const works = data.works || {};

  let cache = {};
  if (fs.existsSync(CACHE_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch (e) {}
  }

  // 優先的に処理する作品:
  // 1. featured（注目作品）とそのTop10
  // 2. 画像が未設定の作品、または既存画像が低解像度の作品
  const targetIds = new Set();
  for (const fid of data.featured || []) {
    targetIds.add(fid);
    const fw = works[fid];
    if (fw && fw.top) {
      for (const [tid] of fw.top) targetIds.add(tid);
    }
  }

  console.log(`▶ 注目作品・最優先対象: ${targetIds.size} 件を強化`);

  let updatedCount = 0;
  for (const wid of targetIds) {
    const w = works[wid];
    if (!w) continue;

    // すでに高画質Annict画像（s:640:853）ならスキップ
    if (w.img && w.img.includes('/s:640:853/')) continue;

    const cacheKey = wid || w.t;
    let resolved = cache[cacheKey];
    if (!resolved || !resolved.url) {
      resolved = await resolveImage(wid, w.t, w.aid);
      cache[cacheKey] = resolved;
    }

    if (resolved && resolved.url) {
      w.img = resolved.url;
      if (resolved.annictId) w.aid = resolved.annictId;
      updatedCount++;
      console.log(`[✔ 更新] ${w.t} -> (${resolved.source}) ${resolved.url.substring(0, 70)}...`);
    }
  }

  // キャッシュ保存
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');

  // similarity-data.json 保存
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log(`✔ 処理完了: ${updatedCount} 件の画像を高画質化・Annict補完しました！`);
}

main();
