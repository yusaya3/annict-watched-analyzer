(function (root) {
  'use strict';

  const SimilarityView = {
    mounted: false,
    container: null,
    coverageBaseUser: null,

    mount(container) {
      if (this.mounted) return;
      this.container = container;
      this.mounted = true;

      container.innerHTML = `
        <div class="stack-lg">
          <div class="similarity-top-grid">
            <div class="card">
              <div class="card-header">
                <h3 class="card-title"><i class="fa-solid fa-table-cells text-pink"></i> 視聴シンクロ率マトリクス</h3>
                <p class="card-desc">共通視聴作 ÷ どちらかが見ている全作品（Jaccard係数）。セルをクリックすると2人の共通作品を確認できます。</p>
              </div>
              <div class="table-scroll-hint">
                <span><i class="fa-solid fa-arrows-left-right"></i> セルをクリックで共通作品一覧を表示（左右スクロールで全メンバー比較）</span>
                <span id="sim-matrix-hint-badge" class="badge"></span>
              </div>
              <div class="table-scroll-outer">
                <div class="table-scroll-wrap">
                  <table id="sim-matrix-table" class="data-table"></table>
                </div>
              </div>
            </div>

            <div class="card">
              <div class="card-header">
                <h3 class="card-title"><i class="fa-solid fa-trophy text-gold"></i> シンクロ率ベストペア</h3>
                <p class="card-desc">アニメの好みが近いペアランキング（クリックで共通作品を表示）</p>
              </div>
              <div id="sim-ranking-list" class="ranking-list"></div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <div class="card-header-row">
                <div>
                  <h3 class="card-title"><i class="fa-solid fa-chart-simple text-purple"></i> 視点別・他ユーザーの視聴カバー率</h3>
                  <p class="card-desc">「基準メンバーが見ている全作品 (100%)」のうち、他のメンバーが何%をカバーしているかを可視化します。</p>
                </div>
                <div id="sim-coverage-chips" class="chips-wrap"></div>
              </div>
            </div>
            <div id="sim-coverage-content"></div>
          </div>
        </div>
      `;
    },

    render(storeState) {
      if (!this.mounted || !storeState.report) return;
      this.renderMatrixAndRanking(storeState.report);
      this.renderCoverage(storeState.report);
    },

    renderMatrixAndRanking(report) {
      const users = report.users || [];
      const matrix = report.similarity?.matrix || [];
      const ranking = report.similarity?.ranking || [];
      const table = this.container.querySelector('#sim-matrix-table');
      const rankList = this.container.querySelector('#sim-ranking-list');
      const esc = root.UIUtils.escapeHtml;

      const hintBadge = this.container.querySelector('#sim-matrix-hint-badge');
      if (hintBadge) hintBadge.textContent = `${users.length}人 × ${users.length}人`;

      if (table) {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const nonDiagMax = Math.max(35, ...matrix.filter(m => m.user1 !== m.user2).map(m => Number(m.percentage || 0)));
        const headerHtml = `<thead><tr><th>メンバー</th>${users.map(u => `<th>@${esc(u)}</th>`).join('')}</tr></thead>`;
        const rowsHtml = users.map(u1 => {
          const cells = users.map(u2 => {
            const item = matrix.find(m => m.user1 === u1 && m.user2 === u2);
            const pctVal = Number(item ? item.percentage : 0);
            const pctStr = pctVal.toFixed(1);
            const common = item ? item.intersection : 0;
            if (u1 === u2) {
              return `<td style="background:var(--bg-muted);color:var(--text-muted);font-weight:700;">100.0%</td>`;
            }
            const alpha = isLight
              ? Math.min(0.62, Math.max(0.08, (pctVal / nonDiagMax) * 0.60))
              : Math.min(0.64, Math.max(0.10, (pctVal / nonDiagMax) * 0.60));
            const bg = `rgba(244, 63, 94, ${alpha.toFixed(2)})`;
            const textColor = isLight ? '#0f172a' : '#ffffff';
            return `
              <td class="heat-cell js-pair-cell" data-u1="${esc(u1)}" data-u2="${esc(u2)}" style="background:${bg};color:${textColor};" title="@${esc(u1)} × @${esc(u2)}: 共通 ${common}作 (${pctStr}%)">
                ${pctStr}%<br><small style="opacity:0.92;font-weight:500;">(${common}作)</small>
              </td>
            `;
          }).join('');
          return `<tr><th>@${esc(u1)}</th>${cells}</tr>`;
        }).join('');

        table.innerHTML = `${headerHtml}<tbody>${rowsHtml}</tbody>`;
        table.querySelectorAll('.js-pair-cell').forEach(td => {
          td.addEventListener('click', () => {
            this.openPairModal(td.getAttribute('data-u1'), td.getAttribute('data-u2'));
          });
        });
      }

      if (rankList) {
        if (ranking.length === 0) {
          rankList.innerHTML = '<div class="empty-box"><i class="fa-solid fa-user-group"></i><p>ランキング表示には2人以上のメンバーが必要です</p></div>';
          return;
        }
        rankList.innerHTML = ranking.map((r, idx) => {
          const pctStr = Number(r.percentage || 0).toFixed(1);
          return `
            <div class="ranking-item rank-${idx + 1} js-pair-rank" data-u1="${esc(r.pair[0])}" data-u2="${esc(r.pair[1])}">
              <span class="rank-num">${idx + 1}</span>
              <span class="rank-pair">@${esc(r.pair[0])} × @${esc(r.pair[1])}</span>
              <span class="rank-score">${pctStr}% <small class="text-muted">(${r.intersection}作)</small></span>
            </div>
          `;
        }).join('');

        rankList.querySelectorAll('.js-pair-rank').forEach(row => {
          row.addEventListener('click', () => {
            this.openPairModal(row.getAttribute('data-u1'), row.getAttribute('data-u2'));
          });
        });
      }
    },

    openPairModal(u1, u2) {
      const report = root.AppStore.state.report;
      if (!report || !u1 || !u2) return;
      const map1 = new Map((report.userWatchedLists[u1] || []).map(a => [String(a.id), a]));
      const set2 = new Set((report.userWatchedLists[u2] || []).map(a => String(a.id)));
      const common = Array.from(map1.values()).filter(a => set2.has(String(a.id)));
      const simRecord = report.similarity?.matrix?.find(m => m.user1 === u1 && m.user2 === u2);
      const pctStr = Number(simRecord ? simRecord.percentage : 0).toFixed(1);

      const modal = document.getElementById('pair-common-modal');
      const titleEl = document.getElementById('pair-modal-title');
      const metaEl = document.getElementById('pair-modal-meta');
      const gridEl = document.getElementById('pair-modal-grid');
      const vennBtn = document.getElementById('btn-pair-open-venn');
      const esc = root.UIUtils.escapeHtml;

      if (!modal || !gridEl) return;
      titleEl.innerHTML = `<i class="fa-solid fa-handshake text-pink"></i> @${esc(u1)} × @${esc(u2)} の共通作品`;
      metaEl.innerHTML = `
        <div class="stack-sm">
          <div class="chips-wrap">
            <span class="badge badge-pink">シンクロ率: ${pctStr}%</span>
            <span id="pair-modal-count-badge" class="badge badge-blue">共通作品: ${common.length.toLocaleString()} 作</span>
            <span class="badge">@${esc(u1)}: ${map1.size}作</span>
            <span class="badge">@${esc(u2)}: ${set2.size}作</span>
          </div>
          <div class="toolbar-row">
            <div class="search-field">
              <i class="fa-solid fa-magnifying-glass"></i>
              <input type="text" id="pair-modal-search" class="input-text" placeholder="共通作品をタイトル検索..." />
              <button type="button" id="pair-modal-clear" class="input-clear-btn" style="display:none;"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <select id="pair-modal-sort" class="select-control" aria-label="共通作品並び替え">
              <option value="season-desc">放送時期が新しい順</option>
              <option value="season-asc">放送時期が古い順</option>
              <option value="title">タイトル順</option>
            </select>
          </div>
        </div>
      `;

      let modalQuery = '';
      let modalSort = 'season-desc';
      const renderModalGrid = () => {
        const filtered = modalQuery
          ? common.filter(a => (a.title || '').toLowerCase().includes(modalQuery))
          : common;
        const sorted = root.AnalyzerEngine.sortAnimes(filtered, modalSort);
        const cntEl = document.getElementById('pair-modal-count-badge');
        if (cntEl) {
          cntEl.textContent = filtered.length === common.length
            ? `共通作品: ${common.length.toLocaleString()} 作`
            : `該当: ${filtered.length.toLocaleString()} / ${common.length.toLocaleString()} 作`;
        }
        root.UIUtils.renderLazyGrid(gridEl, sorted, (anime, idx) =>
          root.UIUtils.createAnimeCardHtml(anime, { showGenre: true, showStoryBtn: false, eager: idx < 12 })
        );
      };

      const searchEl = metaEl.querySelector('#pair-modal-search');
      const clearEl = metaEl.querySelector('#pair-modal-clear');
      searchEl?.addEventListener('input', (e) => {
        modalQuery = e.target.value.trim().toLowerCase();
        if (clearEl) clearEl.style.display = modalQuery ? 'block' : 'none';
        renderModalGrid();
      });
      clearEl?.addEventListener('click', () => {
        if (searchEl) searchEl.value = '';
        modalQuery = '';
        clearEl.style.display = 'none';
        renderModalGrid();
        searchEl?.focus();
      });
      metaEl.querySelector('#pair-modal-sort')?.addEventListener('change', (e) => {
        modalSort = e.target.value;
        renderModalGrid();
      });

      renderModalGrid();

      if (vennBtn) {
        vennBtn.onclick = () => {
          modal.style.display = 'none';
          root.AppStore.state.selectedVennUsers = [u1, u2];
          root.AppStore.markViewsDirty(['venn']);
          root.AppRouter?.navigateTo('venn');
        };
      }

      modal.style.display = 'flex';
    },

    renderCoverage(report) {
      const chipsEl = this.container.querySelector('#sim-coverage-chips');
      const contentEl = this.container.querySelector('#sim-coverage-content');
      if (!chipsEl || !contentEl) return;

      const users = report.users || [];
      const userLists = report.userWatchedLists || {};
      const esc = root.UIUtils.escapeHtml;

      if (users.length < 2) {
        chipsEl.innerHTML = '';
        contentEl.innerHTML = '<div class="empty-box"><i class="fa-solid fa-users"></i><p>カバー率の比較には2人以上のメンバーが必要です</p></div>';
        return;
      }

      if (!this.coverageBaseUser || (!users.includes(this.coverageBaseUser) && this.coverageBaseUser !== '__all__')) {
        this.coverageBaseUser = users[0];
      }

      const userMaps = {};
      users.forEach(u => {
        userMaps[u] = new Map((userLists[u] || []).map(a => [String(a.id), a]));
      });

      chipsEl.innerHTML = `
        ${users.map(u => `
          <button type="button" class="chip-btn ${this.coverageBaseUser === u ? 'active' : ''}" data-cov-user="${esc(u)}">
            @${esc(u)} (${userMaps[u].size})
          </button>
        `).join('')}
        <button type="button" class="chip-btn ${this.coverageBaseUser === '__all__' ? 'active' : ''}" data-cov-user="__all__">
          <i class="fa-solid fa-grip"></i> 全員並列
        </button>
      `;

      chipsEl.querySelectorAll('.chip-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this.coverageBaseUser = btn.getAttribute('data-cov-user');
          this.renderCoverage(report);
        });
      });

      const renderBlock = (me) => {
        const myAnimes = Array.from(userMaps[me].values());
        const myTotal = myAnimes.length;
        const ranked = users
          .filter(u => u !== me)
          .map(other => {
            const mapOther = userMaps[other];
            const commonCount = myAnimes.filter(a => mapOther.has(String(a.id))).length;
            const pct = myTotal > 0 ? (commonCount / myTotal) * 100 : 0;
            return { other, commonCount, pct };
          })
          .sort((a, b) => b.pct - a.pct);

        return `
          <div class="coverage-block">
            <div class="card-header-row">
              <strong style="font-size:0.88rem;"><i class="fa-solid fa-user text-pink"></i> @${esc(me)} 視点</strong>
              <span class="badge">${myTotal} 作基準</span>
            </div>
            ${ranked.map((r, i) => {
              const pctStr = r.pct.toFixed(1);
              return `
                <div class="coverage-row">
                  <div class="coverage-row-head">
                    <span>#${i + 1} <strong>@${esc(r.other)}</strong> ${i === 0 ? '<i class="fa-solid fa-crown text-gold"></i>' : ''}</span>
                    <span><strong>${pctStr}%</strong> <small class="text-muted">(${r.commonCount}/${myTotal})</small></span>
                  </div>
                  <div class="progress-track">
                    <div class="progress-fill" style="width:${pctStr}%;"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;
      };

      if (this.coverageBaseUser === '__all__') {
        contentEl.innerHTML = `<div class="coverage-grid">${users.map(renderBlock).join('')}</div>`;
      } else {
        contentEl.innerHTML = renderBlock(this.coverageBaseUser);
      }
    }
  };

  root.AppViews = root.AppViews || {};
  root.AppViews.similarity = SimilarityView;
}(window));
