'use strict';

const fs = require('fs');
const path = require('path');

const isVercel = !!process.env.VERCEL;
const BUNDLED_CACHE_FILE = path.resolve(__dirname, '../../data/cache/genre_cache.json');
const WRITABLE_CACHE_FILE = isVercel ? '/tmp/genre_cache.json' : BUNDLED_CACHE_FILE;
const ANILIST_GRAPHQL_ENDPOINT = 'https://graphql.anilist.co';
const BATCH_SIZE = 25;
const REQUEST_DELAY_MS = isVercel ? 200 : 600; // Vercel では制限時間内に終わるようインターバルを短縮
const DEFAULT_TIME_BUDGET_MS = isVercel ? 32000 : 300000; // Vercelは60秒制限があるためジャンル取得に最大32秒を割り当て

// dアニメストア参考の15カテゴリジャンル定義
const GENRE_DEFINITIONS = [
  { id: 'isekai',          label: '異世界・転生',            labelEn: 'Isekai',             icon: 'fa-solid fa-door-open',           color: '#8b5cf6' },
  { id: 'sf_fantasy',      label: 'SF / ファンタジー',       labelEn: 'Sci-Fi / Fantasy',   icon: 'fa-solid fa-wand-magic-sparkles', color: '#6366f1' },
  { id: 'mecha',           label: 'ロボット / メカ',         labelEn: 'Mecha',              icon: 'fa-solid fa-robot',               color: '#6b7280' },
  { id: 'action',          label: 'アクション / バトル',     labelEn: 'Action / Battle',    icon: 'fa-solid fa-burst',               color: '#ef4444' },
  { id: 'comedy',          label: 'コメディ / ギャグ',       labelEn: 'Comedy / Gag',       icon: 'fa-solid fa-face-laugh-squint',   color: '#f59e0b' },
  { id: 'romance',         label: '恋愛 / ラブコメ',         labelEn: 'Romance / RomCom',   icon: 'fa-solid fa-heart',               color: '#ec4899' },
  { id: 'nichijou',        label: '日常 / ほのぼの',         labelEn: 'Slice of Life',      icon: 'fa-solid fa-mug-saucer',          color: '#10b981' },
  { id: 'sports',          label: 'スポーツ / 競技',         labelEn: 'Sports',             icon: 'fa-solid fa-futbol',              color: '#14b8a6' },
  { id: 'horror_suspense', label: 'ホラー / サスペンス / 推理', labelEn: 'Suspense & Mystery', icon: 'fa-solid fa-skull',          color: '#475569' },
  { id: 'history',         label: '歴史 / 戦記',             labelEn: 'Historical',         icon: 'fa-solid fa-landmark',            color: '#a16207' },
  { id: 'military',        label: '戦争 / ミリタリー',       labelEn: 'Military / War',     icon: 'fa-solid fa-shield-halved',       color: '#64748b' },
  { id: 'drama',           label: 'ドラマ / 青春',           labelEn: 'Drama / Youth',      icon: 'fa-solid fa-masks-theater',       color: '#3b82f6' },
  { id: 'idol_music',      label: 'アイドル / 音楽',         labelEn: 'Idol / Music',       icon: 'fa-solid fa-music',               color: '#eab308' },
  { id: 'ecchi',           label: 'エッチ / お色気',         labelEn: 'Ecchi',              icon: 'fa-solid fa-fire',                color: '#f43f5e' },
  { id: 'other',           label: 'その他',                  labelEn: 'Other',              icon: 'fa-solid fa-ellipsis',            color: '#9ca3af' }
];

/**
 * AniListのgenres + tags + タイトルから15カテゴリに分類する
 * 各作品は最も適合するカテゴリ1つに割り当てられる（重複なし）
 * @param {string[]} genres - AniListジャンル配列
 * @param {{name: string, rank: number}[]} tags - AniListタグ配列
 * @param {string} title - アニメタイトル（補正・フォールバック用）
 * @returns {string} カテゴリID
 */
function classifyAnime(genres = [], tags = [], title = '') {
  const g = new Set(genres);
  const tagNames = new Set(tags.filter(t => (t.rank || 0) >= 60).map(t => t.name));
  const allTagNames = new Set(tags.map(t => t.name));
  const t = title || '';

  // 優先度順に判定（先にマッチしたものが採用される）

  // 1. エッチ / お色気 — Ecchiジャンルは最優先（他ジャンルと重なっても特徴が際立つため）
  if (g.has('Ecchi')) return 'ecchi';

  // 2. 異世界・転生 (タグ または タイトルキーワード)
  const isIsekaiTag = allTagNames.has('Isekai') || allTagNames.has('Reverse Isekai') || allTagNames.has('Villainess');
  const isIsekaiTitle = /(?:異世界|転生|転移|悪役令嬢|追放され|魔王様|勇者(?:パーティー)?|スライム.*件|チート|治癒魔法|無職転生|陰の実力者|ダンジョンに出会いを|オーバーロード|この素晴らしい世界に祝福を|Re:ゼロ|盾の勇者|本好きの下剋上|賢者の弟子)/i.test(t);
  if (isIsekaiTag || isIsekaiTitle) return 'isekai';

  // 3. ロボット / メカ
  const isMechaTag = g.has('Mecha') || tagNames.has('Real Robot') || tagNames.has('Super Robot');
  const isMechaTitle = /(?:ガンダム|エヴァンゲリオン|ヱヴァンゲリヲン|マクロス|コードギアス|パトレイバー|ダイナゼノン|グリッドマン|アクエリオン|マジンガー|ゲッターロボ|フルメタル・パニック)/i.test(t);
  if (isMechaTag || isMechaTitle) return 'mecha';

  // 4. アイドル / 音楽
  const isMusicTag = g.has('Music') || allTagNames.has('Idol') || tagNames.has('Band') || tagNames.has('Musical Theater');
  const isMusicTitle = /(?:アイドルマスター|シンデレラガールズ|ミリオンライブ|シャイニーカラーズ|ラブライブ|バンドリ|BanG Dream|ぼっち・ざ・ろっく|D4DJ|アイカツ|プリパラ|ゾンビランドサガ|ヒプノシスマイク|マクロス)/i.test(t);
  if (isMusicTag || isMusicTitle) return 'idol_music';

  // 5. スポーツ / 競技
  if (g.has('Sports')) return 'sports';

  // 6. 戦争 / ミリタリー
  const isMilTag = tagNames.has('Military') || tagNames.has('War') || allTagNames.has('Tanks') || allTagNames.has('Aviation');
  const isMilTitle = /(?:ガールズ＆パンツァー|ストライクウィッチーズ|幼女戦記|GATE 自衛隊|アズールレーン|艦隊これくしょん|艦これ|ハイスクール・フリート)/i.test(t);
  if (isMilTag || isMilTitle) return 'military';

  // 7. 歴史 / 戦記
  const isHistTag = tagNames.has('Historical') || tagNames.has('Medieval') || allTagNames.has('Ancient China') || allTagNames.has('Samurai');
  const isHistTitle = /(?:キングダム|ヴィンランド・サガ|平家物語|るろうに剣心|ゴールデンカムイ|銀魂|薄桜鬼|信長|ドリフターズ)/i.test(t);
  if (isHistTag || isHistTitle) return 'history';

  // 8. ホラー / サスペンス / 推理
  if (g.has('Horror') || g.has('Thriller') || g.has('Mystery') || g.has('Psychological')) return 'horror_suspense';

  // 9. SF / ファンタジー（異世界以外）
  if (g.has('Sci-Fi') || (g.has('Fantasy') && !g.has('Slice of Life'))) return 'sf_fantasy';

  // 10. 恋愛 / ラブコメ
  if (g.has('Romance')) return 'romance';

  // 11. 日常 / ほのぼの
  const isSliceTag = g.has('Slice of Life') || tagNames.has('Iyashikei') || tagNames.has('Cute Girls Doing Cute Things') || tagNames.has('Cute Boys Doing Cute Things');
  const isSliceTitle = /(?:ゆるキャン|のんのんびより|ごちうさ|ご注文はうさぎですか|きんいろモザイク|NEW GAME|日常|みなみけ|らき☆すた)/i.test(t);
  if (isSliceTag || isSliceTitle) return 'nichijou';

  // 12. アクション / バトル
  if (g.has('Action') || g.has('Adventure')) return 'action';

  // 13. ドラマ / 青春
  if (g.has('Drama') || tagNames.has('Coming of Age') || tagNames.has('School')) return 'drama';

  // 14. コメディ / ギャグ（他ジャンルに該当しない純コメディ）
  if (g.has('Comedy')) return 'comedy';

  // 15. その他
  return 'other';
}

class GenreClient {
  constructor() {
    this.cache = this.loadCache();
    this.lastRemainingCount = 0;
  }

  /**
   * キャッシュ読み込み（旧形式: string[] / 新形式: {genres, tags} の両方に対応）
   */
  loadCache() {
    const valid = {};

    const loadFrom = (filePath) => {
      try {
        if (fs.existsSync(filePath)) {
          const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          for (const [k, v] of Object.entries(raw)) {
            if (Array.isArray(v)) {
              // 旧形式: genres配列のみ → 新形式に変換（tags未取得として扱う）
              valid[k] = { genres: v, tags: null };
            } else if (v && typeof v === 'object' && Array.isArray(v.genres)) {
              // 新形式: { genres, tags }
              valid[k] = v;
            }
          }
        }
      } catch (e) {}
    };

    // 1. 同梱のジャンルキャッシュを読み込み
    loadFrom(BUNDLED_CACHE_FILE);
    // 2. /tmp などの書き込み先キャッシュがあれば最新差分を上書き
    if (WRITABLE_CACHE_FILE !== BUNDLED_CACHE_FILE) {
      loadFrom(WRITABLE_CACHE_FILE);
    }

    return valid;
  }

  saveCache() {
    try {
      const dir = path.dirname(WRITABLE_CACHE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(WRITABLE_CACHE_FILE, JSON.stringify(this.cache, null, 2), 'utf8');
    } catch (e) {
      console.warn(`[GenreClient] キャッシュ保存失敗: ${e.message}`);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * タイトルのクレンジング（検索ヒット率向上のための正規化）
   */
  normalizeTitle(title, stage = 1) {
    if (!title) return '';
    let cleaned = title;

    // 全角英数を半角に変換
    cleaned = cleaned.replace(/[！-～]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
    // 括弧類とその中身の除去
    cleaned = cleaned.replace(/\s*[\(（][^\)）]+[\)）]/g, '');
    cleaned = cleaned.replace(/\s*\[[^\]]+\]/g, '');

    // 第1段階: シーズン・期数・映画表記の除去
    cleaned = cleaned
      .replace(/\s*(?:Season\s*\d+|第\d+期|第\d+クール|\d+(?:st|nd|rd|th)\s*Season|The\s*Final\s*Season|[1-9Ⅰ-Ⅹ]+).*$/i, '')
      .replace(/^(?:劇場版|映画|アニメ)\s*/i, '')
      .trim();

    // 第2段階: サブタイトル（～...～ や : ...）の除去
    if (stage >= 2) {
      cleaned = cleaned.replace(/\s*～[^～]+～/g, '');
      cleaned = cleaned.replace(/\s*:[^:]+$/g, '');
      cleaned = cleaned.replace(/\s*-.+$/g, '');
      cleaned = cleaned.trim();
    }

    return cleaned || title;
  }

  /**
   * バッチ単位で GraphQL (Pageクエリ) を実行（レートリミット時は自動指数バックオフで再試行）
   */
  async fetchBatchWithRetry(batchTitles, maxRetries = 3) {
    const fields = batchTitles.map((t, idx) => `
      m${idx}: Page(page: 1, perPage: 1) {
        media(search: ${JSON.stringify(t)}, type: ANIME) {
          id
          title { native romaji english }
          genres
          tags { name rank isMediaSpoiler }
        }
      }
    `).join('\n');

    const query = `query {\n${fields}\n}`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(ANILIST_GRAPHQL_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ query })
        });

        if (res.status === 429) {
          const waitTime = isVercel ? 1500 : attempt * 2500;
          console.warn(`\n[GenreClient] レートリミット検知 (試行 ${attempt}/${maxRetries})。${waitTime / 1000}秒待機して再試行します...`);
          await this.sleep(waitTime);
          continue;
        }

        if (!res.ok) {
          console.warn(`[GenreClient] HTTPエラー ${res.status}: ${res.statusText}`);
          return {};
        }

        const json = await res.json();
        return json.data || {};
      } catch (err) {
        console.warn(`[GenreClient] 通信エラー: ${err.message}`);
        await this.sleep(1000);
      }
    }

    return {};
  }

  /**
   * 全タイトルのジャンル・タグを高精度に解決して返す
   * @param {string[]} titles 
   * @param {Function} onProgress 
   * @param {number} timeBudgetMs 
   */
  async resolveGenres(titles, onProgress = null, timeBudgetMs = DEFAULT_TIME_BUDGET_MS) {
    const startTime = Date.now();
    const uniqueTitles = Array.from(new Set(titles.filter(t => typeof t === 'string' && t.trim().length > 0)));
    // キャッシュ未登録 OR 旧形式(tags未取得)の作品を再取得対象にする
    const missingTitles = uniqueTitles.filter(t => {
      if (!(t in this.cache)) return true;
      const entry = this.cache[t];
      // 旧形式で tags が null、かつ genres が空でないものは再取得（タグ情報を補完）
      if (entry.tags === null && entry.genres.length > 0) return true;
      return false;
    });
    this.lastRemainingCount = 0;

    if (missingTitles.length > 0) {
      console.log(`[GenreClient] 未取得のアニメジャンル・タグを照合中 (${missingTitles.length} / ${uniqueTitles.length} 作品)...`);

      let totalSuccess = 0;
      const fallbackWait = isVercel ? 150 : 350;

      for (let i = 0; i < missingTitles.length; i += BATCH_SIZE) {
        // タイムバジェット（制限時間）チェック：Vercelの60秒タイムアウトを防ぐ
        if (Date.now() - startTime > timeBudgetMs) {
          this.lastRemainingCount = missingTitles.length - i;
          console.warn(`\n[GenreClient] 制限時間 (${timeBudgetMs}ms) に達したため、残り ${this.lastRemainingCount} 作品は次回のリクエストに分割します。`);
          break;
        }

        const batch = missingTitles.slice(i, i + BATCH_SIZE);
        const data = await this.fetchBatchWithRetry(batch);

        const unhitTitles = [];
        batch.forEach((origTitle, idx) => {
          const media = data[`m${idx}`]?.media?.[0];
          if (media && Array.isArray(media.genres) && media.genres.length > 0) {
            this.cache[origTitle] = this._extractCacheEntry(media);
            totalSuccess++;
          } else {
            unhitTitles.push(origTitle);
          }
        });

        // 未ヒットの作品があれば、正規化してフォールバック検索（時間に余裕がある場合）
        if (unhitTitles.length > 0 && (Date.now() - startTime <= timeBudgetMs)) {
          await this.sleep(fallbackWait);
          const normalizedBatch = unhitTitles.map(t => this.normalizeTitle(t, 1));
          const fallbackData = await this.fetchBatchWithRetry(normalizedBatch);

          const stillUnhit = [];
          unhitTitles.forEach((origTitle, idx) => {
            const media = fallbackData[`m${idx}`]?.media?.[0];
            if (media && Array.isArray(media.genres) && media.genres.length > 0) {
              this.cache[origTitle] = this._extractCacheEntry(media);
              totalSuccess++;
            } else {
              stillUnhit.push(origTitle);
            }
          });

          // さらに第2段階の正規化（サブタイトル除去）で検索
          if (stillUnhit.length > 0 && (Date.now() - startTime <= timeBudgetMs)) {
            await this.sleep(fallbackWait);
            const subNormalizedBatch = stillUnhit.map(t => this.normalizeTitle(t, 2));
            const subFallbackData = await this.fetchBatchWithRetry(subNormalizedBatch);

            stillUnhit.forEach((origTitle, idx) => {
              const media = subFallbackData[`m${idx}`]?.media?.[0];
              if (media && Array.isArray(media.genres) && media.genres.length > 0) {
                this.cache[origTitle] = this._extractCacheEntry(media);
                totalSuccess++;
              } else {
                // ここまでやっても見つからない作品は空としてキャッシュ（次回以降の無駄な再検索を防止）
                this.cache[origTitle] = { genres: [], tags: [] };
              }
            });
          }
        }

        // キャッシュの中間保存
        this.saveCache();

        const currentCount = Math.min(i + BATCH_SIZE, missingTitles.length);
        if (onProgress) {
          onProgress(currentCount, missingTitles.length);
        }
        process.stdout.write(`\r[GenreClient] 照合進捗: ${currentCount}/${missingTitles.length} 作品完了 (照合成功: ${totalSuccess}作)`);

        if (i + BATCH_SIZE < missingTitles.length) {
          await this.sleep(REQUEST_DELAY_MS);
        }
      }
      console.log(`\n[GenreClient] アニメジャンル・タグの照合・キャッシュ保存が完了しました。(照合成功: ${totalSuccess}作, 残り: ${this.lastRemainingCount}作)`);
    }

    // 解決済みマップを返す（新形式: { genres, tags, category }）
    const resultMap = {};
    for (const title of uniqueTitles) {
      const entry = this.cache[title] || { genres: [], tags: [] };
      const genres = entry.genres || [];
      const tags = entry.tags || [];
      resultMap[title] = {
        genres,
        tags,
        category: classifyAnime(genres, tags, title)
      };
    }
    return resultMap;
  }

  /**
   * メディアデータからキャッシュエントリを抽出
   */
  _extractCacheEntry(media) {
    const genres = media.genres || [];
    // ネタバレタグを除外し、name と rank のみ保存（キャッシュサイズ節約）
    const tags = (media.tags || [])
      .filter(t => !t.isMediaSpoiler)
      .map(t => ({ name: t.name, rank: t.rank }));
    return { genres, tags };
  }
}

module.exports = {
  GenreClient,
  GENRE_DEFINITIONS,
  classifyAnime
};
