/**
 * ==========================================================================
 * 類似アニメ検索 (Similarity Search Lab) フロントエンド
 * - dアニメストア配信作品 (1990〜2026) のあらすじベクトル類似度Top10探索
 * - Annictキービジュアル画像連携 ＆ 数珠つなぎ探索
 * ==========================================================================
 */

class SimilaritySearchLab {
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
      const res = await fetch('./res/similarity-data.json');
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      this.data = await res.json();
      this.works = this.data.works || {};
      console.log(`[SimilaritySearch] 類似度データ読込完了: 全 ${this.data.total} 件`);
    } catch (err) {
      console.error('[SimilaritySearch] データ読み込みエラー:', err);
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
        <p>あらすじ類似度データを読み込み中 (約6,300作品)...</p>
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
        <button class="btn btn-outline" style="margin-top: 1rem;" onclick="similaritySearchLab.init(document.getElementById('tab-similarity-search'))">
          <i class="fa-solid fa-rotate-right"></i> 再試行
        </button>
      </div>
    `;
  }

  /**
   * ベースUI（コントロール、起点エリア、Top10エリア）の構築
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
        <div class="sim-hero-banner">
          <div class="sim-hero-text">
            <h2><i class="fa-solid fa-wand-magic-sparkles"></i> あらすじベクトル類似アニメ探索</h2>
            <p>dアニメストア配信（1990〜2026）元データ全 6,350 件から、あらすじが存在しない作品（83件）を除外した実際に類似度計算の対象となった<strong>全 6,267 作品</strong>を収録。AIベクトルにより内容の近いTop10をAnnictキービジュアルと共に表示します。</p>
          </div>
          <div class="sim-hero-actions">
            <button id="sim-btn-random" class="sim-btn-random" title="ランダムな作品から探す">
              <i class="fa-solid fa-dice"></i> 🎲 ランダム作品
            </button>
          </div>
        </div>

        <!-- 検索・フィルターカード -->
        <div class="sim-controls-card">
          <div class="sim-search-bar-wrap">
            <div class="sim-search-input-box">
              <i class="fa-solid fa-magnifying-glass search-icon"></i>
              <input type="text" id="sim-search-input" class="sim-search-input" placeholder="作品名を入力して検索（例: フリーレン, ぼっち, 幼女戦記, ガンダム...）" autocomplete="off" />
              <button id="sim-search-clear" class="sim-search-clear" style="display:none;" title="クリア">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
            <!-- サジェスト結果ドロップダウン -->
            <div id="sim-dropdown-results" class="sim-dropdown-results"></div>
          </div>

          <!-- フィルター行 -->
          <div class="sim-filter-row">
            <div class="sim-select-wrap">
              <i class="fa-solid fa-calendar"></i>
              <select id="sim-filter-era" class="sim-select">
                ${eraOptions}
              </select>
            </div>
            <div class="sim-select-wrap">
              <i class="fa-solid fa-tags"></i>
              <select id="sim-filter-genre" class="sim-select">
                ${genreOptions}
              </select>
            </div>
          </div>

          <!-- クイック候補タグ -->
          <div class="sim-quick-tags-wrap">
            <span class="sim-quick-label"><i class="fa-solid fa-fire text-gold"></i> 注目アニメ:</span>
            <div id="sim-chips-container" class="sim-chips-list">
              ${featuredChips}
            </div>
          </div>

          <!-- 探索履歴（パンくず） -->
          <div id="sim-history-bar" class="sim-history-bar" style="display: none;">
            <span class="sim-history-label"><i class="fa-solid fa-route"></i> 探索ルート:</span>
            <div id="sim-history-crumbs" style="display: flex; gap: 0.4rem; align-items: center; overflow-x: auto;"></div>
          </div>
        </div>

        <!-- 現在選択中の起点アニメカード -->
        <div id="sim-current-section"></div>

        <!-- 類似度Top10 グリッド -->
        <div id="sim-top10-section"></div>
      </div>
    `;
  }

  /**
   * イベントリスナーの登録
   */
  bindEvents() {
    const searchInput = document.getElementById('sim-search-input');
    const searchClear = document.getElementById('sim-search-clear');
    const dropdown = document.getElementById('sim-dropdown-results');
    const btnRandom = document.getElementById('sim-btn-random');
    const filterEra = document.getElementById('sim-filter-era');
    const filterGenre = document.getElementById('sim-filter-genre');
    const chipsContainer = document.getElementById('sim-chips-container');

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
      if (!e.target.closest('.sim-search-bar-wrap')) {
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
      });
    }

    if (filterGenre) {
      filterGenre.addEventListener('change', (e) => {
        this.filterGenre = e.target.value;
      });
    }

    // 注目タグのクリック
    if (chipsContainer) {
      chipsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.sim-chip');
        if (btn) {
          const wid = btn.getAttribute('data-work-id');
          if (wid) this.selectWork(wid, true);
        }
      });
    }
  }

  /**
   * 作品の選択と画面更新
   */
  selectWork(workId, pushHistory = true) {
    const work = this.works[workId];
    if (!work) return;

    this.currentWorkId = workId;

    if (pushHistory) {
      // 履歴に追加（直近と同じでなければ）
      if (this.history.length === 0 || this.history[this.history.length - 1] !== workId) {
        this.history.push(workId);
        // 最大10件まで
        if (this.history.length > 10) this.history.shift();
      }
    } else if (this.history.length === 0) {
      this.history.push(workId);
    }

    // ドロップダウンを閉じる
    const dropdown = document.getElementById('sim-dropdown-results');
    if (dropdown) dropdown.classList.remove('active');

    // 注目チップのアクティブ状態更新
    document.querySelectorAll('.sim-chip').forEach(chip => {
      if (chip.getAttribute('data-work-id') === workId) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });

    // 探索ルートパンくずの更新
    this.renderHistory();

    // 起点作品の描画
    this.renderCurrentWork(work);

    // Top10カードの描画
    this.renderTop10(work);

    // スムーズスクロール
    const currentSection = document.getElementById('sim-current-section');
    if (currentSection) {
      currentSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /**
   * ランダム作品選出
   */
  selectRandomWork() {
    const keys = Object.keys(this.works);
    if (keys.length === 0) return;

    // 可能ならAnnict画像がある作品を優先して選ぶ（70%の確率）
    let candidateKeys = keys;
    if (Math.random() < 0.7) {
      const withImg = keys.filter(k => this.works[k].img);
      if (withImg.length > 0) candidateKeys = withImg;
    }

    const randomId = candidateKeys[Math.floor(Math.random() * candidateKeys.length)];
    this.selectWork(randomId, true);
  }

  /**
   * 履歴パンくずの描画
   */
  renderHistory() {
    const bar = document.getElementById('sim-history-bar');
    const container = document.getElementById('sim-history-crumbs');
    if (!bar || !container) return;

    if (this.history.length <= 1) {
      bar.style.display = 'none';
      return;
    }

    bar.style.display = 'flex';
    container.innerHTML = this.history.map((id, index) => {
      const w = this.works[id];
      if (!w) return '';
      const isCurrent = id === this.currentWorkId;
      const isLast = index === this.history.length - 1;
      const crumbHtml = `
        <button class="sim-history-crumb ${isCurrent ? 'current' : ''}" data-work-id="${id}">
          ${this.escapeHtml(w.t)}
        </button>
      `;
      const arrow = !isLast ? `<i class="fa-solid fa-chevron-right sim-history-arrow"></i>` : '';
      return `${crumbHtml}${arrow}`;
    }).join('');

    // パンくずクリックイベント
    container.querySelectorAll('.sim-history-crumb').forEach(btn => {
      btn.addEventListener('click', () => {
        const wid = btn.getAttribute('data-work-id');
        if (wid && wid !== this.currentWorkId) {
          this.selectWork(wid, false);
        }
      });
    });
  }

  /**
   * 起点アニメの描画
   */
  renderCurrentWork(work) {
    const currentSection = document.getElementById('sim-current-section');
    if (!currentSection) return;

    const posterHtml = work.img
      ? `<img id="sim-current-poster-img" src="${this.escapeHtml(work.img)}" alt="${this.escapeHtml(work.t)}" class="sim-poster-img" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'sim-poster-placeholder\\'><i class=\\'fa-solid fa-film\\'></i><span>画像なし</span></div>'"/>`
      : `<div id="sim-current-poster-placeholder" class="sim-poster-placeholder"><i class="fa-solid fa-film"></i><span>キービジュアル準備中</span></div>`;

    const annictLink = work.aid
      ? `<a href="https://annict.com/works/${work.aid}" target="_blank" rel="noopener noreferrer" class="sim-link-btn sim-link-annict" title="Annictで作品ページを見る"><i class="fa-solid fa-circle-check"></i> Annict</a>`
      : `<a href="https://annict.com/search?q=${encodeURIComponent(work.t)}" target="_blank" rel="noopener noreferrer" class="sim-link-btn sim-link-annict" title="Annictで検索"><i class="fa-solid fa-magnifying-glass"></i> Annict検索</a>`;

    const danimeLink = work.url
      ? `<a href="${this.escapeHtml(work.url)}" target="_blank" rel="noopener noreferrer" class="sim-link-btn sim-link-danime" title="dアニメストアで視聴する"><i class="fa-solid fa-play"></i> dアニメストア</a>`
      : '';

    const isHires = work.img && (work.img.includes('/s:640:853/') || work.img.includes('cs1.animestore.docomo.ne.jp'));

    currentSection.innerHTML = `
      <div class="sim-current-card">
        <div class="sim-poster-wrap">
          ${posterHtml}
        </div>
        <div class="sim-current-details">
          <h3 class="sim-current-title">${this.escapeHtml(work.t)}</h3>
          <div class="sim-badge-row">
            ${work.y ? `<span class="sim-badge sim-badge-year"><i class="fa-regular fa-calendar"></i> ${work.y}年</span>` : ''}
            ${work.g ? `<span class="sim-badge sim-badge-genre"><i class="fa-solid fa-tag"></i> ${this.escapeHtml(work.g)}</span>` : ''}
            ${work.img ? `<span class="sim-badge sim-badge-annict"><i class="fa-solid fa-image"></i> ${isHires ? '高画質キービジュアル' : '公式キービジュアル'}</span>` : ''}
          </div>
          <div class="sim-synopsis-box">
            ${this.escapeHtml(work.s || 'あらすじ情報がありません。')}
          </div>
          <div class="sim-actions-row">
            ${danimeLink}
            ${annictLink}
            <button id="sim-btn-fetch-hires" class="sim-link-btn sim-link-refresh" title="Annictから高解像度キービジュアルを取得・設定">
              <i class="fa-solid fa-arrows-rotate"></i> Annict高画質化/取得
            </button>
            <button id="sim-btn-manual-annict" class="sim-link-btn sim-link-manual" title="AnnictのURLまたは作品IDを手動指定">
              <i class="fa-solid fa-pen-to-square"></i> 手動紐付け
            </button>
          </div>
        </div>
      </div>
    `;

    // ボタンのイベントリスナー
    const btnFetch = document.getElementById('sim-btn-fetch-hires');
    if (btnFetch) {
      btnFetch.addEventListener('click', () => {
        this.fetchHiresImage(work.id, work.t, work.aid, true);
      });
    }

    const btnManual = document.getElementById('sim-btn-manual-annict');
    if (btnManual) {
      btnManual.addEventListener('click', () => {
        this.promptManualAnnict(work.id);
      });
    }

    // 画像が未設定、または低解像度サムネイルの場合はバックグラウンドで自動高画質化
    if (!work.img || !isHires) {
      this.fetchHiresImage(work.id, work.t, work.aid, false);
    }
  }

  /**
   * Annict高解像度キービジュアル（s:640:853）の取得・更新
   */
  async fetchHiresImage(workId, title, annictId, showFeedback = false) {
    const btn = document.getElementById('sim-btn-fetch-hires');
    if (btn && showFeedback) {
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 取得中...';
      btn.disabled = true;
    }

    try {
      const params = new URLSearchParams({ workId, title, annictId: annictId || '' });
      const res = await fetch(`/api/similarity-image?${params.toString()}`);
      if (!res.ok) throw new Error('API request failed');
      const data = await res.json();

      if (data && data.url) {
        // 作品データの更新
        if (this.works[workId]) {
          this.works[workId].img = data.url;
          if (data.annictId) this.works[workId].aid = data.annictId;
        }

        // 現在選択中の作品ならポスターDOMを更新
        if (this.currentWorkId === workId) {
          const wrap = document.querySelector('.sim-poster-wrap');
          if (wrap) {
            wrap.innerHTML = `<img id="sim-current-poster-img" src="${this.escapeHtml(data.url)}" alt="${this.escapeHtml(title)}" class="sim-poster-img" style="opacity: 0; transition: opacity 0.3s;" />`;
            const imgEl = document.getElementById('sim-current-poster-img');
            if (imgEl) {
              imgEl.onload = () => { imgEl.style.opacity = '1'; };
            }
          }
        }

        // Top10カード内の該当画像も更新
        document.querySelectorAll(`.sim-card[data-work-id="${workId}"] .sim-card-image-box`).forEach(box => {
          box.innerHTML = `<img src="${this.escapeHtml(data.url)}" alt="${this.escapeHtml(title)}" class="sim-card-img" />`;
        });

        if (btn && showFeedback) {
          btn.innerHTML = '<i class="fa-solid fa-check text-green"></i> 高画質化完了';
          setTimeout(() => {
            btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Annict高画質化/取得';
            btn.disabled = false;
          }, 2000);
        }
      } else if (btn && showFeedback) {
        btn.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> 見つかりませんでした';
        setTimeout(() => {
          btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Annict高画質化/取得';
          btn.disabled = false;
        }, 2500);
      }
    } catch (err) {
      console.warn('[SimilaritySearch] 高画質画像取得エラー:', err);
      if (btn && showFeedback) {
        btn.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> 取得失敗';
        setTimeout(() => {
          btn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Annict高画質化/取得';
          btn.disabled = false;
        }, 2000);
      }
    }
  }

  /**
   * 手動でAnnict作品URLまたはIDを指定してキービジュアルを紐付け
   */
  async promptManualAnnict(workId) {
    const work = this.works[workId];
    if (!work) return;

    const input = prompt(
      `『${work.t}』に紐付けるAnnictの作品URLまたは作品IDを入力してください。\n例: https://annict.com/works/5056 または 5056`,
      work.aid ? `https://annict.com/works/${work.aid}` : ''
    );

    if (!input) return;

    let targetId = input.trim();
    const match = targetId.match(/works\/(\d+)/);
    if (match) targetId = match[1];

    if (!/^\d+$/.test(targetId)) {
      alert('有効なAnnict作品ID（数字）または作品URLを入力してください。');
      return;
    }

    await this.fetchHiresImage(workId, work.t, targetId, true);
  }

  /**
   * 類似度Top10カードグリッドの描画
   */
  renderTop10(work) {
    const topSection = document.getElementById('sim-top10-section');
    if (!topSection) return;

    const topList = work.top || [];
    if (topList.length === 0) {
      topSection.innerHTML = `
        <div class="sim-empty-state">
          <p>この作品の類似度データが見つかりませんでした。</p>
        </div>
      `;
      return;
    }

    const cardsHtml = topList.map(([simId, score, rank]) => {
      const sim = this.works[simId];
      if (!sim) return '';

      // 順位クラス
      let rankClass = 'sim-rank-other';
      if (rank === 1) rankClass = 'sim-rank-1';
      else if (rank === 2) rankClass = 'sim-rank-2';
      else if (rank === 3) rankClass = 'sim-rank-3';

      const scorePercent = (score * 100).toFixed(1);

      const posterHtml = sim.img
        ? `<img src="${this.escapeHtml(sim.img)}" alt="${this.escapeHtml(sim.t)}" class="sim-card-img" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'sim-card-placeholder\\'><i class=\\'fa-solid fa-film\\'></i><span>画像なし</span></div>'"/>`
        : `<div class="sim-card-placeholder"><i class="fa-solid fa-film"></i><span>${this.escapeHtml(sim.t)}</span></div>`;

      const danimeLink = sim.url
        ? `<a href="${this.escapeHtml(sim.url)}" target="_blank" rel="noopener noreferrer" class="sim-icon-link danime" title="dアニメストアで見る" onclick="event.stopPropagation();"><i class="fa-solid fa-play"></i></a>`
        : '';

      const annictLink = sim.aid
        ? `<a href="https://annict.com/works/${sim.aid}" target="_blank" rel="noopener noreferrer" class="sim-icon-link annict" title="Annictで見る" onclick="event.stopPropagation();"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>`
        : `<a href="https://annict.com/search?q=${encodeURIComponent(sim.t)}" target="_blank" rel="noopener noreferrer" class="sim-icon-link annict" title="Annictで検索" onclick="event.stopPropagation();"><i class="fa-solid fa-magnifying-glass"></i></a>`;

      return `
        <div class="sim-card" data-work-id="${simId}" title="クリックして『${this.escapeHtml(sim.t)}』を起点に類似作品を探索">
          <!-- 順位バッジ -->
          <div class="sim-card-rank ${rankClass}">#${rank}</div>
          
          <!-- 類似度スコア -->
          <div class="sim-card-score">
            <i class="fa-solid fa-chart-simple text-blue"></i> ${scorePercent}%
          </div>

          <!-- キービジュアル -->
          <div class="sim-card-image-box">
            ${posterHtml}
          </div>

          <!-- カード詳細 -->
          <div class="sim-card-body">
            <h4 class="sim-card-title">${this.escapeHtml(sim.t)}</h4>
            <div class="sim-card-meta">
              <span><i class="fa-regular fa-calendar"></i> ${sim.y || '不明'}年</span>
              <span class="sim-card-genre" title="${this.escapeHtml(sim.g)}">${this.escapeHtml(sim.g || '')}</span>
            </div>
            ${sim.s ? `<div class="sim-card-synopsis">${this.escapeHtml(sim.s)}</div>` : ''}

            <!-- カードフッター -->
            <div class="sim-card-footer">
              <button class="sim-jump-btn" data-work-id="${simId}">
                <i class="fa-solid fa-arrow-right-arrow-left"></i> これを起点にする
              </button>
              <div class="sim-external-links">
                ${danimeLink}
                ${annictLink}
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    topSection.innerHTML = `
      <div class="sim-section-header">
        <h3 class="sim-section-title">
          <i class="fa-solid fa-trophy"></i> 『${this.escapeHtml(work.t)}』とあらすじが似ているアニメ Top10
        </h3>
        <span class="sim-section-hint">
          <i class="fa-solid fa-circle-info"></i> カードをクリックすると、その作品を起点にして数珠つなぎで探索できます
        </span>
      </div>
      <div class="sim-grid">
        ${cardsHtml}
      </div>
    `;

    // カードクリックイベント（カード全体および起点化ボタン）
    topSection.querySelectorAll('.sim-card').forEach(card => {
      card.addEventListener('click', (e) => {
        // 外部リンクのクリック時はイベントバブリングしない
        if (e.target.closest('.sim-external-links')) return;
        const wid = card.getAttribute('data-work-id');
        if (wid) this.selectWork(wid, true);
      });
    });

    topSection.querySelectorAll('.sim-jump-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wid = btn.getAttribute('data-work-id');
        if (wid) this.selectWork(wid, true);
      });
    });

    // Top10の中で画像が未設定の作品があればバックグラウンドで自動解決
    topList.forEach(([simId]) => {
      const sim = this.works[simId];
      if (sim && !sim.img) {
        this.fetchHiresImage(simId, sim.t, sim.aid, false);
      }
    });
  }

  /**
   * インクリメンタル検索処理
   */
  handleSearch(query) {
    const dropdown = document.getElementById('sim-dropdown-results');
    if (!dropdown) return;

    if (!query) {
      dropdown.classList.remove('active');
      dropdown.innerHTML = '';
      return;
    }

    const q = query.toLowerCase();
    const results = [];
    const maxResults = 10;

    for (const [wid, w] of Object.entries(this.works)) {
      // フィルターチェック
      if (this.filterEra !== 'ALL' && w.y) {
        if (this.filterEra === '2020s' && (w.y < 2020 || w.y > 2029)) continue;
        if (this.filterEra === '2010s' && (w.y < 2010 || w.y > 2019)) continue;
        if (this.filterEra === '2000s' && (w.y < 2000 || w.y > 2009)) continue;
        if (this.filterEra === '1990s' && (w.y < 1990 || w.y > 1999)) continue;
      }
      if (this.filterGenre !== 'ALL' && w.g) {
        if (!w.g.includes(this.filterGenre)) continue;
      }

      // タイトル一致判定
      const t = w.t.toLowerCase();
      if (t.includes(q)) {
        // 先頭一致を優先スコアにする
        const score = t.startsWith(q) ? 2 : 1;
        results.push({ id: wid, work: w, score });
      }
    }

    // スコア順・年代降順ソート
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.work.y || 0) - (a.work.y || 0);
    });

    const displayResults = results.slice(0, maxResults);

    if (displayResults.length === 0) {
      dropdown.innerHTML = `
        <div style="padding: 1rem; text-align: center; color: var(--text-muted); font-size: 0.9rem;">
          一致するアニメが見つかりませんでした
        </div>
      `;
      dropdown.classList.add('active');
      return;
    }

    dropdown.innerHTML = displayResults.map(({ id, work }) => {
      const thumbHtml = work.img
        ? `<img src="${this.escapeHtml(work.img)}" alt="" class="sim-dropdown-thumb" loading="lazy" onerror="this.style.display='none'"/>`
        : `<div class="sim-dropdown-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.8rem;"><i class="fa-solid fa-film"></i></div>`;

      return `
        <div class="sim-dropdown-item" data-work-id="${id}">
          ${thumbHtml}
          <div class="sim-dropdown-info">
            <div class="sim-dropdown-title">${this.escapeHtml(work.t)}</div>
            <div class="sim-dropdown-meta">
              <span><i class="fa-regular fa-calendar"></i> ${work.y || '不明'}年</span>
              <span><i class="fa-solid fa-tag"></i> ${this.escapeHtml(work.g || '未分類')}</span>
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
const similaritySearchLab = new SimilaritySearchLab();
window.similaritySearchLab = similaritySearchLab;

window.initSimilaritySearchTab = function() {
  const container = document.getElementById('tab-similarity-search');
  if (container && !window._similaritySearchInitialized) {
    window._similaritySearchInitialized = true;
    similaritySearchLab.init(container);
  }
};

// タブクリック時の自律初期化リスナー
document.addEventListener('DOMContentLoaded', () => {
  const tabBtn = document.querySelector('[data-tab="tab-similarity-search"]');
  if (tabBtn) {
    tabBtn.addEventListener('click', () => {
      window.initSimilaritySearchTab();
    });
  }
});
