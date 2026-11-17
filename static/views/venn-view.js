(function (root) {
  'use strict';

  const VennView = {
    mounted: false,
    container: null,
    activeAnimes: [],
    activeRegionTitle: '',
    filterQuery: '',
    filterGenre: 'ALL',
    sortMode: 'season-desc',
    sets: [],
    activeRegionKey: '',

    mount(container) {
      if (this.mounted) return;
      this.container = container;
      this.mounted = true;

      container.innerHTML = `
        <div class="stack-lg">
          <div class="card card-compact">
            <div class="card-header-row">
              <div class="chips-wrap">
                <span class="small text-muted" style="font-weight:700;"><i class="fa-solid fa-users text-pink"></i> 比較メンバー (1〜3人):</span>
                <div id="venn-user-chips" class="chips-wrap"></div>
              </div>
              <span class="small text-muted"><i class="fa-solid fa-circle-info"></i> 円・交差領域または下部ボタンから作品を確認</span>
            </div>
          </div>

          <div class="venn-grid-layout">
            <div class="venn-stage-card">
              <div id="venn-chart">
                <div class="empty-box"><div class="spinner-sm"></div><p>視聴データを読み込み中...</p></div>
              </div>
              <div id="venn-empty-state" class="empty-box" style="display:none;">
                <i class="fa-solid fa-users"></i>
                <p>比較するユーザーを1〜3人選択してください</p>
              </div>
              <div id="venn-region-stats" class="venn-region-stats"></div>
            </div>

            <div class="card">
              <div class="card-header">
                <div class="card-header-row">
                  <h3 id="venn-detail-title" class="card-title"><i class="fa-solid fa-list-check text-pink"></i> 作品リスト</h3>
                  <span id="venn-detail-badge" class="badge badge-pink">0 作品</span>
                </div>
                <p id="venn-detail-desc" class="card-desc">ベン図の領域を選択すると、該当作品が表示されます。</p>
              </div>

              <div class="toolbar-row" style="margin-bottom:1rem;">
                <div class="search-field">
                  <i class="fa-solid fa-magnifying-glass"></i>
                  <input type="text" id="venn-detail-search" class="input-text" placeholder="この領域内をタイトル絞り込み..." />
                  <button type="button" id="venn-detail-clear" class="input-clear-btn" style="display:none;"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <select id="venn-genre-filter" class="select-control" aria-label="ジャンル絞り込み">
                  <option value="ALL">ジャンル: すべて</option>
                </select>
                <select id="venn-sort-select" class="select-control" aria-label="並び替え">
                  <option value="season-desc">放送時期が新しい順</option>
                  <option value="season-asc">放送時期が古い順</option>
                  <option value="title">タイトル順</option>
                </select>
              </div>

              <div id="venn-detail-grid" class="anime-cards-grid"></div>
            </div>
          </div>
        </div>
      `;

      // ジャンル選択肢生成
      const genreSel = container.querySelector('#venn-genre-filter');
      if (genreSel && root.GenreEngine) {
        root.GenreEngine.GENRE_DEFINITIONS.forEach(g => {
          const opt = document.createElement('option');
          opt.value = g.id;
          opt.textContent = `ジャンル: ${g.label}`;
          genreSel.appendChild(opt);
        });
      }

      const searchInput = container.querySelector('#venn-detail-search');
      const clearBtn = container.querySelector('#venn-detail-clear');
      searchInput?.addEventListener('input', (e) => {
        this.filterQuery = e.target.value.trim().toLowerCase();
        if (clearBtn) clearBtn.style.display = this.filterQuery ? 'block' : 'none';
        this.renderFilteredGrid();
      });
      clearBtn?.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        this.filterQuery = '';
        clearBtn.style.display = 'none';
        this.renderFilteredGrid();
      });

      genreSel?.addEventListener('change', (e) => {
        this.filterGenre = e.target.value;
        this.renderFilteredGrid();
      });

      container.querySelector('#venn-sort-select')?.addEventListener('change', (e) => {
        this.sortMode = e.target.value;
        this.renderFilteredGrid();
      });

      let resizeTimer;
      window.addEventListener('resize', () => {
        if (root.AppStore.state.activeView !== 'venn') return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => this.drawVennChart(), 180);
      });
    },

    render(storeState) {
      if (!this.mounted || !storeState.report) return;
      this.renderUserChips(storeState);
      this.drawVennChart();
    },

    renderUserChips(storeState) {
      const container = this.container.querySelector('#venn-user-chips');
      if (!container) return;
      const effectiveUsers = root.AppStore.getEffectiveUsers();
      const selected = storeState.selectedVennUsers || [];
      const esc = root.UIUtils.escapeHtml;
      const colors = root.UIUtils.USER_COLORS;

      container.innerHTML = effectiveUsers.map(u => {
        const count = root.AppStore.getUserUniqueCount(u);
        const selIdx = selected.indexOf(u);
        const isSel = selIdx >= 0;
        const color = isSel ? colors[selIdx % colors.length] : null;
        const styleAttr = isSel
          ? `style="border-color:${color};background:${color}22;color:var(--text-main);"`
          : '';
        const dotHtml = isSel
          ? `<span style="width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0;box-shadow:0 0 0 2px rgba(255,255,255,0.22);"></span>`
          : `<i class="fa-regular fa-circle"></i>`;
        return `
          <button type="button" class="user-chip ${isSel ? 'selected' : ''}" data-user="${esc(u)}" ${styleAttr}>
            ${dotHtml}
            <span>@${esc(u)} (${count})</span>
          </button>
        `;
      }).join('');

      container.querySelectorAll('.user-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          const u = btn.getAttribute('data-user');
          const sel = root.AppStore.state.selectedVennUsers;
          const idx = sel.indexOf(u);
          if (idx >= 0) {
            if (sel.length <= 1) {
              root.UIUtils.showToast('ベン図には少なくとも1人の選択が必要です', 'warn');
              return;
            }
            sel.splice(idx, 1);
          } else {
            if (sel.length >= 3) {
              root.UIUtils.showToast('ベン図の視認性を保つため、選択は最大3人までです', 'warn');
              return;
            }
            sel.push(u);
          }
          this.activeRegionKey = '';
          this.render(root.AppStore.state);
        });
      });
    },

    drawVennChart() {
      const chartEl = this.container.querySelector('#venn-chart');
      const emptyEl = this.container.querySelector('#venn-empty-state');
      const statsEl = this.container.querySelector('#venn-region-stats');
      if (!chartEl) return;

      const users = root.AppStore.state.selectedVennUsers || [];
      const report = root.AppStore.state.report;
      if (!report || users.length === 0) {
        chartEl.style.display = 'none';
        if (emptyEl) emptyEl.style.display = 'flex';
        if (statsEl) statsEl.innerHTML = '';
        this.setRegion([], '作品リスト', []);
        return;
      }

      chartEl.style.display = 'flex';
      if (emptyEl) emptyEl.style.display = 'none';

      const engine = new root.AnalyzerEngine.AnalyzerEngine(
        Object.fromEntries(users.map(u => [u, report.userWatchedLists[u] || []]))
      );
      const sets = engine.generateVennSets(users);
      this.sets = sets;

      chartEl.innerHTML = '';
      if (typeof window.venn === 'undefined' || typeof window.d3 === 'undefined') {
        chartEl.innerHTML = '<p class="text-muted">ベン図ライブラリを読み込み中...</p>';
      } else {
        const stageWidth = chartEl.parentElement?.clientWidth || window.innerWidth;
        const isMobile = window.innerWidth <= 640;
        const chartWidth = Math.max(260, Math.min(isMobile ? 350 : 620, stageWidth - 32));
        const chartHeight = isMobile ? Math.round(chartWidth * 0.84) : 390;

        const chart = window.venn.VennDiagram()
          .width(chartWidth)
          .height(chartHeight)
          .padding(isMobile ? 28 : 20);
        if (typeof chart.duration === 'function') chart.duration(0);
        const div = window.d3.select(chartEl).datum(sets).call(chart);

        const svg = window.d3.select(chartEl).select('svg')
          .attr('viewBox', `0 0 ${chartWidth} ${chartHeight}`)
          .attr('preserveAspectRatio', 'xMidYMid meet')
          .style('width', '100%')
          .style('max-height', isMobile ? '310px' : '400px');

        const colors = root.UIUtils.USER_COLORS;
        div.selectAll('g.venn-area').each((d, idx, nodes) => {
          const node = window.d3.select(nodes[idx]);
          if (d && d.sets && d.sets.length === 1) {
            const uIdx = users.indexOf(d.sets[0]);
            node.select('path').style('fill', colors[uIdx % colors.length]);
          }
          node.on('click', () => {
            if (!d || !d.sets) return;
            this.selectRegionBySets(d.sets);
          });
        });

        const placeAllLabels = () => {
          if (svg.empty()) return;
          svg.select('g.venn-labels-layer').remove();
          const circleCenters = {};
          div.selectAll('g.venn-circle').each((d, idx, nodes) => {
            if (d?.sets?.length === 1) {
              const p = nodes[idx].querySelector('path');
              if (p && typeof p.getBBox === 'function') {
                try {
                  const b = p.getBBox();
                  circleCenters[d.sets[0]] = { x: b.x + b.width / 2, y: b.y + b.height / 2, r: Math.min(b.width, b.height) / 2 };
                } catch (_) {}
              }
            }
          });

          const labelLayer = svg.append('g').attr('class', 'venn-labels-layer');
          div.selectAll('g.venn-area').each((d, idx, nodes) => {
            if (!d || !d.sets) return;
            if (d.sets.length === 1) {
              const u = d.sets[0];
              const origTxt = nodes[idx].querySelector('text');
              let tx = circleCenters[u]?.x || chartWidth / 2;
              let ty = circleCenters[u]?.y || chartHeight / 2;
              if (origTxt) {
                tx = parseFloat(origTxt.getAttribute('x')) || tx;
                ty = parseFloat(origTxt.getAttribute('y')) || ty;
                origTxt.style.display = 'none';
              }
              const c = circleCenters[u];
              if (isMobile && c) {
                tx = c.x + (tx - c.x) * 0.72;
                ty = c.y + (ty - c.y) * 0.80;
                tx = Math.max(78, Math.min(chartWidth - 78, tx));
              }
              labelLayer.append('text')
                .attr('x', tx)
                .attr('y', ty)
                .attr('text-anchor', 'middle')
                .attr('dominant-baseline', 'central')
                .text(`@${u} (${d.size})`);
            } else if (d.sets.length > 1 && d.size > 0) {
              const p = nodes[idx].querySelector('path');
              if (!p || typeof p.getBBox !== 'function') return;
              try {
                const box = p.getBBox();
                if (box.width < 12 || box.height < 12) return;
                let lx = box.x + box.width / 2;
                let ly = box.y + box.height / 2;
                if (d.sets.length === 2 && users.length === 3) {
                  const thirdUser = users.find(u => !d.sets.includes(u));
                  const c1 = circleCenters[d.sets[0]];
                  const c2 = circleCenters[d.sets[1]];
                  const c3 = thirdUser ? circleCenters[thirdUser] : null;
                  if (c1 && c2 && c3) {
                    const pairDist = Math.hypot(c2.x - c1.x, c2.y - c1.y) || 1;
                    const lensRatio = Math.max(0.15, Math.min(0.85, 0.5 + (c1.r - c2.r) / (2 * pairDist)));
                    const lensX = c1.x + (c2.x - c1.x) * lensRatio;
                    const lensY = c1.y + (c2.y - c1.y) * lensRatio;
                    let dx = lensX - c3.x;
                    let dy = lensY - c3.y;
                    let len = Math.hypot(dx, dy);
                    if (len < 1) {
                      dx = -(c2.y - c1.y);
                      dy = (c2.x - c1.x);
                      len = Math.hypot(dx, dy) || 1;
                    }
                    const ux = dx / len;
                    const uy = dy / len;
                    const m1 = Math.min(3, c1.r * 0.25);
                    const m2 = Math.min(3, c2.r * 0.25);
                    const tMin = c3.r + 4;
                    let tOuter = 0;
                    const maxSweep = c3.r + Math.max(c1.r, c2.r) * 2;
                    for (let t = c3.r + 2; t <= maxSweep; t += 2) {
                      const px = c3.x + ux * t;
                      const py = c3.y + uy * t;
                      if (Math.hypot(px - c1.x, py - c1.y) <= c1.r - m1 && Math.hypot(px - c2.x, py - c2.y) <= c2.r - m2) {
                        tOuter = t;
                      }
                    }
                    if (tOuter > tMin) {
                      const bestT = (c3.r + tOuter) / 2;
                      lx = c3.x + ux * bestT;
                      ly = c3.y + uy * bestT;
                    } else {
                      const curDist = Math.hypot(lx - c3.x, ly - c3.y);
                      const safeDist = c3.r + Math.min(12, Math.max(c1.r, c2.r) * 0.5);
                      if (curDist < safeDist) {
                        const rx = curDist > 1 ? (lx - c3.x) / curDist : ux;
                        const ry = curDist > 1 ? (ly - c3.y) / curDist : uy;
                        lx = c3.x + rx * safeDist;
                        ly = c3.y + ry * safeDist;
                      }
                    }
                  }
                }
                labelLayer.append('text')
                  .attr('class', 'venn-intersection-label')
                  .attr('x', lx)
                  .attr('y', ly)
                  .attr('text-anchor', 'middle')
                  .attr('dominant-baseline', 'central')
                  .text(String(d.size));
              } catch (_) {}
            }
          });
        };

        placeAllLabels();
        requestAnimationFrame(placeAllLabels);
      }

      // クイック領域選択ボタン（モバイル・細かい領域でも確実に押せる）
      if (statsEl) {
        const esc = root.UIUtils.escapeHtml;
        statsEl.innerHTML = sets.map(s => {
          const key = s.sets.join('|');
          const label = s.sets.length === 1
            ? `@${esc(s.sets[0])} (${s.size})`
            : `${s.sets.map(u => `@${esc(u)}`).join(' ∩ ')} (${s.size})`;
          return `<button type="button" class="chip-btn js-venn-region-btn" data-region-key="${esc(key)}">${label}</button>`;
        }).join('');

        statsEl.querySelectorAll('.js-venn-region-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const key = btn.getAttribute('data-region-key');
            const target = this.sets.find(s => s.sets.join('|') === key);
            if (target) this.selectRegionBySets(target.sets);
          });
        });
      }

      // 初期または維持領域の選択
      let targetSet = this.activeRegionKey
        ? sets.find(s => s.sets.join('|') === this.activeRegionKey)
        : null;
      if (!targetSet) {
        targetSet = sets.find(s => s.sets.length === users.length) || sets[0];
      }
      if (targetSet) {
        this.selectRegionBySets(targetSet.sets);
      }
    },

    selectRegionBySets(targetSets) {
      const key = [...targetSets].join('|');
      this.activeRegionKey = key;
      const match = this.sets.find(s => s.sets.length === targetSets.length && s.sets.every(u => targetSets.includes(u)));
      const animes = match ? (match.animes || []) : [];

      const areaLabel = targetSets.map(u => `@${u}`).join(' ∩ ');
      const title = targetSets.length === 1 ? `${areaLabel} の視聴作品` : `${areaLabel} の共通視聴作品`;

      // SVGハイライト同期
      const chartEl = this.container.querySelector('#venn-chart');
      if (chartEl && typeof window.d3 !== 'undefined') {
        const div = window.d3.select(chartEl);
        div.selectAll('g').classed('active', false).classed('active-parent', false);
        div.selectAll('g').each(function (d) {
          if (!d || !d.sets) return;
          if (d.sets.length === targetSets.length && d.sets.every(u => targetSets.includes(u))) {
            window.d3.select(this).classed('active', true);
          } else if (targetSets.length > 1 && d.sets.length === 1 && targetSets.includes(d.sets[0])) {
            window.d3.select(this).classed('active-parent', true);
          }
        });
      }

      // クイック領域ボタンハイライト同期
      this.container.querySelectorAll('.js-venn-region-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-region-key') === key);
      });

      this.setRegion(targetSets, title, animes);
    },

    setRegion(targetSets, title, animes) {
      this.activeAnimes = animes || [];
      this.activeRegionTitle = title;
      const titleEl = this.container.querySelector('#venn-detail-title');
      const badgeEl = this.container.querySelector('#venn-detail-badge');
      const descEl = this.container.querySelector('#venn-detail-desc');
      if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-list-check text-pink"></i> ${root.UIUtils.escapeHtml(title)}`;
      if (badgeEl) badgeEl.textContent = `${this.activeAnimes.length.toLocaleString()} 作品`;
      if (descEl) descEl.textContent = `${this.activeAnimes.length.toLocaleString()} 件が該当します。カードをクリックするとAnnictを開きます。`;
      this.renderFilteredGrid();
    },

    renderFilteredGrid() {
      const grid = this.container.querySelector('#venn-detail-grid');
      if (!grid) return;

      let list = [...this.activeAnimes];
      if (this.filterQuery) {
        list = list.filter(a => (a.title || '').toLowerCase().includes(this.filterQuery));
      }
      if (this.filterGenre && this.filterGenre !== 'ALL') {
        list = list.filter(a => root.AppStore.getWorkCategory(a.title) === this.filterGenre);
      }

      const sorted = root.AnalyzerEngine.sortAnimes(list, this.sortMode);

      const badgeEl = this.container.querySelector('#venn-detail-badge');
      if (badgeEl) {
        badgeEl.textContent = list.length === this.activeAnimes.length
          ? `${list.length.toLocaleString()} 作品`
          : `${list.length.toLocaleString()} / ${this.activeAnimes.length.toLocaleString()} 作品`;
      }

      root.UIUtils.renderLazyGrid(grid, sorted, (anime, idx) =>
        root.UIUtils.createAnimeCardHtml(anime, { showGenre: true, showStoryBtn: true, eager: idx < 12 })
      );
    }
  };

  root.AppViews = root.AppViews || {};
  root.AppViews.venn = VennView;
}(window));
