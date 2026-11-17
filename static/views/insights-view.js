(function (root) {
  'use strict';

  const InsightsView = {
    mounted: false,
    container: null,
    activeMode: 'all', // 'all' | 'exclusive' | 'missing'
    _hasUserInteracted: false,
    activeUser: null,
    filterGenre: 'ALL',
    filterQuery: '',
    sortMode: 'season-desc',

    mount(container) {
      if (this.mounted) return;
      this.container = container;
      this.mounted = true;

      container.innerHTML = `
        <div class="stack-lg">
          <div class="insights-kpi-row">
            <button type="button" class="insight-kpi-card active" data-insight-mode="all">
              <div class="kpi-title"><i class="fa-solid fa-crown text-gold"></i> <span class="hide-mobile">全員が見ているアニメ</span><span class="show-mobile-inline">全員視聴</span> <span class="kpi-active-tag"></span></div>
              <div id="insight-kpi-all" class="kpi-value">0</div>
              <div class="kpi-sub">全員で語り合える鉄板タイトル</div>
            </button>
            <button type="button" class="insight-kpi-card" data-insight-mode="exclusive">
              <div class="kpi-title"><i class="fa-solid fa-gem text-purple"></i> <span class="hide-mobile">この人だけが見ているアニメ</span><span class="show-mobile-inline">独自視聴</span> <span class="kpi-active-tag"></span></div>
              <div id="insight-kpi-exclusive" class="kpi-value">0</div>
              <div class="kpi-sub">独自推し・布教ネタの宝庫</div>
            </button>
            <button type="button" class="insight-kpi-card" data-insight-mode="missing">
              <div class="kpi-title"><i class="fa-solid fa-user-slash text-pink"></i> <span class="hide-mobile">この人以外みんな見ているアニメ</span><span class="show-mobile-inline">未履修</span> <span class="kpi-active-tag"></span></div>
              <div id="insight-kpi-missing" class="kpi-value">0</div>
              <div class="kpi-sub">あと1人で全員コンプリート（3人以上）</div>
            </button>
          </div>

          <div class="card">
            <div class="card-header">
              <div class="card-header-row">
                <div style="flex:1;min-width:0;">
                  <h3 id="insight-section-title" class="card-title"><i class="fa-solid fa-crown text-gold"></i> 全員が見ているアニメ</h3>
                  <p id="insight-section-desc" class="card-desc">参加メンバー全員が視聴記録している共通作品</p>
                </div>
                <span id="insight-count-badge" class="badge badge-gold">0作品</span>
              </div>
            </div>

            <div id="insight-user-bar" class="chips-wrap" style="margin-bottom:0.85rem;display:none;"></div>

            <div class="toolbar-row" style="margin-bottom:1rem;">
              <div class="search-field">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" id="insight-search-input" class="input-text" placeholder="タイトルで絞り込み..." />
                <button type="button" id="insight-search-clear" class="input-clear-btn" style="display:none;"><i class="fa-solid fa-xmark"></i></button>
              </div>
              <select id="insight-genre-select" class="select-control" aria-label="ジャンル絞り込み">
                <option value="ALL">ジャンル: すべて</option>
              </select>
              <select id="insight-sort-select" class="select-control" aria-label="並び替え">
                <option value="season-desc">放送時期が新しい順</option>
                <option value="season-asc">放送時期が古い順</option>
                <option value="title">タイトル順</option>
              </select>
            </div>

            <div id="insight-grid" class="anime-cards-grid"></div>
          </div>
        </div>
      `;

      const genreSel = container.querySelector('#insight-genre-select');
      if (genreSel && root.GenreEngine) {
        root.GenreEngine.GENRE_DEFINITIONS.forEach(g => {
          const opt = document.createElement('option');
          opt.value = g.id;
          opt.textContent = `ジャンル: ${g.label}`;
          genreSel.appendChild(opt);
        });
      }

      container.querySelectorAll('.insight-kpi-card').forEach(btn => {
        btn.addEventListener('click', () => {
          this._hasUserInteracted = true;
          this.activeMode = btn.getAttribute('data-insight-mode');
          this.render(root.AppStore.state);
        });
      });

      const searchInput = container.querySelector('#insight-search-input');
      const clearBtn = container.querySelector('#insight-search-clear');
      searchInput?.addEventListener('input', (e) => {
        this.filterQuery = e.target.value.trim().toLowerCase();
        if (clearBtn) clearBtn.style.display = this.filterQuery ? 'block' : 'none';
        this.renderGrid();
      });
      clearBtn?.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        this.filterQuery = '';
        clearBtn.style.display = 'none';
        this.renderGrid();
      });

      genreSel?.addEventListener('change', (e) => {
        this.filterGenre = e.target.value;
        this.renderGrid();
      });

      container.querySelector('#insight-sort-select')?.addEventListener('change', (e) => {
        this.sortMode = e.target.value;
        this.renderGrid();
      });
    },

    render(storeState) {
      if (!this.mounted || !storeState.report) return;
      const report = storeState.report;
      const users = report.users || [];
      const insights = report.insights || {};

      if (!this.activeUser || !users.includes(this.activeUser)) {
        this.activeUser = users[0] || null;
      }

      // KPI値更新
      const allCount = (insights.watchedByAll || []).length;
      const excTotal = users.reduce((sum, u) => sum + (insights.exclusivePerUser?.[u]?.length || 0), 0);
      const misTotal = users.reduce((sum, u) => sum + (insights.missingPerUser?.[u]?.length || 0), 0);

      // 初期表示で全員共通が0件のときは、空画面にならないよう独自視聴または未視聴モードへ自動フォールバック
      if (!this._hasUserInteracted && this.activeMode === 'all' && allCount === 0) {
        if (excTotal > 0) {
          this.activeMode = 'exclusive';
          const firstWithExc = users.find(u => (insights.exclusivePerUser?.[u]?.length || 0) > 0);
          if (firstWithExc) this.activeUser = firstWithExc;
        } else if (users.length >= 3 && misTotal > 0) {
          this.activeMode = 'missing';
          const firstWithMis = users.find(u => (insights.missingPerUser?.[u]?.length || 0) > 0);
          if (firstWithMis) this.activeUser = firstWithMis;
        }
      }

      const kpiAll = this.container.querySelector('#insight-kpi-all');
      const kpiExc = this.container.querySelector('#insight-kpi-exclusive');
      const kpiMis = this.container.querySelector('#insight-kpi-missing');
      if (kpiAll) kpiAll.textContent = `${allCount.toLocaleString()} 作`;
      if (kpiExc) kpiExc.textContent = `${excTotal.toLocaleString()} 作`;
      if (kpiMis) kpiMis.textContent = users.length >= 3 ? `${misTotal.toLocaleString()} 作` : '3人〜';

      this.container.querySelectorAll('.insight-kpi-card').forEach(btn => {
        const isActive = btn.getAttribute('data-insight-mode') === this.activeMode;
        btn.classList.toggle('active', isActive);
        const tag = btn.querySelector('.kpi-active-tag');
        if (tag) tag.textContent = isActive ? '表示中' : '';
      });

      const titleEl = this.container.querySelector('#insight-section-title');
      const descEl = this.container.querySelector('#insight-section-desc');
      const userBar = this.container.querySelector('#insight-user-bar');
      const esc = root.UIUtils.escapeHtml;

      const badge = this.container.querySelector('#insight-count-badge');
      if (badge) {
        const badgeCls = this.activeMode === 'all' ? 'badge-gold' : this.activeMode === 'exclusive' ? 'badge-purple' : 'badge-pink';
        badge.className = `badge ${badgeCls}`;
      }

      if (this.activeMode === 'all') {
        titleEl.innerHTML = '<i class="fa-solid fa-crown text-gold"></i> 全員が見ているアニメ';
        descEl.textContent = users.length < 2
          ? '全員共通アニメを表示するには2人以上のメンバーを有効にしてください。'
          : `対象 ${users.length} 人全員が見ている鉄板タイトル一覧です。`;
        userBar.style.display = 'none';
      } else {
        const isExc = this.activeMode === 'exclusive';
        const targetLabel = this.activeUser ? `@${esc(this.activeUser)} ` : '';
        titleEl.innerHTML = isExc
          ? `<i class="fa-solid fa-gem text-purple"></i> ${targetLabel}だけが見ているアニメ`
          : `<i class="fa-solid fa-user-slash text-pink"></i> ${targetLabel}以外みんな見ているアニメ`;
        descEl.textContent = isExc
          ? '他のメンバーは誰も見ていない、その人だけの独自履修作品です。'
          : '他の全員が見ているのに、選択した人だけが未視聴の作品です（3人以上で有効）。';

        userBar.style.display = 'flex';
        userBar.innerHTML = users.map(u => {
          const cnt = isExc
            ? (insights.exclusivePerUser?.[u]?.length || 0)
            : (insights.missingPerUser?.[u]?.length || 0);
          return `
            <button type="button" class="chip-btn ${this.activeUser === u ? 'active' : ''}" data-user="${esc(u)}">
              @${esc(u)} (${cnt})
            </button>
          `;
        }).join('');

        userBar.querySelectorAll('.chip-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            this.activeUser = btn.getAttribute('data-user');
            this.render(root.AppStore.state);
          });
        });
      }

      this.renderGrid();
    },

    renderGrid() {
      const grid = this.container.querySelector('#insight-grid');
      const badge = this.container.querySelector('#insight-count-badge');
      const report = root.AppStore.state.report;
      if (!grid || !report) return;

      const insights = report.insights || {};
      const users = report.users || [];

      if (this.activeMode === 'missing' && users.length < 3) {
        if (badge) badge.textContent = '0作品';
        grid.innerHTML = '<div class="empty-box"><i class="fa-solid fa-users"></i><p>「この人以外みんな見ている」は3人以上のメンバーで分析できます</p></div>';
        return;
      }

      let rawList = [];
      if (this.activeMode === 'all') {
        rawList = insights.watchedByAll || [];
      } else if (this.activeMode === 'exclusive') {
        rawList = (this.activeUser && insights.exclusivePerUser?.[this.activeUser]) || [];
      } else {
        rawList = (this.activeUser && insights.missingPerUser?.[this.activeUser]) || [];
      }

      let list = [...rawList];
      if (this.filterQuery) {
        list = list.filter(a => (a.title || '').toLowerCase().includes(this.filterQuery));
      }
      if (this.filterGenre && this.filterGenre !== 'ALL') {
        list = list.filter(a => root.AppStore.getWorkCategory(a.title) === this.filterGenre);
      }

      const sorted = root.AnalyzerEngine.sortAnimes(list, this.sortMode);

      if (badge) badge.textContent = `${sorted.length.toLocaleString()}作品`;

      root.UIUtils.renderLazyGrid(grid, sorted, (anime, idx) =>
        root.UIUtils.createAnimeCardHtml(anime, { showGenre: true, showStoryBtn: true, eager: idx < 12 })
      );
    }
  };

  root.AppViews = root.AppViews || {};
  root.AppViews.insights = InsightsView;
}(window));
