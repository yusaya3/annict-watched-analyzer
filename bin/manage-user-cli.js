#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const USERS_FILE = path.resolve(__dirname, '../config/users.json');

function main() {
  const action = process.argv[2]; // 'add', 'remove', 'list'
  const username = (process.argv[3] || '').trim().replace(/^@/, '');

  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2), 'utf8');
  }

  let users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));

  if (action === 'add') {
    if (!username) {
      console.error('エラー: 追加するユーザー名を指定してください');
      process.exit(1);
    }
    if (!users.includes(username)) {
      users.push(username);
      fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
      console.log(`[OK] ユーザー @${username} を追加しました`);
    } else {
      console.log(`[INFO] ユーザー @${username} は既に登録されています`);
    }
  } else if (action === 'remove') {
    if (!username) {
      console.error('エラー: 削除するユーザー名を指定してください');
      process.exit(1);
    }
    users = users.filter(u => u.toLowerCase() !== username.toLowerCase());
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
    console.log(`[OK] ユーザー @${username} を削除しました`);
  } else if (action === 'list') {
    console.log('登録中ユーザー一覧:');
    users.forEach(u => console.log(`- @${u}`));
  } else {
    console.log('使用法: node bin/manage-user-cli.js [add|remove|list] [username]');
  }
}

main();
