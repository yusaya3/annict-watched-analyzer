'use strict';

const { STUDIOS, identifyStudio } = require('./studio-dictionary.js');
const { GENRE_DEFINITIONS, classifyAnime } = require('./genre-client.js');
const { scoreAnimeDetailed, classifyAnimeScored } = require('./genre-scorer.js');

function parseSeasonWeight(seasonStr) {
  if (!seasonStr) return 0;
  const m = seasonStr.match(/(\d{4})年?(冬|春|夏|秋)?/);
  if (!m) return 0;
  const year = parseInt(m[1], 10) || 0;
  const sMap = { '冬': 1, '春': 2, '夏': 3, '秋': 4 };
  const seasonWeight = sMap[m[2]] || 0;
  return year * 10 + seasonWeight;
}

/**
 * お試し機能（Labs）専用分析エンジン
 * コアロジックから完全に独立して動作可能
 */
class ExperimentalAnalyzer {
  /**
   * @param {Object.<string, Array<{id: string, title: string, image: string, season: string, url: string}>>} userWatchedLists
   */
  constructor(userWatchedLists) {
    this.userWatchedLists = userWatchedLists;
    this.users = Object.keys(userWatchedLists);
  }

  /**
   * 1. 視聴カロリー（総鑑賞時間・人生換算）の算出
   */
  calculateCalories() {
    const caloriesByUser = {};

    for (const username of this.users) {
      const list = this.userWatchedLists[username] || [];
      let totalMinutes = 0;
      let movieCount = 0;
      let tvCount = 0;
      let ovaCount = 0;

      for (const anime of list) {
        const title = (anime.title || '').toLowerCase();
        let minutes = 288; // デフォルト: 1クール (12話 × 24分)

        if (title.includes('劇場版') || title.includes('映画') || title.includes('the movie') || title.includes('film')) {
          minutes = 110; // 映画
          movieCount++;
        } else if (title.includes('ova') || title.includes('oad') || title.includes('短編') || title.includes('ちび')) {
          minutes = 45; // OVA・短編
          ovaCount++;
        } else if (title.includes('第2クール') || title.includes('2クール') || title.includes('2nd season') || title.includes('第2期')) {
          minutes = 576; // 2クール
          tvCount++;
        } else {
          tvCount++;
        }

        totalMinutes += minutes;
      }

      const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
      const totalDays = Math.round((totalHours / 24) * 10) / 10; // 24時間不眠不休で換算
      const wakingDays = Math.round((totalHours / 16) * 10) / 10; // 起きている時間(16h/日)換算

      // 人生の可処分時間（仮に過去10年間の活動時間の何％をアニメに費やしたか）
      const tenYearsWakingHours = 10 * 365 * 16;
      const lifePercentage = Math.round((totalHours / tenYearsWakingHours) * 1000) / 10;

      // 視聴規模レベル
      let titleLevel = 'ライト';
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
        breakdown: {
          tvCount,
          movieCount,
          ovaCount
        }
      };
    }

    return caloriesByUser;
  }

  /**
   * 2. 年代別タイムライン分析（放送年分布 ＆ 僕らの青春黄金期）
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

    for (const username of this.users) {
      const list = this.userWatchedLists[username] || [];
      const yearCountMap = {};
      const animesByYear = {};
      const bucketCounts = {};
      eraBuckets.forEach(b => { bucketCounts[b.id] = 0; });

      for (const anime of list) {
        let year = null;
        if (anime.season) {
          const m = anime.season.match(/(\d{4})年/);
          if (m) year = parseInt(m[1], 10);
        }

        if (year) {
          allYearsSet.add(year);
          yearCountMap[year] = (yearCountMap[year] || 0) + 1;
          if (!animesByYear[year]) animesByYear[year] = [];
          animesByYear[year].push(anime);

          for (const b of eraBuckets) {
            if (year >= b.start && year <= b.end) {
              bucketCounts[b.id]++;
              break;
            }
          }
        }
      }

      // 最も多く見た年（その人の個人的ピーク年）
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

    // 1年ごとの全年一覧（降順: 2026, 2025...）
    const allYears = Array.from(allYearsSet).sort((a, b) => b - a);

    // 1年ごとのサマリー統計
    const yearStats = allYears.map(year => {
      let totalCount = 0;
      const countsByUser = {};
      const animesByUser = {};
      for (const u of this.users) {
        const cnt = yearsByUser[u]?.yearCounts?.[year] || 0;
        countsByUser[u] = cnt;
        animesByUser[u] = yearsByUser[u]?.animesByYear?.[year] || [];
        totalCount += cnt;
      }
      return {
        year,
        totalCount,
        countsByUser,
        animesByUser
      };
    });

    // 2人の「共通の青春黄金期」の算出
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
      allYears,
      yearStats,
      yearsByUser,
      goldenYears
    };
  }

  /**
   * 3. 制作スタジオ（アニメ会社）偏愛度分析
   */
  calculateStudioPreferences() {
    const studioStatsByUser = {};

    for (const username of this.users) {
      const list = this.userWatchedLists[username] || [];
      const studioMap = new Map();

      // 初期化
      for (const s of STUDIOS) {
        studioMap.set(s.name, {
          name: s.name,
          short: s.short,
          color: s.color,
          count: 0,
          animes: []
        });
      }

      for (const anime of list) {
        const studio = identifyStudio(anime.title);
        if (studio) {
          const entry = studioMap.get(studio.name);
          entry.count++;
          entry.animes.push(anime);
        }
      }

      const studioRankings = Array.from(studioMap.values())
        .filter(s => s.count > 0)
        .sort((a, b) => b.count - a.count);

      // 最多スタジオ
      let studioTitle = 'バランス型';
      if (studioRankings.length > 0) {
        const top = studioRankings[0];
        studioTitle = `${top.name} 最多 (${top.count}作品)`;
      }

      studioStatsByUser[username] = {
        username,
        studioTitle,
        rankings: studioRankings
      };
    }

    return {
      allStudios: STUDIOS,
      studioStatsByUser
    };
  }

  /**
   * 4. ジャンル別視聴傾向分析（15カテゴリ分類）
   * @param {Object.<string, {genres: string[], tags: {name:string,rank:number}[], category: string}>} genreMap
   */
  calculateGenres(genreMap = {}) {
    const statsByUser = {};
    const genreSummary = {};

    // 15カテゴリの初期化
    for (const g of GENRE_DEFINITIONS) {
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

    // ユーザーごとの集計（各作品は1カテゴリのみに分類）
    for (const username of this.users) {
      const list = this.userWatchedLists[username] || [];
      const userGenreCounts = {};
      const userGenreAnimes = {};

      for (const g of GENRE_DEFINITIONS) {
        userGenreCounts[g.id] = 0;
        userGenreAnimes[g.id] = [];
      }

      for (const anime of list) {
        const entry = genreMap[anime.title];
        let categoryId = entry?.category;
        if (!categoryId) {
          const genres = Array.isArray(entry) ? entry : (entry?.genres || []);
          const tags = Array.isArray(entry?.tags) ? entry.tags : [];
          categoryId = classifyAnime(genres, tags, anime.title);
        }

        if (genreSummary[categoryId]) {
          userGenreCounts[categoryId]++;
          userGenreAnimes[categoryId].push(anime);
          genreSummary[categoryId].userCounts[username]++;
          genreSummary[categoryId].animesByUser[username].push(anime);
        }
      }

      const totalListCount = list.length || 1;
      const genreList = GENRE_DEFINITIONS.map(g => {
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

    // 各ジャンルの総合統計と比率算出
    for (const g of GENRE_DEFINITIONS) {
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

    // 全ユーザーの鑑賞数が多い順にソートしたジャンルリスト
    const sortedGenres = Object.values(genreSummary).sort((a, b) => b.totalWorksAcrossUsers - a.totalWorksAcrossUsers);

    return {
      definitions: GENRE_DEFINITIONS,
      statsByUser,
      genres: sortedGenres
    };
  }

  /**
   * 4-B. 新・重み付けスコアリング方式によるジャンル別視聴傾向分析
   * @param {Object.<string, {genres: string[], tags: {name:string,rank:number}[]}>} genreMap
   */
  calculateGenresScored(genreMap = {}) {
    const statsByUser = {};
    const genreSummary = {};

    for (const g of GENRE_DEFINITIONS) {
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

      for (const g of GENRE_DEFINITIONS) {
        userGenreCounts[g.id] = 0;
        userGenreAnimes[g.id] = [];
      }

      for (const anime of list) {
        const entry = genreMap[anime.title];
        const genres = Array.isArray(entry) ? entry : (entry?.genres || []);
        const tags = Array.isArray(entry?.tags) ? entry.tags : [];
        const categoryId = classifyAnimeScored(genres, tags, anime.title);

        if (genreSummary[categoryId]) {
          userGenreCounts[categoryId]++;
          userGenreAnimes[categoryId].push(anime);
          genreSummary[categoryId].userCounts[username]++;
          genreSummary[categoryId].animesByUser[username].push(anime);
        }
      }

      const totalListCount = list.length || 1;
      const genreList = GENRE_DEFINITIONS.map(g => {
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

    for (const g of GENRE_DEFINITIONS) {
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
      definitions: GENRE_DEFINITIONS,
      statsByUser,
      genres: sortedGenres
    };
  }

  /**
   * 4-C. 旧方式 vs 新方式の差分比較レポート生成
   * @param {Object.<string, {genres: string[], tags: {name:string,rank:number}[]}>} genreMap
   */
  calculateGenreDiffs(genreMap = {}) {
    // ユニーク作品マップ（タイトル別）
    const worksMap = new Map();
    for (const username of this.users) {
      for (const a of this.userWatchedLists[username] || []) {
        if (!worksMap.has(a.title)) {
          worksMap.set(a.title, {
            id: a.id,
            title: a.title,
            image: a.image,
            season: a.season,
            url: a.url,
            watchedBy: []
          });
        }
        worksMap.get(a.title).watchedBy.push(username);
      }
    }

    const diffs = [];
    let sameCount = 0;

    for (const [title, work] of worksMap.entries()) {
      const entry = genreMap[title];
      const genres = Array.isArray(entry) ? entry : (entry?.genres || []);
      const tags = Array.isArray(entry?.tags) ? entry.tags : [];

      const legacyCategory = classifyAnime(genres, tags, title);
      const scoredResult = scoreAnimeDetailed(genres, tags, title);
      const scoredCategory = scoredResult.category;

      if (legacyCategory === scoredCategory) {
        sameCount++;
      } else {
        diffs.push({
          id: work.id,
          title: work.title,
          image: work.image,
          season: work.season,
          url: work.url,
          watchedBy: work.watchedBy,
          legacyCategory,
          scoredCategory,
          score: scoredResult.score,
          topReasons: scoredResult.topReasons
        });
      }
    }

    // 視聴人数が多い順にソート（重要作品を上位に）
    diffs.sort((a, b) => b.watchedBy.length - a.watchedBy.length || b.score - a.score);

    return {
      totalWorks: worksMap.size,
      sameCount,
      diffCount: diffs.length,
      diffPercentage: Math.round((diffs.length / (worksMap.size || 1)) * 100),
      diffs
    };
  }

  /**
   * お試し機能全体のレポートを作成
   */
  generateLabsReport(genreMap = {}) {
    return {
      calorieReport: this.calculateCalories(),
      timelineReport: this.calculateTimeline(),
      studioReport: this.calculateStudioPreferences(),
      genreReport: this.calculateGenres(genreMap),
      genreReportScored: this.calculateGenresScored(genreMap),
      genreDiffReport: this.calculateGenreDiffs(genreMap)
    };
  }
}

module.exports = ExperimentalAnalyzer;
