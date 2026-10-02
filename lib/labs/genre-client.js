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

// 重複ジャンルを統合した14カテゴリジャンル定義（歴史+ミリタリー統合、恋愛+ドラマ青春統合）
const GENRE_DEFINITIONS = [
  { id: 'isekai',           label: '異世界 / 転生',             labelEn: 'Isekai',             icon: 'fa-solid fa-door-open',           color: '#8b5cf6' },
  { id: 'mahou_shoujo',     label: '魔法少女 / バトルヒロイン',  labelEn: 'Magical Girl / Battle Heroine', icon: 'fa-solid fa-wand-magic-sparkles', color: '#fb7185' },
  { id: 'mecha',            label: 'ロボット / メカ',          labelEn: 'Mecha',              icon: 'fa-solid fa-robot',               color: '#6b7280' },
  { id: 'action',           label: 'アクション / バトル',      labelEn: 'Action / Battle',    icon: 'fa-solid fa-burst',               color: '#ef4444' },
  { id: 'sports',           label: 'スポーツ / 競技',          labelEn: 'Sports',             icon: 'fa-solid fa-futbol',              color: '#14b8a6' },
  { id: 'comedy',           label: 'コメディ / ギャグ',        labelEn: 'Comedy / Gag',       icon: 'fa-solid fa-face-laugh-squint',   color: '#f59e0b' },
  { id: 'romance_drama',    label: '恋愛 / ラブコメ / 青春ドラマ', labelEn: 'Romance & Drama',    icon: 'fa-solid fa-heart',               color: '#ec4899' },
  { id: 'nichijou',         label: '日常 / ほのぼの',          labelEn: 'Slice of Life',      icon: 'fa-solid fa-mug-saucer',          color: '#10b981' },
  { id: 'sf_fantasy',       label: 'SF / ファンタジー',        labelEn: 'Sci-Fi / Fantasy',   icon: 'fa-solid fa-meteor',              color: '#6366f1' },
  { id: 'horror_suspense',  label: 'ホラー / サスペンス / 推理', labelEn: 'Suspense & Mystery', icon: 'fa-solid fa-skull',          color: '#475569' },
  { id: 'history_military', label: '歴史 / 戦記 / ミリタリー', labelEn: 'Historical & Military', icon: 'fa-solid fa-shield-halved', color: '#64748b' },
  { id: 'idol_music',       label: 'アイドル / 音楽',          labelEn: 'Idol / Music',       icon: 'fa-solid fa-music',               color: '#eab308' },
  { id: 'ecchi',            label: 'エッチ / お色気',          labelEn: 'Ecchi',              icon: 'fa-solid fa-fire',                color: '#f43f5e' },
  { id: 'other',            label: 'その他',                   labelEn: 'Other',              icon: 'fa-solid fa-ellipsis',            color: '#9ca3af' }
];

/**
 * AniListのgenres + tags + タイトルから14カテゴリに高精度にバランス良く分類する
 * 各作品は最も本質的なカテゴリ1つに割り当てられる（重複なし）
 * @param {string[]} genres - AniListジャンル配列
 * @param {{name: string, rank: number}[]} tags - AniListタグ配列
 * @param {string} title - アニメタイトル（補正・フォールバック用）
 * @returns {string} カテゴリID
 */
function classifyAnime(genres = [], tags = [], title = '') {
  const g = new Set(genres);
  const tagRankMap = new Map();
  tags.forEach(t => { if (t.name) tagRankMap.set(t.name, t.rank || 0); });
  const hasTag = (name, minRank = 50) => (tagRankMap.get(name) || 0) >= minRank;
  const anyTag = (name) => tagRankMap.has(name);
  const t = title || '';

  // 1. 魔法少女 / バトルヒロイン (Mahou Shoujoジャンル または 変身・魔女タグ または 代表タイトル)
  const isMahouGenre = g.has('Mahou Shoujo');
  const isMahouTag = hasTag('Henshin', 70) || hasTag('Witch', 70);
  const isMahouTitle = /(?:プリキュア|まどか|なのは|シンフォギア|プリズマ|魔法少女|セーラームーン|結城友奈|ストライクウィッチーズ|グランベルム|幻影ヲ駆ケル太陽|キューティーハニー|りりかSOS|ファンファンファーマシィー|プリンセッション|シュガー)/i.test(t);
  if (isMahouGenre || (isMahouTag && (g.has('Action') || g.has('Fantasy'))) || isMahouTitle) {
    return 'mahou_shoujo';
  }

  // 2. 異世界 / 転生（※ダンまちは生粋のダンジョンファンタジーなので除外）
  const isIsekaiTag = anyTag('Isekai') || anyTag('Reverse Isekai') || anyTag('Villainess');
  const isIsekaiTitle = /(?:異世界|転生|転移|悪役令嬢|追放され|魔王様|勇者(?:パーティー)?|スライム.*件|チート|治癒魔法|無職転生|陰の実力者|オーバーロード|この素晴らしい世界に祝福を|Re:ゼロ|盾の勇者|本好きの下剋上|賢者の弟子|ベヒーモス|聖女なのに|Sランクになってた|まじかる商会|インタビュールーム)/i.test(t);
  if ((isIsekaiTag || isIsekaiTitle) && !/ダンジョンに出会いを|ダンまち/i.test(t)) {
    return 'isekai';
  }

  // 3. ロボット / メカ
  const isMechaTag = g.has('Mecha') || hasTag('Real Robot') || hasTag('Super Robot');
  const isMechaTitle = /(?:ガンダム|エヴァンゲリオン|ヱヴァンゲリヲン|マクロス|コードギアス|パトレイバー|ダイナゼノン|グリッドマン|アクエリオン|マジンガー|ゲッターロボ|フルメタル・パニック|ゾイド)/i.test(t);
  if (isMechaTag || isMechaTitle) return 'mecha';

  // 4. スポーツ / 競技
  const isSportsTitle = /(?:メジャー|MAJOR|ハイキュー|黒子のバスケ|ブルーロック|ダイヤのA|スラムダンク|弱虫ペダル|Free!|キャプテン翼|テニスの王子様)/i.test(t);
  if (g.has('Sports') || isSportsTitle) return 'sports';

  // 5. 歴史 / 戦記 / ミリタリー（統合：軍事、戦乱、歴史劇）
  const isMilTag = hasTag('Military', 60) || hasTag('War', 60) || anyTag('Tanks') || anyTag('Aviation');
  const isHistTag = hasTag('Historical', 60) || hasTag('Medieval', 60) || anyTag('Ancient China') || anyTag('Samurai');
  const isHistMilTitle = /(?:ガールズ＆パンツァー|ガールズ&パンツァー|ガルパン|アンツィオ|幼女戦記|GATE 自衛隊|アズールレーン|艦隊これくしょん|艦これ|ハイスクール・フリート|キングダム|ヴィンランド・サガ|平家物語|るろうに剣心|ゴールデンカムイ|銀魂|薄桜鬼|信長|ドリフターズ|らいむいろ|アルスラーン戦記|銀河英雄伝説)/i.test(t);
  const isExcludedFromHistory = /ダンジョン飯|葬送のフリーレン|七つの魔剣/i.test(t);
  if (!isExcludedFromHistory && (isMilTag || isHistTag || isHistMilTitle)) {
    return 'history_military';
  }

  // 6. アイドル / 音楽
  const isMusicTag = anyTag('Idol') || hasTag('Band', 60) || hasTag('Musical Theater', 60);
  const isMusicTitle = /(?:アイドルマスター|IDOLM＠STER|アイマス|Jupiter|シンデレラガールズ|ミリオンライブ|シャイニーカラーズ|SideM|ラブライブ|バンドリ|BanG Dream|ぼっち・ざ・ろっく|D4DJ|アイカツ|プリパラ|ゾンビランドサガ|ヒプノシスマイク|Wake Up|22\/7|あの日の彼女たち|プロジェクトセカイ|プロセカ|初音ミク|DIALOGUE|かぐや姫.*MV|超かぐや姫|リメンバー・ミー|LONELINESS WILL SHINE)/i.test(t);
  if (isMusicTag || isMusicTitle || (g.has('Music') && !g.has('Action') && !g.has('Drama') && !g.has('Fantasy'))) return 'idol_music';

  // 7. コメディ / ギャグ（純粋なギャグ・スラップスティック）
  const isPureComedyTag = hasTag('Slapstick', 50) || hasTag('Surreal Comedy', 50) || hasTag('Parody', 50) || hasTag('Satire', 50);
  const isComedyTitle = /(?:銀魂|あそびあそばせ|男子高校生の日常|斉木楠雄|女子高生の無駄づかい|てーきゅう|ポプテピピック|ぐらんぶる|この美術部には問題がある|邪神ちゃん|ヒナまつり|これはゾンビですか|でじこ|Di Gi Charat|バトルプログラマーシラセ|BPS|クックルン|しかのこのこのこ|アホガール|さばげぶっ|日常)/i.test(t);
  if (isComedyTitle || (g.has('Comedy') && isPureComedyTag)) {
    return 'comedy';
  }

  // 8. 日常 / ほのぼの（日常系、きらら系、癒し系、キャンプ）
  const isIyashikei = hasTag('Iyashikei', 40);
  const isCGDCT = anyTag('Cute Girls Doing Cute Things') || anyTag('Cute Boys Doing Cute Things');
  const isOutdoor = hasTag('Outdoor Activities', 50) || hasTag('Camping', 50);
  const isSliceTitle = /(?:ゆるキャン|のんのんびより|ごちうさ|ご注文はうさぎですか|きんいろモザイク|NEW GAME|みなみけ|らき☆すた|ヤマノススメ|スローループ|ゆるゆり|小林さんちのメイドラゴン|ブルーアーカイブ|ブルアカ|もめんたりー・リリィ|mono|ざつ旅|雨と君と|クジマ歌えば|笑顔のたえない職場|日々は過ぎれど|フードコートで|カワイスギクライシス|くノ一ツバキ|ばっどがーる|あっちこっち|干物妹|三ツ星カラーズ|私に天使が舞い降りた|わたてん|スロウスタート|あんハピ|ブレンド・S|GA 芸術科)/i.test(t);
  if (isSliceTitle || isIyashikei || isOutdoor || (isCGDCT && !g.has('Action') && !g.has('Music'))) {
    return 'nichijou';
  }

  // 9. SF / ファンタジー（王道ハイファンタジー、ダンジョン、魔法世界、サイバーパンク、近未来SF、仮想世界）
  const isDungeon = anyTag('Dungeon') || hasTag('Magic', 60) || anyTag('Dragons') || anyTag('Elves') || anyTag('Monster Girl');
  const isSciFiThemes = anyTag('Artificial Intelligence') || anyTag('Virtual World') || anyTag('Cyberpunk') || anyTag('Space') || anyTag('Time Manipulation') || hasTag('Dystopian', 50);
  const isSFFantasyTitle = /(?:STEINS;GATE|シュタインズ・ゲート|シュタゲ|ダンジョン飯|ダンジョンに出会いを|ダンまち|BEATLESS|ビートレス|ファイナルファンタジー|魔法陣グルグル|グルグル|プラスティック・メモリーズ|プラメモ|ワンダーエッグ|トイ・ストーリー|カーズ|マリオ|俺だけレベルアップ|サマーウォーズ|とある魔術|禁書目録|フリーレン|葬送のフリーレン|メイドインアビス|ウィストリア|シャングリラ・フロンティア|シャンフロ|SAO|ソードアート|マギ|電脳コイル|攻殻機動隊|ヴィヴィ|Vivy|寄生獣|ゴブリンスレイヤー|七つの大罪|チェインクロニクル|ベルセルク|クレイモア|ハクメイとミコチ|虫師|夏目友人帳|ソマリと森の神様)/i.test(t);
  if (isSFFantasyTitle || (g.has('Fantasy') && isDungeon && !hasTag('Shounen', 80)) || (g.has('Sci-Fi') && isSciFiThemes) || (g.has('Fantasy') && !g.has('Romance') && !g.has('Action') && !g.has('Comedy'))) {
    return 'sf_fantasy';
  }

  // 10. ホラー / サスペンス / 推理
  const isSuspenseTitle = /(?:GOSICK|ゴシック|ロード・エルメロイ|エルメロイ|ひぐらし|Another|PSYCHO-PASS|サイコパス|約束のネバーランド|サマータイムレンダ|Death Note|デスノート|MONSTER|シャドーハウス)/i.test(t);
  if (isSuspenseTitle || ((g.has('Horror') || g.has('Thriller') || g.has('Mystery') || g.has('Psychological')) && !g.has('Comedy') && !g.has('Romance'))) {
    return 'horror_suspense';
  }

  // 11. エッチ / お色気（明確なお色気作品・ハーレム作品）
  const isEcchiCore = g.has('Ecchi') && (anyTag('Female Harem') || anyTag('Nudity') || hasTag('Fanservice', 60) || anyTag('Ecchi'));
  const isEcchiTitle = /(?:変ゼミ|染谷さん|最近、妹のようすが|妹ちょ|お姉さまに恋してる|オトボク|To LOVEる|ハイスクールD×D|ヨスガノソラ|監獄学園|魔装学園|新妹魔王|異種族レビュアーズ|回復術士|ド級編隊|健全ロボ)/i.test(t);
  if (isEcchiTitle || isEcchiCore) return 'ecchi';

  // 12. アクション / バトル（能力バトル、格闘、剣戟、少年漫画系アクション）
  const isBattleTag = hasTag('Super Power', 60) || hasTag('Martial Arts', 60) || hasTag('Swordplay', 60) || hasTag('Superhero', 60) || hasTag('Battle Royale', 60);
  const isActionTitle = /(?:鬼滅の刃|呪術廻戦|チェンソーマン|僕のヒーローアカデミア|ヒロアカ|ワンパンマン|モブサイコ|BLEACH|NARUTO|ナルト|ONE PIECE|ワンピース|進撃の巨人|ドラゴンボール|HUNTER×HUNTER|ハンターハンター|ブラッククローバー|東京喰種|Fate\/stay night|Fate\/Zero|空の境界|刀語|キルラキル|KILL la KILL|ブラック★ロックシューター|シーキューブ|C3|アクセル・ワールド|ストライク・ザ・ブラッド|とある科学の超電磁砲|レールガン|灼眼のシャナ|デート・ア・ライブ|AKIBA’S TRIP|LAZARUS|リボンヒーロー)/i.test(t);
  if (isActionTitle || (g.has('Action') && (isBattleTag || hasTag('Shounen', 70)))) {
    return 'action';
  }

  // 13. 恋愛 / ラブコメ / 青春ドラマ（統合：恋愛、学園青春、人間ドラマ、お仕事）
  const isComingOfAge = hasTag('Coming of Age', 50);
  const isWork = hasTag('Work', 60);
  const isRomanceDramaTitle = /(?:神のみぞ知るセカイ|政宗くんのリベンジ|シスター・プリンセス|シスプリ|citrus|シトラス|わたしが恋人になれるわけないじゃん|わたなれ|Фなるあぷろーち|ウィッシュ|W ～ウィッシュ～|漣蒼士|五等分の花嫁|かぐや様|とらドラ|やはり俺の青春|俺ガイル|ヴァイオレット・エヴァーガーデン|宇宙よりも遠い場所|よりもい|SHIROBAKO|四月は君の嘘|あの日見た花|CLANNAD|クラナド|響け！ユーフォニアム|氷菓|花咲くいろは|サクラクエスト|白い砂のアクアトープ|僕の心のヤバイやつ|銀の匙|Silver Spoon|藤本タツキ|ビーバーになる時|The Summer|あの夏|聲の形|リズと青い鳥|ちはやふる)/i.test(t);
  if (isRomanceDramaTitle || g.has('Romance') || (g.has('Drama') && (isComingOfAge || isWork) && !g.has('Action'))) {
    return 'romance_drama';
  }

  // --- 残余フォールバック判定（優先順位順） ---
  if (g.has('Fantasy') || g.has('Sci-Fi')) return 'sf_fantasy';
  if (g.has('Slice of Life')) return 'nichijou';
  if (g.has('Action') || g.has('Adventure')) return 'action';
  if (g.has('Romance') || g.has('Drama')) return 'romance_drama';
  if (g.has('Comedy')) return 'comedy';
  if (g.has('Ecchi')) return 'ecchi';
  if (g.has('Horror') || g.has('Thriller') || g.has('Mystery') || g.has('Psychological')) return 'horror_suspense';

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
