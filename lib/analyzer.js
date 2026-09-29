'use strict';

/**
 * 視聴データ分析・集合演算エンジン
 */
class Analyzer {
  /**
   * @param {Object.<string, Array<{id: string, title: string, image: string, season: string, url: string}>>} userWatchedLists
   */
  constructor(userWatchedLists) {
    this.userWatchedLists = userWatchedLists;
    this.users = Object.keys(userWatchedLists);

    // 作品IDでMap化
    this.userAnimeMaps = {};
    for (const u of this.users) {
      const map = new Map();
      for (const a of userWatchedLists[u] || []) {
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

    // 全作品の一意なリストを作成
    const allAnimesMap = new Map();
    for (const u of allUsers) {
      for (const a of this.userWatchedLists[u] || []) {
        if (!allAnimesMap.has(String(a.id))) {
          allAnimesMap.set(String(a.id), a);
        }
      }
    }

    // 各作品について「誰が見ているか」を集計
    const animeWatchers = new Map();
    for (const [id, anime] of allAnimesMap.entries()) {
      const watchers = allUsers.filter(u => this.userAnimeMaps[u]?.has(id));
      animeWatchers.set(id, { anime, watchers });
    }

    // 1. 全員が見ているアニメ
    const watchedByAll = [];
    // 2. この人だけが見ているアニメ（ユーザー別）
    const exclusivePerUser = {};
    for (const u of allUsers) {
      exclusivePerUser[u] = [];
    }
    // 3. この人以外みんな見ているアニメ（「未履修枠」・「逆張り枠」）
    const missingPerUser = {};
    for (const u of allUsers) {
      missingPerUser[u] = [];
    }

    for (const [, item] of animeWatchers.entries()) {
      const { anime, watchers } = item;

      // 全員
      if (watchers.length === allUsers.length && allUsers.length > 1) {
        watchedByAll.push(anime);
      }

      // 1人だけ
      if (watchers.length === 1) {
        exclusivePerUser[watchers[0]].push(anime);
      }

      // この人だけ見ていない（N-1 人が見ている）
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
   * 完全な分析レポートオブジェクトを生成
   */
  buildFullReport() {
    const defaultVennUsers = this.users.slice(0, 3);
    const vennSets = this.generateVennSets(defaultVennUsers);
    const { matrix, ranking } = this.calculateSimilarityMatrix();
    const insights = this.generateInsights();

    // ユーザーサマリー
    const userSummary = this.users.map(u => ({
      username: u,
      count: this.userWatchedLists[u]?.length || 0,
      exclusiveCount: insights.exclusivePerUser?.[u]?.length || 0,
      missingCount: insights.missingPerUser?.[u]?.length || 0
    }));

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
      userWatchedLists: this.userWatchedLists
    };
  }
}

module.exports = Analyzer;
