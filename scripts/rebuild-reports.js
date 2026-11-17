'use strict';

const fs = require('fs');
const path = require('path');
const { buildBootstrapPayload } = require('./build-bootstrap.js');
const { buildWorkGenres } = require('./build-work-genres.js');

async function main() {
  console.log('=== 超軽量ブートストラップ & ジャンル辞書の再ビルド開始 ===');
  const cacheDir = path.resolve(__dirname, '../data/cache');
  const resDir = path.resolve(__dirname, '../static/res');
  const usersConfigPath = path.resolve(__dirname, '../config/users.json');

  let usersOrder = [];
  if (fs.existsSync(usersConfigPath)) {
    try {
      usersOrder = JSON.parse(fs.readFileSync(usersConfigPath, 'utf8'));
    } catch (e) {}
  }

  const userFiles = fs.readdirSync(cacheDir).filter(
    f => f.endsWith('.json') && !f.includes('genre') && !f.includes('image') && !f.includes('hires')
  );
  const userWatchedLists = {};
  const lowerKeyMap = new Map();

  for (const f of userFiles) {
    try {
      const u = JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf8'));
      if (u.username && Array.isArray(u.animes)) {
        userWatchedLists[u.username] = u.animes;
        lowerKeyMap.set(u.username.toLowerCase(), u.username);
      }
    } catch (e) {}
  }

  const finalUsers = usersOrder.length > 0
    ? usersOrder.filter(u => lowerKeyMap.has(String(u).toLowerCase()))
    : Object.keys(userWatchedLists);

  console.log(`対象ユーザー (${finalUsers.length}名):`, finalUsers.join(', '));

  const bootstrapPayload = buildBootstrapPayload(userWatchedLists, finalUsers);
  const bootstrapFile = path.join(resDir, 'bootstrap.json');
  fs.mkdirSync(resDir, { recursive: true });
  fs.writeFileSync(bootstrapFile, JSON.stringify(bootstrapPayload), 'utf8');
  console.log(`bootstrap.json を更新しました (${Math.round(fs.statSync(bootstrapFile).size / 1024)} KB)`);

  buildWorkGenres();
  console.log('=== 再ビルド完了 ===');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
