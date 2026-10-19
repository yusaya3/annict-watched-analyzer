/**
 * ==========================================================================
 * ストーリー構造類似アニメ検索 (Story Structure Similarity Lab) フロントエンド
 * - アプローチ1: LLM構造化ストーリー要約 ＋ デュアルベクトルハイブリッド (世界観 × ストーリー展開)
 * - ブラウザ上で「世界観 vs ストーリー展開」の重みをリアルタイムに変更可能 (0ms 再計算)
 * - 既存の類似アニメ検索と100%同一のUIデザイン・操作性
 * ==========================================================================
 */

class StorySimilarityLab {
  constructor() {
    this.data = null;
    this.works = null;
    this.currentWorkId = null;
    this.history = [];
    this.isLoading = false;
    this.filterGenre = 'ALL';
    this.filterEra = 'ALL';
    this.searchDebounceTimer = null;

    // デュアル・アスペクトの重み (0.0: 世界観100% 〜 1.0: プロット展開100%)
    // デフォルト: 0.5 (バランス 5:5)
    this.plotWeight = 0.5;

    // 起点作品カードのあらすじタブ ('synopsis' または 'summary')
    this.currentSynopsisTab = 'summary';

    // DOM要素の参照
    this.container = null;
  }

  /**
   * 初期化
   */
  async init(containerEl) {
    this.container = containerEl;
    if (!this.container) return;

    this.renderLoading();
    await this.loadData();
    if (!this.data) {
      this.renderError('ストーリー構造類似度データの読み込みに失敗しました。');
      return;
    }

    this.renderBaseUI();
    this.bindEvents();

    // 初期表示: クイック候補の先頭、またはランダムな1件
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
      const res = await fetch('./res/story-similarity-data.json?v=20261019');
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      this.data = await res.json();
      this.works = this.data.works || {};
      console.log(`[StorySimilarity] ストーリー構造類似度データ読込完了: 全 ${this.data.total} 件`);
    } catch (err) {
      console.error('[StorySimilarity] データ読み込みエラー:', err);
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
        <p>ストーリー構造類似度データを読み込み中 (約6,260作品)...</p>
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
        <button class="btn btn-outline" style="margin-top: 1rem;" onclick="storySimilarityLab.init(document.getElementById('tab-story-similarity'))">
          <i class="fa-solid fa-rotate-right"></i> 再試行
        </button>
      </div>
    `;
  }

  /**
   * ベースUIの構築
   */
  renderBaseUI() {
    const eraOptions = `
      <option value="ALL">年代: すべて (1990〜2026)</option>
      <option value="2020s">2020年代 (2020〜2026)</option>
      <option value="2010s">2010年代 (2010〜2019)</option>
      <option value="2000s">2000年代 (2000〜2009)</option>
      <option value="1990s">1990年代 (1990〜1999)</option>
    `;

    const genreOptions = ['ALL', ...(this.data.genres || [])].map(g => {
      return `<option value="${this.escapeHtml(g)}">${g === 'ALL' ? 'ジャンル: すべて' : this.escapeHtml(g)}</option>`;
    }).join('');

    const featuredChips = (this.data.featured || []).map(id => {
      const w = this.works[id];
      if (!w) return '';
      return `<button class="sim-chip" data-work-id="${id}" title="${this.escapeHtml(w.t)}">${this.escapeHtml(w.t)}</button>`;
    }).join('');

    this.container.innerHTML = `
      <div class="sim-container">
        <!-- ヒーロー紹介バナー -->
        <div class="sim-hero-banner">
          <div class="sim-hero-text">
            <h2><i class="fa-solid fa-brain"></i> ストーリー構造類似アニメ探索（新手法）</h2>
            <p>全話あらすじからLLM（Gemini）で抽出した【起承転結・動機・葛藤・結末】のプロット骨格と、作品全体の【世界観・設定】をAIデュアルベクトル化。下のスライダーで<strong>世界観 vs ストーリー展開の重みを自由に変更</strong>できます。（有効作品 <strong>${this.data.total.toLocaleString()}</strong> 件収録）</p>
          </div>
          <div class="sim-hero-actions">
            <button id="story-sim-btn-random" class="sim-btn-random" title="ランダムな作品から探す">
              <i class="fa-solid fa-dice"></i> 🎲 ランダム作品
            </button>
          </div>
        </div>

        <!-- 検索・フィルターカード -->
        <div class="sim-controls-card">
          <div class="sim-search-bar-wrap">
            <div class="sim-search-input-box">
              <i class="fa-solid fa-magnifying-glass search-icon"></i>
              <input type="text" id="story-sim-search-input" class="sim-search-input" placeholder="作品名を入力して検索（例: フリーレン, ぼっち, まどか, 幼女戦記, ガンダム...）" autocomplete="off" />
              <button id="story-sim-search-clear" class="sim-search-clear" style="display:none;" title="クリア">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div id="story-sim-dropdown-results" class="sim-dropdown-results"></div>
          </div>

          <!-- フィルター行 -->
          <div class="sim-filter-row">
            <div class="sim-select-wrap">
              <i class="fa-solid fa-calendar"></i>
              <select id="story-sim-filter-era" class="sim-select">
                ${eraOptions}
              </select>
            </div>
            <div class="sim-select-wrap">
              <i class="fa-solid fa-tags"></i>
              <select id="story-sim-filter-genre" class="sim-select">
                ${genreOptions}
              </select>
            </div>
          </div>

          <!-- クイック候補タグ -->
          <div class="sim-quick-tags-wrap">
            <span class="sim-quick-label"><i class="fa-solid fa-fire text-gold"></i> 注目アニメ:</span>
            <div id="story-sim-chips-container" class="sim-chips-list">
              ${featuredChips}
            </div>
          </div>

          <!-- 探索履歴（パンくず） -->
          <div id="story-sim-history-bar" class="sim-history-bar" style="display: none;">
            <span class="sim-history-label"><i class="fa-solid fa-route"></i> 探索ルート:</span>
            <div id="story-sim-history-crumbs" style="display: flex; gap: 0.4rem; align-items: center; overflow-x: auto;"></div>
          </div>
        </div>

        <!-- 【新機能】デュアル・アスペクト重みコントローラー -->
        <div class="sim-weight-controller-card">
          <div class="sim-weight-header">
            <div class="sim-weight-title">
              <i class="fa-solid fa-sliders"></i>
              <span>類似度の重視バランス調整:</span>
              <span id="story-weight-display" class="badge-subtab" style="font-weight: 700; margin-left: 0.25rem;">プロット 50% / 世界観 50%</span>
            </div>
            <div class="sim-weight-presets">
              <button type="button" class="sim-btn-preset" data-weight="0.8">ストーリー重視 (80:20)</button>
              <button type="button" class="sim-btn-preset active" data-weight="0.5">バランス (50:50)</button>
              <button type="button" class="sim-btn-preset" data-weight="0.2">世界観重視 (20:80)</button>
            </div>
          </div>
          <div class="sim-slider-wrap">
            <input type="range" id="story-sim-weight-slider" class="sim-weight-slider" min="0" max="100" value="50" step="1" />
            <div class="sim-slider-labels">
              <span class="sim-label-setting"><i class="fa-solid fa-earth-americas"></i> 世界観・設定重視 (100%)</span>
              <span class="sim-label-center">⚖️ バランス (50:50)</span>
              <span class="sim-label-plot"><i class="fa-solid fa-book-open"></i> ストーリー展開・プロット重視 (100%)</span>
            </div>
          </div>
        </div>

        <!-- 現在選択中の起点アニメカード -->
        <div id="story-sim-current-section"></div>

        <!-- 類似度Top30 グリッド -->
        <div id="story-sim-top30-section"></div>
      </div>
    `;
  }

  /**
   * イベントリスナーの登録
   */
  bindEvents() {
    const searchInput = document.getElementById('story-sim-search-input');
    const searchClear = document.getElementById('story-sim-search-clear');
    const dropdown = document.getElementById('story-sim-dropdown-results');
    const btnRandom = document.getElementById('story-sim-btn-random');
    const filterEra = document.getElementById('story-sim-filter-era');
    const filterGenre = document.getElementById('story-sim-filter-genre');
    const chipsContainer = document.getElementById('story-sim-chips-container');
    const slider = document.getElementById('story-sim-weight-slider');
    const weightDisplay = document.getElementById('story-weight-display');

    // 検索入力
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

    // 外側クリックでドロップダウン閉じる
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#tab-story-similarity .sim-search-bar-wrap')) {
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
        this.renderTop30();
      });
    }
    if (filterGenre) {
      filterGenre.addEventListener('change', (e) => {
        this.filterGenre = e.target.value;
        this.renderTop30();
      });
    }

    // クイック候補チップ
    if (chipsContainer) {
      chipsContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.sim-chip');
        if (chip) {
          const wid = chip.getAttribute('data-work-id');
          if (wid) this.selectWork(wid, true);
        }
      });
    }

    // 重みスライダー操作 (input イベントでリアルタイム追従)
    if (slider) {
      slider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        this.plotWeight = val / 100.0;
        this.updateWeightUI(val);
        this.renderTop30();
      });
    }

    // プリセットボタン
    document.querySelectorAll('.sim-weight-presets .sim-btn-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const w = parseFloat(btn.getAttribute('data-weight'));
        this.plotWeight = w;
        if (slider) slider.value = Math.round(w * 100);
        this.updateWeightUI(Math.round(w * 100));
        this.renderTop30();
      });
    });
  }

  /**
   * 重みUI（表示テキストとプリセットボタンのアクティブ状態）を同期更新
   */
  updateWeightUI(valPercent) {
    const weightDisplay = document.getElementById('story-weight-display');
    const plotPercent = valPercent;
    const settingPercent = 100 - valPercent;

    if (weightDisplay) {
      weightDisplay.textContent = `プロット ${plotPercent}% / 世界観 ${settingPercent}%`;
    }

    // プリセットボタンの同期
    document.querySelectorAll('.sim-weight-presets .sim-btn-preset').forEach(btn => {
      const btnW = Math.round(parseFloat(btn.getAttribute('data-weight')) * 100);
      if (btnW === valPercent) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  /**
   * ランダム作品選択
   */
  selectRandomWork() {
    const allIds = Object.keys(this.works);
    if (!allIds.length) return;
    const randId = allIds[Math.floor(Math.random() * allIds.length)];
    this.selectWork(randId, true);
  }

  /**
   * 作品を選択して表示を更新
   */
  selectWork(workId, recordHistory = true) {
    const w = this.works[workId];
    if (!w) return;

    if (recordHistory && this.currentWorkId && this.currentWorkId !== workId) {
      this.history.push(this.currentWorkId);
      if (this.history.length > 10) this.history.shift();
    }

    this.currentWorkId = workId;

    // クイック候補のアクティブ表示
    const chips = document.querySelectorAll('#tab-story-similarity .sim-chip');
    chips.forEach(c => {
      if (c.getAttribute('data-work-id') === workId) {
        c.classList.add('active');
      } else {
        c.classList.remove('active');
      }
    });

    // 検索入力のクリア
    const searchInput = document.getElementById('story-sim-search-input');
    const searchClear = document.getElementById('story-sim-search-clear');
    const dropdown = document.getElementById('story-sim-dropdown-results');
    if (searchInput) searchInput.value = '';
    if (searchClear) searchClear.style.display = 'none';
    if (dropdown) dropdown.classList.remove('active');

    this.renderHistory();
    this.renderCurrentWork();
    this.renderTop30();

    // 起点作品の高画質キービジュアル解決
    if (!w.img || !w.img.includes('image.annict.com')) {
      this.resolveHiresImage(workId, w.t, w.aid, (newUrl) => {
        const curImg = document.getElementById('story-sim-current-img');
        if (curImg && newUrl) {
          curImg.src = newUrl;
        }
      });
    }
  }

  /**
   * 探索履歴パンくずの描画
   */
  renderHistory() {
    const historyBar = document.getElementById('story-sim-history-bar');
    const crumbsContainer = document.getElementById('story-sim-history-crumbs');
    if (!historyBar || !crumbsContainer) return;

    if (this.history.length === 0) {
      historyBar.style.display = 'none';
      return;
    }

    historyBar.style.display = 'flex';
    crumbsContainer.innerHTML = '';

    this.history.forEach((hid, idx) => {
      const hw = this.works[hid];
      if (!hw) return;

      const chip = document.createElement('button');
      chip.className = 'sim-history-crumb';
      chip.title = hw.t;
      chip.textContent = hw.t.length > 12 ? hw.t.substring(0, 12) + '…' : hw.t;
      chip.addEventListener('click', () => {
        this.history = this.history.slice(0, idx);
        this.selectWork(hid, false);
      });
      crumbsContainer.appendChild(chip);

      const arrow = document.createElement('span');
      arrow.className = 'sim-history-arrow';
      arrow.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
      crumbsContainer.appendChild(arrow);
    });

    const curChip = document.createElement('span');
    curChip.className = 'sim-history-crumb active';
    const curW = this.works[this.currentWorkId];
    curChip.textContent = curW ? (curW.t.length > 12 ? curW.t.substring(0, 12) + '…' : curW.t) : '';
    crumbsContainer.appendChild(curChip);
  }

  /**
   * 起点アニメカードの描画
   */
  renderCurrentWork() {
    const container = document.getElementById('story-sim-current-section');
    if (!container || !this.currentWorkId) return;

    const w = this.works[this.currentWorkId];
    if (!w) return;

    const imgSrc = w.img || './icon.png';
    const yearText = w.y ? `${w.y}年` : '年代不明';
    const genreText = w.g || 'その他';
    const synopsis = w.s || 'あらすじ情報なし';
    const plotSummary = w.summary || 'プロット要約情報なし';

    container.innerHTML = `
      <div class="sim-current-card">
        <div class="sim-poster-wrap">
          <img id="story-sim-current-img" src="${this.escapeHtml(imgSrc)}" alt="${this.escapeHtml(w.t)}" class="sim-poster-img" onerror="this.onerror=null; this.src='./icon.png';" />
          <button class="sim-zoom-btn" title="画像を拡大" onclick="openImageModal('${this.escapeHtml(imgSrc)}', '${this.escapeHtml(w.t)}')">
            <i class="fa-solid fa-magnifying-glass-plus"></i>
          </button>
        </div>
        <div class="sim-current-info">
          <div class="sim-current-header-row">
            <div class="sim-badge-row">
              <span class="sim-badge era"><i class="fa-solid fa-calendar"></i> ${this.escapeHtml(yearText)}</span>
              <span class="sim-badge genre"><i class="fa-solid fa-tag"></i> ${this.escapeHtml(genreText)}</span>
              <span class="sim-badge current-target"><i class="fa-solid fa-crosshairs"></i> 起点アニメ</span>
            </div>
          </div>
          <h3 class="sim-current-title">${this.escapeHtml(w.t)}</h3>

          <!-- あらすじ / プロット要約の切り替えタブ -->
          <div class="sim-synopsis-tabs">
            <button id="story-tab-summary" class="sim-synopsis-tab-btn ${this.currentSynopsisTab === 'summary' ? 'active' : ''}">
              <i class="fa-solid fa-brain"></i> 起承転結プロット要約 (LLM)
            </button>
            <button id="story-tab-synopsis" class="sim-synopsis-tab-btn ${this.currentSynopsisTab === 'synopsis' ? 'active' : ''}">
              <i class="fa-solid fa-book"></i> 全体あらすじ
            </button>
          </div>

          <div id="story-synopsis-content-box" class="sim-current-synopsis-box">
            ${this.renderSynopsisContent(this.currentSynopsisTab, synopsis, plotSummary)}
          </div>

          <div class="sim-actions-row">
            ${w.url ? `<a href="${this.escapeHtml(w.url)}" target="_blank" rel="noopener noreferrer" class="sim-external-link danime"><i class="fa-solid fa-play"></i> dアニメストアで観る</a>` : ''}
            ${w.aid ? `<a href="https://annict.com/works/${w.aid}" target="_blank" rel="noopener noreferrer" class="sim-external-link annict"><i class="fa-solid fa-arrow-up-right-from-square"></i> Annict作品ページ</a>` : ''}
          </div>
        </div>
      </div>
    `;

    // タブ切り替えイベント
    const btnSummary = document.getElementById('story-tab-summary');
    const btnSynopsis = document.getElementById('story-tab-synopsis');
    const contentBox = document.getElementById('story-synopsis-content-box');

    if (btnSummary && btnSynopsis && contentBox) {
      btnSummary.addEventListener('click', () => {
        this.currentSynopsisTab = 'summary';
        btnSummary.classList.add('active');
        btnSynopsis.classList.remove('active');
        contentBox.innerHTML = this.renderSynopsisContent('summary', synopsis, plotSummary);
      });
      btnSynopsis.addEventListener('click', () => {
        this.currentSynopsisTab = 'synopsis';
        btnSynopsis.classList.add('active');
        btnSummary.classList.remove('active');
        contentBox.innerHTML = this.renderSynopsisContent('synopsis', synopsis, plotSummary);
      });
    }
  }

  renderSynopsisContent(mode, synopsis, plotSummary) {
    if (mode === 'summary') {
      return `<p class="sim-current-synopsis" style="white-space: pre-wrap; line-height: 1.6;">${this.escapeHtml(plotSummary)}</p>`;
    } else {
      return `<p class="sim-current-synopsis" style="line-height: 1.6;">${this.escapeHtml(synopsis)}</p>`;
    }
  }

  /**
   * 類似度Top30グリッドの描画
   * - 重み（this.plotWeight）に基づいて、候補プールからリアルタイムに再計算＆ソート
   */
  renderTop30() {
    const container = document.getElementById('story-sim-top30-section');
    if (!container || !this.currentWorkId) return;

    const w = this.works[this.currentWorkId];
    if (!w) return;

    const rawCandidates = w.candidates || [];
    if (rawCandidates.length === 0) {
      container.innerHTML = `
        <div class="sim-empty-state">
          <i class="fa-solid fa-circle-question" style="font-size: 2rem;"></i>
          <p>類似作品データが見つかりませんでした。</p>
        </div>
      `;
      return;
    }

    // 1. 各候補について、現在の重み (this.plotWeight) でスコアを計算
    const wp = this.plotWeight;
    const ws = 1.0 - wp;

    let computedList = [];
    for (const cand of rawCandidates) {
      const candWid = String(cand[0]);
      const settingScore = cand[1];
      const plotScore = cand[2];
      const totalScore = (ws * settingScore) + (wp * plotScore);

      const targetWork = this.works[candWid];
      if (!targetWork) continue;

      // フィルター適用 (年代)
      if (this.filterEra !== 'ALL') {
        const y = targetWork.y;
        if (!y) continue;
        if (this.filterEra === '2020s' && (y < 2020 || y > 2026)) continue;
        if (this.filterEra === '2010s' && (y < 2010 || y > 2019)) continue;
        if (this.filterEra === '2000s' && (y < 2000 || y > 2009)) continue;
        if (this.filterEra === '1990s' && (y < 1990 || y > 1999)) continue;
      }

      // フィルター適用 (ジャンル)
      if (this.filterGenre !== 'ALL') {
        if (!targetWork.g || !targetWork.g.includes(this.filterGenre)) continue;
      }

      computedList.push({
        wid: candWid,
        work: targetWork,
        totalScore: totalScore,
        settingScore: settingScore,
        plotScore: plotScore,
      });
    }

    // 2. 総合スコア順に降順ソート
    computedList.sort((a, b) => b.totalScore - a.totalScore);

    // 3. 上位30件を抽出
    const top30 = computedList.slice(0, 30);

    if (top30.length === 0) {
      container.innerHTML = `
        <div class="sim-empty-state">
          <i class="fa-solid fa-filter-circle-xmark" style="font-size: 2rem;"></i>
          <p>選択されたフィルター条件に合致する類似アニメが見つかりませんでした。<br>年代またはジャンルの指定を緩めてみてください。</p>
        </div>
      `;
      return;
    }

    const cardsHtml = top30.map((item, idx) => {
      const rank = idx + 1;
      const tw = item.work;
      const pct = Math.max(0, Math.min(100, Math.round(item.totalScore * 1000) / 10));
      const plotPct = Math.max(0, Math.min(100, Math.round(item.plotScore * 1000) / 10));
      const setPct = Math.max(0, Math.min(100, Math.round(item.settingScore * 1000) / 10));

      const rankBadgeClass = rank <= 3 ? `rank-${rank}` : 'rank-other';
      const imgSrc = tw.img || './icon.png';
      const yearText = tw.y ? `${tw.y}年` : '年代不明';
      const genreText = tw.g || 'その他';
      const synopsis = tw.s || '';

      return `
        <div class="sim-card" data-work-id="${item.wid}">
          <div class="sim-card-rank-badge ${rankBadgeClass}">#${rank}</div>
          <div class="sim-card-poster-wrap">
            <img id="story-sim-img-${item.wid}" src="${this.escapeHtml(imgSrc)}" alt="${this.escapeHtml(tw.t)}" class="sim-card-poster" loading="lazy" onerror="this.onerror=null; this.src='./icon.png';" />
            <button class="sim-card-zoom-btn" title="画像を拡大" onclick="event.stopPropagation(); openImageModal('${this.escapeHtml(imgSrc)}', '${this.escapeHtml(tw.t)}')">
              <i class="fa-solid fa-magnifying-glass-plus"></i>
            </button>
            <div class="sim-card-score-bar-wrap">
              <div class="sim-card-score-bar" style="width: ${pct}%;"></div>
              <span class="sim-card-score-text">${pct}% 一致</span>
            </div>
          </div>
          <div class="sim-card-body">
            <div class="sim-card-meta-row">
              <span class="sim-card-meta era">${this.escapeHtml(yearText)}</span>
              <span class="sim-card-meta genre">${this.escapeHtml(genreText)}</span>
            </div>
            <h4 class="sim-card-title" title="${this.escapeHtml(tw.t)}">${this.escapeHtml(tw.t)}</h4>

            <!-- スコア内訳バッジ -->
            <div class="sim-score-breakdown-row">
              <span class="sim-badge-plot" title="ストーリー展開・プロット類似度"><i class="fa-solid fa-book-open"></i> 展開: ${plotPct}%</span>
              <span class="sim-badge-setting" title="世界観・設定類似度"><i class="fa-solid fa-earth-americas"></i> 世界観: ${setPct}%</span>
            </div>

            <p class="sim-card-synopsis" title="${this.escapeHtml(synopsis)}">${this.escapeHtml(synopsis)}</p>
            <div class="sim-card-footer">
              <button class="sim-card-btn-explore" title="このアニメを起点にして再探索" onclick="event.stopPropagation(); storySimilarityLab.selectWork('${item.wid}', true);">
                <i class="fa-solid fa-wand-magic-sparkles"></i> この作品から探す
              </button>
              <div class="sim-card-external-links">
                ${tw.url ? `<a href="${this.escapeHtml(tw.url)}" target="_blank" rel="noopener noreferrer" class="sim-icon-link danime" title="dアニメストアで視聴" onclick="event.stopPropagation();"><i class="fa-solid fa-play"></i></a>` : ''}
                ${tw.aid ? `<a href="https://annict.com/works/${tw.aid}" target="_blank" rel="noopener noreferrer" class="sim-icon-link annict" title="Annictページへ" onclick="event.stopPropagation();"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>` : ''}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="sim-top30-header">
        <h3 class="sim-top30-title">
          <i class="fa-solid fa-ranking-star"></i>
          類似ストーリー構成アニメ Top 30
          <small class="sim-top30-sub">(現在スコア: プロット ${Math.round(wp * 100)}% + 世界観 ${Math.round(ws * 100)}%)</small>
        </h3>
        <span class="sim-top30-count">${top30.length} 件表示中</span>
      </div>
      <div class="sim-grid">
        ${cardsHtml}
      </div>
    `;

    // カードクリックイベント（カード全体クリックでも探索可能）
    container.querySelectorAll('.sim-card').forEach(card => {
      card.addEventListener('click', () => {
        const wid = card.getAttribute('data-work-id');
        if (wid) this.selectWork(wid, true);
      });
    });

    // キービジュアル未解決作品の動的取得
    top30.forEach(item => {
      const tw = item.work;
      if (!tw.img || !tw.img.includes('image.annict.com')) {
        this.resolveHiresImage(item.wid, tw.t, tw.aid, (newUrl) => {
          const imgEl = document.getElementById(`story-sim-img-${item.wid}`);
          if (imgEl && newUrl) {
            imgEl.src = newUrl;
          }
        });
      }
    });
  }

  /**
   * Annictキービジュアルの動的解決API呼び出し
   */
  async resolveHiresImage(workId, title, annictId, callback) {
    try {
      let url = `/api/similarity-image?workId=${encodeURIComponent(workId)}&title=${encodeURIComponent(title)}`;
      if (annictId) {
        url += `&annictId=${encodeURIComponent(annictId)}`;
      }
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.url && data.url.includes('image.annict.com')) {
        if (this.works[workId]) {
          this.works[workId].img = data.url;
          if (data.annictId && !this.works[workId].aid) {
            this.works[workId].aid = data.annictId;
          }
        }
        if (typeof callback === 'function') {
          callback(data.url);
        }
      }
    } catch (e) {
      // 握りつぶす
    }
  }

  /**
   * インクリメンタル検索ハンドラー
   */
  handleSearch(query) {
    const dropdown = document.getElementById('story-sim-dropdown-results');
    if (!dropdown) return;

    if (!query) {
      dropdown.classList.remove('active');
      dropdown.innerHTML = '';
      return;
    }

    const nfkcQuery = query.normalize('NFKC').toLowerCase();
    const hits = [];

    for (const [wid, w] of Object.entries(this.works)) {
      const titleLower = (w.t || '').normalize('NFKC').toLowerCase();
      if (titleLower.includes(nfkcQuery)) {
        hits.push(w);
        if (hits.length >= 15) break;
      }
    }

    if (hits.length === 0) {
      dropdown.innerHTML = `
        <div class="sim-dropdown-empty">
          <i class="fa-solid fa-magnifying-glass"></i> 「${this.escapeHtml(query)}」に一致する作品が見つかりません
        </div>
      `;
      dropdown.classList.add('active');
      return;
    }

    const itemsHtml = hits.map(w => {
      const imgSrc = w.img || './icon.png';
      const yearText = w.y ? `${w.y}年` : '';
      const genreText = w.g || '';
      return `
        <div class="sim-dropdown-item" data-work-id="${w.id}">
          <img src="${this.escapeHtml(imgSrc)}" alt="" class="sim-dropdown-thumb" onerror="this.src='./icon.png';" />
          <div class="sim-dropdown-info">
            <div class="sim-dropdown-title">${this.escapeHtml(w.t)}</div>
            <div class="sim-dropdown-meta">${this.escapeHtml(yearText)} ${genreText ? '・ ' + this.escapeHtml(genreText) : ''}</div>
          </div>
        </div>
      `;
    }).join('');

    dropdown.innerHTML = itemsHtml;
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
const storySimilarityLab = new StorySimilarityLab();
window.storySimilarityLab = storySimilarityLab;

window.initStorySimilarityTab = function() {
  const container = document.getElementById('tab-story-similarity');
  if (container && !window._storySimilarityInitialized) {
    window._storySimilarityInitialized = true;
    storySimilarityLab.init(container);
  }
};

// タブクリック時の自律初期化リスナー
document.addEventListener('DOMContentLoaded', () => {
  const tabBtn = document.querySelector('[data-tab="tab-story-similarity"]');
  if (tabBtn) {
    tabBtn.addEventListener('click', () => {
      window.initStorySimilarityTab();
    });
  }
});
