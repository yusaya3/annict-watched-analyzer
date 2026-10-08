/**
 * ==========================================================================
 * エピソード類似アニメ検索 (Episode Sequence Similarity Search Lab) フロントエンド
 * - dアニメストア配信作品 (1990〜2026) の各エピソード全あらすじベクトル類似度Top30探索
 * - Annictキービジュアル画像連携 ＆ 数珠つなぎ探索
 * ==========================================================================
 */

class EpisodeSimilarityLab {
  constructor() {
    this.data = null;
    this.works = null;
    this.currentWorkId = null;
    this.history = [];
    this.isLoading = false;
    this.filterGenre = 'ALL';
    this.filterEra = 'ALL';
    this.searchDebounceTimer = null;

    // DOM要素の参照
    this.container = null;
  }

  /**
   * 初期化（タブ初期化時またはDOM構築後に呼ばれる）
   */
  async init(containerEl) {
    this.container = containerEl;
    if (!this.container) return;

    this.renderLoading();
    await this.loadData();
    if (!this.data) {
      this.renderError('データの読み込みに失敗しました。');
      return;
    }

    this.renderBaseUI();
    this.bindEvents();

    // 初期表示: クイック候補の先頭、またはランダムな1件を表示
    if (this.data.featured && this.data.featured.length > 0) {
      this.selectWork(this.data.featured[0], false);
    } else {
      const allIds = Object.keys(this.works);
      if (allIds.length > 0) {
        this.selectWork(allIds[0], false);
      }
    }
  }

  /**
   * 静的JSONデータの非同期読み込み
   */
  async loadData() {
    this.isLoading = true;
    try {
      const res = await fetch('./res/episode-similarity-data.json');
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      this.data = await res.json();
      this.works = this.data.works || {};
      console.log(`[EpisodeSimilarity] エピソード類似度データ読込完了: 全 ${this.data.total} 件`);
    } catch (err) {
      console.error('[EpisodeSimilarity] データ読み込みエラー:', err);
      this.data = null;
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * ロード中表示
   */
  renderLoading() {
    this.container.innerHTML = `
      <div class="sim-loading-state">
        <i class="fa-solid fa-spinner sim-loading-spinner"></i>
        <p>エピソード全あらすじ類似度データを読み込み中 (約6,300作品)...</p>
      </div>
    `;
  }

  /**
   * エラー表示
   */
  renderError(msg) {
    this.container.innerHTML = `
      <div class="sim-empty-state">
        <i class="fa-solid fa-triangle-exclamation" style="font-size: 2.5rem; color: var(--accent-pink); margin-bottom: 0.75rem;"></i>
        <p>${this.escapeHtml(msg)}</p>
        <button class="btn btn-outline" style="margin-top: 1rem;" onclick="episodeSimilarityLab.init(document.getElementById('tab-episode-similarity'))">
          <i class="fa-solid fa-rotate-right"></i> 再試行
        </button>
      </div>
    `;
  }

  /**
   * ベースUI（コントロール、起点エリア、Top30エリア）の構築
   */
  renderBaseUI() {
    // 年代グループ（90年代、2000年代、2010年代、2020年代）
    const eraOptions = `
      <option value="ALL">年代: すべて (1990〜2026)</option>
      <option value="2020s">2020年代 (2020〜2026)</option>
      <option value="2010s">2010年代 (2010〜2019)</option>
      <option value="2000s">2000年代 (2000〜2009)</option>
      <option value="1990s">1990年代 (1990〜1999)</option>
    `;

    // ジャンル一覧オプション
    const genreOptions = ['ALL', ...(this.data.genres || [])].map(g => {
      return `<option value="${this.escapeHtml(g)}">${g === 'ALL' ? 'ジャンル: すべて' : this.escapeHtml(g)}</option>`;
    }).join('');

    // おすすめ作品チップ
    const featuredChips = (this.data.featured || []).map(id => {
      const w = this.works[id];
      if (!w) return '';
      return `<button class="sim-chip" data-work-id="${id}" title="${this.escapeHtml(w.t)}">${this.escapeHtml(w.t)}</button>`;
    }).join('');

    this.container.innerHTML = `
      <div class="sim-container">
        <!-- ヒーロー紹介バナー -->
        <div class="sim-hero-banner" style="border-left: 4px solid #38bdf8;">
          <div class="sim-hero-text">
            <h2><i class="fa-solid fa-list-ol" style="color: #38bdf8;"></i> 全話エピソードあらすじ・類似アニメ探索</h2>
            <p>dアニメストア配信（1990〜2026）全作品の【各エピソード全あらすじ（時系列ストーリー展開）】をもとにAIベクトル化。作品全体のストーリー構成や展開が近い<strong>Top30作品</strong>をAnnict公式キービジュアルと共に表示します。（全 <strong>${this.data.total.toLocaleString()}</strong> 作品収録）</p>
          </div>
          <div class="sim-hero-actions">
            <button id="ep-sim-btn-random" class="sim-btn-random" title="ランダムな作品から探す">
              <i class="fa-solid fa-dice"></i> 🎲 ランダム作品
            </button>
          </div>
        </div>

        <!-- 検索・フィルターカード -->
        <div class="sim-controls-card">
          <div class="sim-search-bar-wrap">
            <div class="sim-search-input-box">
              <i class="fa-solid fa-magnifying-glass search-icon"></i>
              <input type="text" id="ep-sim-search-input" class="sim-search-input" placeholder="作品名を入力して検索（例: フリーレン, ぼっち, 幼女戦記, ガンダム...）" autocomplete="off" />
              <button id="ep-sim-search-clear" class="sim-search-clear" style="display:none;" title="クリア">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
            <!-- サジェスト結果ドロップダウン -->
            <div id="ep-sim-dropdown-results" class="sim-dropdown-results"></div>
          </div>

          <!-- フィルター行 -->
          <div class="sim-filter-row">
            <div class="sim-select-wrap">
              <i class="fa-solid fa-calendar"></i>
              <select id="ep-sim-filter-era" class="sim-select">
                ${eraOptions}
              </select>
            </div>
            <div class="sim-select-wrap">
              <i class="fa-solid fa-tags"></i>
              <select id="ep-sim-filter-genre" class="sim-select">
                ${genreOptions}
              </select>
            </div>
          </div>

          <!-- クイック候補タグ -->
          <div class="sim-quick-tags-wrap">
            <span class="sim-quick-label"><i class="fa-solid fa-fire text-gold"></i> 注目アニメ:</span>
            <div id="ep-sim-chips-container" class="sim-chips-list">
              ${featuredChips}
            </div>
          </div>

          <!-- 探索履歴（パンくず） -->
          <div id="ep-sim-history-bar" class="sim-history-bar" style="display: none;">
            <span class="sim-history-label"><i class="fa-solid fa-route"></i> 探索ルート:</span>
            <div id="ep-sim-history-crumbs" style="display: flex; gap: 0.4rem; align-items: center; overflow-x: auto;"></div>
          </div>
        </div>

        <!-- 現在選択中の起点アニメカード -->
        <div id="ep-sim-current-section"></div>

        <!-- 類似度Top30 グリッド -->
        <div id="ep-sim-top30-section"></div>
      </div>
    `;
  }

  /**
   * イベントリスナーの登録
   */
  bindEvents() {
    const searchInput = document.getElementById('ep-sim-search-input');
    const searchClear = document.getElementById('ep-sim-search-clear');
    const dropdown = document.getElementById('ep-sim-dropdown-results');
    const btnRandom = document.getElementById('ep-sim-btn-random');
    const filterEra = document.getElementById('ep-sim-filter-era');
    const filterGenre = document.getElementById('ep-sim-filter-genre');
    const chipsContainer = document.getElementById('ep-sim-chips-container');

    // 検索窓入力イベント
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        searchClear.style.display = query ? 'inline-block' : 'none';

        clearTimeout(this.searchDebounceTimer);
        this.searchDebounceTimer = setTimeout(() => {
          this.handleSearch(query);
        }, 150);
      });

      searchInput.addEventListener('focus', () => {
        if (searchInput.value.trim()) {
          this.handleSearch(searchInput.value.trim());
        }
      });
    }

    // 検索クリア
    if (searchClear) {
      searchClear.addEventListener('click', () => {
        searchInput.value = '';
        searchClear.style.display = 'none';
        dropdown.classList.remove('active');
        dropdown.innerHTML = '';
        searchInput.focus();
      });
    }

    // ドキュメントクリックでドロップダウンを閉じる
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#tab-episode-similarity .sim-search-bar-wrap')) {
        if (dropdown) dropdown.classList.remove('active');
      }
    });

    // ランダムボタン
    if (btnRandom) {
      btnRandom.addEventListener('click', () => {
        this.selectRandomWork();
      });
    }

    // フィルター変更
    if (filterEra) {
      filterEra.addEventListener('change', (e) => {
        this.filterEra = e.target.value;
        this.renderSimilarGrid();
      });
    }

    if (filterGenre) {
      filterGenre.addEventListener('change', (e) => {
        this.filterGenre = e.target.value;
        this.renderSimilarGrid();
      });
    }

    // 注目アニメチップクリック
    if (chipsContainer) {
      chipsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.sim-chip');
        if (btn) {
          const wid = btn.getAttribute('data-work-id');
          if (wid) {
            this.selectWork(wid, true);
          }
        }
      });
    }
  }

  /**
   * ランダムな作品を選択
   */
  selectRandomWork() {
    const allIds = Object.keys(this.works);
    if (allIds.length === 0) return;
    const randomId = allIds[Math.floor(Math.random() * allIds.length)];
    this.selectWork(randomId, true);
  }

  /**
   * 作品を選択して表示を更新
   */
  selectWork(workId, addToHistory = true) {
    if (!this.works || !this.works[workId]) return;

    if (this.currentWorkId === workId) return;

    this.currentWorkId = workId;

    if (addToHistory) {
      if (!this.history.includes(workId)) {
        this.history.push(workId);
        if (this.history.length > 8) {
          this.history.shift();
        }
      }
    } else {
      if (this.history.length === 0) {
        this.history.push(workId);
      }
    }

    this.updateHistoryBar();
    this.renderCurrentWork();
    this.renderSimilarGrid();

    // 選択された起点アニメカードへスムーズスクロール（検索から選んだ場合など）
    const currentSection = document.getElementById('ep-sim-current-section');
    if (currentSection && addToHistory) {
      currentSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /**
   * 履歴パンくずの更新
   */
  updateHistoryBar() {
    const bar = document.getElementById('ep-sim-history-bar');
    const crumbs = document.getElementById('ep-sim-history-crumbs');
    if (!bar || !crumbs) return;

    if (this.history.length <= 1) {
      bar.style.display = 'none';
      return;
    }

    bar.style.display = 'flex';
    crumbs.innerHTML = this.history.map((id, idx) => {
      const w = this.works[id];
      if (!w) return '';
      const isCurrent = id === this.currentWorkId;
      const titleShort = w.t.length > 10 ? w.t.substring(0, 10) + '…' : w.t;
      return `
        <button class="sim-crumb-btn ${isCurrent ? 'active' : ''}" data-work-id="${id}" title="${this.escapeHtml(w.t)}">
          ${idx > 0 ? '<span class="sim-crumb-sep">→</span>' : ''}
          ${this.escapeHtml(titleShort)}
        </button>
      `;
    }).join('');

    crumbs.querySelectorAll('.sim-crumb-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const wid = btn.getAttribute('data-work-id');
        if (wid && wid !== this.currentWorkId) {
          this.selectWork(wid, false);
        }
      });
    });
  }

  /**
   * 起点アニメのメインカード描画
   */
  renderCurrentWork() {
    const currentContainer = document.getElementById('ep-sim-current-section');
    if (!currentContainer || !this.currentWorkId) return;

    const work = this.works[this.currentWorkId];
    if (!work) return;

    const safeTitle = this.escapeHtml(work.t);
    const safeSynopsis = work.s ? this.escapeHtml(work.s) : '（あらすじ情報なし）';
    const yearStr = work.y ? `${work.y}年` : '年代不明';
    const genreStr = work.g || '未分類';
    const epStr = (work.ep_total !== undefined && work.ep_total > 0) ? `全${work.ep_total}話` : '';

    const annictLink = work.aid
      ? `<a href="https://annict.com/works/${work.aid}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm" title="Annictで作品詳細を見る"><i class="fa-solid fa-arrow-up-right-from-square"></i> Annict</a>`
      : '';

    const danimeLink = work.url
      ? `<a href="${work.url}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm" title="dアニメストアで視聴する"><i class="fa-solid fa-play"></i> dアニメストア</a>`
      : '';

    currentContainer.innerHTML = `
      <div class="sim-current-card">
        <div class="sim-current-badge">
          <i class="fa-solid fa-location-dot"></i> 現在の起点アニメ (探索中)
        </div>
        <div class="sim-current-layout">
          <!-- ポスター枠（Annict縦長） -->
          <div class="sim-current-poster-box">
            ${this.renderPosterImg(work, safeTitle, 'sim-current-poster')}
          </div>
          <!-- メタ情報＆あらすじ -->
          <div class="sim-current-info">
            <h3 class="sim-current-title">${safeTitle}</h3>
            <div class="sim-meta-tags">
              <span class="sim-badge sim-badge-year"><i class="fa-regular fa-calendar"></i> ${yearStr}</span>
              <span class="sim-badge sim-badge-genre"><i class="fa-solid fa-tag"></i> ${this.escapeHtml(genreStr)}</span>
              ${epStr ? `<span class="sim-badge" style="background:rgba(56,189,248,0.15);color:#38bdf8;border:1px solid rgba(56,189,248,0.3);"><i class="fa-solid fa-list-ol"></i> ${epStr}</span>` : ''}
              ${work.img ? '<span class="sim-badge sim-badge-verified"><i class="fa-solid fa-circle-check"></i> Annict公式ポスター</span>' : ''}
            </div>
            <div class="sim-synopsis-box">
              <p class="sim-synopsis-text">${safeSynopsis}</p>
            </div>
            <div class="sim-action-links">
              ${danimeLink}
              ${annictLink}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 類似度Top30 グリッド描画
   */
  renderSimilarGrid() {
    const gridContainer = document.getElementById('ep-sim-top30-section');
    if (!gridContainer || !this.currentWorkId) return;

    const work = this.works[this.currentWorkId];
    if (!work || !work.top || work.top.length === 0) {
      gridContainer.innerHTML = `
        <div class="sim-empty-state">
          <i class="fa-solid fa-circle-info"></i>
          <p>この作品の類似データが見つかりませんでした。</p>
        </div>
      `;
      return;
    }

    // フィルタリング適用
    const filteredTop = work.top.filter(([simWid]) => {
      const targetWork = this.works[simWid];
      if (!targetWork) return false;

      // 年代フィルター
      if (this.filterEra !== 'ALL') {
        const y = targetWork.y;
        if (!y) return false;
        if (this.filterEra === '2020s' && (y < 2020 || y > 2026)) return false;
        if (this.filterEra === '2010s' && (y < 2010 || y > 2019)) return false;
        if (this.filterEra === '2000s' && (y < 2000 || y > 2009)) return false;
        if (this.filterEra === '1990s' && (y < 1990 || y > 1999)) return false;
      }

      // ジャンルフィルター
      if (this.filterGenre !== 'ALL') {
        if (!targetWork.g || !targetWork.g.includes(this.filterGenre)) return false;
      }

      return true;
    });

    const totalCount = work.top.length;
    const currentCount = filteredTop.length;
    const filterNotice = currentCount < totalCount
      ? `<span class="sim-filter-notice">（フィルター適用中: ${totalCount}件中 ${currentCount}件表示）</span>`
      : '';

    if (filteredTop.length === 0) {
      gridContainer.innerHTML = `
        <div class="sim-section-header">
          <div class="sim-section-title">
            <i class="fa-solid fa-list-ol" style="color: #38bdf8;"></i>
            <span>全話エピソードあらすじ 類似アニメ Top30</span>
            ${filterNotice}
          </div>
        </div>
        <div class="sim-empty-state">
          <i class="fa-solid fa-filter"></i>
          <p>選択したフィルター（年代 / ジャンル）に一致する類似アニメがありませんでした。</p>
          <button class="btn btn-outline btn-sm" style="margin-top: 0.5rem;" onclick="episodeSimilarityLab.resetFilters()">
            フィルターをリセット
          </button>
        </div>
      `;
      return;
    }

    const cardsHtml = filteredTop.map(([simWid, score, originalRank]) => {
      const tw = this.works[simWid];
      if (!tw) return '';

      const safeTitle = this.escapeHtml(tw.t);
      const yearStr = tw.y ? `${tw.y}年` : '年代不明';
      const genreStr = tw.g ? tw.g.split(',').slice(0, 2).join('・') : '未分類';
      const pct = Math.round(score * 100);
      const epStr = (tw.ep_total !== undefined && tw.ep_total > 0) ? `全${tw.ep_total}話` : '';

      // 類似度スコアに応じたバッジ色クラス
      let scoreBadgeClass = 'sim-score-medium';
      if (pct >= 80) scoreBadgeClass = 'sim-score-high';
      else if (pct < 70) scoreBadgeClass = 'sim-score-low';

      // 順位メダル
      let rankBadgeHtml = `<span class="sim-card-rank">#${originalRank}</span>`;
      if (originalRank === 1) {
        rankBadgeHtml = `<span class="sim-card-rank rank-gold"><i class="fa-solid fa-crown"></i> 1位</span>`;
      } else if (originalRank === 2) {
        rankBadgeHtml = `<span class="sim-card-rank rank-silver">2位</span>`;
      } else if (originalRank === 3) {
        rankBadgeHtml = `<span class="sim-card-rank rank-bronze">3位</span>`;
      }

      return `
        <div class="sim-work-card" data-work-id="${simWid}" title="${safeTitle} の類似アニメへジャンプ">
          <!-- 上部ポスターエリア -->
          <div class="sim-card-poster-box">
            ${this.renderPosterImg(tw, safeTitle, 'sim-card-poster')}
            ${rankBadgeHtml}
            <div class="sim-card-score-badge ${scoreBadgeClass}">
              <i class="fa-solid fa-chart-simple"></i> ${pct}%
            </div>
            <!-- ホバー時の数珠つなぎアクションオーバーレイ -->
            <div class="sim-card-overlay">
              <span class="sim-jump-btn"><i class="fa-solid fa-magnifying-glass"></i> この作品から探す</span>
            </div>
          </div>

          <!-- 下部テキストメタ情報 -->
          <div class="sim-card-body">
            <h4 class="sim-card-title">${safeTitle}</h4>
            <div class="sim-card-meta">
              <span><i class="fa-regular fa-calendar"></i> ${yearStr}</span>
              <span><i class="fa-solid fa-tag"></i> ${this.escapeHtml(genreStr)}</span>
              ${epStr ? `<span><i class="fa-solid fa-list-ol"></i> ${epStr}</span>` : ''}
            </div>
            <!-- 類似度プログレスバー -->
            <div class="sim-card-meter-track">
              <div class="sim-card-meter-fill ${scoreBadgeClass}" style="width: ${Math.min(100, Math.max(10, pct))}%;"></div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    gridContainer.innerHTML = `
      <div class="sim-section-header">
        <div class="sim-section-title">
          <i class="fa-solid fa-list-ol" style="color: #38bdf8;"></i>
          <span>全話エピソードあらすじ 類似アニメ Top30</span>
          ${filterNotice}
        </div>
        <p class="sim-section-desc">
          各カードをクリックすると、その作品を起点にした<strong>数珠つなぎ探索</strong>ができます。
        </p>
      </div>
      <div class="sim-cards-grid">
        ${cardsHtml}
      </div>
    `;

    // カードクリックイベント（数珠つなぎ遷移）
    gridContainer.querySelectorAll('.sim-work-card').forEach(card => {
      card.addEventListener('click', () => {
        const wid = card.getAttribute('data-work-id');
        if (wid) {
          this.selectWork(wid, true);
        }
      });
    });
  }

  /**
   * ポスター画像タグの生成（Annict縦長優先・フォールバック対応）
   */
  renderPosterImg(work, safeTitle, className) {
    if (work.img && work.img.startsWith('http')) {
      return `
        <img 
          src="${work.img}" 
          alt="${safeTitle}" 
          class="${className}" 
          loading="lazy" 
          decoding="async"
          onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'sim-poster-fallback\\'><i class=\\'fa-solid fa-film\\'></i><span>${safeTitle}</span></div>';"
        />
      `;
    }
    return `
      <div class="sim-poster-fallback">
        <i class="fa-solid fa-film"></i>
        <span>${safeTitle}</span>
      </div>
    `;
  }

  /**
   * フィルターのリセット
   */
  resetFilters() {
    this.filterEra = 'ALL';
    this.filterGenre = 'ALL';
    const selEra = document.getElementById('ep-sim-filter-era');
    const selGenre = document.getElementById('ep-sim-filter-genre');
    if (selEra) selEra.value = 'ALL';
    if (selGenre) selGenre.value = 'ALL';
    this.renderSimilarGrid();
  }

  /**
   * インクリメンタル作品検索の実行
   */
  handleSearch(query) {
    const dropdown = document.getElementById('ep-sim-dropdown-results');
    if (!dropdown) return;

    if (!query || query.length < 1) {
      dropdown.classList.remove('active');
      dropdown.innerHTML = '';
      return;
    }

    const qLower = query.toLowerCase().replace(/[\s\u3000]+/g, '');
    const matchedWorks = [];

    // 高速スキャン（最大15件まで）
    for (const [wid, work] of Object.entries(this.works)) {
      const tClean = work.t.toLowerCase().replace(/[\s\u3000]+/g, '');
      if (tClean.includes(qLower)) {
        matchedWorks.push({
          id: wid,
          work,
          exact: tClean.startsWith(qLower)
        });
        if (matchedWorks.length >= 25) break;
      }
    }

    if (matchedWorks.length === 0) {
      dropdown.innerHTML = `
        <div class="sim-dropdown-empty">
          <i class="fa-solid fa-circle-xmark text-muted"></i>
          <span>「${this.escapeHtml(query)}」に一致するアニメが見つかりません</span>
        </div>
      `;
      dropdown.classList.add('active');
      return;
    }

    // 先頭一致を優先ソート
    matchedWorks.sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0));
    const showList = matchedWorks.slice(0, 10);

    dropdown.innerHTML = showList.map(({ id, work }) => {
      const thumb = work.img
        ? `<img src="${work.img}" alt="" class="sim-dropdown-thumb" loading="lazy" />`
        : '<div class="sim-dropdown-thumb-fallback"><i class="fa-solid fa-film"></i></div>';

      return `
        <div class="sim-dropdown-item" data-work-id="${id}">
          ${thumb}
          <div class="sim-dropdown-info">
            <div class="sim-dropdown-title">${this.escapeHtml(work.t)}</div>
            <div class="sim-dropdown-meta">
              <span><i class="fa-regular fa-calendar"></i> ${work.y || '不明'}年</span>
              <span><i class="fa-solid fa-tag"></i> ${this.escapeHtml(work.g || '未分類')}</span>
              ${work.ep_total ? `<span><i class="fa-solid fa-list-ol"></i> 全${work.ep_total}話</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    dropdown.classList.add('active');

    // 候補クリックイベント
    dropdown.querySelectorAll('.sim-dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        const wid = item.getAttribute('data-work-id');
        if (wid) {
          this.selectWork(wid, true);
        }
      });
    });
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// グローバルインスタンス
const episodeSimilarityLab = new EpisodeSimilarityLab();
window.episodeSimilarityLab = episodeSimilarityLab;

window.initEpisodeSimilarityTab = function() {
  const container = document.getElementById('tab-episode-similarity');
  if (container && !window._episodeSimilarityInitialized) {
    window._episodeSimilarityInitialized = true;
    episodeSimilarityLab.init(container);
  }
};

// タブクリック時の自律初期化リスナー
document.addEventListener('DOMContentLoaded', () => {
  const tabBtn = document.querySelector('[data-tab="tab-episode-similarity"]');
  if (tabBtn) {
    tabBtn.addEventListener('click', () => {
      window.initEpisodeSimilarityTab();
    });
  }
});
