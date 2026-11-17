(function (root) {
  'use strict';

  const BUCKET_COUNT = 128;

  function clamp01(val) {
    const n = Number(val);
    if (Number.isNaN(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

  function normalizeTitleKey(s) {
    return String(s || '')
      .normalize('NFKC')
      .replace(/[【\[][^】\]]*[】\]]/g, '')
      .replace(/[(（]\s*(?:配信限定|テレビ放送版|TV版|web版|OVA|劇場版|総集編)[^)）]*[)）]/gi, '')
      .toLowerCase()
      .replace(/[\s　・:：!！?？「」『』()（）\-~〜,.、。]/g, '');
  }

  function getBucketIndex(wid) {
    const num = parseInt(wid, 10);
    if (!Number.isNaN(num)) return Math.abs(num) % BUCKET_COUNT;
    let hash = 0;
    const str = String(wid);
    for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    return Math.abs(hash) % BUCKET_COUNT;
  }

  const StoryView = {
    mounted: false,
    container: null,
    indexData: null,
    indexError: null,
    _indexPromise: null,
    _selectSeq: 0,
    _sliderRaf: null,
    worksMeta: null,   // { [wid]: { id, t, y, g, genreTokens, img, aid } }
    bucketCache: new Map(), // bucketIdx -> raw bucket json
    bucketPromises: new Map(), // bucketIdx -> Promise
    detailsCache: new Map(), // wid -> { s, sum, url, c }
    currentWorkId: null,
    history: [],
    plotWeight: 0.5,
    filterEra: 'ALL',
    filterGenre: 'ALL',
    onlyUnwatchedByGroup: false,
    synopsisTab: 'summary',
    pendingJumpTitle: null,
    imgResolveQueue: [],
    imgResolveListeners: new Map(),
    activeImgResolves: 0,

    mount(container) {
      if (this.mounted) return;
      this.container = container;
      this.mounted = true;

      container.innerHTML = `
        <div class="stack-lg">
          <div class="sim-hero-banner">
            <div style="flex:1;min-width:240px;">
              <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;margin-bottom:0.35rem;">
                <h2 style="font-size:1.15rem;font-weight:800;display:flex;align-items:center;gap:0.5rem;">
                  <i class="fa-solid fa-brain text-purple"></i> ストーリー構造類似検索（デュアルAIベクトル）
                </h2>
                <span id="story-total-label" class="badge badge-purple">読込待機</span>
              </div>
              <p class="small text-muted" style="line-height:1.5;">
                LLMによる【起承転結プロット要約】と【世界観・全体あらすじ】をハイブリッド比較。下のスライダーで重視バランスを0msで調整できます。
              </p>
            </div>
            <button type="button" id="story-btn-random" class="btn btn-primary btn-sm">
              <i class="fa-solid fa-dice"></i> ランダム作品
            </button>
          </div>

          <div class="card stack-md">
            <div class="inspector-suggest-box">
              <div class="search-field">
                <i class="fa-solid fa-magnifying-glass"></i>
                <input type="text" id="story-search-input" class="input-text" placeholder="作品名を入力（例: フリーレン）" autocomplete="off" />
                <button type="button" id="story-search-clear" class="input-clear-btn" style="display:none;"><i class="fa-solid fa-xmark"></i></button>
              </div>
              <div id="story-dropdown" class="suggest-dropdown" style="display:none;"></div>
            </div>

            <div class="small text-muted" style="font-weight:600;margin-bottom:-0.45rem;">
              <i class="fa-solid fa-filter text-purple"></i> 類似候補リスト (Top 30) の絞り込み
            </div>
            <div class="toolbar-row">
              <select id="story-filter-era" class="select-control" aria-label="年代絞り込み">
                <option value="ALL">年代: すべて (1990〜2026)</option>
                <option value="2020s">2020年代 (2020〜2026)</option>
                <option value="2010s">2010年代 (2010〜2019)</option>
                <option value="2000s">2000年代 (2000〜2009)</option>
                <option value="1990s">1990年代 (1990〜1999)</option>
              </select>
              <select id="story-filter-genre" class="select-control" aria-label="ジャンル絞り込み">
                <option value="ALL">ジャンル: すべて</option>
              </select>
              <label class="chip-btn" style="cursor:pointer;">
                <input type="checkbox" id="story-filter-unwatched" style="accent-color:var(--accent-pink);" />
                <span><i class="fa-solid fa-eye-slash"></i> メンバー未視聴のみ表示</span>
              </label>
            </div>

            <div id="story-featured-chips" class="chips-wrap chips-scroll-mobile"></div>

            <div id="story-history-bar" class="sim-history-bar" style="display:none;">
              <span class="small text-muted" style="flex-shrink:0;"><i class="fa-solid fa-route"></i> 探索ルート:</span>
              <div id="story-history-crumbs" class="chips-wrap" style="flex-wrap:nowrap;"></div>
            </div>
          </div>

          <div class="card">
            <div class="card-header-row" style="margin-bottom:0.65rem;">
              <span class="small" style="font-weight:700;"><i class="fa-solid fa-sliders text-purple"></i> 類似度バランス: <span id="story-weight-label" class="badge badge-purple">世界観 50% / プロット 50%</span></span>
              <div class="btn-group">
                <button type="button" class="chip-btn js-story-preset" data-w="0.2">世界観重視 (80:20)</button>
                <button type="button" class="chip-btn active js-story-preset" data-w="0.5">バランス (50:50)</button>
                <button type="button" class="chip-btn js-story-preset" data-w="0.8">展開重視 (20:80)</button>
              </div>
            </div>
            <input type="range" id="story-weight-slider" class="sim-weight-slider" min="0" max="100" value="50" step="1" />
            <div class="sim-slider-labels">
              <span><i class="fa-solid fa-earth-americas"></i> 世界観・設定重視</span>
              <span id="story-weight-ratio-center"><i class="fa-solid fa-scale-balanced text-purple"></i> 50 : 50</span>
              <span><i class="fa-solid fa-book-open"></i> 起承転結プロット重視</span>
            </div>
          </div>

          <div id="story-current-section"></div>
          <div id="story-top30-section"></div>
        </div>
      `;

      this.bindEvents();
    },

    bindEvents() {
      const input = this.container.querySelector('#story-search-input');
      const clearBtn = this.container.querySelector('#story-search-clear');
      const dropdown = this.container.querySelector('#story-dropdown');
      const slider = this.container.querySelector('#story-weight-slider');

      let debounce;
      input?.addEventListener('input', (e) => {
        const q = e.target.value.trim();
        if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';
        clearTimeout(debounce);
        debounce = setTimeout(() => this.handleSearch(q), 110);
      });
      input?.addEventListener('focus', () => {
        if (input.value.trim()) this.handleSearch(input.value.trim());
      });
      clearBtn?.addEventListener('click', () => {
        input.value = '';
        clearBtn.style.display = 'none';
        dropdown.style.display = 'none';
      });
      document.addEventListener('click', (e) => {
        if (dropdown && !dropdown.contains(e.target) && e.target !== input) {
          dropdown.style.display = 'none';
        }
      });

      this.container.querySelector('#story-btn-random')?.addEventListener('click', () => {
        if (!this.worksMeta) return;
        const ids = Object.keys(this.worksMeta);
        if (ids.length > 0) {
          const randId = ids[Math.floor(Math.random() * ids.length)];
          this.selectWork(randId, true);
        }
      });

      this.container.querySelector('#story-filter-era')?.addEventListener('change', (e) => {
        this.filterEra = e.target.value;
        this.renderTop30();
      });
      this.container.querySelector('#story-filter-genre')?.addEventListener('change', (e) => {
        this.filterGenre = e.target.value;
        this.renderTop30();
      });
      this.container.querySelector('#story-filter-unwatched')?.addEventListener('change', (e) => {
        this.onlyUnwatchedByGroup = e.target.checked;
        this.renderTop30();
      });

      slider?.addEventListener('input', (e) => {
        const pct = parseInt(e.target.value, 10);
        this.plotWeight = pct / 100;
        this.updateWeightLabel(pct);
        if (!this._sliderRaf) {
          this._sliderRaf = requestAnimationFrame(() => {
            this._sliderRaf = null;
            this.renderTop30();
          });
        }
      });

      this.container.querySelectorAll('.js-story-preset').forEach(btn => {
        btn.addEventListener('click', () => {
          const w = parseFloat(btn.getAttribute('data-w'));
          this.plotWeight = w;
          const pct = Math.round(w * 100);
          if (slider) slider.value = pct;
          this.updateWeightLabel(pct);
          this.renderTop30();
        });
      });

      // Delegated image fallback (loop-safe, avoids duplicate capture with syncThumbStates)
      this.container.addEventListener('error', (e) => {
        const img = e.target;
        if (!img || img.tagName !== 'IMG') return;
        if (img.classList.contains('sim-poster-img')) {
          root.UIUtils.replaceThumbWithNoImage(img);
        } else if (img.closest('#story-dropdown')) {
          const ph = document.createElement('div');
          ph.style.cssText = 'width:30px;height:40px;border-radius:4px;background:var(--bg-muted);display:flex;align-items:center;justify-content:center;color:var(--text-muted);flex-shrink:0;';
          ph.innerHTML = '<i class="fa-solid fa-film"></i>';
          img.replaceWith(ph);
        }
      }, true);

      // Delegated click handler on current work poster
      this.container.querySelector('#story-current-section')?.addEventListener('click', (e) => {
        if (e.target.closest('.sim-poster-img')) {
          const m = this.worksMeta?.[this.currentWorkId];
          if (m && m.img) root.UIUtils.openImageModal(m.t, m.img, m.aid || null);
        }
      });

      // Delegated click handler on Top 30 section (avoids re-binding on every slider frame)
      this.container.querySelector('#story-top30-section')?.addEventListener('click', (e) => {
        const card = e.target.closest('.js-sim-card');
        if (!card) return;
        const wid = card.getAttribute('data-wid');
        if (e.target.closest('.anime-card-thumb')) {
          e.stopPropagation();
          const m = this.worksMeta?.[wid];
          if (m && m.img) root.UIUtils.openImageModal(m.t, m.img, m.aid || null);
          return;
        }
        if (wid) this.selectWork(wid, true);
      });
    },

    updateWeightLabel(pct) {
      const label = this.container.querySelector('#story-weight-label');
      if (label) label.textContent = `世界観 ${100 - pct}% / プロット ${pct}%`;
      const centerEl = this.container.querySelector('#story-weight-ratio-center');
      if (centerEl) centerEl.innerHTML = `<i class="fa-solid fa-scale-balanced text-purple"></i> ${100 - pct} : ${pct}`;
      this.container.querySelectorAll('.js-story-preset').forEach(btn => {
        btn.classList.toggle('active', Math.round(parseFloat(btn.getAttribute('data-w')) * 100) === pct);
      });
    },

    async render(storeState) {
      if (!this.mounted) return;
      this.rebuildMemberWatchIndex(storeState.report);

      if (!this.indexData) {
        await this.loadIndex();
      }

      if (this.pendingJumpTitle && this.worksMeta) {
        const q = this.pendingJumpTitle;
        this.pendingJumpTitle = null;
        const found = this.findBestWorkIdByTitle(q);
        if (found) {
          await this.selectWork(found, true);
          return;
        }
        root.UIUtils.showToast(`「${q}」はストーリー類似検索の対象リストに含まれていません`, 'info');
      }

      if (!this.currentWorkId && this.indexData) {
        const firstId = this.indexData.featured?.[0] || Object.keys(this.worksMeta || {})[0];
        if (firstId) await this.selectWork(firstId, false);
      } else if (this.currentWorkId) {
        this.renderCurrentWork();
        this.renderTop30();
      }
    },

    rebuildMemberWatchIndex(report) {
      this.watchersByTitleNorm = new Map();
      this.watchersByAid = new Map();
      if (!report) return;

      for (const u of (report.users || [])) {
        for (const a of (report.userWatchedLists?.[u] || [])) {
          if (a.id) {
            const aid = String(a.id);
            if (!this.watchersByAid.has(aid)) this.watchersByAid.set(aid, []);
            if (!this.watchersByAid.get(aid).includes(u)) this.watchersByAid.get(aid).push(u);
          }
          if (a.title) {
            const nt = normalizeTitleKey(a.title);
            if (nt) {
              if (!this.watchersByTitleNorm.has(nt)) this.watchersByTitleNorm.set(nt, []);
              if (!this.watchersByTitleNorm.get(nt).includes(u)) this.watchersByTitleNorm.get(nt).push(u);
            }
          }
        }
      }
    },

    getWorkWatchers(meta) {
      if (!meta) return [];
      if (meta.aid && this.watchersByAid?.has(String(meta.aid))) {
        return this.watchersByAid.get(String(meta.aid));
      }
      const nt = normalizeTitleKey(meta.t);
      return (nt && this.watchersByTitleNorm?.get(nt)) || [];
    },

    findBestWorkIdByTitle(title) {
      if (!this.worksMeta || !title) return null;
      const target = normalizeTitleKey(title);
      if (!target) return null;
      let partialHit = null;
      for (const [wid, m] of Object.entries(this.worksMeta)) {
        const mt = normalizeTitleKey(m.t);
        if (!mt) continue;
        if (mt === target) return wid;
        if (!partialHit && (mt.includes(target) || target.includes(mt))) {
          partialHit = wid;
        }
      }
      return partialHit;
    },

    async loadIndex() {
      if (this.indexData) return this.indexData;
      if (this._indexPromise) return this._indexPromise;
      this.indexError = null;

      const topSection = this.container.querySelector('#story-top30-section');
      if (topSection) {
        topSection.innerHTML = '<div class="empty-box"><div class="spinner-sm"></div><p>ストーリー検索インデックス (1MB) を読み込み中...</p></div>';
      }

      this._indexPromise = (async () => {
        try {
          const res = await fetch('./res/story/index.json');
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          this.indexData = data;
          this.worksMeta = {};
          const genreFreq = new Map();

          for (const [wid, tuple] of Object.entries(data.works || {})) {
            const rawG = tuple[2] || '';
            const tokens = rawG.split(/[,、]/).map(s => s.trim()).filter(s => s && s !== 'その他');
            tokens.forEach(t => genreFreq.set(t, (genreFreq.get(t) || 0) + 1));
            this.worksMeta[wid] = {
              id: wid,
              t: tuple[0] || '',
              y: tuple[1] || null,
              g: rawG,
              genreTokens: tokens,
              img: root.AnalyzerEngine.expandAnnictImg(tuple[3] || ''),
              aid: tuple[4] || ''
            };
          }

          const totalBadge = this.container.querySelector('#story-total-label');
          if (totalBadge) totalBadge.textContent = `${(data.total || 0).toLocaleString()} 作品収録`;

          const genreSel = this.container.querySelector('#story-filter-genre');
          if (genreSel) {
            const baseGenres = Array.from(genreFreq.entries())
              .sort((a, b) => b[1] - a[1] || root.AnalyzerEngine.compareTitlesJa(a[0], b[0]))
              .map(([name]) => name);
            genreSel.innerHTML = '<option value="ALL">ジャンル: すべて</option>' +
              baseGenres.map(g => `<option value="${root.UIUtils.escapeHtml(g)}">${root.UIUtils.escapeHtml(g)}</option>`).join('');
          }

          const chipsEl = this.container.querySelector('#story-featured-chips');
          if (chipsEl && data.featured) {
            chipsEl.innerHTML = `<span class="small text-muted" style="flex-shrink:0;"><i class="fa-solid fa-fire text-gold"></i> 注目作:</span>` +
              data.featured.map(wid => {
                const m = this.worksMeta[wid];
                if (!m) return '';
                return `<button type="button" class="chip-btn js-story-featured" data-wid="${root.UIUtils.escapeHtml(wid)}">${root.UIUtils.escapeHtml(m.t)}</button>`;
              }).join('');

            chipsEl.querySelectorAll('.js-story-featured').forEach(btn => {
              btn.addEventListener('click', () => this.selectWork(btn.getAttribute('data-wid'), true));
            });
          }
          return this.indexData;
        } catch (err) {
          this.indexError = err.message || '読込エラー';
          if (topSection) {
            topSection.innerHTML = `
              <div class="empty-box text-red">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <p>データ読込エラー: ${root.UIUtils.escapeHtml(this.indexError)}</p>
                <button type="button" id="btn-story-retry-index" class="btn btn-primary btn-sm"><i class="fa-solid fa-rotate-right"></i> 再試行</button>
              </div>
            `;
            topSection.querySelector('#btn-story-retry-index')?.addEventListener('click', () => this.render(root.AppStore.state));
          }
          return null;
        } finally {
          this._indexPromise = null;
        }
      })();
      return this._indexPromise;
    },

    async loadWorkDetail(wid) {
      if (this.detailsCache.has(wid)) return this.detailsCache.get(wid);
      const bIdx = getBucketIndex(wid);
      if (!this.bucketCache.has(bIdx)) {
        let p = this.bucketPromises.get(bIdx);
        if (!p) {
          const bName = `${String(bIdx).padStart(3, '0')}.json`;
          p = fetch(`./res/story/buckets/${bName}`)
            .then(res => {
              if (!res.ok) throw new Error(`Bucket ${bName} HTTP ${res.status}`);
              return res.json();
            })
            .then(bucket => {
              this.bucketCache.set(bIdx, bucket);
              for (const [id, detail] of Object.entries(bucket)) {
                this.detailsCache.set(id, detail);
              }
              return bucket;
            })
            .finally(() => {
              this.bucketPromises.delete(bIdx);
            });
          this.bucketPromises.set(bIdx, p);
        }
        await p;
      }
      return this.detailsCache.get(wid) || null;
    },

    prefetchTopBuckets(candidates) {
      const prefetchFn = () => {
        const seenBuckets = new Set();
        for (const cand of candidates.slice(0, 6)) {
          const bIdx = getBucketIndex(cand[0]);
          if (!this.bucketCache.has(bIdx) && !seenBuckets.has(bIdx)) {
            seenBuckets.add(bIdx);
            this.loadWorkDetail(cand[0]).catch(() => {});
            if (seenBuckets.size >= 3) break;
          }
        }
      };
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(prefetchFn, { timeout: 1200 });
      } else {
        setTimeout(prefetchFn, 200);
      }
    },

    async selectWork(wid, recordHistory = true) {
      if (!this.worksMeta || !this.worksMeta[wid]) return;
      const reqSeq = ++this._selectSeq;
      this.imgResolveQueue = [];
      for (const k of this.imgResolveListeners.keys()) {
        if (!this.worksMeta?.[k]?._imgInFlight) this.imgResolveListeners.delete(k);
      }

      if (recordHistory && this.currentWorkId && this.currentWorkId !== wid) {
        this.history.push(this.currentWorkId);
        if (this.history.length > 10) this.history.shift();
      }

      this.currentWorkId = wid;
      this.container.querySelectorAll('.js-story-featured').forEach(c => {
        c.classList.toggle('active', c.getAttribute('data-wid') === wid);
      });

      const dropdown = this.container.querySelector('#story-dropdown');
      if (dropdown) dropdown.style.display = 'none';

      this.renderHistory();

      // バケット取得（~250KB）
      const topSection = this.container.querySelector('#story-top30-section');
      if (!this.detailsCache.has(wid) && topSection) {
        topSection.innerHTML = '<div class="empty-box"><div class="spinner-sm"></div><p>類似候補データを読み込み中...</p></div>';
      }

      try {
        await this.loadWorkDetail(wid);
      } catch (e) {
        if (reqSeq !== this._selectSeq) return;
        if (topSection) {
          topSection.innerHTML = `<div class="empty-box text-red"><i class="fa-solid fa-triangle-exclamation"></i><p>詳細データの取得に失敗しました</p></div>`;
        }
        return;
      }

      if (reqSeq !== this._selectSeq) return;
      this.renderCurrentWork();
      this.renderTop30();

      const detail = this.detailsCache.get(wid);
      if (detail?.c) {
        this.prefetchTopBuckets(detail.c);
      }
    },

    renderHistory() {
      const bar = this.container.querySelector('#story-history-bar');
      const crumbs = this.container.querySelector('#story-history-crumbs');
      if (!bar || !crumbs) return;

      if (this.history.length === 0) {
        bar.style.display = 'none';
        return;
      }

      bar.style.display = 'flex';
      const esc = root.UIUtils.escapeHtml;
      const itemsHtml = this.history.map((hid, idx) => {
        const m = this.worksMeta[hid];
        if (!m) return '';
        const label = m.t.length > 12 ? m.t.slice(0, 12) + '…' : m.t;
        return `<button type="button" class="chip-btn js-hist-crumb" data-idx="${idx}" data-wid="${esc(hid)}" title="${esc(m.t)}">${esc(label)}</button><i class="fa-solid fa-chevron-right small text-muted"></i>`;
      }).join('');

      const cur = this.worksMeta[this.currentWorkId];
      const curLabel = cur ? (cur.t.length > 14 ? cur.t.slice(0, 14) + '…' : cur.t) : '';
      crumbs.innerHTML = `${itemsHtml}<span class="chip-btn active">${esc(curLabel)}</span>`;

      crumbs.querySelectorAll('.js-hist-crumb').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.getAttribute('data-idx'), 10);
          const hid = btn.getAttribute('data-wid');
          this.history = this.history.slice(0, idx);
          this.selectWork(hid, false);
        });
      });
    },

    renderCurrentWork() {
      const section = this.container.querySelector('#story-current-section');
      if (!section || !this.currentWorkId) return;
      const targetWid = this.currentWorkId;
      const m = this.worksMeta[targetWid];
      const detail = this.detailsCache.get(targetWid);
      if (!m || !detail) return;

      const esc = root.UIUtils.escapeHtml;
      const sanitize = root.UIUtils.sanitizeUrl;
      const imgSrc = m.img ? sanitize(m.img, '') : '';
      const safeStreamUrl = detail.url ? sanitize(detail.url, '') : '';
      const watchers = this.getWorkWatchers(m);
      const formatSum = (txt) => {
        const cleaned = String(txt || 'プロット要約なし')
          .replace(/^[^\n]*物語構造を分析・構造化しました。[ \t]*\n*(?:---+\s*\n*)?/i, '')
          .trim();
        return esc(cleaned).replace(/(【[^】\n]+】)/g, '<strong class="text-purple" style="display:inline-block;margin-top:0.35rem;">$1</strong>');
      };

      section.innerHTML = `
        <div class="sim-current-card">
          <div class="sim-poster-wrap">
            ${imgSrc
              ? `<img id="story-current-img" src="${esc(imgSrc)}" alt="${esc(m.t)}" class="sim-poster-img" />`
              : `<div class="anime-card-no-thumb"><i class="fa-solid fa-film"></i><span class="anime-card-no-thumb-label">NO IMAGE</span></div>`}
          </div>
          <div class="stack-md" style="min-width:0;">
            <div>
              <h3 style="font-size:1.2rem;font-weight:800;margin-bottom:0.4rem;">${esc(m.t)}</h3>
              <div class="chips-wrap">
                <span class="badge">${m.y ? `${m.y}年` : '年代不明'}</span>
                <span class="badge badge-blue">${esc(m.g || 'その他')}</span>
                <span class="badge badge-purple"><i class="fa-solid fa-crosshairs"></i> 起点作品</span>
                ${watchers.length > 0 ? watchers.map(u => `<span class="watcher-pill">@${esc(u)} 視聴済</span>`).join('') : ''}
              </div>
            </div>

            <div class="subtabs-bar" style="align-self:flex-start;">
              <button type="button" class="subtab-btn ${this.synopsisTab === 'summary' ? 'active' : ''}" data-syn-tab="summary">
                <i class="fa-solid fa-brain"></i> 起承転結プロット要約 (LLM)
              </button>
              <button type="button" class="subtab-btn ${this.synopsisTab === 'synopsis' ? 'active' : ''}" data-syn-tab="synopsis">
                <i class="fa-solid fa-book"></i> 全体あらすじ
              </button>
            </div>

            <div id="story-syn-box" class="sim-synopsis-box">${this.synopsisTab === 'summary' ? formatSum(detail.sum) : esc(detail.s || 'あらすじ情報なし')}</div>

            <div class="btn-group">
              ${safeStreamUrl ? `<a href="${esc(safeStreamUrl)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-xs"><i class="fa-solid fa-play text-pink"></i> dアニメストア</a>` : ''}
              ${m.aid ? `<a href="https://annict.com/works/${esc(encodeURIComponent(m.aid))}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-xs"><i class="fa-solid fa-arrow-up-right-from-square text-blue"></i> Annict</a>` : ''}
            </div>
          </div>
        </div>
      `;

      section.querySelectorAll('[data-syn-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.synopsisTab = btn.getAttribute('data-syn-tab');
          section.querySelectorAll('[data-syn-tab]').forEach(b => b.classList.toggle('active', b === btn));
          const box = section.querySelector('#story-syn-box');
          if (box) {
            box.innerHTML = this.synopsisTab === 'summary' ? formatSum(detail.sum) : esc(detail.s || 'あらすじ情報なし');
          }
        });
      });

      if (!imgSrc || !root.AnalyzerEngine.isAnnictImageHost(imgSrc)) {
        this.enqueueImgResolve(targetWid, (newUrl) => {
          if (this.currentWorkId !== targetWid) return;
          const cleanUrl = sanitize(newUrl, '');
          if (!cleanUrl) return;
          const wrap = section.querySelector('.sim-poster-wrap');
          if (!wrap) return;
          wrap.classList.remove('is-empty');
          wrap.querySelector('.anime-card-no-thumb')?.remove();
          let el = wrap.querySelector('#story-current-img');
          if (!el) {
            el = document.createElement('img');
            el.id = 'story-current-img';
            el.alt = m.t || '';
            el.className = 'sim-poster-img';
            wrap.appendChild(el);
          }
          el.style.display = '';
          el.src = cleanUrl;
        });
      }
    },

    renderTop30() {
      const section = this.container.querySelector('#story-top30-section');
      if (!section || !this.currentWorkId) return;
      const detail = this.detailsCache.get(this.currentWorkId);
      if (!detail || !detail.c) return;

      const wp = this.plotWeight;
      const ws = 1.0 - wp;
      const computed = [];

      for (const cand of detail.c) {
        const cWid = String(cand[0]);
        const target = this.worksMeta[cWid];
        if (!target) continue;

        const settingScore = clamp01((cand[1] || 0) / 1000);
        const plotScore = clamp01((cand[2] || 0) / 1000);
        const totalScore = clamp01(ws * settingScore + wp * plotScore);

        if (this.filterEra !== 'ALL') {
          const y = target.y;
          if (!y) continue;
          if (this.filterEra === '2020s' && (y < 2020 || y > 2029)) continue;
          if (this.filterEra === '2010s' && (y < 2010 || y > 2019)) continue;
          if (this.filterEra === '2000s' && (y < 2000 || y > 2009)) continue;
          if (this.filterEra === '1990s' && (y < 1990 || y > 1999)) continue;
        }

        if (this.filterGenre !== 'ALL' && !target.genreTokens?.includes(this.filterGenre)) {
          continue;
        }

        const watchers = this.getWorkWatchers(target);
        if (this.onlyUnwatchedByGroup && watchers.length > 0) continue;

        computed.push({ wid: cWid, work: target, totalScore, plotScore, settingScore, watchers });
      }

      computed.sort((a, b) => b.totalScore - a.totalScore);
      const top30 = computed.slice(0, 30);
      const esc = root.UIUtils.escapeHtml;
      const sanitize = root.UIUtils.sanitizeUrl;

      if (top30.length === 0) {
        section.innerHTML = '<div class="card"><div class="empty-box"><i class="fa-solid fa-filter-circle-xmark"></i><p>絞り込み条件に一致する類似アニメが見つかりませんでした。</p></div></div>';
        return;
      }

      const cardsHtml = top30.map((item, idx) => {
        const rank = idx + 1;
        const w = item.work;
        const pct = Math.min(100, Math.round(item.totalScore * 1000) / 10);
        const plotPct = Math.min(100, Math.round(item.plotScore * 1000) / 10);
        const setPct = Math.min(100, Math.round(item.settingScore * 1000) / 10);
        const rankCls = rank <= 3 ? `rank-${rank}` : '';
        const imgSrc = w.img ? sanitize(w.img, '') : '';
        const firstGenre = w.genreTokens?.[0] || (w.g || '').split(',')[0] || '';

        let genreChipHtml = '';
        if (root.AppStore && root.GenreEngine) {
          const catId = root.AppStore.getWorkCategory(w.t);
          const def = root.GenreEngine.GENRE_DEF_MAP[catId];
          if (def && catId !== 'other') {
            const gcl = def.colorLight || def.color;
            const cardLabel = def.shortLabel || def.label;
            genreChipHtml = `<div class="anime-card-genre-inline" style="--gc:${def.color};--gcl:${gcl};"><i class="${def.icon}"></i> <span>${esc(cardLabel)}</span></div>`;
          }
        }
        if (!genreChipHtml) {
          genreChipHtml = `<div class="anime-card-genre-inline is-muted"><i class="fa-solid fa-tag"></i> <span>${esc(firstGenre || 'その他')}</span></div>`;
        }

        return `
          <div class="sim-card js-sim-card" data-wid="${esc(item.wid)}">
            <div class="anime-card-thumb-wrap${imgSrc ? '' : ' is-empty'}">
              ${imgSrc ? `<img id="story-card-img-${esc(item.wid)}" src="${esc(imgSrc)}" alt="${esc(w.t)}" class="anime-card-thumb" loading="${idx < 12 ? 'eager' : 'lazy'}" decoding="async" />` : `<div class="anime-card-no-thumb"><i class="fa-solid fa-film"></i><span class="anime-card-no-thumb-label">NO IMAGE</span></div>`}
            </div>
            <div class="anime-card-body">
              <div class="sim-card-head-badges">
                <span class="sim-card-rank ${rankCls}">#${rank}</span>
                <span class="sim-card-score-pill">${pct}%</span>
              </div>
              <div class="anime-card-title" title="${esc(w.t)}">${esc(w.t)}</div>
              ${genreChipHtml}
              <div class="anime-card-meta">
                <span><i class="fa-regular fa-calendar"></i> ${w.y ? `${w.y}年` : '年代不明'}</span>
              </div>
              <div class="chips-wrap" style="gap:0.25rem;">
                <span class="badge badge-blue" style="font-size:0.66rem;padding:0.08rem 0.4rem;">世界観 ${setPct}%</span>
                <span class="badge badge-purple" style="font-size:0.66rem;padding:0.08rem 0.4rem;">展開 ${plotPct}%</span>
              </div>
              ${item.watchers.length > 0 ? `<div class="anime-card-watchers">${item.watchers.slice(0, 3).map(u => `<span class="watcher-pill">@${esc(u)} 済</span>`).join('')}</div>` : ''}
            </div>
          </div>
        `;
      }).join('');

      section.innerHTML = `
        <div class="card">
          <div class="card-header">
            <div class="card-header-row">
              <h3 class="card-title"><i class="fa-solid fa-ranking-star text-gold"></i> 類似ストーリー構成アニメ Top ${top30.length}</h3>
              <span class="small text-muted">世界観 ${Math.round(ws * 100)}% + プロット ${Math.round(wp * 100)}%</span>
            </div>
          </div>
          <div class="sim-cards-grid">${cardsHtml}</div>
        </div>
      `;

      root.UIUtils.syncThumbStates(section);

      top30.forEach(item => {
        const w = item.work;
        if (!w.img || !root.AnalyzerEngine.isAnnictImageHost(w.img)) {
          this.enqueueImgResolve(item.wid, (newUrl) => {
            const cleanUrl = sanitize(newUrl, '');
            if (!cleanUrl) return;
            const cardEl = Array.from(section.querySelectorAll('.js-sim-card'))
              .find(el => el.getAttribute('data-wid') === item.wid);
            const wrap = cardEl?.querySelector('.anime-card-thumb-wrap');
            if (!wrap) return;
            wrap.classList.remove('is-empty', 'is-ready');
            wrap.querySelector('.anime-card-no-thumb')?.remove();
            let el = wrap.querySelector('.anime-card-thumb');
            if (!el) {
              el = document.createElement('img');
              el.alt = w.t || '';
              el.className = 'anime-card-thumb';
              el.loading = 'lazy';
              el.decoding = 'async';
              wrap.appendChild(el);
            }
            el.style.display = '';
            el.src = cleanUrl;
            if (el.complete && el.naturalWidth > 0) root.UIUtils.markThumbLoaded(el);
          });
        }
      });
    },

    enqueueImgResolve(wid, cb) {
      const m = this.worksMeta?.[wid];
      if (!m) return;
      if (m.img && root.AnalyzerEngine.isAnnictImageHost(m.img)) {
        cb(m.img);
        return;
      }
      if (m._imgTried && !m._imgInFlight) return;
      let list = this.imgResolveListeners.get(wid);
      if (!list) {
        list = [];
        this.imgResolveListeners.set(wid, list);
      }
      list.push(cb);
      if (!m._imgInFlight && !this.imgResolveQueue.some(j => j.wid === wid)) {
        this.imgResolveQueue.push({ wid, m });
        this.drainImgQueue();
      }
    },

    drainImgQueue() {
      while (this.activeImgResolves < 4 && this.imgResolveQueue.length > 0) {
        const job = this.imgResolveQueue.shift();
        if (!job?.m || job.m._imgTried || job.m._imgInFlight) continue;
        job.m._imgTried = true;
        job.m._imgInFlight = true;
        this.activeImgResolves++;
        let url = `/api/similarity-image?workId=${encodeURIComponent(job.wid)}&title=${encodeURIComponent(job.m.t)}`;
        if (job.m.aid) url += `&annictId=${encodeURIComponent(job.m.aid)}`;
        fetch(url)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data?.url && root.AnalyzerEngine.isAnnictImageHost(data.url)) {
              job.m.img = data.url;
              if (data.annictId && !job.m.aid) job.m.aid = data.annictId;
              const listeners = this.imgResolveListeners.get(job.wid) || [];
              listeners.forEach(fn => fn(data.url));
            }
          })
          .catch(() => {})
          .finally(() => {
            job.m._imgInFlight = false;
            this.imgResolveListeners.delete(job.wid);
            this.activeImgResolves--;
            this.drainImgQueue();
          });
      }
    },

    handleSearch(query) {
      const dropdown = this.container.querySelector('#story-dropdown');
      if (!dropdown || !this.worksMeta) return;
      if (!query) { dropdown.style.display = 'none'; return; }

      const qNorm = query.normalize('NFKC').toLowerCase();
      const hits = [];
      for (const wid in this.worksMeta) {
        const m = this.worksMeta[wid];
        if ((m.t || '').normalize('NFKC').toLowerCase().includes(qNorm)) {
          hits.push(m);
          if (hits.length >= 15) break;
        }
      }

      const esc = root.UIUtils.escapeHtml;
      const sanitize = root.UIUtils.sanitizeUrl;
      if (hits.length === 0) {
        dropdown.innerHTML = `<div class="suggest-item text-muted">「${esc(query)}」に一致する作品はありません</div>`;
        dropdown.style.display = 'block';
        return;
      }

      dropdown.innerHTML = hits.map(m => {
        const sImg = m.img ? sanitize(m.img, '') : '';
        const thumbHtml = sImg
          ? `<img src="${esc(sImg)}" alt="" style="width:30px;height:40px;object-fit:cover;border-radius:4px;flex-shrink:0;" />`
          : `<div style="width:30px;height:40px;border-radius:4px;background:var(--bg-muted);display:flex;align-items:center;justify-content:center;color:var(--text-muted);flex-shrink:0;"><i class="fa-solid fa-film"></i></div>`;
        return `
        <div class="suggest-item" data-wid="${esc(m.id)}">
          ${thumbHtml}
          <div style="min-width:0;">
            <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(m.t)}</div>
            <div class="small text-muted">${m.y ? `${m.y}年` : ''} ${m.g ? `・${esc(m.g)}` : ''}</div>
          </div>
        </div>
      `;
      }).join('');
      dropdown.style.display = 'block';

      dropdown.querySelectorAll('.suggest-item[data-wid]').forEach(item => {
        item.addEventListener('click', () => {
          this.selectWork(item.getAttribute('data-wid'), true);
        });
      });
    },

    jumpByTitle(title) {
      this.pendingJumpTitle = title;
      if (this.worksMeta) {
        const wid = this.findBestWorkIdByTitle(title);
        this.pendingJumpTitle = null;
        if (wid) {
          this.selectWork(wid, true);
        } else {
          root.UIUtils.showToast(`「${title}」はストーリー類似検索の対象リストに含まれていません`, 'info');
        }
      }
    }
  };

  root.AppViews = root.AppViews || {};
  root.AppViews.story = StoryView;
}(window));
