'use strict';

const fs = require('fs');
const path = require('path');
const { classifyAnimeScored } = require('../lib/labs/genre-scorer.js');

const cachePath = path.join(__dirname, '../data/cache/genre_cache.json');
if (!fs.existsSync(cachePath)) {
  console.error('genre_cache.json not found at:', cachePath);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
const compact = {};
let count = 0;

for (const [title, entry] of Object.entries(raw)) {
  const genres = entry.genres || [];
  const tags = entry.tags || [];
  compact[title] = {
    c: classifyAnimeScored(genres, tags, title),
    g: genres
  };
  count++;
}

const outDir = path.join(__dirname, '../static/res');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const outPath = path.join(outDir, 'work-genres.json');
fs.writeFileSync(outPath, JSON.stringify(compact));
const sizeKb = Math.round(fs.statSync(outPath).size / 1024);

console.log(`[Success] static/res/work-genres.json created: ${count} works (${sizeKb} KB)`);
