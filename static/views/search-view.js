(function (root) {
  'use strict';

  const SearchView = {
    mounted: false,
    container: null,
    scope: 'members', // 'members' | 'all'
    query: '',
    genreFilter: 'ALL',

    mount(container) {
      if (this.mounted) return;
      this.container = container;
      this.mounted = true;

      container.innerHTML = `
        <div class="stack-lg">
          <div class="card">
            <div class="card-header">
              <div class="card-header-row">
                <div>
                  <h3 class="card-title"><i class="fa-solid fa-magnifying-glass text-pink"></i> 作品検索・逆引き</h3>
                  <p class="card-desc">気になるタイトルから「誰が見ているか」を瞬時に検索。Annict全作品からの横断検索にも切り替えできます。</p>
                </div>
                <span id="search-hit-badge" class="badge badge-pink">0 件</span>
              </div>
            </div>

            <div class="stack-md" style="margin-bottom:1rem;">
              <div class="toolbar-row">
                <div class="subtabs-bar">
                  <button type="button" class="subtab-btn active" data-search-scope="members">
                    <i class="fa-solid fa-users"></i> メンバー視聴作
                  </button>
                  <button type="button" class="subtab-btn" data-search-scope="all">
                    <i class="fa-solid fa-globe"></i> Annict全作品
                  </button>
                </div>
                <select id="search-genre-select" class="select-control" aria-label="ジャンル絞り込み">
                  <option value="ALL">ジャンル: すべて</option>
                </select>
              </div>

              <div class="search-field">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" id="global-search-input" class="input-text" placeholder="タイトル・略称で検索（例: まどか）" />
                <button type="button" id="global-search-clear" class="input-clear-btn" style="display:none;"><i class="fa-solid fa-xmark"></i></button>
              </div>
            </div>

            <div id="global-search-results" class="anime-cards-grid"></div>
          </div>
        </div>
      `;

      const genreSel = container.querySelector('#search-genre-select');
      if (genreSel && root.GenreEngine) {
        root.GenreEngine.GENRE_DEFINITIONS.forEach(g => {
          const opt = document.createElement('option');
          opt.value = g.id;
          opt.textContent = `ジャンル: ${g.label}`;
          genreSel.appendChild(opt);
        });
      }

      container.querySelectorAll('[data-search-scope]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const next = btn.getAttribute('data-search-scope');
          if (next === this.scope) return;
          this.scope = next;
          container.querySelectorAll('[data-search-scope]').forEach(b => b.classList.toggle('active', b === btn));
          if (this.scope === 'all' && !root.AppStore.state.popularWorks) {
            const grid = container.querySelector('#global-search-results');
            if (grid) grid.innerHTML = '<div class="empty-box"><div class="spinner-sm"></div><p>Annict全作品インデックスを読み込み中...</p></div>';
            await root.AppStore.ensurePopularIndex();
          }
          this.renderResults();
        });
      });

      let debounce;
      const input = container.querySelector('#global-search-input');
      const clearBtn = container.querySelector('#global-search-clear');
      input?.addEventListener('input', (e) => {
        this.query = e.target.value.trim();
        if (clearBtn) clearBtn.style.display = this.query ? 'block' : 'none';
        clearTimeout(debounce);
        debounce = setTimeout(() => this.renderResults(), 100);
      });
      clearBtn?.addEventListener('click', () => {
        if (input) input.value = '';
        this.query = '';
        clearBtn.style.display = 'none';
        this.renderResults();
        input?.focus();
      });

      genreSel?.addEventListener('change', (e) => {
        this.genreFilter = e.target.value;
        this.renderResults();
      });
    },

    render(storeState) {
      if (!this.mounted || !storeState.report) return;
      this.renderResults();
    },

    renderResults() {
      const grid = this.container.querySelector('#global-search-results');
      const badge = this.container.querySelector('#search-hit-badge');
      const report = root.AppStore.state.report;
      if (!grid || !report) return;

      // メンバー視聴マップ構築
      const users = report.users || [];
      const memberWatchersMap = new Map();
      const memberWorkMap = new Map();

      users.forEach(u => {
        (report.userWatchedLists[u] || []).forEach(a => {
          const id = String(a.id);
          if (!memberWatchersMap.has(id)) {
            memberWatchersMap.set(id, []);
            memberWorkMap.set(id, a);
          }
          const arr = memberWatchersMap.get(id);
          if (!arr.includes(u)) arr.push(u);
        });
      });

      const normalizedRaw = (this.query || '').trim().normalize('NFKC');
      const aliases = root.GenreEngine?.TITLE_ALIASES || {};
      const aliased = aliases[normalizedRaw] || aliases[normalizedRaw.toLowerCase()] || normalizedRaw;
      const qLower = aliased.normalize('NFKC').toLowerCase();

      let items = [];
      if (this.scope === 'members') {
        for (const [id, anime] of memberWorkMap.entries()) {
          items.push({ anime, watchers: memberWatchersMap.get(id) || [] });
        }
      } else {
        const popular = root.AppStore.state.popularWorks;
        const popularError = root.AppStore.state.popularLoadError;
        if (!popular && popularError) {
          if (badge) badge.textContent = '読込エラー';
          grid.innerHTML = `
            <div class="empty-box">
              <i class="fa-solid fa-triangle-exclamation text-pink"></i>
              <p>Annict全作品インデックスの取得に失敗しました: ${root.UIUtils.escapeHtml(popularError)}</p>
              <button type="button" id="btn-search-retry-popular" class="btn btn-primary btn-sm">
                <i class="fa-solid fa-rotate-right"></i> 再試行
              </button>
            </div>
          `;
          grid.querySelector('#btn-search-retry-popular')?.addEventListener('click', async () => {
            grid.innerHTML = '<div class="empty-box"><div class="spinner-sm"></div><p>再読み込み中...</p></div>';
            await root.AppStore.ensurePopularIndex();
            this.renderResults();
          });
          return;
        }
        if (!popular) {
          if (badge) badge.textContent = '読込中';
          grid.innerHTML = '<div class="empty-box"><div class="spinner-sm"></div><p>Annict全作品インデックスを読み込み中...</p></div>';
          return;
        }
        const popArr = popular;
        for (let i = 0; i < popArr.length; i++) {
          const w = popArr[i];
          items.push({ anime: w, watchers: memberWatchersMap.get(w.id) || [] });
        }
      }

      if (qLower) {
        items = items.filter(({ anime }) => {
          const tLower = (anime.title || '').normalize('NFKC').toLowerCase();
          return tLower.includes(qLower) || String(anime.id) === qLower;
        });
      }
      if (this.genreFilter !== 'ALL') {
        items = items.filter(({ anime }) => root.AppStore.getWorkCategory(anime.title) === this.genreFilter);
      }

      if (this.scope === 'members') {
        const parseW = root.AnalyzerEngine.parseSeasonWeight;
        items.sort((a, b) => b.watchers.length - a.watchers.length || parseW(b.anime.season) - parseW(a.anime.season));
      }

      if (badge) badge.textContent = `${items.length.toLocaleString()} 件ヒット`;

      root.UIUtils.renderLazyGrid(
        grid,
        items,
        ({ anime, watchers }, idx) => root.UIUtils.createAnimeCardHtml(anime, {
          showGenre: true,
          watchers: watchers.length > 0 ? watchers : null,
          showStoryBtn: true,
          eager: idx < 12,
          extraMeta: watchers.length > 0
            ? `<span class="badge badge-blue" style="padding:0.06rem 0.35rem;font-size:0.66rem;">${watchers.length}人視聴</span>`
            : `<span class="text-muted">未視聴</span>`
        }),
        {
          batchSize: 48,
          onAfterBatch: async (slice) => {
            if (this.scope !== 'all') return;
            await root.UIUtils.hydratePopularThumbs(grid, slice.map(x => x.anime));
          }
        }
      );
    }
  };

  root.AppViews = root.AppViews || {};
  root.AppViews.search = SearchView;
}(window));
