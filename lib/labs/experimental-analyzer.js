'use strict';

const { AnalyzerEngine } = require('../../static/core/analyzer-engine.js');

/**
 * 視聴傾向分析エンジン（単一ソース AnalyzerEngine をラップ）
 */
class ExperimentalAnalyzer {
  constructor(userWatchedLists) {
    this.engine = new AnalyzerEngine(userWatchedLists);
    this.userWatchedLists = this.engine.userWatchedLists;
    this.users = this.engine.users;
  }

  calculateCalories() {
    return this.engine.calculateCalories();
  }

  calculateTimeline() {
    return this.engine.calculateTimeline();
  }

  calculateStudioPreferences(genreMap = {}) {
    return this.engine.calculateStudioPreferences(genreMap);
  }

  calculateGenres(genreMap = {}) {
    return this.engine.calculateGenres(genreMap);
  }

  calculateGenresScored(genreMap = {}) {
    return this.engine.calculateGenres(genreMap);
  }

  generateLabsReport(genreMap = {}) {
    const genreReportScored = this.engine.calculateGenres(genreMap);
    return {
      calorieReport: this.engine.calculateCalories(),
      timelineReport: this.engine.calculateTimeline(),
      studioReport: this.engine.calculateStudioPreferences(genreMap),
      genreReportScored
    };
  }
}

module.exports = ExperimentalAnalyzer;
