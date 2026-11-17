#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const IMG_PREFIX = 'https://image.annict.com/';

function shortenImg(url) {
  if (!url || url.includes('no-image') || url.includes('color-white-')) return '';
  return url.startsWith(IMG_PREFIX) ? url.slice(IMG_PREFIX.length) : url;
}

/**
 * 視聴リスト群から超軽量正規化ブートストラップペイロードを生成
 * 大文字小文字を無視してユーザーリストと視聴データを確実にマッピングする
 */
function buildBootstrapPayload(userWatchedLists = {}, usersOrder = null) {
  const lowerKeyMap = new Map();
  for (const k of Object.keys(userWatchedLists)) {
    lowerKeyMap.set(k.toLowerCase(), k);
  }

  const users = Array.isArray(usersOrder) && usersOrder.length > 0
    ? usersOrder.filter(u => lowerKeyMap.has(String(u).toLowerCase()))
    : Object.keys(userWatchedLists);

  const works = {};
  const userWorkIds = {};

  for (const username of users) {
    const actualKey = lowerKeyMap.get(String(username).toLowerCase());
    const list = (actualKey ? userWatchedLists[actualKey] : userWatchedLists[username]) || [];
    const ids = [];
    const seen = new Set();

    for (const a of list) {
      if (!a || a.id === undefined || a.id === null) continue;
      const id = String(a.id);
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
      const ep = a.episodesCount ? Number(a.episodesCount) : 0;
      const media = a.media ? String(a.media) : '';
      if (!works[id]) {
        const tuple = [a.title || '', a.season || '', shortenImg(a.image || '')];
        if (ep || media) {
          tuple.push(ep);
          if (media) tuple.push(media);
        }
        works[id] = tuple;
      } else {
        if (!works[id][1] && a.season) works[id][1] = a.season;
        if (!works[id][2] && a.image) works[id][2] = shortenImg(a.image);
        if (ep && !works[id][3]) works[id][3] = ep;
        if (media && !works[id][4]) {
          if (works[id][3] === undefined) works[id][3] = 0;
          works[id][4] = media;
        }
      }
    }

    userWorkIds[username] = ids;
  }

  return {
    version: 3,
    generatedAt: new Date().toISOString(),
    users,
    works,
    userWorkIds
  };
}

function buildFromCacheFiles() {
  const cacheDir = path.join(ROOT_DIR, 'data/cache');
  const usersConfigPath = path.join(ROOT_DIR, 'config/users.json');
  const outPath = path.join(ROOT_DIR, 'static/res/bootstrap.json');

  let configuredUsers = [];
  if (fs.existsSync(usersConfigPath)) {
    try {
      configuredUsers = JSON.parse(fs.readFileSync(usersConfigPath, 'utf8'));
    } catch (e) {}
  }

  const userWatchedLists = {};
  for (const u of configuredUsers) {
    const cacheFile = path.join(cacheDir, `${u.toLowerCase()}.json`);
    if (fs.existsSync(cacheFile)) {
      try {
        const d = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (Array.isArray(d.animes)) {
          userWatchedLists[u] = d.animes;
        }
      } catch (e) {}
    }
  }

  const payload = buildBootstrapPayload(userWatchedLists, configuredUsers);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload), 'utf8');
  const sizeKb = Math.round(fs.statSync(outPath).size / 1024);
  console.log(`[BuildBootstrap] static/res/bootstrap.json 生成完了: ${payload.users.length}人 / ${Object.keys(payload.works).length}ユニーク作品 (${sizeKb} KB)`);
  return payload;
}

if (require.main === module) {
  buildFromCacheFiles();
}

module.exports = { buildBootstrapPayload, buildFromCacheFiles };
