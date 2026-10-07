'use strict';

/**
 * similarity-data.json の各作品に対して、Annictの公式縦長キービジュアル（s:640:853）
 * のみを厳選・補完・高画質化するバッチスクリプト。
 * ※ 縦長のキービジュアルに統一するため、横長画像は一切除外します。
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const DATA_FILE = path.resolve(__dirname, '../static/res/similarity-data.json');
const CACHE_FILE = path.resolve(__dirname, '../data/cache/similarity_hires_cache.json');

function generateSearchQueries(title) {
  const queries = [];
  if (!title) return queries;
  
  // NFKCで全角英数記号を半角に正規化
  const nfkc = title.normalize('NFKC').trim();
  queries.push(nfkc);
  if (title !== nfkc) queries.push(title);

  // 1. 括弧や記号の除去
  const clean = nfkc
    .replace(/「|」|『|』|【|】|\(|\)|（|）/g, ' ')
    .replace(/第[0-9０-９一二三四五六七八九十]+期/g, ' ')
    .replace(/Season\s*[0-9]+/gi, ' ')
    .replace(/TV版|配信限定.*|OAD|OVA/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean && !queries.includes(clean)) queries.push(clean);

  // 2. 読点・句読点・記号の除去
  const noPunct = clean.replace(/[、。，．・:：!！?？~～\-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (noPunct && !queries.includes(noPunct)) queries.push(noPunct);

  // 3. サブタイトル分割
  const parts = noPunct.split(' ');
  if (parts.length > 1 && parts[0].length >= 2 && !queries.includes(parts[0])) {
    queries.push(parts[0]);
  }

  return queries;
}

async function resolveAnnictVerticalPoster(danimeWorkId, title, annictId) {
  // 1. Annict ID既知の場合 -> 高解像度縦長OGP (s:640:853)
  if (annictId && /^\d+$/.test(annictId)) {
    try {
      const res = await fetch(`https://annict.com/works/${annictId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      if (res.ok) {
        const html = await res.text();
        const $ = cheerio.load(html);
        const og = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || '';
        if (og && og.includes('image.annict.com') && !og.includes('color-white-') && !og.includes('no-image')) {
          return { url: og, annictId, source: 'annict_hires' };
        }
      }
    } catch (e) {}
  }

  // 2. Annict多段階検索（縦長キービジュアルのみ）
  const queries = generateSearchQueries(title);
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
          const match = href.match(/^\/works\/(\d+)$/);
          if (match && !foundWorkId) {
            foundWorkId = match[1];
            foundThumb = $(el).find('img').attr('src');
          }
        });

        if (foundWorkId) {
          const workRes = await fetch(`https://annict.com/works/${foundWorkId}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
          });
          if (workRes.ok) {
            const workHtml = await workRes.text();
            const $w = cheerio.load(workHtml);
            const og = $w('meta[property="og:image"]').attr('content') || $w('meta[name="twitter:image"]').attr('content') || '';
            if (og && og.includes('image.annict.com') && !og.includes('color-white-') && !og.includes('no-image')) {
              return { url: og, annictId: foundWorkId, source: 'annict_search_hires' };
            }
          }
          if (foundThumb && foundThumb.includes('image.annict.com')) {
            return { url: foundThumb, annictId: foundWorkId, source: 'annict_search_thumb' };
          }
        }
      }
    } catch (e) {}
  }

  return { url: '', annictId: null, source: 'none' };
}

async function main() {
  console.log('=== Annict縦長キービジュアル統一・補完処理開始 ===');
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

  // 1. キャッシュおよびデータから横長dアニメ画像（animestore）をクリーンアップ
  let purgedCount = 0;
  for (const [k, v] of Object.entries(cache)) {
    if (v.url && v.url.includes('animestore.docomo.ne.jp')) {
      delete cache[k];
      purgedCount++;
    }
  }
  for (const w of Object.values(works)) {
    if (w.img && w.img.includes('animestore.docomo.ne.jp')) {
      w.img = null;
    }
  }
  console.log(`🧹 横長dアニメ画像をキャッシュから ${purgedCount} 件削除しました`);

  // 2. 注目作品とそのTop10を対象にAnnict縦長ポスターを取得
  const targetIds = new Set();
  for (const fid of data.featured || []) {
    targetIds.add(fid);
    const fw = works[fid];
    if (fw && fw.top) {
      for (const [tid] of fw.top) targetIds.add(tid);
    }
  }

  console.log(`▶ 注目作品・最優先対象: ${targetIds.size} 件の縦長ポスターを検証・更新`);

  let updatedCount = 0;
  for (const wid of targetIds) {
    const w = works[wid];
    if (!w) continue;

    // すでにAnnict高解像度ポスター（s:640:853）ならスキップ
    if (w.img && w.img.includes('image.annict.com') && w.img.includes('/s:640:853/')) continue;

    const cacheKey = wid || w.t;
    let resolved = cache[cacheKey];
    if (!resolved || !resolved.url || !resolved.url.includes('image.annict.com')) {
      resolved = await resolveAnnictVerticalPoster(wid, w.t, w.aid);
      cache[cacheKey] = resolved;
    }

    if (resolved && resolved.url && resolved.url.includes('image.annict.com')) {
      w.img = resolved.url;
      if (resolved.annictId) w.aid = resolved.annictId;
      updatedCount++;
      console.log(`[✔ 縦長ポスター適用] ${w.t} -> ${resolved.url.substring(0, 65)}...`);
    }
  }

  // キャッシュ保存
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');

  // similarity-data.json 保存
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  console.log(`✔ 処理完了: ${updatedCount} 件のAnnict縦長キービジュアルを適用しました！`);
}

main();
