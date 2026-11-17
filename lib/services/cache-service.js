'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 上限サイズ付きメモリキャッシュ ＋ 非同期直列デバウンス書き込み
 */
class PersistentMapCache {
  constructor(filePath, maxEntries = 2500, debounceMs = 1500) {
    this.filePath = filePath;
    this.maxEntries = maxEntries;
    this.debounceMs = debounceMs;
    this.map = new Map();
    this._timer = null;
    this._writeQueue = Promise.resolve();
    this._loadSync();
  }

  _loadSync() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        const entries = Object.entries(raw || {});
        const start = Math.max(0, entries.length - this.maxEntries);
        for (let i = start; i < entries.length; i++) {
          this.map.set(entries[i][0], entries[i][1]);
        }
      }
    } catch (e) {}
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const val = this.map.get(key);
    // LRU更新
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  set(key, value, persist = true) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
    if (persist) this._scheduleWrite();
  }

  _scheduleWrite() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flush().catch(() => {});
    }, this.debounceMs);
    if (typeof this._timer.unref === 'function') {
      this._timer.unref();
    }
  }

  flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    const obj = Object.fromEntries(this.map.entries());
    const content = JSON.stringify(obj, null, 2);
    this._writeQueue = this._writeQueue.then(async () => {
      try {
        await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.promises.writeFile(this.filePath, content, 'utf8');
      } catch (e) {}
    });
    return this._writeQueue;
  }
}

module.exports = { PersistentMapCache };
