'use strict';

const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000;

function isAnnictImageHost(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const u = new URL(rawUrl);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname === 'image.annict.com';
  } catch (e) {
    return false;
  }
}

function generateSimSearchQueries(t) {
  const queries = [];
  if (!t) return queries;
  const nfkc = t.normalize('NFKC').trim();
  queries.push(nfkc);
  if (t !== nfkc) queries.push(t);
  const clean = nfkc
    .replace(/「|」|『|』|【|】|\(|\)|（|）/g, ' ')
    .replace(/第[0-9０-９一二三四五六七八九十]+期/g, ' ')
    .replace(/Season\s*[0-9]+/gi, ' ')
    .replace(/TV版|配信限定.*|OAD|OVA/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean && !queries.includes(clean)) queries.push(clean);
  const noPunct = clean.replace(/[、。，．・:：!！?？~～\-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (noPunct && !queries.includes(noPunct)) queries.push(noPunct);
  const parts = noPunct.split(' ');
  if (parts.length > 1 && parts[0].length >= 2 && !queries.includes(parts[0])) {
    queries.push(parts[0]);
  }
  return queries;
}

async function fetchAnnictOgImage(workId) {
  const res = await fetch(`https://annict.com/works/${encodeURIComponent(workId)}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) return '';
  const html = await res.text();
  const $ = cheerio.load(html);
  const og = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || '';
  if (og && !og.includes('color-white-') && !og.includes('no-image') && isAnnictImageHost(og)) return og;
  return '';
}

async function resolveSimilarityImage({ workId, title, annictId }, cache) {
  const cacheKey = workId || title;
  const cached = cache.get(cacheKey);
  if (cached && cached.url && isAnnictImageHost(cached.url)) {
    return cached;
  }
  if (cached && cached.source === 'none' && cached.cachedAt && (Date.now() - cached.cachedAt) < NEGATIVE_CACHE_TTL_MS) {
    return cached;
  }

  try {
    if (annictId && /^\d+$/.test(annictId)) {
      try {
        const ogImage = await fetchAnnictOgImage(annictId);
        if (isAnnictImageHost(ogImage)) {
          const result = { workId, title, annictId, url: ogImage, source: 'annict_hires' };
          cache.set(cacheKey, result);
          return result;
        }
      } catch (_) {}
    }

    if (title) {
      const queries = generateSimSearchQueries(title);
      for (const q of queries) {
        const searchRes = await fetch(`https://annict.com/search?q=${encodeURIComponent(q)}`, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(10000)
        });
        if (!searchRes.ok) continue;
        const html = await searchRes.text();
        const $ = cheerio.load(html);
        let foundWorkId = null;
        let foundImg = null;

        $('a').each((_, el) => {
          const href = $(el).attr('href') || '';
          const match = href.match(/^\/works\/(\d+)$/);
          if (match && !foundWorkId) {
            foundWorkId = match[1];
            foundImg = $(el).find('img').attr('src');
          }
        });

        if (foundWorkId) {
          const ogImage = await fetchAnnictOgImage(foundWorkId);
          if (isAnnictImageHost(ogImage)) {
            const result = { workId, title, annictId: foundWorkId, url: ogImage, source: 'annict_search_hires' };
            cache.set(cacheKey, result);
            return result;
          }
          if (isAnnictImageHost(foundImg) && !foundImg.includes('no-image')) {
            const result = { workId, title, annictId: foundWorkId, url: foundImg, source: 'annict_search_thumb' };
            cache.set(cacheKey, result);
            return result;
          }
        }
      }
    }

    const emptyResult = { workId, title, annictId: null, url: '', source: 'none', cachedAt: Date.now() };
    cache.set(cacheKey, emptyResult, false);
    return emptyResult;
  } catch (err) {
    return { workId, title, annictId: null, url: '', source: 'error' };
  }
}

module.exports = { fetchAnnictOgImage, resolveSimilarityImage };
