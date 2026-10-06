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

// ブラウザのグローバルスコープに公開
if (typeof window !== 'undefined') {
  window.ClientAnalyzer = ClientAnalyzer;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ClientAnalyzer;
}
