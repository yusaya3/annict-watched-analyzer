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
   * 完全な分析レポートオブジェクトを生成（所要時間: 0.05秒）
   */
  buildFullReport(baseLabs = null) {
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

    // Labsレポート（カロリー・年代はリアルタイム再計算、ジャンル・スタジオはbaseLabsから引き継ぎ/補完）
    const labs = baseLabs ? { ...baseLabs } : {};
    labs.calorieReport = this.calculateCalories();
    labs.timelineReport = this.calculateTimeline();

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
