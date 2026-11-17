(function (root) {
  'use strict';

  const GroupView = {
    mounted: false,
    container: null,
    selectedUsers: null,
    _knownReportUsers: null,
    subtab: 'union', // 'union' | 'unwatched'
    searchQuery: '',
    eraFilter: 'all',
    genreFilter: 'ALL',
    sortMode: 'watchers',

    mount(container) {
      if (this.mounted) return;
      this.container = container;
      this.mounted = true;

      container.innerHTML = `
        <div class="stack-lg">
          <div class="card card-compact">
            <div class="card-header-row" style="margin-bottom:0.5rem;">
              <div class="chips-wrap">
                <span class="small text-muted" style="font-weight:700;"><i class="fa-solid fa-users text-pink"></i> 対象メンバー:</span>
                <span id="group-selected-summary" class="small text-muted"></span>
              </div>
              <div class="btn-group">
                <button type="button" id="btn-group-toggle-members" class="btn btn-outline btn-xs mobile-collapse-toggle" aria-expanded="false">
                  <i class="fa-solid fa-sliders"></i> 選択を開く
                </button>
                <button type="button" id="btn-group-all" class="btn btn-outline btn-xs">全選択</button>
                <button type="button" id="btn-group-none" class="btn btn-outline btn-xs">全解除</button>
              </div>
            </div>
            <div id="group-member-chips-wrap" class="mobile-collapse-body collapsed-on-mobile">
              <div id="group-user-chips" class="chips-wrap"></div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div class="card-header-row">
                <div class="subtabs-bar">
                  <button type="button" class="subtab-btn active" data-group-subtab="union">
                    <i class="fa-solid fa-circle-nodes"></i> <span>誰か視聴<span class="hide-mobile"> (和集合)</span></span>
                    <span id="badge-group-union" class="badge badge-pink">0</span>
                  </button>
                  <button type="button" class="subtab-btn" data-group-subtab="unwatched">
                    <i class="fa-solid fa-sparkles text-gold"></i> <span>全員未視聴<span class="hide-mobile"> (全作品)</span></span>
                    <span id="badge-group-unwatched" class="badge badge-gold">読込中</span>
                  </button>
                </div>
                <span id="group-results-meta" class="small text-muted">表示中: 0 件</span>
              </div>
              <p id="group-subtab-desc" class="card-desc" style="margin-top:0.45rem;">
                選択メンバーのうち「誰か1人以上が見ている作品」の全一覧です。
              </p>
            </div>

            <div class="stack-md" style="margin-bottom:1rem;">
              <div class="toolbar-row">
                <div class="search-field">
                  <i class="fa-solid fa-magnifying-glass"></i>
                  <input type="text" id="group-search-input" class="input-text" placeholder="タイトルで検索..." />
                  <button type="button" id="group-search-clear" class="input-clear-btn" style="display:none;"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <select id="group-genre-select" class="select-control" aria-label="ジャンル絞り込み">
                  <option value="ALL">ジャンル: すべて</option>
                </select>
                <select id="group-sort-select" class="select-control" aria-label="並び替え">
                  <option value="watchers">視聴人数が多い順</option>
                  <option value="season-desc">放送時期が新しい順</option>
                  <option value="season-asc">放送時期が古い順</option>
                  <option value="title">タイトル順</option>
                </select>
              </div>

              <div id="group-era-chips" class="chips-wrap">
                <span class="small text-muted"><i class="fa-regular fa-calendar"></i> 年代:</span>
                <button type="button" class="chip-btn active" data-era="all">すべて</button>
                <button type="button" class="chip-btn" data-era="2020s">2020年代</button>
                <button type="button" class="chip-btn" data-era="2010s">2010年代</button>
                <button type="button" class="chip-btn" data-era="2000s">2000年代</button>
                <button type="button" class="chip-btn" data-era="classic">〜1990年代</button>
                <button type="button" class="chip-btn" data-era="unknown">時期未設定</button>
              </div>
            </div>

            <div id="group-works-grid" class="anime-cards-grid"></div>
          </div>
        </div>
      `;

      const genreSel = container.querySelector('#group-genre-select');
      if (genreSel && root.GenreEngine) {
        root.GenreEngine.GENRE_DEFINITIONS.forEach(g => {
          const opt = document.createElement('option');
          opt.value = g.id;
          opt.textContent = `ジャンル: ${g.label}`;
          genreSel.appendChild(opt);
        });
      }

      container.querySelectorAll('.subtab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const next = btn.getAttribute('data-group-subtab');
          if (next === this.subtab) return;
          this.subtab = next;
          container.querySelectorAll('.subtab-btn').forEach(b => b.classList.toggle('active', b === btn));

          const descEl = container.querySelector('#group-subtab-desc');
          const sortSel = container.querySelector('#group-sort-select');
          if (this.subtab === 'union') {
            descEl.textContent = '選択メンバーのうち「誰か1人以上が見ている作品」の全一覧です。';
            sortSel.options[0].textContent = '視聴人数が多い順';
          } else {
            const totalPop = (root.AppStore.state.popularWorks?.length || 17350).toLocaleString();
            descEl.textContent = `Annict全作品インデックス（${totalPop}作）から、選択メンバーが「誰も見ていない」作品を人気順に探索できます。`;
            sortSel.options[0].textContent = 'Annict人気順';
          }
          this.renderGrid();
        });
      });

      container.querySelector('#btn-group-toggle-members')?.addEventListener('click', (e) => {
        const wrap = container.querySelector('#group-member-chips-wrap');
        const btn = e.currentTarget;
        if (!wrap) return;
        const willShow = wrap.classList.contains('collapsed-on-mobile');
        wrap.classList.toggle('collapsed-on-mobile', !willShow);
        btn.setAttribute('aria-expanded', String(willShow));
        btn.innerHTML = willShow
          ? '<i class="fa-solid fa-chevron-up"></i> 選択を閉じる'
          : '<i class="fa-solid fa-sliders"></i> 選択を開く';
      });

      container.querySelector('#btn-group-all')?.addEventListener('click', () => {
        this.selectedUsers = [...(root.AppStore.state.report?.users || [])];
        this.render(root.AppStore.state);
      });

      container.querySelector('#btn-group-none')?.addEventListener('click', () => {
        this.selectedUsers = [];
        this.render(root.AppStore.state);
      });

      let debounce;
      const searchInput = container.querySelector('#group-search-input');
      const clearBtn = container.querySelector('#group-search-clear');
      searchInput?.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.trim().toLowerCase();
        if (clearBtn) clearBtn.style.display = this.searchQuery ? 'block' : 'none';
        clearTimeout(debounce);
        debounce = setTimeout(() => this.renderGrid(), 100);
      });
      clearBtn?.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        this.searchQuery = '';
        clearBtn.style.display = 'none';
        this.renderGrid();
      });

      genreSel?.addEventListener('change', (e) => {
        this.genreFilter = e.target.value;
        this.renderGrid();
      });

      container.querySelector('#group-sort-select')?.addEventListener('change', (e) => {
        this.sortMode = e.target.value;
        this.renderGrid();
      });

      container.querySelector('#group-era-chips')?.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip-btn');
        if (!chip) return;
        container.querySelectorAll('#group-era-chips .chip-btn').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.eraFilter = chip.getAttribute('data-era') || 'all';
        this.renderGrid();
      });
    },

    async render(storeState) {
      if (!this.mounted || !storeState.report) return;
      const users = storeState.report.users || [];

      if (!this.selectedUsers) {
        this.selectedUsers = [...users];
        this._knownReportUsers = new Set(users);
      } else {
        const prevKnown = this._knownReportUsers || new Set(this.selectedUsers);
        const kept = this.selectedUsers.filter(u => users.includes(u));
        users.forEach(u => {
          if (!prevKnown.has(u) && !kept.includes(u)) kept.push(u);
        });
        this.selectedUsers = kept;
        this._knownReportUsers = new Set(users);
      }

      this.renderUserChips(storeState.report);

      // 未視聴数バッジ表示のために遅延インデックスが未読込なら非同期ロード
      if (!root.AppStore.state.popularWorks && !root.AppStore.state.popularLoadError) {
        this.renderGrid();
        await root.AppStore.ensurePopularIndex();
        if (root.AppStore.state.activeView === 'group') {
          this.renderGrid();
        } else {
          root.AppStore.markViewsDirty(['group']);
        }
      } else {
        this.renderGrid();
      }
    },

    renderUserChips(report) {
      const container = this.container.querySelector('#group-user-chips');
      const summary = this.container.querySelector('#group-selected-summary');
      const users = report.users || [];
      const selectedSet = new Set(this.selectedUsers || []);
      const esc = root.UIUtils.escapeHtml;

      if (summary) summary.textContent = `(全${users.length}人中 ${selectedSet.size}人選択)`;
      if (!container) return;

      container.innerHTML = users.map(u => {
        const count = root.AppStore.getUserUniqueCount(u);
        const isSel = selectedSet.has(u);
        return `
          <button type="button" class="user-chip ${isSel ? 'selected' : ''}" data-user="${esc(u)}">
            <i class="fa-${isSel ? 'solid fa-check' : 'regular fa-circle'}"></i>
            <span>@${esc(u)} (${count})</span>
          </button>
        `;
      }).join('');

      container.querySelectorAll('.user-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          const u = btn.getAttribute('data-user');
          if (selectedSet.has(u)) {
            this.selectedUsers = this.selectedUsers.filter(x => x !== u);
          } else {
            this.selectedUsers.push(u);
          }
          this.renderUserChips(report);
          this.renderGrid();
        });
      });
    },

    renderGrid() {
      const grid = this.container.querySelector('#group-works-grid');
      const unionBadge = this.container.querySelector('#badge-group-union');
      const unwatchedBadge = this.container.querySelector('#badge-group-unwatched');
      const metaEl = this.container.querySelector('#group-results-meta');
      const report = root.AppStore.state.report;
      if (!grid || !report) return;

      const selected = this.selectedUsers || [];
      const unionMap = new Map();

      selected.forEach(u => {
        (report.userWatchedLists[u] || []).forEach(a => {
          const id = String(a.id);
          if (!unionMap.has(id)) {
            unionMap.set(id, { work: a, watchers: [u] });
          } else {
            const entry = unionMap.get(id);
            if (!entry.watchers.includes(u)) entry.watchers.push(u);
          }
        });
      });

      if (unionBadge) unionBadge.textContent = unionMap.size.toLocaleString();

      const popularList = root.AppStore.state.popularWorks;
      const popularError = root.AppStore.state.popularLoadError;
      let unwatchedList = [];
      if (popularList) {
        for (let i = 0; i < popularList.length; i++) {
          const pw = popularList[i];
          if (!unionMap.has(pw.id)) {
            unwatchedList.push({ work: pw, popularRank: pw.popularRank || i + 1 });
          }
        }
        if (unwatchedBadge) unwatchedBadge.textContent = unwatchedList.length.toLocaleString();
      } else {
        if (unwatchedBadge) unwatchedBadge.textContent = popularError ? 'エラー' : '読込中';
      }

      if (selected.length === 0) {
        if (metaEl) metaEl.textContent = '表示中: 0 件';
        grid.innerHTML = '<div class="empty-box"><i class="fa-solid fa-user-xmark"></i><p>対象メンバーを1人以上選択してください</p></div>';
        return;
      }

      const isUnion = this.subtab === 'union';
      if (!isUnion && !popularList) {
        if (popularError) {
          if (metaEl) metaEl.textContent = '読込エラー';
          grid.innerHTML = `
            <div class="empty-box">
              <i class="fa-solid fa-triangle-exclamation text-pink"></i>
              <p>Annict全作品インデックスの取得に失敗しました: ${root.UIUtils.escapeHtml(popularError)}</p>
              <button type="button" id="btn-group-retry-popular" class="btn btn-primary btn-sm">
                <i class="fa-solid fa-rotate-right"></i> 再試行
              </button>
            </div>
          `;
          grid.querySelector('#btn-group-retry-popular')?.addEventListener('click', async () => {
            grid.innerHTML = '<div class="empty-box"><div class="spinner-sm"></div><p>再読み込み中...</p></div>';
            await root.AppStore.ensurePopularIndex();
            this.renderGrid();
          });
          return;
        }
        if (metaEl) metaEl.textContent = '全作品インデックスを読み込み中...';
        grid.innerHTML = '<div class="empty-box"><div class="spinner-sm"></div><p>Annict全作品インデックス (17,350件) を読み込み中...</p></div>';
        return;
      }

      const sourceItems = isUnion ? Array.from(unionMap.values()) : unwatchedList;
      const matchEra = root.AnalyzerEngine.matchEra;
      const parseW = root.AnalyzerEngine.parseSeasonWeight;

      const filtered = sourceItems.filter(item => {
        const w = item.work;
        if (this.searchQuery && !(w.title || '').toLowerCase().includes(this.searchQuery)) return false;
        if (this.eraFilter !== 'all' && !matchEra(w.season, this.eraFilter)) return false;
        if (this.genreFilter !== 'ALL' && root.AppStore.getWorkCategory(w.title) !== this.genreFilter) return false;
        return true;
      });

      filtered.sort((a, b) => {
        if (this.sortMode === 'watchers') {
          if (isUnion) {
            const diff = b.watchers.length - a.watchers.length;
            if (diff !== 0) return diff;
          } else {
            return a.popularRank - b.popularRank;
          }
        } else if (this.sortMode === 'season-desc') {
          const diff = parseW(b.work.season) - parseW(a.work.season);
          if (diff !== 0) return diff;
        } else if (this.sortMode === 'season-asc') {
          const diff = parseW(a.work.season) - parseW(b.work.season);
          if (diff !== 0) return diff;
        }
        return root.AnalyzerEngine.compareTitlesJa(a.work.title, b.work.title);
      });

      if (metaEl) {
        metaEl.textContent = `該当 ${filtered.length.toLocaleString()} 件 / 全体 ${sourceItems.length.toLocaleString()} 件`;
      }

      root.UIUtils.renderLazyGrid(
        grid,
        filtered,
        (item, idx) => {
          const w = item.work;
          const extra = isUnion
            ? `<span class="badge badge-pink" style="padding:0.08rem 0.4rem;font-size:0.68rem;">${item.watchers.length}人</span>`
            : `<span class="text-muted">#${item.popularRank}</span>`;
          return root.UIUtils.createAnimeCardHtml(w, {
            showGenre: true,
            watchers: isUnion ? item.watchers : null,
            showStoryBtn: true,
            eager: idx < 12,
            extraMeta: extra
          });
        },
        {
          batchSize: 48,
          onAfterBatch: async (slice) => {
            if (isUnion) return;
            await root.UIUtils.hydratePopularThumbs(grid, slice.map(x => x.work));
          }
        }
      );
    }
  };

  root.AppViews = root.AppViews || {};
  root.AppViews.group = GroupView;
}(window));
