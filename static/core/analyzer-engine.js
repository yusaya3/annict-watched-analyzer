(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    const GenreEngine = require('./genre-engine.js');
    const StudioDictionary = require('./studio-dictionary.js');
    module.exports = factory(GenreEngine, StudioDictionary);
  } else {
    root.AnalyzerEngine = factory(root.GenreEngine, root.StudioDictionary);
  }
}(typeof self !== 'undefined' ? self : this, function (GenreEngine, StudioDictionary) {
  'use strict';

  const SEASON_WEIGHT_MAP = { '冬': 1, '春': 2, '夏': 3, '秋': 4 };

  /**
   * シーズン文字列を数値重みに変換（例: "2024年夏" -> 20243）
   * @param {string} seasonStr
   * @returns {number}
   */
  function parseSeasonWeight(seasonStr) {
    if (!seasonStr) return 0;
    const m = String(seasonStr).match(/(\d{4})年?(冬|春|夏|秋)?/);
    if (!m) return 0;
    const year = parseInt(m[1], 10) || 0;
    const seasonWeight = SEASON_WEIGHT_MAP[m[2]] || 0;
    return year * 10 + seasonWeight;
  }

  /**
   * シーズン文字列から放送年（数値）を抽出
   * @param {string} seasonStr
   * @returns {number|null}
   */
  function extractYear(seasonStr) {
    if (!seasonStr) return null;
    const m = String(seasonStr).match(/(\d{4})/);
    return m ? parseInt(m[1], 10) : null;
  }

  const IMG_PREFIX = 'https://image.annict.com/';

  function expandAnnictImg(raw) {
    if (!raw) return '';
    return raw.startsWith('http') ? raw : `${IMG_PREFIX}${raw}`;
  }

  function isAnnictImageHost(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return false;
    try {
      const u = new URL(rawUrl);
      return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname === 'image.annict.com';
    } catch (e) {
      return false;
    }
  }

  const jaCollator = typeof Intl !== 'undefined' && typeof Intl.Collator === 'function'
    ? new Intl.Collator('ja')
    : null;

  function compareTitlesJa(a, b) {
    const t1 = a || '';
    const t2 = b || '';
    return jaCollator ? jaCollator.compare(t1, t2) : t1.localeCompare(t2, 'ja');
  }

  /**
   * 共通アニメ配列ソート関数（season-desc / season-asc / title）
   */
  function sortAnimes(list, sortMode = 'season-desc') {
    return [...(list || [])].sort((a, b) => {
      if (sortMode === 'season-desc') {
        const diff = parseSeasonWeight(b.season) - parseSeasonWeight(a.season);
        if (diff !== 0) return diff;
      } else if (sortMode === 'season-asc') {
        const diff = parseSeasonWeight(a.season) - parseSeasonWeight(b.season);
        if (diff !== 0) return diff;
      }
      const t1 = a.title || '';
      const t2 = b.title || '';
      return jaCollator ? jaCollator.compare(t1, t2) : t1.localeCompare(t2, 'ja');
    });
  }

  /**
   * 年代カテゴリ判定（all, 2020s, 2010s, 2000s, classic, unknown）
   * 時期不明作品は90年代へ混入させず分離する
   * @param {string} seasonStr
   * @param {string} era
   * @returns {boolean}
   */
  function matchEra(seasonStr, era) {
    if (!era || era === 'all') return true;
    const year = extractYear(seasonStr);
    if (!year) return era === 'unknown';
    if (era === '2020s') return year >= 2020 && year <= 2029;
    if (era === '2010s') return year >= 2010 && year <= 2019;
    if (era === '2000s') return year >= 2000 && year <= 2009;
    if (era === 'classic' || era === 'older' || era === '1990s') return year < 2000;
    return false;
  }

  /**
   * 作品ID/タイトル向けのジャンル解決ヘルパー
   * @param {string} title
   * @param {Object} genreMap
   * @returns {string}
   */
  function resolveCategoryId(title, genreMap) {
    const entry = genreMap ? genreMap[title] : null;
    const directCat = entry?.c || entry?.category;
    if (directCat && directCat !== 'other' && GenreEngine.GENRE_DEF_MAP[directCat]) {
      return directCat;
    }
    if (entry && (Array.isArray(entry.genres) || Array.isArray(entry.g) || Array.isArray(entry.tags) || Array.isArray(entry.t))) {
      const genres = entry.genres || entry.g || [];
      const tags = entry.tags || entry.t || [];
      const scored = GenreEngine.classifyAnimeScored(genres, tags, title);
      if (scored && scored !== 'other') return scored;
    }
    if (directCat && GenreEngine.GENRE_DEF_MAP[directCat]) {
      const inferred = GenreEngine.inferCategoryFromTitle(title);
      return inferred || 'other';
    }
    return GenreEngine.inferCategoryFromTitle(title) || 'other';
  }

  /**
   * サーバー・ブラウザ両対応 統合分析エンジン
   */
  class AnalyzerEngine {
    /**
     * @param {Object.<string, Array<{id: string, title: string, image: string, season: string, url: string}>>} userWatchedLists
     */
    constructor(userWatchedLists) {
      this.userWatchedLists = userWatchedLists || {};
      this.users = Object.keys(this.userWatchedLists);

      this.userAnimeMaps = {};
      for (let i = 0; i < this.users.length; i++) {
        const u = this.users[i];
        const map = new Map();
        const list = this.userWatchedLists[u] || [];
        for (let j = 0; j < list.length; j++) {
          const a = list[j];
          if (a && a.id !== undefined && a.id !== null) {
            map.set(String(a.id), a);
          }
        }
        this.userAnimeMaps[u] = map;
      }
    }

    /**
     * 指定ユーザー群すべての共通アニメ（積集合）を取得
     * @param {string[]} userGroup
     * @returns {Array}
     */
    getIntersection(userGroup) {
      if (!userGroup || userGroup.length === 0) return [];
      const firstMap = this.userAnimeMaps[userGroup[0]];
      const firstList = firstMap ? Array.from(firstMap.values()) : [];
      if (userGroup.length === 1) return firstList;

      const result = [];
      for (let i = 0; i < firstList.length; i++) {
        const anime = firstList[i];
        const animeId = String(anime.id);
        let allHave = true;
        for (let k = 1; k < userGroup.length; k++) {
          if (!this.userAnimeMaps[userGroup[k]]?.has(animeId)) {
            allHave = false;
            break;
          }
        }
        if (allHave) result.push(anime);
      }
      return result;
    }

    /**
     * 1〜3人の Venn.js 向けデータセットを生成
     * @param {string[]} selectedUsers
     */
    generateVennSets(selectedUsers = this.users.slice(0, 3)) {
      const sets = [];
      const n = selectedUsers.length;
      if (n === 0) return sets;

      for (let i = 0; i < n; i++) {
        const u = selectedUsers[i];
        const uMap = this.userAnimeMaps[u];
        const list = uMap ? Array.from(uMap.values()) : [];
        sets.push({
          sets: [u],
          size: list.length,
          label: `@${u} (${list.length})`,
          animes: list
        });
      }

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
     * Jaccard類似度マトリクスとペアランキングを計算
     */
    calculateSimilarityMatrix() {
      const matrix = [];
      const ranking = [];

      for (let i = 0; i < this.users.length; i++) {
        const u1 = this.users[i];
        const map1 = this.userAnimeMaps[u1];
        const count1 = map1.size;

        for (let j = 0; j < this.users.length; j++) {
          const u2 = this.users[j];

          if (i === j) {
            matrix.push({
              user1: u1,
              user2: u2,
              intersection: count1,
              union: count1,
              similarity: 1.0,
              percentage: 100
            });
            continue;
          }

          const map2 = this.userAnimeMaps[u2];
          let commonCount = 0;
          // 小さい側のマップを反復して高速化
          const [smaller, larger] = map1.size <= map2.size ? [map1, map2] : [map2, map1];
          for (const id of smaller.keys()) {
            if (larger.has(id)) commonCount++;
          }

          const unionCount = map1.size + map2.size - commonCount;
          const similarity = unionCount > 0 ? (commonCount / unionCount) : 0;
          const percentage = Math.round(similarity * 1000) / 10;

          matrix.push({
            user1: u1,
            user2: u2,
            intersection: commonCount,
            union: unionCount,
            similarity,
            percentage
          });

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

      ranking.sort((a, b) => b.similarity - a.similarity || b.intersection - a.intersection);
      return { matrix, ranking };
    }

    /**
     * 会話ネタ・インサイトデータ生成
     */
    generateInsights() {
      const allUsers = this.users;
      if (allUsers.length === 0) {
        return { watchedByAll: [], exclusivePerUser: {}, missingPerUser: {}, totalUniqueAnimes: 0 };
      }

      const animeWatchers = new Map();
      for (let i = 0; i < allUsers.length; i++) {
        const u = allUsers[i];
        const mapU = this.userAnimeMaps[u];
        const list = mapU ? Array.from(mapU.values()) : [];
        for (let j = 0; j < list.length; j++) {
          const a = list[j];
          const id = String(a.id);
          let entry = animeWatchers.get(id);
          if (!entry) {
            entry = { anime: a, watchers: [u] };
            animeWatchers.set(id, entry);
          } else if (entry.watchers[entry.watchers.length - 1] !== u && !entry.watchers.includes(u)) {
            entry.watchers.push(u);
          }
        }
      }

      const watchedByAll = [];
      const exclusivePerUser = {};
      const missingPerUser = {};
      for (let i = 0; i < allUsers.length; i++) {
        exclusivePerUser[allUsers[i]] = [];
        missingPerUser[allUsers[i]] = [];
      }

      const totalUsersCount = allUsers.length;

      for (const { anime, watchers } of animeWatchers.values()) {
        if (watchers.length === totalUsersCount && totalUsersCount > 1) {
          watchedByAll.push(anime);
        }
        if (watchers.length === 1) {
          exclusivePerUser[watchers[0]].push(anime);
        }
        if (totalUsersCount >= 3 && watchers.length === totalUsersCount - 1) {
          const watcherSet = new Set(watchers);
          for (let i = 0; i < totalUsersCount; i++) {
            const u = allUsers[i];
            if (!watcherSet.has(u)) {
              missingPerUser[u].push(anime);
              break;
            }
          }
        }
      }

      return {
        watchedByAll,
        exclusivePerUser,
        missingPerUser,
        totalUniqueAnimes: animeWatchers.size
      };
    }

    /**
     * 総視聴時間（視聴カロリー）算出
     */
    calculateCalories() {
      const caloriesByUser = {};
      const tenYearsWakingHours = 10 * 365 * 16;

      for (let i = 0; i < this.users.length; i++) {
        const username = this.users[i];
        const list = this.userAnimeMaps[username] ? Array.from(this.userAnimeMaps[username].values()) : [];
        let totalMinutes = 0;
        let movieCount = 0;
        let tvCount = 0;
        let ovaCount = 0;

        for (let j = 0; j < list.length; j++) {
          const item = list[j];
          const title = (item.title || '').toLowerCase();
          const media = String(item.media || '').toUpperCase();
          const epCount = Number(item.episodesCount);

          const isTvSeries = media === 'TV' || (Number.isFinite(epCount) && epCount > 1);

          if (media === 'MOVIE' || (!isTvSeries && (title.includes('劇場版') || title.includes('映画') || title.includes('the movie') || /\bfilm\b/.test(title)))) {
            totalMinutes += 110;
            movieCount++;
          } else if (media === 'OVA' || (!isTvSeries && /\bova\b|\boad\b|短編|特別編/.test(title))) {
            totalMinutes += (Number.isFinite(epCount) && epCount > 0) ? epCount * 24 : 45;
            ovaCount++;
          } else if (Number.isFinite(epCount) && epCount > 0) {
            totalMinutes += epCount * 24;
            tvCount++;
          } else if (title.includes('第2クール') || title.includes('2クール')) {
            totalMinutes += 576;
            tvCount++;
          } else {
            totalMinutes += 288;
            tvCount++;
          }
        }

        const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
        const totalDays = Math.round((totalHours / 24) * 10) / 10;
        const wakingDays = Math.round((totalHours / 16) * 10) / 10;
        const lifePercentage = Math.round((totalHours / tenYearsWakingHours) * 1000) / 10;

        let titleLevel = 'ビギナー';
        if (totalHours >= 2000) titleLevel = '超ヘビー (2,000h+)';
        else if (totalHours >= 1000) titleLevel = 'ヘビー (1,000h+)';
        else if (totalHours >= 500) titleLevel = 'ミドル (500h+)';
        else if (totalHours >= 200) titleLevel = 'レギュラー (200h+)';
        else if (totalHours >= 50) titleLevel = 'ライト (50h+)';

        caloriesByUser[username] = {
          username,
          workCount: list.length,
          totalHours,
          totalDays,
          wakingDays,
          lifePercentage,
          titleLevel,
          breakdown: { tvCount, movieCount, ovaCount }
        };
      }

      return caloriesByUser;
    }

    /**
     * 年代別タイムライン分析（1年ごと・5年ごと）
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

      const allYearsSet = new Set();

      for (let i = 0; i < this.users.length; i++) {
        const username = this.users[i];
        const list = this.userAnimeMaps[username] ? Array.from(this.userAnimeMaps[username].values()) : [];
        const yearCountMap = {};
        const animesByYear = {};
        const bucketCounts = {};
        for (let b = 0; b < eraBuckets.length; b++) {
          bucketCounts[eraBuckets[b].id] = 0;
        }

        for (let j = 0; j < list.length; j++) {
          const anime = list[j];
          const year = extractYear(anime.season);
          if (year) {
            allYearsSet.add(year);
            yearCountMap[year] = (yearCountMap[year] || 0) + 1;
            if (!animesByYear[year]) animesByYear[year] = [];
            animesByYear[year].push(anime);

            for (let b = 0; b < eraBuckets.length; b++) {
              const bucket = eraBuckets[b];
              if (year >= bucket.start && year <= bucket.end) {
                bucketCounts[bucket.id]++;
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
          animesByYear,
          bucketCounts
        };
      }

      const allYears = Array.from(allYearsSet).sort((a, b) => b - a);
      const yearStats = allYears.map(year => {
        let totalCount = 0;
        const countsByUser = {};
        const animesByUser = {};
        for (let i = 0; i < this.users.length; i++) {
          const u = this.users[i];
          const cnt = yearsByUser[u]?.yearCounts?.[year] || 0;
          countsByUser[u] = cnt;
          animesByUser[u] = yearsByUser[u]?.animesByYear?.[year] || [];
          totalCount += cnt;
        }
        return { year, totalCount, countsByUser, animesByUser };
      });

      return {
        eraBuckets,
        allYears,
        yearStats,
        yearsByUser
      };
    }

    /**
     * 制作スタジオ傾向分析（単一ソース・リアルタイム計算対応）
     */
    calculateStudioPreferences() {
      const studioStatsByUser = {};
      const studios = StudioDictionary?.STUDIOS || [];
      const identify = StudioDictionary?.identifyStudio || (() => null);

      for (let i = 0; i < this.users.length; i++) {
        const username = this.users[i];
        const list = this.userAnimeMaps[username] ? Array.from(this.userAnimeMaps[username].values()) : [];
        const studioMap = new Map();

        for (let s = 0; s < studios.length; s++) {
          const st = studios[s];
          studioMap.set(st.name, {
            name: st.name,
            short: st.short,
            color: st.color,
            count: 0,
            animes: []
          });
        }

        for (let j = 0; j < list.length; j++) {
          const anime = list[j];
          const studio = identify(anime.title);
          if (studio) {
            const entry = studioMap.get(studio.name);
            if (entry) {
              entry.count++;
              entry.animes.push(anime);
            }
          }
        }

        const rankings = Array.from(studioMap.values())
          .filter(s => s.count > 0)
          .sort((a, b) => b.count - a.count);

        const studioTitle = rankings.length > 0
          ? `${rankings[0].name} 最多 (${rankings[0].count}作品)`
          : 'バランス型';

        studioStatsByUser[username] = {
          username,
          studioTitle,
          rankings
        };
      }

      return {
        allStudios: studios,
        studioStatsByUser
      };
    }

    /**
     * 15大ジャンル傾向分析（メイン公式重み付けエンジン）
     * @param {Object} genreMap
     */
    calculateGenres(genreMap = {}) {
      const definitions = GenreEngine.GENRE_DEFINITIONS;
      const statsByUser = {};
      const genreSummary = {};

      for (let i = 0; i < definitions.length; i++) {
        const g = definitions[i];
        genreSummary[g.id] = {
          ...g,
          totalWorksAcrossUsers: 0,
          uniqueWorksCount: 0,
          userCounts: {},
          userPercentages: {},
          animesByUser: {}
        };
        for (let u = 0; u < this.users.length; u++) {
          const uname = this.users[u];
          genreSummary[g.id].userCounts[uname] = 0;
          genreSummary[g.id].userPercentages[uname] = 0;
          genreSummary[g.id].animesByUser[uname] = [];
        }
      }

      const uniqueIdsByGenre = {};
      for (let i = 0; i < definitions.length; i++) {
        uniqueIdsByGenre[definitions[i].id] = new Set();
      }

      for (let u = 0; u < this.users.length; u++) {
        const username = this.users[u];
        const list = this.userAnimeMaps[username] ? Array.from(this.userAnimeMaps[username].values()) : [];
        const userGenreCounts = {};
        const userGenreAnimes = {};

        for (let i = 0; i < definitions.length; i++) {
          const id = definitions[i].id;
          userGenreCounts[id] = 0;
          userGenreAnimes[id] = [];
        }

        for (let j = 0; j < list.length; j++) {
          const anime = list[j];
          const categoryId = resolveCategoryId(anime.title, genreMap);
          if (genreSummary[categoryId]) {
            userGenreCounts[categoryId]++;
            userGenreAnimes[categoryId].push(anime);
            genreSummary[categoryId].userCounts[username]++;
            genreSummary[categoryId].animesByUser[username].push(anime);
            uniqueIdsByGenre[categoryId].add(String(anime.id || anime.title));
          }
        }

        const totalListCount = list.length || 1;
        const genreList = definitions.map(g => {
          const count = userGenreCounts[g.id];
          const pct = Math.round((count / totalListCount) * 1000) / 10;
          return {
            id: g.id,
            label: g.label,
            labelEn: g.labelEn,
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

      for (let i = 0; i < definitions.length; i++) {
        const g = definitions[i];
        const summary = genreSummary[g.id];
        let maxUser = null;
        let maxCount = -1;
        let totalWorks = 0;

        for (let u = 0; u < this.users.length; u++) {
          const uname = this.users[u];
          const userTotal = (this.userAnimeMaps[uname]?.size) || 1;
          const cnt = summary.userCounts[uname];
          summary.userPercentages[uname] = Math.round((cnt / userTotal) * 1000) / 10;
          totalWorks += cnt;
          if (cnt > maxCount) {
            maxCount = cnt;
            maxUser = uname;
          }
        }

        summary.totalWorksAcrossUsers = totalWorks;
        summary.uniqueWorksCount = uniqueIdsByGenre[g.id].size;
        summary.topUser = maxCount > 0 ? { username: maxUser, count: maxCount } : null;
      }

      const sortedGenres = Object.values(genreSummary).sort(
        (a, b) => b.uniqueWorksCount - a.uniqueWorksCount || b.totalWorksAcrossUsers - a.totalWorksAcrossUsers
      );

      return {
        definitions,
        statsByUser,
        genres: sortedGenres
      };
    }

    /**
     * 完全レポート生成
     * @param {Object} genreMap
     */
    buildFullReport(genreMap = {}) {
      const defaultVennUsers = this.users.slice(0, 3);
      const vennSets = this.generateVennSets(defaultVennUsers);
      const { matrix, ranking } = this.calculateSimilarityMatrix();
      const insights = this.generateInsights();

      const userSummary = this.users.map(u => ({
        username: u,
        count: this.userAnimeMaps[u]?.size || 0,
        exclusiveCount: insights.exclusivePerUser?.[u]?.length || 0,
        missingCount: insights.missingPerUser?.[u]?.length || 0
      }));

      const labs = {
        calorieReport: this.calculateCalories(),
        timelineReport: this.calculateTimeline(),
        studioReport: this.calculateStudioPreferences(),
        genreReportScored: this.calculateGenres(genreMap)
      };

      return {
        generatedAt: new Date().toISOString(),
        users: this.users,
        userSummary,
        defaultVennUsers,
        vennSets,
        similarity: { matrix, ranking },
        insights,
        labs,
        userWatchedLists: this.userWatchedLists
      };
    }
  }

  return {
    AnalyzerEngine,
    parseSeasonWeight,
    extractYear,
    matchEra,
    resolveCategoryId,
    sortAnimes,
    compareTitlesJa,
    expandAnnictImg,
    isAnnictImageHost
  };
}));
