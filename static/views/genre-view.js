(function (root) {
  'use strict';

  const PRESET_TITLES = [
    'チェンソーマン',
    '葬送のフリーレン',
    '進撃の巨人',
    'その着せ替え人形は恋をする',
    'リコリス・リコイル',
    '薬屋のひとりごと',
    'Dr.STONE'
  ];

  const GenreView = {
    mounted: false,
    container: null,
    subtab: 'distribution', // 'distribution' | 'inspector'
    _inspectSeq: 0,

    mount(container) {
      if (this.mounted) return;
      this.container = container;
      this.mounted = true;

      const presetsHtml = PRESET_TITLES.map(t =>
        `<button type="button" class="chip-btn js-inspector-preset" data-title="${root.UIUtils.escapeHtml(t)}">${root.UIUtils.escapeHtml(t)}</button>`
      ).join('');

      container.innerHTML = `
        <div class="stack-lg">
          <div class="card card-compact">
            <div class="card-header-row">
              <div class="subtabs-bar">
                <button type="button" class="subtab-btn active" data-genre-subtab="distribution">
                  <i class="fa-solid fa-chart-pie text-purple"></i> 15ジャンル視聴傾向
                </button>
                <button type="button" class="subtab-btn" data-genre-subtab="inspector">
                  <i class="fa-solid fa-calculator text-blue"></i> 作品スコア内訳診断
                </button>
              </div>
              <span class="small text-muted"><i class="fa-solid fa-layer-group text-purple"></i> AniList統合スコア分類 (15カテゴリ)</span>
            </div>
          </div>

          <!-- サブタブ1: 15ジャンル視聴傾向 -->
          <div id="genre-pane-distribution" class="stack-lg">
            <div class="card">
              <div class="card-header">
                <h3 class="card-title"><i class="fa-solid fa-crown text-gold"></i> メンバー別 最多ジャンル Top 3</h3>
                <p class="card-desc">AniList公式ジャンル × コミュニティタグRank × 日本語タイトル補正による15カテゴリ重み付け分類の結果です。</p>
              </div>
              <div id="genre-user-summaries" class="genre-summary-grid"></div>
            </div>

            <div class="card">
              <div class="card-header">
                <div class="card-header-row">
                  <div>
                    <h3 class="card-title"><i class="fa-solid fa-shapes text-purple"></i> 15ジャンル別 詳細比較 &amp; 作品一覧</h3>
                    <p class="card-desc">各ジャンルを開くと、「全員ユニーク一覧」および「メンバー個人別」の視聴作品を放送時期新しい順で確認できます。</p>
                  </div>
                  <div class="btn-group">
                    <button type="button" id="btn-genre-expand-all" class="btn btn-outline btn-xs"><i class="fa-solid fa-angles-down"></i> すべて展開</button>
                    <button type="button" id="btn-genre-collapse-all" class="btn btn-outline btn-xs"><i class="fa-solid fa-angles-up"></i> すべて閉じる</button>
                  </div>
                </div>
              </div>
              <div id="genre-accordion-list" class="genre-accordion-list"></div>
            </div>
          </div>

          <!-- サブタブ2: 作品スコア内訳診断 -->
          <div id="genre-pane-inspector" class="stack-lg" style="display:none;">
            <div class="card">
              <div class="card-header">
                <h3 class="card-title"><i class="fa-solid fa-calculator text-blue"></i> 作品ジャンルスコア内訳診断</h3>
                <p class="card-desc">作品名（略称も可）を入力すると、AniListの公式ジャンルとタグスコアから15カテゴリへの配点根拠をリアルタイムに解剖します。</p>
              </div>

              <div class="toolbar-row" style="margin-bottom:0.85rem;">
                <div class="inspector-suggest-box">
                  <div class="search-field">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <input type="text" id="inspector-input" class="input-text" placeholder="作品名を入力（例: フリーレン、着せ恋）" autocomplete="off" />
                    <button type="button" id="inspector-clear" class="input-clear-btn" style="display:none;"><i class="fa-solid fa-xmark"></i></button>
                  </div>
                  <div id="inspector-suggest" class="suggest-dropdown" style="display:none;"></div>
                </div>
                <button type="button" id="btn-inspector-run" class="btn btn-primary">
                  <i class="fa-solid fa-chart-simple"></i> スコア診断
                </button>
              </div>

              <div class="chips-wrap" style="margin-bottom:1rem;">
                <span class="small text-muted"><i class="fa-solid fa-lightbulb text-gold"></i> 診断おすすめ:</span>
                ${presetsHtml}
              </div>

              <div id="inspector-result"></div>
            </div>
          </div>
        </div>
      `;

      container.querySelectorAll('[data-genre-subtab]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.subtab = btn.getAttribute('data-genre-subtab');
          container.querySelectorAll('[data-genre-subtab]').forEach(b => b.classList.toggle('active', b === btn));
          container.querySelector('#genre-pane-distribution').style.display = this.subtab === 'distribution' ? 'flex' : 'none';
          container.querySelector('#genre-pane-inspector').style.display = this.subtab === 'inspector' ? 'flex' : 'none';
        });
      });

      container.querySelector('#btn-genre-expand-all')?.addEventListener('click', () => {
        const listEl = container.querySelector('#genre-accordion-list');
        if (listEl) listEl.dataset.expandingAll = '1';
        try {
          container.querySelectorAll('.genre-accordion-card').forEach(c => {
            if (!c.classList.contains('open')) {
              c.querySelector('.genre-accordion-head')?.click();
            }
          });
        } finally {
          if (listEl) delete listEl.dataset.expandingAll;
        }
      });

      container.querySelector('#btn-genre-collapse-all')?.addEventListener('click', () => {
        container.querySelectorAll('.genre-accordion-card.open').forEach(c => c.classList.remove('open'));
      });

      this.bindInspectorEvents();
    },

    bindInspectorEvents() {
      const input = this.container.querySelector('#inspector-input');
      const clearBtn = this.container.querySelector('#inspector-clear');
      const runBtn = this.container.querySelector('#btn-inspector-run');
      const suggest = this.container.querySelector('#inspector-suggest');
      if (!input || !runBtn || !suggest) return;

      const syncClearBtn = () => {
        if (clearBtn) clearBtn.style.display = input.value.trim() ? 'block' : 'none';
      };

      const updateSuggest = (qRaw) => {
        const q = (qRaw || '').trim().toLowerCase();
        if (!q) { suggest.style.display = 'none'; return; }

        const titles = new Set(Object.keys(root.AppStore.state.genreMap || {}));
        Object.values(root.AppStore.state.userWatchedLists || {}).forEach(list => {
          (list || []).forEach(a => { if (a?.title) titles.add(a.title); });
        });

        const qClean = q.replace(/[\s\-_・:：!！?？]/g, '');
        const hits = [];
        for (const t of titles) {
          const tl = t.toLowerCase();
          const tc = tl.replace(/[\s\-_・:：!！?？]/g, '');
          if (tl.startsWith(q) || tc.startsWith(qClean)) {
            hits.push({ title: t, score: 100 - Math.min(40, t.length) });
          } else if (tl.includes(q) || tc.includes(qClean)) {
            hits.push({ title: t, score: 50 - Math.min(40, t.length) });
          }
        }
        hits.sort((a, b) => b.score - a.score);
        const top = hits.slice(0, 8);
        if (top.length === 0) { suggest.style.display = 'none'; return; }

        suggest.innerHTML = top.map(h => `
          <div class="suggest-item" data-title="${root.UIUtils.escapeHtml(h.title)}">
            <i class="fa-solid fa-film text-muted"></i>
            <span>${root.UIUtils.escapeHtml(h.title)}</span>
          </div>
        `).join('');
        suggest.style.display = 'block';

        suggest.querySelectorAll('.suggest-item').forEach(item => {
          item.addEventListener('click', () => {
            const title = item.getAttribute('data-title');
            input.value = title;
            suggest.style.display = 'none';
            this.runInspection(title);
          });
        });
      };

      input.addEventListener('input', (e) => {
        syncClearBtn();
        updateSuggest(e.target.value);
      });
      clearBtn?.addEventListener('click', () => {
        input.value = '';
        syncClearBtn();
        suggest.style.display = 'none';
        input.focus();
      });
      input.addEventListener('focus', (e) => { if (e.target.value.trim()) updateSuggest(e.target.value); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          suggest.style.display = 'none';
          const val = input.value.trim();
          if (val) this.runInspection(val);
        } else if (e.key === 'Escape') {
          suggest.style.display = 'none';
        }
      });

      document.addEventListener('click', (e) => {
        if (!suggest.contains(e.target) && e.target !== input) {
          suggest.style.display = 'none';
        }
      });

      runBtn.addEventListener('click', () => {
        suggest.style.display = 'none';
        const val = input.value.trim();
        if (val) this.runInspection(val);
      });

      this.container.querySelectorAll('.js-inspector-preset').forEach(btn => {
        btn.addEventListener('click', () => {
          const t = btn.getAttribute('data-title');
          input.value = t;
          syncClearBtn();
          suggest.style.display = 'none';
          this.runInspection(t);
        });
      });
    },

    render(storeState) {
      if (!this.mounted || !storeState.report) return;
      const genreReport = storeState.report.labs?.genreReportScored;
      if (!genreReport) return;
      this.renderDistribution(genreReport);
    },

    renderDistribution(genreReport) {
      const summariesEl = this.container.querySelector('#genre-user-summaries');
      const listEl = this.container.querySelector('#genre-accordion-list');
      if (!summariesEl || !listEl) return;

      const statsByUser = genreReport.statsByUser || {};
      const genres = genreReport.genres || [];
      const users = Object.keys(statsByUser);
      const colors = root.UIUtils.USER_COLORS;
      const esc = root.UIUtils.escapeHtml;
      const parseW = root.AnalyzerEngine.parseSeasonWeight;

      const defMap = root.GenreEngine.GENRE_DEF_MAP;
      summariesEl.innerHTML = Object.values(statsByUser).map((uStat, idx) => {
        const uColor = colors[idx % colors.length];
        const tops = (uStat.topGenres || []).map((g, gIdx) => {
          const def = defMap[g.id] || g;
          const gcl = def.colorLight || g.color;
          return `
          <div class="genre-top-row">
            <span class="genre-pill js-jump-genre" data-themed="1" data-genre-id="${esc(g.id)}" style="--gc:${g.color};--gcl:${gcl};background:${g.color}1e;border-color:${g.color}44;cursor:pointer;">
              #${gIdx + 1} <i class="${g.icon}"></i> ${esc(g.label)}
            </span>
            <span class="small"><strong>${g.count}</strong>作 <span class="text-muted">(${g.percentage}%)</span></span>
          </div>
        `;
        }).join('');

        return `
          <div class="genre-user-card" style="border-top:3px solid ${uColor};">
            <div class="card-header-row">
              <strong><i class="fa-solid fa-user" style="color:${uColor};"></i> @${esc(uStat.username)}</strong>
              <span class="small text-muted">計${uStat.totalWatched}作</span>
            </div>
            <div class="stack-md" style="gap:0.45rem;">${tops || '<span class="small text-muted">データなし</span>'}</div>
          </div>
        `;
      }).join('');

      summariesEl.querySelectorAll('.js-jump-genre').forEach(pill => {
        pill.addEventListener('click', () => {
          const gid = pill.getAttribute('data-genre-id');
          const target = Array.from(listEl.querySelectorAll('.genre-accordion-card'))
            .find(el => el.getAttribute('data-genre-id') === gid);
          if (target) {
            if (!target.classList.contains('open')) target.querySelector('.genre-accordion-head')?.click();
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
      });

      listEl.innerHTML = '';
      genres.forEach(g => {
        const card = document.createElement('div');
        card.className = 'genre-accordion-card';
        card.setAttribute('data-genre-id', g.id);

        let maxCount = 1;
        users.forEach(u => {
          const c = g.userCounts?.[u] || 0;
          if (c > maxCount) maxCount = c;
        });

        const barsHtml = users.map((u, idx) => {
          const c = g.userCounts?.[u] || 0;
          const pct = g.userPercentages?.[u] || 0;
          const w = Math.min(100, (c / maxCount) * 100);
          return `
            <div class="bar-line bar-line-wide">
              <span class="bar-line-label">@${esc(u)}</span>
              <div class="bar-line-track"><div class="bar-line-fill" style="width:${w}%;background:${colors[idx % colors.length]};"></div></div>
              <span class="bar-line-val">${c}作 (${pct}%)</span>
            </div>
          `;
        }).join('');

        const defG = defMap[g.id] || g;
        const gclTop = defG.colorLight || g.color;
        const topBadge = g.topUser
          ? `<span class="badge" style="--gc:${g.color};--gcl:${gclTop};background:${g.color}22;border-color:${g.color}44;color:var(--text-main);">最多: @${esc(g.topUser.username)} (${g.topUser.count}作)</span>`
          : '';

        const badgeBg = defG.colorLight || g.color;

        card.innerHTML = `
          <div class="genre-accordion-head">
            <div class="genre-head-top">
              <div class="chips-wrap">
                <div class="genre-icon-badge" style="background:${badgeBg};"><i class="${g.icon}"></i></div>
                <div>
                  <strong style="font-size:0.95rem;">${esc(g.label)}</strong>
                  <span class="small text-muted" style="margin-left:0.35rem;">${esc(g.labelEn || g.id)}</span>
                </div>
              </div>
              <div class="chips-wrap">
                ${topBadge}
                <span class="badge">${g.uniqueWorksCount} 作品 (延べ ${g.totalWorksAcrossUsers})</span>
                <i class="fa-solid fa-chevron-down text-muted genre-chevron" style="transition:transform 0.2s;"></i>
              </div>
            </div>
            <div class="timeline-bars" style="margin-top:0;">${barsHtml}</div>
          </div>
          <div class="genre-accordion-body"></div>
        `;

        const head = card.querySelector('.genre-accordion-head');
        const body = card.querySelector('.genre-accordion-body');
        let bodyBuilt = false;
        let currentTab = '__all__';

        const renderBodyTab = (batchOverride) => {
          const grid = body.querySelector('.js-genre-cards-grid');
          if (!grid) return;
          const batchSize = batchOverride || 72;
          if (currentTab === '__all__') {
            const uniqueMap = new Map();
            users.forEach(u => {
              (g.animesByUser?.[u] || []).forEach(a => {
                const k = String(a.id || a.title);
                if (!uniqueMap.has(k)) {
                  uniqueMap.set(k, { anime: a, watchers: [u] });
                } else {
                  const entry = uniqueMap.get(k);
                  if (!entry.watchers.includes(u)) entry.watchers.push(u);
                }
              });
            });
            const sorted = Array.from(uniqueMap.values()).sort((a, b) => {
              const d = parseW(b.anime.season) - parseW(a.anime.season);
              if (d !== 0) return d;
              return b.watchers.length - a.watchers.length || root.AnalyzerEngine.compareTitlesJa(a.anime.title, b.anime.title);
            });
            root.UIUtils.renderLazyGrid(grid, sorted, (item, idx) =>
              root.UIUtils.createAnimeCardHtml(item.anime, {
                showGenre: false,
                watchers: item.watchers,
                showStoryBtn: true,
                eager: idx < 12
              }),
              { batchSize }
            );
          } else {
            const sorted = root.AnalyzerEngine.sortAnimes(g.animesByUser?.[currentTab] || [], 'season-desc');
            root.UIUtils.renderLazyGrid(grid, sorted, (anime, idx) =>
              root.UIUtils.createAnimeCardHtml(anime, { showGenre: false, showStoryBtn: true, eager: idx < 12 }),
              { batchSize }
            );
          }
        };

        head.addEventListener('click', () => {
          const willOpen = !card.classList.contains('open');
          card.classList.toggle('open', willOpen);
          if (willOpen && !bodyBuilt) {
            bodyBuilt = true;
            const userBtns = users.map(u => `
              <button type="button" class="chip-btn" data-guser="${esc(u)}">@${esc(u)} (${(g.animesByUser?.[u] || []).length})</button>
            `).join('');

            body.innerHTML = `
              <div class="chips-wrap" style="margin-bottom:0.85rem;">
                <button type="button" class="chip-btn active" data-guser="__all__">全員 (${g.uniqueWorksCount}作)</button>
                ${userBtns}
              </div>
              <div class="anime-cards-grid js-genre-cards-grid"></div>
            `;

            body.querySelectorAll('[data-guser]').forEach(btn => {
              btn.addEventListener('click', (e) => {
                e.stopPropagation();
                currentTab = btn.getAttribute('data-guser');
                body.querySelectorAll('[data-guser]').forEach(b => b.classList.toggle('active', b === btn));
                renderBodyTab();
              });
            });
            const initialBatch = listEl.dataset.expandingAll === '1' ? 24 : 72;
            renderBodyTab(initialBatch);
          }
        });

        listEl.appendChild(card);
      });
    },

    async runInspection(title) {
      const resultEl = this.container.querySelector('#inspector-result');
      if (!resultEl) return;
      const clearBtn = this.container.querySelector('#inspector-clear');
      if (clearBtn) clearBtn.style.display = title ? 'block' : 'none';
      const reqSeq = ++this._inspectSeq;

      resultEl.innerHTML = `
        <div class="empty-box" style="padding:1.5rem;">
          <div class="spinner-sm"></div>
          <p>「${root.UIUtils.escapeHtml(title)}」のジャンルスコア内訳を診断中...</p>
        </div>
      `;

      try {
        const res = await fetch(`/api/genre-score?title=${encodeURIComponent(title)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (reqSeq !== this._inspectSeq) return;
        this.renderInspectionResult(data);
      } catch (err) {
        if (reqSeq !== this._inspectSeq) return;
        resultEl.innerHTML = `<div class="empty-box text-red"><i class="fa-solid fa-triangle-exclamation"></i><p>診断取得エラー: ${root.UIUtils.escapeHtml(err.message)}</p></div>`;
      }
    },

    renderInspectionResult(data) {
      const resultEl = this.container.querySelector('#inspector-result');
      if (!resultEl) return;
      const esc = root.UIUtils.escapeHtml;
      const defMap = root.GenreEngine.GENRE_DEF_MAP;
      const scoredCat = data.scored?.category || 'other';
      const scoredDef = defMap[scoredCat] || { label: scoredCat, color: '#a855f7', icon: 'fa-solid fa-shapes' };

      const rows = Object.entries(data.scored?.scores || {})
        .filter(([id]) => id !== 'other')
        .map(([id, score]) => ({
          id,
          score: Math.round(score),
          def: defMap[id] || { label: id, color: '#64748b', icon: 'fa-solid fa-tag' },
          reasons: data.scored?.reasons?.[id] || []
        }))
        .sort((a, b) => b.score - a.score);

      const maxScore = Math.max(1, rows[0]?.score || 1);

      const matchesHtml = data.matches?.length > 0
        ? `<div class="chips-wrap" style="margin-top:0.65rem;">
             <span class="small text-muted">関連候補:</span>
             ${data.matches.map(m => `<button type="button" class="chip-btn js-inspect-cand" data-title="${esc(m.title)}">${esc(m.title)}</button>`).join('')}
           </div>`
        : '';

      resultEl.innerHTML = `
        <div class="stack-md" style="border-top:1px solid var(--border-color);padding-top:1rem;">
          <div class="card-header-row">
            <div>
              <h4 style="font-size:1.1rem;font-weight:800;">${esc(data.title)}</h4>
              ${!data.isExactMatch ? `<span class="small text-blue">「${esc(data.query)}」の検索候補として表示中</span>` : ''}
            </div>
            <span class="genre-pill" data-themed="1" style="--gc:${scoredDef.color};--gcl:${scoredDef.colorLight || scoredDef.color};background:${scoredDef.color}22;border-color:${scoredDef.color};font-size:0.86rem;padding:0.35rem 0.85rem;">
              <i class="${scoredDef.icon}"></i> 判定: ${esc(scoredDef.label)} (${data.scored?.score || 0} pt)
            </span>
          </div>

          ${matchesHtml}

          <div class="stack-md" style="gap:0.4rem;">
            <div class="chips-wrap">
              <span class="small text-muted">公式ジャンル:</span>
              ${(data.genres || []).length > 0 ? data.genres.map(g => `<span class="badge badge-blue">${esc(g)}</span>`).join('') : '<span class="small text-muted">なし</span>'}
            </div>
            <div class="chips-wrap">
              <span class="small text-muted">タグ (${(data.tags || []).length}件):</span>
              ${(data.tags || []).slice(0, 18).map(t => `<span class="badge">${esc(t.name)} (${t.rank})</span>`).join('') || '<span class="small text-muted">なし</span>'}
              ${(data.tags || []).length > 18 ? `<span class="badge text-muted">+他${data.tags.length - 18}件</span>` : ''}
            </div>
          </div>

          <div class="inspector-scores-list">
            ${rows.map(r => {
              const isWin = r.id === scoredCat;
              const pct = Math.min(100, (r.score / maxScore) * 100);
              return `
                <div class="inspector-score-row ${isWin ? 'winner' : ''}">
                  <div class="card-header-row">
                    <span class="genre-pill" data-themed="1" style="--gc:${r.def.color};--gcl:${r.def.colorLight || r.def.color};background:${r.def.color}20;">
                      <i class="${r.def.icon}"></i> ${esc(r.def.label)} ${isWin ? '<i class="fa-solid fa-crown text-gold"></i>' : ''}
                    </span>
                    <strong>${r.score} pt</strong>
                  </div>
                  <div class="progress-track">
                    <div class="progress-fill" style="width:${pct}%;background:${isWin ? r.def.color : 'var(--text-muted)'};"></div>
                  </div>
                  ${r.reasons.length > 0 ? `<div class="inspector-reasons">${r.reasons.map(x => `<span class="inspector-reason-chip">${esc(x)}</span>`).join('')}</div>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;

      resultEl.querySelectorAll('.js-inspect-cand').forEach(btn => {
        btn.addEventListener('click', () => {
          const t = btn.getAttribute('data-title');
          const input = this.container.querySelector('#inspector-input');
          if (input) input.value = t;
          this.runInspection(t);
        });
      });
    }
  };

  root.AppViews = root.AppViews || {};
  root.AppViews.genre = GenreView;
}(window));
