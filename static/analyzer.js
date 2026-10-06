'use strict';

/**
 * ブラウザ上で動作する超高速クライアントサイド分析エンジン
 * サーバーを介さず、ユーザーのスマホ/PC上で 0.05秒以内に全集計を完了します
 */
class ClientAnalyzer {
  /**
   * @param {Object.<string, Array<{id: string, title: string, image: string, season: string, url: string}>>} userWatchedLists
   */
  constructor(userWatchedLists = {}) {
    this.userWatchedLists = userWatchedLists;
    this.users = Object.keys(this.userWatchedLists);

    this.userAnimeMaps = {};
    for (const u of this.users) {
      const map = new Map();
      for (const a of this.userWatchedLists[u] || []) {
        map.set(String(a.id), a);
      }
      this.userAnimeMaps[u] = map;
    }
  }

  /**
   * 2人または3人の Venn.js 向けデータセットを作成
   */
  generateVennSets(selectedUsers = this.users.slice(0, 3)) {
    const sets = [];
    const n = selectedUsers.length;
    if (n === 0) return [];

    // 1人ごとの集合
    for (const u of selectedUsers) {
      sets.push({
        sets: [u],
        size: this.userWatchedLists[u]?.length || 0,
        animes: this.userWatchedLists[u] || []
      });
    }

    // 2人ごとの積集合
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const u1 = selectedUsers[i];
        const u2 = selectedUsers[j];
        const commonAnimes = this.getIntersection([u1, u2]);
        sets.push({
          sets: [u1, u2],
          size: commonAnimes.length,
          animes: commonAnimes
        });
      }
    }

    // 3人の場合の3重積集合
    if (n >= 3) {
      for (let i = 0; i < n - 2; i++) {
        for (let j = i + 1; j < n - 1; j++) {
          for (let k = j + 1; k < n; k++) {
            const u1 = selectedUsers[i];
            const u2 = selectedUsers[j];
            const u3 = selectedUsers[k];
            const commonAnimes = this.getIntersection([u1, u2, u3]);
            sets.push({
              sets: [u1, u2, u3],
              size: commonAnimes.length,
              animes: commonAnimes
            });
          }
        }
      }
    }

    return sets;
  }

  /**
   * 指定したユーザー群すべての共通アニメ（積集合）を取得
   */
  getIntersection(userGroup) {
    if (!userGroup || userGroup.length === 0) return [];
    const firstUser = userGroup[0];
    const firstList = this.userWatchedLists[firstUser] || [];

    return firstList.filter(anime => {
      const animeId = String(anime.id);
      return userGroup.every(u => this.userAnimeMaps[u]?.has(animeId));
    });
  }

  /**
   * Jaccard類似度マトリクス（全ペアのシンクロ率）を計算
   */
  calculateSimilarityMatrix() {
    const matrix = [];
    const ranking = [];

    for (let i = 0; i < this.users.length; i++) {
      for (let j = 0; j < this.users.length; j++) {
        const u1 = this.users[i];
        const u2 = this.users[j];

        if (i === j) {
          matrix.push({
            user1: u1,
            user2: u2,
            intersection: this.userWatchedLists[u1]?.length || 0,
            union: this.userWatchedLists[u1]?.length || 0,
            similarity: 1.0,
            percentage: 100
          });
          continue;
        }

        const map1 = this.userAnimeMaps[u1];
        const map2 = this.userAnimeMaps[u2];

        let commonCount = 0;
        const allIds = new Set([...map1.keys(), ...map2.keys()]);

        for (const id of allIds) {
          if (map1.has(id) && map2.has(id)) {
            commonCount++;
          }
        }

        const unionCount = allIds.size;
        const similarity = unionCount > 0 ? (commonCount / unionCount) : 0;
        const percentage = Math.round(similarity * 1000) / 10;

        const record = {
          user1: u1,
          user2: u2,
          intersection: commonCount,
          union: unionCount,
          similarity,
          percentage
        };

        matrix.push(record);

        if (i < j) {
          ranking.push({
            pair: [u1, u2],
            intersection: commonCount,
            union: unionCount,
            similarity,
            percentage
          });
        }
      }
    }

    ranking.sort((a, b) => b.similarity - a.similarity);

    return { matrix, ranking };
  }

  /**
   * 話のネタになるインサイトデータを生成
   */
  generateInsights() {
    const allUsers = this.users;
    if (allUsers.length === 0) return {};

    const allAnimesMap = new Map();
    for (const u of allUsers) {
      for (const a of this.userWatchedLists[u] || []) {
        if (!allAnimesMap.has(String(a.id))) {
          allAnimesMap.set(String(a.id), a);
        }
      }
    }

    const animeWatchers = new Map();
    for (const [id, anime] of allAnimesMap.entries()) {
      const watchers = allUsers.filter(u => this.userAnimeMaps[u]?.has(id));
      animeWatchers.set(id, { anime, watchers });
    }

    const watchedByAll = [];
    const exclusivePerUser = {};
    const missingPerUser = {};

    for (const u of allUsers) {
      exclusivePerUser[u] = [];
      missingPerUser[u] = [];
    }

    for (const [, item] of animeWatchers.entries()) {
      const { anime, watchers } = item;

      if (watchers.length === allUsers.length && allUsers.length > 1) {
        watchedByAll.push(anime);
      }

      if (watchers.length === 1) {
        exclusivePerUser[watchers[0]].push(anime);
      }

      if (allUsers.length >= 3 && watchers.length === allUsers.length - 1) {
        const missingUser = allUsers.find(u => !watchers.includes(u));
        if (missingUser) {
          missingPerUser[missingUser].push(anime);
        }
      }
    }

    return {
      watchedByAll,
      exclusivePerUser,
      missingPerUser,
      totalUniqueAnimes: allAnimesMap.size
    };
  }

  /**
   * 視聴カロリー計算
   */
  calculateCalories() {
    const calorieReport = {};

    for (const username of this.users) {
      const list = this.userWatchedLists[username] || [];
      let totalMinutes = 0;
      let tvCount = 0;
      let movieCount = 0;
      let ovaCount = 0;

      for (const anime of list) {
        const title = anime.title || '';
        if (title.includes('劇場版') || title.includes('映画') || title.includes('THE MOVIE')) {
          movieCount++;
          totalMinutes += 105;
        } else if (title.includes('OVA') || title.includes('OAD') || title.includes('特別編')) {
          ovaCount++;
          totalMinutes += 45;
        } else {
          tvCount++;
          totalMinutes += 12 * 24;
        }
      }

      const totalHours = Math.round(totalMinutes / 60);
      const totalDays = (totalMinutes / (60 * 24)).toFixed(1);
      const wakingDays = (totalMinutes / (60 * 16)).toFixed(1);

      calorieReport[username] = {
        username,
        workCount: list.length,
        totalHours,
        totalDays: parseFloat(totalDays),
        wakingDays: parseFloat(wakingDays),
        breakdown: { tvCount, movieCount, ovaCount }
      };
    }

    return calorieReport;
  }

  /**
   * 年代別タイムライン計算
   */
  calculateTimeline() {
    const yearsByUser = {};
    const eraBuckets = [
      { id: 'pre_2005', label: '〜2005年', start: 0, end: 2005 },
      { id: '2006_2010', label: '2006〜2010年', start: 2006, end: 2010 },
      { id: '2011_2015', label: '2011〜2015年', start: 2011, end: 2015 },
      { id: '2016_2020', label: '2016〜2020年', start: 2016, end: 2020 },
      { id: '2021_present', label: '2021年〜現在', start: 2021, end: 2099 }
    ];

    for (const username of this.users) {
      const list = this.userWatchedLists[username] || [];
      const yearCountMap = {};
      const bucketCounts = {};
      eraBuckets.forEach(b => { bucketCounts[b.id] = 0; });

      for (const anime of list) {
        let year = null;
        if (anime.season) {
          const m = anime.season.match(/(\d{4})年/);
          if (m) year = parseInt(m[1], 10);
        }

        if (year) {
          yearCountMap[year] = (yearCountMap[year] || 0) + 1;
          for (const b of eraBuckets) {
            if (year >= b.start && year <= b.end) {
              bucketCounts[b.id]++;
              break;
            }
          }
        }
      }

      let peakYear = null;
      let maxYearCount = 0;
      for (const [y, cnt] of Object.entries(yearCountMap)) {
        if (cnt > maxYearCount) {
          maxYearCount = cnt;
          peakYear = parseInt(y, 10);
        }
      }

      yearsByUser[username] = {
        username,
        peakYear,
        maxYearCount,
        yearCounts: yearCountMap,
        bucketCounts
      };
    }

    const goldenYears = [];
    for (let i = 0; i < this.users.length - 1; i++) {
      for (let j = i + 1; j < this.users.length; j++) {
        const u1 = this.users[i];
        const u2 = this.users[j];

        const map2 = new Set((this.userWatchedLists[u2] || []).map(a => String(a.id)));
        const commonAnimes = (this.userWatchedLists[u1] || []).filter(a => map2.has(String(a.id)));

        const yearCommon = {};
        for (const a of commonAnimes) {
          if (a.season) {
            const m = a.season.match(/(\d{4})年/);
            if (m) {
              const y = parseInt(m[1], 10);
              yearCommon[y] = (yearCommon[y] || 0) + 1;
            }
          }
        }

        let bestYear = null;
        let bestCount = 0;
        for (const [y, cnt] of Object.entries(yearCommon)) {
          if (cnt > bestCount) {
            bestCount = cnt;
            bestYear = parseInt(y, 10);
          }
        }

        if (bestYear) {
          goldenYears.push({
            pair: [u1, u2],
            year: bestYear,
            commonInYearCount: bestCount,
            totalCommon: commonAnimes.length
          });
        }
      }
    }

    return {
      eraBuckets,
      yearsByUser,
      goldenYears
    };
  }

  /**
   * 未知・未登録タイトルのスマート推論（セーフティネット）
   */
  inferCategoryFromTitle(title) {
    if (!title) return 'other';
    const t = title;
    if (/(?:異世界|転生|転移|悪役令嬢|追放|スライム|魔王|勇者|チート|治癒|スキル|ステータス|レベル|ダンジョン|冒険者|聖女|公爵|辺境|ギルド|鑑定|テイマー|錬金術|魔術|魔導|セカンドライフ|無双|召喚|スローライフ)/i.test(t)) return 'isekai';
    if (/(?:魔法少女|プリキュア|魔女|変身ヒロイン|マギカ|マジカル|ウィッチ|セーラー)/i.test(t)) return 'mahou_shoujo';
    if (/(?:ガンダム|メカ|ロボ|ロボット|マクロス|エヴァ|パトレイバー|ダイナ|カイザー|トランスフォーマー|ギア|バルキリー|イデオン|マジンガー)/i.test(t)) return 'mecha';
    if (/(?:サッカー|野球|バスケ|バレー|テニス|ゴルフ|競走|レース|水泳|ボクシング|格闘|相撲|将棋|囲碁|かるた|麻雀|ダンス|体操|自転車|ペダル|フットボール|陸上|卓球|ボウリング|競馬)/i.test(t)) return 'sports';
    if (/(?:アイドル|バンド|ライブ|ソング|ミュージック|うた|歌|メロディ|オーケストラ|吹奏楽|ピアノ|ギター|合唱|ボーカル|シンガー)/i.test(t)) return 'idol_music';
    if (/(?:恋|愛|彼女|彼氏|カノジョ|カレシ|ラブコメ|告白|好き|同棲|結婚|許嫁|ウェディング|キス|両想い|片想い|失恋|初恋|純情|初体験|カップル|お見合い|プロポーズ|ハレ婚)/i.test(t)) return 'romance';
    if (/(?:日常|キャンプ|キャン△|ごちうさ|うさぎ|きんいろ|のんのん|ゆる|ぼっち|きらら|ほのぼの|カフェ|喫茶|暮らし|生活|女子会|散歩|家族|ごちそう|料理|ごはん|食堂|のんびり)/i.test(t)) return 'nichijou';
    if (/(?:青春|ドラマ|絆|家族|友情|仕事|部活|お仕事|吹奏楽|クラシック|人生|再生|旅立ち|成長|君の嘘|聲の形|あの花|よりもい|いろは|ユーフォ)/i.test(t)) return 'drama';
    if (/(?:殺人|探偵|推理|事件|サスペンス|ホラー|怪談|呪い|幽霊|サイコ|デス|死|密室|ミステリー|サイコパス|謎|陰謀|悪夢|ゴースト)/i.test(t)) return 'horror_suspense';
    if (/(?:武将|戦国|幕末|歴史|三国志|大河|軍|兵|艦隊|戦艦|空母|ミリタリー|戦争|部隊|大戦|帝国|皇国|侍|新選組|維新)/i.test(t)) return 'history_military';
    if (/(?:ギャグ|コメディ|コメディー|バカ|コント|パロディ|お笑い|珍道中|騒動|ハチャメチャ|漫才|おバカ)/i.test(t)) return 'comedy';
    if (/(?:バトル|ファイト|バスター|ブレード|ソード|ストライク|ファイター|アサシン|ハンター|ウォリアー|リベンジ|復讐|激闘|討伐|拳|格闘|戦士|ウォーズ)/i.test(t)) return 'action';
    if (/(?:SF|ファンタジー|エイリアン|アンドロイド|サイボーグ|宇宙|惑星|異星|次元|魔術|魔法|エルフ|ドラゴン|ダンジョン|タイムトラベル|冒険)/i.test(t)) return 'sf_fantasy';
    return 'other';
  }

  /**
   * 4. ジャンル別視聴傾向分析（ブラウザ内完全リアルタイム集計）
   * @param {Object.<string, {c: string}|{category: string}>} genreMap
   */
  calculateGenres(genreMap = {}) {
    const definitions = [
      { id: 'isekai',           label: '異世界 / 転生',             icon: 'fa-solid fa-door-open',           color: '#8b5cf6' },
      { id: 'mahou_shoujo',     label: '魔法少女 / バトルヒロイン',  icon: 'fa-solid fa-wand-magic-sparkles', color: '#fb7185' },
      { id: 'mecha',            label: 'ロボット / メカ',          icon: 'fa-solid fa-robot',               color: '#6b7280' },
      { id: 'action',           label: 'アクション / バトル',      icon: 'fa-solid fa-burst',               color: '#ef4444' },
      { id: 'sports',           label: 'スポーツ / 競技',          icon: 'fa-solid fa-futbol',              color: '#14b8a6' },
      { id: 'comedy',           label: 'コメディ / ギャグ',        icon: 'fa-solid fa-face-laugh-squint',   color: '#f59e0b' },
      { id: 'romance',          label: '恋愛 / ラブコメ',          icon: 'fa-solid fa-heart',               color: '#ec4899' },
      { id: 'drama',            label: 'ドラマ / 青春',            icon: 'fa-solid fa-masks-theater',       color: '#0284c7' },
      { id: 'nichijou',         label: '日常 / ほのぼの',          icon: 'fa-solid fa-mug-saucer',          color: '#10b981' },
      { id: 'sf_fantasy',       label: 'SF / ファンタジー',        icon: 'fa-solid fa-meteor',              color: '#6366f1' },
      { id: 'horror_suspense',  label: 'ホラー / サスペンス / 推理', icon: 'fa-solid fa-skull',          color: '#475569' },
      { id: 'history_military', label: '歴史 / 戦記 / ミリタリー', icon: 'fa-solid fa-shield-halved', color: '#64748b' },
      { id: 'idol_music',       label: 'アイドル / 音楽',          icon: 'fa-solid fa-music',               color: '#eab308' },
      { id: 'ecchi',            label: 'エッチ / お色気',          icon: 'fa-solid fa-fire',                color: '#f43f5e' },
      { id: 'other',            label: 'その他',                   icon: 'fa-solid fa-ellipsis',            color: '#9ca3af' }
    ];

    const statsByUser = {};
    const genreSummary = {};

    for (const g of definitions) {
      genreSummary[g.id] = {
        ...g,
        totalWorksAcrossUsers: 0,
        userCounts: {},
        userPercentages: {},
        animesByUser: {}
      };
      for (const u of this.users) {
        genreSummary[g.id].userCounts[u] = 0;
        genreSummary[g.id].userPercentages[u] = 0;
        genreSummary[g.id].animesByUser[u] = [];
      }
    }

    for (const username of this.users) {
      const list = this.userWatchedLists[username] || [];
      const userGenreCounts = {};
      const userGenreAnimes = {};

      for (const g of definitions) {
        userGenreCounts[g.id] = 0;
        userGenreAnimes[g.id] = [];
      }

      for (const anime of list) {
        const title = anime.title || '';
        const entry = genreMap[title];
        let categoryId = entry?.category || entry?.c;

        // 未知作品はスマート推論で救済
        if (!categoryId || categoryId === 'other') {
          categoryId = this.inferCategoryFromTitle(title) || 'other';
        }

        if (genreSummary[categoryId]) {
          userGenreCounts[categoryId]++;
          userGenreAnimes[categoryId].push(anime);
          genreSummary[categoryId].userCounts[username]++;
          genreSummary[categoryId].animesByUser[username].push(anime);
        }
      }

      const totalListCount = list.length || 1;
      const genreList = definitions.map(g => {
        const count = userGenreCounts[g.id];
        const pct = Math.round((count / totalListCount) * 1000) / 10;
        return {
          id: g.id,
          label: g.label,
          icon: g.icon,
          color: g.color,
          count,
          percentage: pct,
          animes: userGenreAnimes[g.id]
        };
      }).sort((a, b) => b.count - a.count);

      const topGenres = genreList.filter(g => g.count > 0).slice(0, 3);

      statsByUser[username] = {
        username,
        totalWatched: list.length,
        genres: genreList,
        topGenres
      };
    }

    for (const g of definitions) {
      let maxUser = null;
      let maxCount = -1;
      let totalWorks = 0;

      for (const u of this.users) {
        const userTotal = (this.userWatchedLists[u] || []).length || 1;
        const cnt = genreSummary[g.id].userCounts[u];
        const pct = Math.round((cnt / userTotal) * 1000) / 10;
        genreSummary[g.id].userPercentages[u] = pct;
        totalWorks += cnt;

        if (cnt > maxCount) {
          maxCount = cnt;
          maxUser = u;
        }
      }

      genreSummary[g.id].totalWorksAcrossUsers = totalWorks;
      genreSummary[g.id].topUser = maxCount > 0 ? { username: maxUser, count: maxCount } : null;
    }

    const sortedGenres = Object.values(genreSummary).sort((a, b) => b.totalWorksAcrossUsers - a.totalWorksAcrossUsers);

    return {
      definitions,
      statsByUser,
      genres: sortedGenres
    };
  }

  /**
   * 完全な分析レポートオブジェクトを生成（所要時間: 0.05秒）
   */
  buildFullReport(baseLabs = null, genreMap = {}) {
    const defaultVennUsers = this.users.slice(0, 3);
    const vennSets = this.generateVennSets(defaultVennUsers);
    const { matrix, ranking } = this.calculateSimilarityMatrix();
    const insights = this.generateInsights();

    const userSummary = this.users.map(u => ({
      username: u,
      count: this.userWatchedLists[u]?.length || 0,
      exclusiveCount: insights.exclusivePerUser?.[u]?.length || 0,
      missingCount: insights.missingPerUser?.[u]?.length || 0
    }));

    // Labsレポート（カロリー・年代・ジャンルは新ユーザー含めリアルタイム再計算！）
    const labs = baseLabs ? { ...baseLabs } : {};
    labs.calorieReport = this.calculateCalories();
    labs.timelineReport = this.calculateTimeline();

    // ジャンルマップがある場合（または初期化時）はジャンルレポートを完全リアルタイム再計算
    if (genreMap && Object.keys(genreMap).length > 0) {
      const calculatedGenres = this.calculateGenres(genreMap);
      labs.genreReportScored = calculatedGenres;
      labs.genreReport = calculatedGenres;
    }

    return {
      generatedAt: new Date().toISOString(),
      users: this.users,
      userSummary,
      defaultVennUsers,
      vennSets,
      similarity: {
        matrix,
        ranking
      },
      insights,
      labs,
      userWatchedLists: this.userWatchedLists
    };
  }
}

// =========================================================================
// 【Local-First】クライアントサイド・ジャンル判定＆AniList直接照合エンジン
// =========================================================================

/**
 * 重み付けスコアリング方式（多重加点・タグランク活用）による高精度アニメジャンル分類
 */
function scoreAnimeDetailed(genres = [], tags = [], title = '') {
  const g = new Set(genres || []);
  const tagMap = new Map();
  (tags || []).forEach(t => {
    if (t && t.name) {
      tagMap.set(t.name, t.rank || 0);
    }
  });

  const getTag = (name) => tagMap.get(name) || 0;
  const t = title || '';

  const scores = {
    isekai: 0, mahou_shoujo: 0, mecha: 0, sports: 0, idol_music: 0,
    comedy: 0, nichijou: 0, romance: 0, drama: 0, history_military: 0,
    horror_suspense: 0, ecchi: 0, action: 0, sf_fantasy: 0, other: 0
  };
  const reasons = {};
  Object.keys(scores).forEach(k => { reasons[k] = []; });

  const addScore = (catId, pts, reason) => {
    if (scores[catId] !== undefined && pts > 0) {
      scores[catId] += pts;
      reasons[catId].push(`${reason} (+${Math.round(pts)})`);
    }
  };

  // 1. 異世界 / 転生
  const hasIsekaiTag = tagMap.has('Isekai') || tagMap.has('Reverse Isekai');
  const hasIsekaiTitle = /(?:異世界|転生|転移|悪役令嬢|追放され|魔王様|勇者(?:パーティー)?|スライム.*件|チート|治癒魔法|無職転生|陰の実力者|オーバーロード|この素晴らしい世界に祝福を|このすば|Re:ゼロ|盾の勇者|本好きの下剋上|賢者の弟子|ベヒーモス|聖女なのに|Sランクになってた|シンデレラ・シェフ|第七王子|ダンジョン飯|貴族転生)/i.test(t);
  if (hasIsekaiTag || hasIsekaiTitle) {
    if (tagMap.has('Isekai')) addScore('isekai', getTag('Isekai') * 2.0, `タグ: Isekai(${getTag('Isekai')})`);
    if (tagMap.has('Reverse Isekai')) addScore('isekai', getTag('Reverse Isekai') * 1.8, `タグ: Reverse Isekai`);
    if (tagMap.has('Villainess')) addScore('isekai', getTag('Villainess') * 1.6, `タグ: Villainess(悪役令嬢)`);
    if (tagMap.has('Reincarnation')) addScore('isekai', getTag('Reincarnation') * 1.5, `タグ: Reincarnation(転生)`);
    if (hasIsekaiTitle) addScore('isekai', 160, `異世界・転生代表タイトル`);
    if (g.has('Fantasy')) addScore('isekai', 50, `ファンタジー異世界`);
  }
  if (/ダンジョンに出会いを|ダンまち/i.test(t)) {
    scores.isekai = 0;
  }

  // 2. 魔法少女 / バトルヒロイン
  if (g.has('Mahou Shoujo')) addScore('mahou_shoujo', 200, `公式ジャンル: Mahou Shoujo`);
  if (tagMap.has('Magical Girl')) addScore('mahou_shoujo', getTag('Magical Girl') * 2.0, `タグ: Magical Girl`);
  if (tagMap.has('Majokko')) addScore('mahou_shoujo', getTag('Majokko') * 1.8, `タグ: Majokko`);
  const isFemaleLead = tagMap.has('Female Protagonist') || tagMap.has('Primarily Female Cast');
  if (tagMap.has('Henshin') && isFemaleLead && !tagMap.has('Shounen') && !tagMap.has('Gore') && !g.has('Mecha')) {
    addScore('mahou_shoujo', getTag('Henshin') * 1.0, `タグ: Henshin(ヒロイン変身)`);
  }
  if (/(?:プリキュア|まどか|なのは|シンフォギア|プリズマ|魔法少女|セーラームーン|結城友奈|ストライクウィッチーズ|グランベルム|幻影ヲ駆ケル太陽|キューティーハニー|りりかSOS|ファンファンファーマシィー|プリンセッション)/i.test(t)) {
    addScore('mahou_shoujo', 180, `代表魔法少女タイトル`);
  }

  // 3. ロボット / メカ
  if (g.has('Mecha')) addScore('mecha', 160, `公式ジャンル: Mecha`);
  if (tagMap.has('Real Robot')) addScore('mecha', getTag('Real Robot') * 1.6, `タグ: Real Robot`);
  if (tagMap.has('Super Robot')) addScore('mecha', getTag('Super Robot') * 1.6, `タグ: Super Robot`);
  if (tagMap.has('Piloted Robot')) addScore('mecha', getTag('Piloted Robot') * 1.4, `タグ: Piloted Robot`);
  if (/(?:ガンダム|エヴァンゲリオン|ヱヴァンゲリヲン|マクロス|コードギアス|パトレイバー|ダイナゼノン|グリッドマン|アクエリオン|マジンガー|ゲッターロボ|フルメタル・パニック|ゾイド|ビーストウォーズ|トランスフォーマー)/i.test(t)) {
    addScore('mecha', 150, `代表メカタイトル`);
  }

  // 4. スポーツ / 競技
  if (g.has('Sports')) addScore('sports', 180, `公式ジャンル: Sports`);
  if (tagMap.has('Athletics')) addScore('sports', getTag('Athletics') * 1.2, `タグ: Athletics`);
  const sportsTags = ['Baseball', 'Basketball', 'Football', 'Volleyball', 'Swimming', 'Tennis', 'Boxing', 'Cycling', 'Motor Sports', 'Ice Skating', 'Martial Arts Competition', 'Badminton'];
  sportsTags.forEach(st => {
    if (tagMap.has(st)) addScore('sports', getTag(st) * 1.4, `競技タグ: ${st}`);
  });
  if (/(?:メジャー|MAJOR|ハイキュー|黒子のバスケ|ブルーロック|ダイヤのA|スラムダンク|弱虫ペダル|Free!|キャプテン翼|テニスの王子様|MFゴースト|頭文字D|イニシャルD|3月のライオン|ちはやふる|ヒカルの碁|ウマ娘)/i.test(t)) {
    addScore('sports', 150, `代表スポーツタイトル`);
  }

  // 5. アイドル / 音楽
  if (tagMap.has('Idol')) addScore('idol_music', getTag('Idol') * 1.8, `タグ: Idol(${getTag('Idol')})`);
  if (tagMap.has('Band')) addScore('idol_music', getTag('Band') * 1.6, `タグ: Band`);
  if (tagMap.has('Musical Theater')) addScore('idol_music', getTag('Musical Theater') * 1.2, `タグ: Musical Theater`);
  if (tagMap.has('Rock Music')) addScore('idol_music', getTag('Rock Music') * 1.2, `タグ: Rock Music`);
  if (g.has('Music')) {
    const isPureMusic = !g.has('Action') && !g.has('Fantasy');
    addScore('idol_music', isPureMusic ? 120 : 60, `公式ジャンル: Music`);
  }
  if (/(?:アイドルマスター|IDOLM＠STER|アイマス|Jupiter|シンデレラガールズ|ミリオンライブ|シャイニーカラーズ|SideM|ラブライブ|バンドリ|BanG Dream|ぼっち・ざ・ろっく|ガールズバンドクライ|ガルクラ|トゲナシトゲアリ|D4DJ|アイカツ|プリパラ|ゾンビランドサガ|ヒプノシスマイク|プロジェクトセカイ|プロセカ|初音ミク)/i.test(t)) {
    addScore('idol_music', 150, `代表音楽・アイドルタイトル`);
  }

  // 6. コメディ / ギャグ
  if (tagMap.has('Slapstick')) addScore('comedy', getTag('Slapstick') * 1.2, `タグ: Slapstick`);
  if (tagMap.has('Surreal Comedy')) addScore('comedy', getTag('Surreal Comedy') * 1.2, `タグ: Surreal Comedy`);
  if (tagMap.has('Parody')) addScore('comedy', getTag('Parody') * 1.1, `タグ: Parody`);
  if (tagMap.has('Satire')) addScore('comedy', getTag('Satire') * 1.0, `タグ: Satire`);
  if (g.has('Comedy')) {
    const pure = !g.has('Romance') && !g.has('Slice of Life') && !g.has('Action');
    addScore('comedy', pure ? 70 : 35, `公式ジャンル: Comedy`);
  }
  if (/(?:銀魂|あそびあそばせ|男子高校生の日常|斉木楠雄|女子高生の無駄づかい|てーきゅう|ポプテピピック|ぐらんぶる|邪神ちゃん|ヒナまつり|これはゾンビですか|でじこ|しかのこのこのこ|さばげぶっ|日常|こちら葛飾区|こち亀|バカとテスト|おねがい！ポコタ|生徒会の一存|ひつじのショーン|クックルン|Di Gi Charat|みらくる! ぱんぞう|おれたちイジワルケイ|ドンキーコング|ハウス・オブ・マウス|BPS バトルプログラマーシラセ|破産富豪)/i.test(t)) {
    addScore('comedy', 140, `代表コメディタイトル`);
  }

  // 7. 日常 / ほのぼの
  if (tagMap.has('Cute Girls Doing Cute Things')) addScore('nichijou', getTag('Cute Girls Doing Cute Things') * 1.2, `タグ: CGDCT`);
  if (tagMap.has('Cute Boys Doing Cute Things')) addScore('nichijou', getTag('Cute Boys Doing Cute Things') * 1.2, `タグ: CBDCT`);
  if (tagMap.has('Outdoor Activities')) addScore('nichijou', getTag('Outdoor Activities') * 1.1, `タグ: Outdoor`);
  if (tagMap.has('Camping')) addScore('nichijou', getTag('Camping') * 1.1, `タグ: Camping`);
  if (tagMap.has('Iyashikei')) {
    const isEpic = (g.has('Fantasy') && g.has('Adventure')) || g.has('Action');
    addScore('nichijou', getTag('Iyashikei') * (isEpic ? 0.3 : 1.2), `タグ: Iyashikei`);
  }
  if (g.has('Slice of Life')) {
    const isPure = !g.has('Action') && !g.has('Romance');
    addScore('nichijou', isPure ? 80 : 40, `公式ジャンル: Slice of Life`);
  }
  if (/(?:ゆるキャン|へやキャン|のんのんびより|ごちうさ|ご注文はうさぎですか|きんいろモザイク|NEW GAME|みなみけ|らき☆すた|ヤマノススメ|スローループ|ゆるゆり|小林さんちのメイドラゴン|ブルーアーカイブ|ブルアカ|もめんたりー・リリィ|mono|ざつ旅|雨と君と|クジマ歌えば|日々は過ぎれど|三ツ星カラーズ|私に天使が舞い降りた|わたてん|スロウスタート|あんハピ|ブレンド・S|GA 芸術科|苺ましまろ|しろくまカフェ|WORKING|ふらいんぐうぃっち|パパのいうこと|クロワーゼ|異国迷路のクロワーゼ|グルメ日記|着ぐるみガール)/i.test(t)) {
    addScore('nichijou', 140, `代表日常系タイトル`);
  }

  // 8. 恋愛 / ラブコメ
  if (g.has('Romance')) addScore('romance', 130, `公式ジャンル: Romance`);
  if (tagMap.has('Romantic Comedy')) addScore('romance', getTag('Romantic Comedy') * 1.3, `タグ: Romantic Comedy`);
  if (tagMap.has('Love Triangle')) addScore('romance', getTag('Love Triangle') * 1.1, `タグ: Love Triangle`);
  if (tagMap.has('Female Harem')) addScore('romance', getTag('Female Harem') * 1.0, `タグ: Female Harem`);
  if (tagMap.has('Male Harem')) addScore('romance', getTag('Male Harem') * 1.0, `タグ: Male Harem`);
  if (tagMap.has('Yuri') && !g.has('Music')) addScore('romance', getTag('Yuri') * 0.9, `タグ: Yuri`);
  if (tagMap.has('Boys\' Love')) addScore('romance', getTag('Boys\' Love') * 1.3, `タグ: BL`);
  if (tagMap.has('Tsundere')) addScore('romance', getTag('Tsundere') * 0.7, `タグ: Tsundere`);
  if (tagMap.has('Arranged Marriage')) addScore('romance', getTag('Arranged Marriage') * 1.1, `タグ: Arranged Marriage`);
  if (tagMap.has('First Love')) addScore('romance', getTag('First Love') * 1.1, `タグ: First Love`);
  if (tagMap.has('Unrequited Love')) addScore('romance', getTag('Unrequited Love') * 1.0, `タグ: Unrequited Love`);
  if (tagMap.has('Cohabitation')) addScore('romance', getTag('Cohabitation') * 0.8, `タグ: 同棲`);
  if (tagMap.has('Marriage')) addScore('romance', getTag('Marriage') * 0.8, `タグ: 結婚`);
  if (tagMap.has('Dating Sim') || tagMap.has('Visual Novel')) {
    if (g.has('Romance') || tagMap.has('Female Harem')) addScore('romance', 80, `タグ: 恋愛ノベル原作`);
  }
  if (/(?:その着せ替え人形|着せ恋|僕の心のヤバイやつ|五等分の花嫁|かぐや様|とらドラ|やはり俺の青春|俺ガイル|カノジョも彼女|女神のカフェテラス|わたしが恋人になれるわけないじゃん|わたなれ|神のみぞ知るセカイ|神のみ|政宗くんのリベンジ|シスター・プリンセス|シスプリ|citrus|シトラス|Фなるあぷろーち|ウィッシュ|W ～ウィッシュ～|漣蒼士|あんた私のことを好きだったの|これは二度目で最後の初恋|君主様に胸やけ|小さい潜水艦に恋をした|冴えない彼女|冴えカノ|ニセコイ|君に届け|アオハライド|山田くんとLv999|お隣の天使様|恋は雨上がりのように|ゴールデンタイム|高嶺のハナさん|疑似ハーレム|ロシデレ|時々ボソッとロシア語でデレる隣のアーリャさん|負けヒロインが多すぎる|マケイン)/i.test(t)) {
    addScore('romance', 150, `代表恋愛/ラブコメタイトル`);
  }

  // 9. ドラマ / 青春
  const hasStrongWorldGenre = g.has('Fantasy') || g.has('Sci-Fi') || g.has('Mecha') || tagMap.has('Isekai');
  const dramaMult = hasStrongWorldGenre ? 0.45 : 1.0;
  if (g.has('Drama')) {
    const isPureDrama = !g.has('Romance') && !tagMap.has('Romantic Comedy') && !tagMap.has('Female Harem');
    addScore('drama', (isPureDrama ? 120 : 60) * dramaMult, isPureDrama ? `公式ジャンル: Drama (純粋ドラマ)` : `公式ジャンル: Drama`);
  }
  if (tagMap.has('Coming of Age')) addScore('drama', getTag('Coming of Age') * 1.3 * dramaMult, `タグ: Coming of Age`);
  if (tagMap.has('Work')) addScore('drama', getTag('Work') * 1.2 * dramaMult, `タグ: Work`);
  if (tagMap.has('School Club') && !g.has('Sports') && !g.has('Music')) addScore('drama', getTag('School Club') * 0.8 * dramaMult, `タグ: School Club`);
  if (tagMap.has('Family Life')) addScore('drama', getTag('Family Life') * 1.1 * dramaMult, `タグ: Family Life`);
  if (tagMap.has('Tragedy') && !g.has('Action') && !g.has('Horror')) addScore('drama', getTag('Tragedy') * 1.0 * dramaMult, `タグ: Tragedy`);
  if (tagMap.has('Rehabilitation')) addScore('drama', getTag('Rehabilitation') * 1.2 * dramaMult, `タグ: Rehabilitation`);
  if (tagMap.has('Bullying')) addScore('drama', getTag('Bullying') * 1.2 * dramaMult, `タグ: Bullying`);
  if (tagMap.has('Disability')) addScore('drama', getTag('Disability') * 1.3 * dramaMult, `タグ: Disability`);
  if (tagMap.has('Youth')) addScore('drama', getTag('Youth') * 1.1 * dramaMult, `タグ: Youth`);
  if (tagMap.has('Ensemble Cast') && g.has('Drama')) addScore('drama', 70 * dramaMult, `タグ: Ensemble Cast`);
  if (tagMap.has('Melodrama')) addScore('drama', getTag('Melodrama') * 1.0 * dramaMult, `タグ: Melodrama`);
  if (/(?:宇宙よりも遠い場所|よりもい|SHIROBAKO|花咲くいろは|サクラクエスト|白い砂のアクアトープ|ヴァイオレット・エヴァーガーデン|響け！ユーフォニアム|四月は君の嘘|あの日見た花|あの花|CLANNAD|クラナド|聲の形|リズと青い鳥|銀の匙|Silver Spoon|ビーバーになる時|ルックバック|さよならの朝に約束の花をかざろう|氷菓|プラネテス|波よ聞いてくれ|スキップとローファー|バクマン|BLUE GIANT|平家物語|東京マグニチュード|花緑青|僕らの雨いろプロトコル|クジラの話|あの夏)/i.test(t)) {
    addScore('drama', 150, `代表ドラマ/青春タイトル`);
  }

  // 10. 歴史 / 戦記 / ミリタリー
  if (tagMap.has('Historical')) addScore('history_military', getTag('Historical') * 1.2, `タグ: Historical`);
  if (tagMap.has('Ancient China')) addScore('history_military', getTag('Ancient China') * 1.4, `タグ: Ancient China`);
  if (tagMap.has('Samurai')) addScore('history_military', getTag('Samurai') * 1.1, `タグ: Samurai`);
  if (tagMap.has('Medieval')) addScore('history_military', getTag('Medieval') * 0.7, `タグ: Medieval`);
  if (tagMap.has('Tanks')) addScore('history_military', 160, `タグ: Tanks(戦車)`);
  if (tagMap.has('Aviation')) addScore('history_military', 90, `タグ: Aviation`);
  const hasSupernaturalOrSciFi = tagMap.has('Super Power') || tagMap.has('Magic') || g.has('Sci-Fi');
  if (tagMap.has('Military')) {
    const mult = hasSupernaturalOrSciFi ? 0.3 : 1.1;
    addScore('history_military', getTag('Military') * mult, `タグ: Military`);
  }
  if (tagMap.has('War')) {
    const mult = hasSupernaturalOrSciFi ? 0.3 : 1.0;
    addScore('history_military', getTag('War') * mult, `タグ: War`);
  }
  if (/(?:ガールズ＆パンツァー|ガールズ&パンツァー|ガルパン|アンツィオ|幼女戦記|GATE 自衛隊|アズールレーン|艦隊これくしょん|艦これ|ハイスクール・フリート|キングダム|ヴィンランド・サガ|平家物語|るろうに剣心|ゴールデンカムイ|銀魂|薄桜鬼|信長|ドリフターズ|アルスラーン戦記|銀河英雄伝説|火喰鳥|静岡県史|歴史を変える男たち|戦国を駆ける武将|らいむいろ|どん兵衛)/i.test(t)) {
    addScore('history_military', 140, `代表歴史・ミリタリータイトル`);
  }

  // 11. ホラー / サスペンス / 推理
  if (g.has('Horror')) addScore('horror_suspense', 130, `公式ジャンル: Horror`);
  if (g.has('Mystery')) addScore('horror_suspense', 120, `公式ジャンル: Mystery`);
  if (g.has('Thriller')) addScore('horror_suspense', 100, `公式ジャンル: Thriller`);
  if (g.has('Psychological')) addScore('horror_suspense', 80, `公式ジャンル: Psychological`);
  if (tagMap.has('Detective')) addScore('horror_suspense', getTag('Detective') * 1.3, `タグ: Detective`);
  if (tagMap.has('Crime')) addScore('horror_suspense', getTag('Crime') * 1.0, `タグ: Crime`);
  if (tagMap.has('Police')) addScore('horror_suspense', getTag('Police') * 0.9, `タグ: Police`);
  if (tagMap.has('Death Game')) addScore('horror_suspense', getTag('Death Game') * 1.2, `タグ: Death Game`);
  if (/(?:薬屋のひとりごと|GOSICK|ゴシック|ロード・エルメロイ|ひぐらし|Another|PSYCHO-PASS|サイコパス|約束のネバーランド|サマータイムレンダ|Death Note|デスノート|MONSTER|シャドーハウス|死亡遊戯で飯を食う|探偵様|ブラッディ・メアリー|なつみSTEP)/i.test(t)) {
    addScore('horror_suspense', 140, `代表推理・サスペンスタイトル`);
  }

  // 12. エッチ / お色気
  if (g.has('Hentai')) addScore('ecchi', 300, `公式ジャンル: Hentai`);
  if (g.has('Ecchi')) {
    const hasExplicitNudity = tagMap.has('Nudity') || tagMap.has('Fanservice');
    addScore('ecchi', hasExplicitNudity ? 100 : 50, `公式ジャンル: Ecchi`);
  }
  if (tagMap.has('Nudity')) addScore('ecchi', getTag('Nudity') * 1.2, `タグ: Nudity`);
  if (tagMap.has('Fanservice')) addScore('ecchi', getTag('Fanservice') * 0.8, `タグ: Fanservice`);
  if (tagMap.has('Ecchi')) addScore('ecchi', getTag('Ecchi') * 1.1, `タグ: Ecchi`);
  if (/(?:変ゼミ|To LOVEる|ハイスクールD×D|ヨスガノソラ|監獄学園|魔装学園|新妹魔王|異種族レビュアーズ|回復術士|ド級編隊|ギルティホール|最近、妹のようすが|妹ちょ|お姉さまに恋してる|オトボク)/i.test(t)) {
    addScore('ecchi', 150, `代表お色気タイトル`);
  }

  // 13. アクション / バトル
  if (g.has('Action')) addScore('action', 90, `公式ジャンル: Action`);
  if (g.has('Adventure')) addScore('action', 30, `公式ジャンル: Adventure`);
  if (tagMap.has('Super Power')) addScore('action', getTag('Super Power') * 1.1, `タグ: Super Power`);
  if (tagMap.has('Swordplay')) addScore('action', getTag('Swordplay') * 1.0, `タグ: Swordplay`);
  if (tagMap.has('Martial Arts')) addScore('action', getTag('Martial Arts') * 1.0, `タグ: Martial Arts`);
  if (tagMap.has('Guns')) addScore('action', getTag('Guns') * 1.1, `タグ: Guns`);
  if (tagMap.has('Battle Royale')) addScore('action', getTag('Battle Royale') * 1.1, `タグ: Battle Royale`);
  if (tagMap.has('Superhero')) addScore('action', getTag('Superhero') * 1.1, `タグ: Superhero`);
  if (tagMap.has('Shounen') && g.has('Action')) addScore('action', getTag('Shounen') * 0.9, `タグ: Shounen`);
  if (tagMap.has('Kaiju')) addScore('action', getTag('Kaiju') * 0.9, `タグ: Kaiju`);
  if (tagMap.has('Revenge') && g.has('Action')) addScore('action', getTag('Revenge') * 0.9, `タグ: Revenge`);
  if (/(?:チェンソーマン|呪術廻戦|鬼滅の刃|進撃の巨人|リコリス・リコイル|僕のヒーローアカデミア|ヒロアカ|ワンパンマン|モブサイコ|BLEACH|NARUTO|ナルト|ONE PIECE|ワンピース|ドラゴンボール|HUNTER×HUNTER|ハンターハンター|ブラッククローバー|東京喰種|Fate\/stay night|Fate\/Zero|空の境界|キルラキル|アクセル・ワールド|ストライク・ザ・ブラッド|超電磁砲|レールガン|シャナ|デート・ア・ライブ|ブラック★ロックシューター|シーキューブ|C3|心臓に復讐|Mr.War|AKIBA’S TRIP|リボンヒーロー|LAZARUS)/i.test(t)) {
    addScore('action', 150, `代表アクションタイトル`);
  }

  // 14. SF / ファンタジー
  if (g.has('Fantasy')) addScore('sf_fantasy', 75, `公式ジャンル: Fantasy`);
  if (g.has('Sci-Fi')) addScore('sf_fantasy', 90, `公式ジャンル: Sci-Fi`);
  if (tagMap.has('Magic')) addScore('sf_fantasy', getTag('Magic') * 0.9, `タグ: Magic`);
  if (tagMap.has('Witch') && !g.has('Mahou Shoujo')) addScore('sf_fantasy', getTag('Witch') * 1.1, `タグ: Witch(魔女)`);
  if (tagMap.has('Elf')) addScore('sf_fantasy', getTag('Elf') * 1.1, `タグ: Elf`);
  if (tagMap.has('Dungeon')) addScore('sf_fantasy', getTag('Dungeon') * 1.2, `タグ: Dungeon`);
  if (tagMap.has('Dragons')) addScore('sf_fantasy', getTag('Dragons') * 1.0, `タグ: Dragons`);
  if (tagMap.has('Time Manipulation')) addScore('sf_fantasy', getTag('Time Manipulation') * 1.1, `タグ: Time Manipulation`);
  if (tagMap.has('Cyberpunk')) addScore('sf_fantasy', getTag('Cyberpunk') * 1.2, `タグ: Cyberpunk`);
  if (tagMap.has('Space')) addScore('sf_fantasy', getTag('Space') * 1.1, `タグ: Space`);
  if (tagMap.has('Artificial Intelligence')) addScore('sf_fantasy', getTag('Artificial Intelligence') * 1.1, `タグ: AI`);
  if (tagMap.has('Virtual World')) addScore('sf_fantasy', getTag('Virtual World') * 1.1, `タグ: Virtual World`);
  if (tagMap.has('Urban Fantasy')) addScore('sf_fantasy', getTag('Urban Fantasy') * 0.8, `タグ: Urban Fantasy`);
  if (tagMap.has('Post-Apocalyptic')) addScore('sf_fantasy', getTag('Post-Apocalyptic') * 0.9, `タグ: Post-Apocalyptic`);
  if (/(?:葬送のフリーレン|フリーレン|魔女の旅々|ダンジョン飯|ダンまち|ダンジョンに出会いを|STEINS;GATE|シュタゲ|Dr.STONE|ドクターストーン|サマーウォーズ|とある魔術|禁書目録|メイドインアビス|ウィストリア|シャンフロ|シャングリラ・フロンティア|SAO|ソードアート|電脳コイル|攻殻機動隊|ヴィヴィ|Vivy|寄生獣|ハクメイとミコチ|虫師|夏目友人帳|宇宙戦艦ヤマト|マギ The labyrinth|マギ シンドバッド|マリオ|プラスティック・メモリーズ|プラメモ|BEATLESS|ビートレス|AYAKA|トイ・ストーリー|神椿市|FF:U|ファイナルファンタジー|グルグル|魔法陣グルグル|ワンダーエッグ|xxxHOLiC|ホリック|COWBOY BEBOP|カウボーイビバップ|しらぬひ|サイレント・ウィッチ|とんがり帽子のアトリエ|ある魔女が死ぬまで|魔術師クノン)/i.test(t)) {
    addScore('sf_fantasy', 140, `代表SF/ファンタジータイトル`);
  }

  // 最高得点カテゴリの判定
  let bestCat = 'other';
  let maxScore = 20;

  for (const catId of Object.keys(scores)) {
    if (catId === 'other') continue;
    const s = scores[catId] || 0;
    if (s > maxScore) {
      maxScore = s;
      bestCat = catId;
    }
  }

  // セーフティネット推論
  if (bestCat === 'other') {
    const inferred = ClientAnalyzer.prototype.inferCategoryFromTitle ? ClientAnalyzer.prototype.inferCategoryFromTitle(t) : 'other';
    if (inferred && inferred !== 'other') {
      bestCat = inferred;
      maxScore = 60;
    }
  }

  return {
    category: bestCat,
    score: Math.round(maxScore),
    scores,
    reasons
  };
}

function classifyAnimeScored(genres = [], tags = [], title = '') {
  return scoreAnimeDetailed(genres, tags, title).category;
}

/**
 * ブラウザからAniList GraphQL APIを直接叩いてタグ・ジャンルを取得（CORS完全対応）
 */
async function fetchAniListMediaInBrowser(title) {
  if (!title) return null;
  const cleanTitle = title
    .replace(/\s*(?:第?\d+[期巻話]|1st|2nd|3rd|Season|シーズン|OVA|OAD|劇場版|映画|THE MOVIE|前編|後編|完結編|ディレクターズカット).*$/i, '')
    .trim();

  const query = `
    query ($search: String) {
      Page(page: 1, perPage: 6) {
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          id
          title { romaji english native }
          format
          popularity
          genres
          tags { name rank }
        }
      }
    }
  `;

  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query, variables: { search: cleanTitle || title } })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const mediaList = data?.data?.Page?.media || [];
    if (mediaList.length === 0) return null;

    let bestMedia = mediaList[0];
    for (const m of mediaList) {
      const titles = [m.title?.native, m.title?.romaji, m.title?.english].filter(Boolean);
      if (titles.some(t => t.toLowerCase() === title.toLowerCase())) {
        bestMedia = m;
        break;
      }
    }
    return {
      genres: bestMedia.genres || [],
      tags: bestMedia.tags || []
    };
  } catch (e) {
    console.warn('[AniList Browser Direct] Failed:', title, e.message);
    return null;
  }
}

// グローバルスコープへの公開
if (typeof window !== 'undefined') {
  window.ClientAnalyzer = ClientAnalyzer;
  window.scoreAnimeDetailed = scoreAnimeDetailed;
  window.classifyAnimeScored = classifyAnimeScored;
  window.fetchAniListMediaInBrowser = fetchAniListMediaInBrowser;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ClientAnalyzer,
    scoreAnimeDetailed,
    classifyAnimeScored,
    fetchAniListMediaInBrowser
  };
}
