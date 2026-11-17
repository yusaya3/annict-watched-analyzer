(function (root) {
  'use strict';

  const AnalyticsView = {
    mounted: false,
    container: null,
    timelineMode: '1year', // '1year' | '5years'

    mount(container) {
      if (this.mounted) return;
      this.container = container;
      this.mounted = true;

      container.innerHTML = `
        <div class="stack-lg">
          <!-- メンバー別サマリープロフィール -->
          <div class="card">
            <div class="card-header">
              <div class="card-header-row">
                <div>
                  <h3 class="card-title"><i class="fa-solid fa-address-card text-blue"></i> メンバー別 視聴プロフィール概要</h3>
                  <p class="card-desc">総視聴時間・黄金期・推しスタジオ・最多ジャンルをひと目で比較します。</p>
                </div>
                <button type="button" class="btn btn-outline btn-sm js-goto-genre">
                  <i class="fa-solid fa-shapes text-purple"></i> 15ジャンル詳細へ
                </button>
              </div>
            </div>
            <div id="analytics-profile-grid" class="analytics-summary-grid"></div>
          </div>

          <!-- ① 総視聴時間 -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title"><i class="fa-solid fa-fire-flame-curved text-gold"></i> 総視聴時間（視聴カロリー）</h3>
              <p class="card-desc">TVシリーズ（1〜2クール）・劇場版・OVA等の構成から総鑑賞時間を推計しています。</p>
            </div>
            <div id="analytics-calorie-grid" class="calorie-grid"></div>
          </div>

          <!-- ② 年代別タイムライン -->
          <div class="card">
            <div class="card-header">
              <div class="card-header-row">
                <div>
                  <h3 class="card-title"><i class="fa-solid fa-timeline text-blue"></i> 年代別タイムライン</h3>
                  <p class="card-desc">各放送年・年代別の視聴作品数分布と「2人の共通黄金期」を表示します。</p>
                </div>
                <div class="subtabs-bar">
                  <button type="button" class="subtab-btn active" data-tl-mode="1year">
                    <i class="fa-solid fa-calendar-days"></i> 1年ごと
                  </button>
                  <button type="button" class="subtab-btn" data-tl-mode="5years">
                    <i class="fa-solid fa-layer-group"></i> 5年ごと
                  </button>
                </div>
              </div>
            </div>
            <div id="analytics-golden-years" class="chips-wrap" style="margin-bottom:0.85rem;"></div>
            <div id="analytics-timeline-list" class="timeline-list"></div>
          </div>

          <!-- ③ 制作スタジオ傾向 -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title"><i class="fa-solid fa-palette text-pink"></i> 制作スタジオ別視聴傾向</h3>
              <p class="card-desc">主要14アニメ制作会社の履修数ランキング。スタジオ名をクリックすると該当作品を確認できます。</p>
            </div>
            <div id="analytics-studio-grid" class="studio-grid"></div>
          </div>
        </div>
      `;

      container.querySelector('.js-goto-genre')?.addEventListener('click', () => {
        root.AppRouter?.navigateTo('genre');
      });

      container.querySelectorAll('[data-tl-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.timelineMode = btn.getAttribute('data-tl-mode');
          container.querySelectorAll('[data-tl-mode]').forEach(b => b.classList.toggle('active', b === btn));
          if (root.AppStore.state.report) {
            this.renderTimeline(root.AppStore.state.report);
          }
        });
      });
    },

    render(storeState) {
      if (!this.mounted || !storeState.report) return;
      const report = storeState.report;
      this.renderProfiles(report);
      this.renderCalories(report);
      this.renderTimeline(report);
      this.renderStudios(report);
    },

    renderProfiles(report) {
      const grid = this.container.querySelector('#analytics-profile-grid');
      if (!grid) return;
      const users = report.users || [];
      const cal = report.labs?.calorieReport || {};
      const tl = report.labs?.timelineReport?.yearsByUser || {};
      const st = report.labs?.studioReport?.studioStatsByUser || {};
      const gn = report.labs?.genreReportScored?.statsByUser || {};
      const esc = root.UIUtils.escapeHtml;
      const colors = root.UIUtils.USER_COLORS;

      grid.innerHTML = users.map((u, idx) => {
        const c = cal[u] || {};
        const t = tl[u] || {};
        const s = st[u] || {};
        const g = gn[u]?.topGenres?.[0];
        const color = colors[idx % colors.length];
        const topStudio = s.rankings?.[0];

        const gDef = g ? (root.GenreEngine?.GENRE_DEF_MAP?.[g.id] || g) : null;

        return `
          <div class="member-profile-card" style="border-top: 3px solid ${color};">
            <div class="card-header-row">
              <strong style="font-size:0.95rem;"><i class="fa-solid fa-user" style="color:${color};"></i> @${esc(u)}</strong>
              <span class="badge">${(c.workCount || 0).toLocaleString()}作</span>
            </div>
            <div class="profile-stat-line">
              <span class="text-muted">総視聴時間</span>
              <strong>${(c.totalHours || 0).toLocaleString()}h</strong>
            </div>
            <div class="profile-stat-line">
              <span class="text-muted">ピーク年</span>
              <strong>${t.peakYear ? `${t.peakYear}年 (${t.maxYearCount}作)` : '-'}</strong>
            </div>
            <div class="profile-stat-line">
              <span class="text-muted">最多スタジオ</span>
              <strong>${topStudio ? `${esc(topStudio.short)} (${topStudio.count})` : '-'}</strong>
            </div>
            <div class="profile-stat-line">
              <span class="text-muted">最多ジャンル</span>
              <strong>${g ? `<span class="themed-genre-text" style="--gc:${g.color};--gcl:${gDef.colorLight || g.color};">${esc(g.label)}</span>` : '-'}</strong>
            </div>
          </div>
        `;
      }).join('');
    },

    renderCalories(report) {
      const grid = this.container.querySelector('#analytics-calorie-grid');
      if (!grid) return;
      const calMap = report.labs?.calorieReport || {};
      const esc = root.UIUtils.escapeHtml;

      grid.innerHTML = Object.values(calMap).map(cal => `
        <div class="calorie-card">
          <div class="card-header-row">
            <strong><i class="fa-solid fa-user"></i> @${esc(cal.username)}</strong>
            <span class="badge badge-gold">${esc(cal.titleLevel)}</span>
          </div>
          <div>
            <span class="calorie-hours">${cal.totalHours.toLocaleString()}</span>
            <span class="small text-muted"> 時間 (${cal.workCount} 作品)</span>
          </div>
          <div class="stack-md" style="gap:0.35rem;background:var(--bg-surface);padding:0.65rem 0.8rem;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);">
            <div class="profile-stat-line">
              <span class="text-muted"><i class="fa-solid fa-clock"></i> 24時間不眠換算</span>
              <strong class="text-pink">約 ${cal.totalDays} 日分</strong>
            </div>
            <div class="profile-stat-line">
              <span class="text-muted"><i class="fa-solid fa-sun"></i> 覚醒時間 (16h/日)</span>
              <strong class="text-pink">約 ${cal.wakingDays} 日分</strong>
            </div>
            <div class="profile-stat-line">
              <span class="text-muted"><i class="fa-solid fa-hourglass-half"></i> 10年間の覚醒割合</span>
              <strong class="text-blue">約 ${cal.lifePercentage ?? 0}%</strong>
            </div>
          </div>
          <div class="profile-stat-line text-muted">
            <span><i class="fa-solid fa-tv"></i> TV: ${cal.breakdown.tvCount}</span>
            <span><i class="fa-solid fa-film"></i> 映画: ${cal.breakdown.movieCount}</span>
            <span><i class="fa-solid fa-compact-disc"></i> OVA等: ${cal.breakdown.ovaCount}</span>
          </div>
        </div>
      `).join('');
    },

    renderTimeline(report) {
      const listEl = this.container.querySelector('#analytics-timeline-list');
      const goldenEl = this.container.querySelector('#analytics-golden-years');
      const tl = report.labs?.timelineReport;
      if (!listEl || !tl) return;

      const users = report.users || [];
      const yearsByUser = tl.yearsByUser || {};
      const colors = root.UIUtils.USER_COLORS;
      const esc = root.UIUtils.escapeHtml;

      if (goldenEl) {
        const golden = (tl.goldenYears || []).slice(0, 6);
        goldenEl.innerHTML = golden.length > 0
          ? `<span class="small text-muted" style="font-weight:700;"><i class="fa-solid fa-star text-gold"></i> 共通黄金期:</span>` +
            golden.map(g => `<span class="badge badge-gold">@${esc(g.pair[0])} × @${esc(g.pair[1])}: ${g.year}年 (${g.commonInYearCount}作)</span>`).join('')
          : '';
      }

      if (this.timelineMode === '5years') {
        const buckets = tl.eraBuckets || [];
        listEl.innerHTML = buckets.map(era => {
          let maxInEra = 1;
          users.forEach(u => {
            const c = yearsByUser[u]?.bucketCounts?.[era.id] || 0;
            if (c > maxInEra) maxInEra = c;
          });
          const barsHtml = users.map((u, idx) => {
            const count = yearsByUser[u]?.bucketCounts?.[era.id] || 0;
            const pct = Math.min(100, (count / maxInEra) * 100);
            return `
              <div class="bar-line">
                <span class="bar-line-label">@${esc(u)}</span>
                <div class="bar-line-track"><div class="bar-line-fill" style="width:${pct}%;background:${colors[idx % colors.length]};"></div></div>
                <span class="bar-line-val">${count}作</span>
              </div>
            `;
          }).join('');
          return `
            <div class="timeline-row">
              <div class="timeline-row-head"><strong><i class="fa-regular fa-calendar-check text-blue"></i> ${esc(era.label)}</strong></div>
              <div class="timeline-bars">${barsHtml}</div>
            </div>
          `;
        }).join('');
        return;
      }

      const allYears = tl.allYears || [];
      if (allYears.length === 0) {
        listEl.innerHTML = '<div class="empty-box"><i class="fa-regular fa-calendar-xmark"></i><p>放送年データがありません</p></div>';
        return;
      }

      let globalMax = 1;
      allYears.forEach(y => {
        users.forEach(u => {
          const c = yearsByUser[u]?.yearCounts?.[y] || 0;
          if (c > globalMax) globalMax = c;
        });
      });

      listEl.innerHTML = '';
      allYears.forEach(year => {
        let total = 0;
        let topUser = null;
        let topCount = 0;
        users.forEach(u => {
          const c = yearsByUser[u]?.yearCounts?.[year] || 0;
          total += c;
          if (c > topCount) { topCount = c; topUser = u; }
        });
        if (total === 0) return;

        const row = document.createElement('div');
        row.className = 'timeline-row';

        const barsHtml = users.map((u, idx) => {
          const c = yearsByUser[u]?.yearCounts?.[year] || 0;
          const pct = Math.min(100, (c / globalMax) * 100);
          return `
            <div class="bar-line">
              <span class="bar-line-label">@${esc(u)}</span>
              <div class="bar-line-track"><div class="bar-line-fill" style="width:${pct}%;background:${colors[idx % colors.length]};"></div></div>
              <span class="bar-line-val">${c}作</span>
            </div>
          `;
        }).join('');

        row.innerHTML = `
          <div class="timeline-row-head">
            <div class="chips-wrap">
              <span class="badge"><i class="fa-regular fa-calendar"></i> ${year}年</span>
              ${topUser ? `<span class="badge badge-blue">最多: @${esc(topUser)} (${topCount}作)</span>` : ''}
              <span class="small text-muted">延べ ${total} 作品</span>
            </div>
            <span class="small text-muted"><span class="js-tl-toggle-txt">作品を見る</span> <i class="fa-solid fa-chevron-down js-tl-chevron"></i></span>
          </div>
          <div class="timeline-bars">${barsHtml}</div>
          <div class="timeline-drawer" style="display:none;"></div>
        `;

        const head = row.querySelector('.timeline-row-head');
        const drawer = row.querySelector('.timeline-drawer');
        const txt = row.querySelector('.js-tl-toggle-txt');
        const icon = row.querySelector('.js-tl-chevron');
        let drawerLoaded = false;

        head.addEventListener('click', () => {
          const isOpen = drawer.style.display !== 'none';
          if (isOpen) {
            drawer.style.display = 'none';
            txt.textContent = '作品を見る';
            icon.style.transform = 'rotate(0deg)';
          } else {
            if (!drawerLoaded) {
              drawerLoaded = true;
              drawer.innerHTML = '';
              users.forEach((u, idx) => {
                const animes = root.AnalyzerEngine.sortAnimes(yearsByUser[u]?.animesByYear?.[year] || [], 'season-desc');
                if (animes.length === 0) return;
                const block = document.createElement('div');
                block.innerHTML = `
                  <div style="font-size:0.82rem;font-weight:700;color:${colors[idx % colors.length]};margin-bottom:0.45rem;">
                    <i class="fa-solid fa-user"></i> @${esc(u)} (${animes.length}作)
                  </div>
                  <div class="anime-cards-grid js-tl-user-grid"></div>
                `;
                drawer.appendChild(block);
                const gridEl = block.querySelector('.js-tl-user-grid');
                if (gridEl) {
                  root.UIUtils.renderLazyGrid(
                    gridEl,
                    animes,
                    (a, idx) => root.UIUtils.createAnimeCardHtml(a, { showGenre: true, eager: idx < 12 }),
                    { batchSize: 48 }
                  );
                }
              });
            }
            drawer.style.display = 'flex';
            txt.textContent = '閉じる';
            icon.style.transform = 'rotate(180deg)';
          }
        });

        listEl.appendChild(row);
      });
    },

    renderStudios(report) {
      const grid = this.container.querySelector('#analytics-studio-grid');
      const stats = report.labs?.studioReport?.studioStatsByUser || {};
      if (!grid) return;
      const esc = root.UIUtils.escapeHtml;

      grid.innerHTML = '';
      Object.values(stats).forEach(uStat => {
        const card = document.createElement('div');
        card.className = 'studio-card';
        const topStudios = (uStat.rankings || []).slice(0, 6);

        const listHtml = topStudios.length === 0
          ? '<p class="small text-muted">該当する主要スタジオ作品がありません</p>'
          : topStudios.map((st, idx) => `
              <div class="studio-item" data-studio-idx="${idx}">
                <div class="studio-item-head">
                  <span style="display:flex;align-items:center;gap:0.45rem;">
                    <span class="text-muted">#${idx + 1}</span>
                    <span style="width:10px;height:10px;border-radius:50%;background:${st.color};display:inline-block;"></span>
                    <span>${esc(st.name)}</span>
                  </span>
                  <span class="small text-muted">${st.count}作 <i class="fa-solid fa-chevron-down"></i></span>
                </div>
                <div class="studio-item-body"></div>
              </div>
            `).join('');

        card.innerHTML = `
          <div class="card-header-row">
            <strong><i class="fa-solid fa-user text-pink"></i> @${esc(uStat.username)}</strong>
            <span class="badge badge-pink">${esc(uStat.studioTitle)}</span>
          </div>
          <div class="stack-md" style="gap:0.45rem;">${listHtml}</div>
        `;

        card.querySelectorAll('.studio-item').forEach(item => {
          const head = item.querySelector('.studio-item-head');
          const body = item.querySelector('.studio-item-body');
          const idx = parseInt(item.getAttribute('data-studio-idx'), 10);
          let loaded = false;

          head.addEventListener('click', () => {
            const willOpen = !item.classList.contains('open');
            item.classList.toggle('open', willOpen);
            if (willOpen && !loaded) {
              loaded = true;
              const animes = topStudios[idx]?.animes || [];
              body.innerHTML = `
                <div class="anime-cards-grid" style="grid-template-columns:repeat(auto-fill,minmax(115px,1fr));gap:0.55rem;">
                  ${animes.map(a => root.UIUtils.createAnimeCardHtml(a, { showGenre: false })).join('')}
                </div>
              `;
              root.UIUtils.bindCardContainerEvents(body);
            }
          });
        });

        grid.appendChild(card);
      });
    }
  };

  root.AppViews = root.AppViews || {};
  root.AppViews.analytics = AnalyticsView;
}(window));
