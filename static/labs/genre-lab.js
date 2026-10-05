'use strict';

/**
 * ジャンル実験室（Genre Lab）フロントエンドコントローラー
 * 従来のif文優先度方式と新スコアリング方式の比較・検証UI
 */
(function() {
  let labInitialized = false;
  let currentDiffFilter = 'all';
  let currentDiffSearch = '';

  // シーズン文字列の重み付けパース（例: "2024年夏" -> 20243）
  function parseSeasonWeight(seasonStr) {
    if (!seasonStr) return 0;
    const m = seasonStr.match(/(\d{4})年?(冬|春|夏|秋)?/);
    if (!m) return 0;
    const year = parseInt(m[1], 10) || 0;
    const sMap = { '冬': 1, '春': 2, '夏': 3, '秋': 4 };
    const seasonWeight = sMap[m[2]] || 0;
    return year * 10 + seasonWeight;
  }

  window.renderGenreLabTab = function(labsData, fullData) {
    if (!labsData || !labsData.genreDiffReport) return;

    if (!labInitialized) {
      initGenreLabEvents(labsData, fullData);
      labInitialized = true;
    }

    renderDiffSummary(labsData.genreDiffReport);
    renderDiffFilterChips(labsData.genreDiffReport);
    renderDiffCards(labsData.genreDiffReport);
    renderScoredDashboard(labsData.genreReportScored);
  };

  // 1. イベントリスナーの初期化
  function initGenreLabEvents(labsData, fullData) {
    // サブタブ切り替え
    const subnavBtns = document.querySelectorAll('.genre-lab-subnav-btn');
    subnavBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        subnavBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const subtabId = btn.getAttribute('data-lab-subtab');
        document.querySelectorAll('.genre-lab-subpane').forEach(p => {
          p.style.display = 'none';
          p.classList.remove('active');
        });

        const targetPane = document.getElementById(`genre-lab-subtab-${subtabId}`);
        if (targetPane) {
          targetPane.style.display = 'block';
          targetPane.classList.add('active');
        }
      });
    });

    // 差分検索ボックス
    const searchInput = document.getElementById('diff-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        currentDiffSearch = (e.target.value || '').trim().toLowerCase();
        renderDiffCards(labsData.genreDiffReport);
      });
    }

    // スコア診断ボタン
    const btnInspect = document.getElementById('btn-inspect-score');
    const inputInspect = document.getElementById('inspector-title-input');
    if (btnInspect && inputInspect) {
      btnInspect.addEventListener('click', () => {
        const title = inputInspect.value.trim();
        if (title) executeInspection(title);
      });
      inputInspect.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const title = inputInspect.value.trim();
          if (title) executeInspection(title);
        }
      });
    }

    // おすすめ診断プリセットボタン
    document.querySelectorAll('.btn-preset-title').forEach(btn => {
      btn.addEventListener('click', () => {
        const title = btn.getAttribute('data-title');
        if (inputInspect) inputInspect.value = title;
        executeInspection(title);
      });
    });

    // スコアリング結果の一括展開・一括折りたたみ
    const btnExpandAll = document.getElementById('btn-lab-expand-all');
    const btnCollapseAll = document.getElementById('btn-lab-collapse-all');
    if (btnExpandAll) {
      btnExpandAll.addEventListener('click', () => {
        document.querySelectorAll('#lab-scored-breakdown-list .genre-accordion-card').forEach(c => c.classList.add('open'));
      });
    }
    if (btnCollapseAll) {
      btnCollapseAll.addEventListener('click', () => {
        document.querySelectorAll('#lab-scored-breakdown-list .genre-accordion-card').forEach(c => c.classList.remove('open'));
      });
    }
  }

  // 2. 差分サマリーバナー描画
  function renderDiffSummary(diffReport) {
    const badge = document.getElementById('badge-diff-count');
    const tag = document.getElementById('diff-summary-tag');
    if (badge) {
      badge.textContent = `${diffReport.diffCount} 作品が改善`;
    }
    if (tag) {
      tag.innerHTML = `<i class="fa-solid fa-arrow-trend-up text-gold"></i> 全 ${diffReport.totalWorks.toLocaleString()} 作中 <strong>${diffReport.diffCount} 作 (${diffReport.diffPercentage}%)</strong> の判定精度が向上`;
    }
  }

  // 3. 差分フィルタチップ（変更元ジャンル別）
  function renderDiffFilterChips(diffReport) {
    const container = document.getElementById('diff-filter-chips');
    if (!container) return;

    // どの旧ジャンルから何件変更があったか集計
    const countsByLegacy = {};
    (diffReport.diffs || []).forEach(d => {
      countsByLegacy[d.legacyCategory] = (countsByLegacy[d.legacyCategory] || 0) + 1;
    });

    // 定義マップ
    const defMap = getGenreDefMap();

    let html = `
      <button class="chip-btn ${currentDiffFilter === 'all' ? 'active' : ''}" data-legacy="all">
        すべて (${diffReport.diffCount})
      </button>
    `;

    // 変更数の多い旧ジャンル順にソート
    const sortedLegacies = Object.entries(countsByLegacy).sort((a, b) => b[1] - a[1]);
    sortedLegacies.forEach(([catId, cnt]) => {
      const def = defMap[catId] || { label: catId, color: '#94a3b8' };
      html += `
        <button class="chip-btn ${currentDiffFilter === catId ? 'active' : ''}" data-legacy="${catId}">
          旧: ${escapeHtml(def.label)} (${cnt})
        </button>
      `;
    });

    container.innerHTML = html;

    container.querySelectorAll('.chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentDiffFilter = btn.getAttribute('data-legacy');
        renderDiffCards(diffReport);
      });
    });
  }

  // 4. 差分カード一覧描画
  function renderDiffCards(diffReport) {
    const container = document.getElementById('diff-cards-grid');
    const countBadge = document.getElementById('diff-filtered-count');
    if (!container) return;

    const defMap = getGenreDefMap();
    let items = diffReport.diffs || [];

    // 旧ジャンルフィルタ
    if (currentDiffFilter !== 'all') {
      items = items.filter(d => d.legacyCategory === currentDiffFilter);
    }

    // タイトル検索フィルタ
    if (currentDiffSearch) {
      items = items.filter(d => d.title.toLowerCase().includes(currentDiffSearch));
    }

    if (countBadge) {
      countBadge.textContent = `${items.length} 件`;
    }

    if (items.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;padding:3rem 1rem;">
          <i class="fa-solid fa-check-circle" style="font-size:2.5rem;color:var(--text-muted);margin-bottom:0.8rem;"></i>
          <p>該当する差分作品は見つかりませんでした</p>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    // 最初の120件を描画（描画パフォーマンス維持）
    const displayItems = items.slice(0, 120);

    displayItems.forEach(item => {
      const legacyDef = defMap[item.legacyCategory] || { label: item.legacyCategory, color: '#64748b', icon: 'fa-solid fa-tag' };
      const scoredDef = defMap[item.scoredCategory] || { label: item.scoredCategory, color: '#a855f7', icon: 'fa-solid fa-shapes' };

      const card = document.createElement('div');
      card.className = 'diff-anime-card';

      const thumbHtml = item.image
        ? `<img src="${item.image}" alt="${escapeHtml(item.title)}" class="diff-card-thumb" loading="lazy" decoding="async" />`
        : `<div class="diff-card-no-thumb"><i class="fa-solid fa-film"></i></div>`;

      const reasonsHtml = (item.topReasons || []).map(r => `
        <span class="diff-reason-tag">${escapeHtml(r)}</span>
      `).join('');

      const watchersHtml = (item.watchedBy || []).map(u => `
        <span class="diff-watcher-tag">@${escapeHtml(u)}</span>
      `).join('');

      card.innerHTML = `
        <div class="diff-thumb-wrapper">
          ${thumbHtml}
          <span class="diff-score-badge" title="新スコア: ${item.score}点">${item.score} pt</span>
        </div>
        <div class="diff-card-content">
          <h4 class="diff-card-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h4>
          <div class="diff-compare-flow">
            <span class="diff-badge legacy" style="border-color:${legacyDef.color}55;color:${legacyDef.color};">
              <i class="${legacyDef.icon}"></i> ${escapeHtml(legacyDef.label)}
            </span>
            <i class="fa-solid fa-arrow-right diff-arrow"></i>
            <span class="diff-badge scored" style="background:${scoredDef.color}22;border-color:${scoredDef.color};color:${scoredDef.color};">
              <i class="${scoredDef.icon}"></i> ${escapeHtml(scoredDef.label)}
            </span>
          </div>
          <div class="diff-reasons-wrap">
            <span class="text-muted" style="font-size:0.75rem;"><i class="fa-solid fa-check"></i> 勝因理由:</span>
            <div class="diff-reasons-list">
              ${reasonsHtml}
            </div>
          </div>
          <div class="diff-card-footer">
            <small class="text-muted"><i class="fa-solid fa-users"></i> 視聴者 (${(item.watchedBy || []).length}人):</small>
            <div class="diff-watchers-list">
              ${watchersHtml}
            </div>
          </div>
        </div>
      `;

      // サムネイルクリックで高解像度モーダルを開く
      const thumbEl = card.querySelector('.diff-card-thumb');
      if (thumbEl) {
        thumbEl.style.cursor = 'pointer';
        thumbEl.addEventListener('click', (e) => {
          e.stopPropagation();
          if (typeof window.openImageModal === 'function') {
            window.openImageModal(item.title, item.image, item.id);
          }
        });
      }

      container.appendChild(card);
    });

    if (items.length > 120) {
      const moreMsg = document.createElement('div');
      moreMsg.className = 'diff-more-indicator';
      moreMsg.style.gridColumn = '1 / -1';
      moreMsg.innerHTML = `<p class="text-muted text-center" style="padding:1.5rem;"><i class="fa-solid fa-circle-info"></i> 他 ${items.length - 120} 件の差分作品があります。検索ボックスで絞り込んでご覧ください。</p>`;
      container.appendChild(moreMsg);
    }
  }

  // 5. 新スコアリング結果ダッシュボード描画
  function renderScoredDashboard(genreReportScored) {
    if (!genreReportScored) return;

    const userSummaryContainer = document.getElementById('lab-scored-user-summaries');
    const breakdownContainer = document.getElementById('lab-scored-breakdown-list');
    if (!userSummaryContainer || !breakdownContainer) return;

    userSummaryContainer.innerHTML = '';
    breakdownContainer.innerHTML = '';

    const statsByUser = genreReportScored.statsByUser || {};
    const genres = genreReportScored.genres || [];
    const users = Object.keys(statsByUser);
    const colors = ['#f43f5e', '#38bdf8', '#a855f7', '#fbbf24', '#34d399', '#ec4899'];

    // ユーザー別Top3サマリーカード
    Object.values(statsByUser).forEach(uStat => {
      const card = document.createElement('div');
      card.className = 'genre-user-card';

      let topHtml = '';
      (uStat.topGenres || []).forEach((g, idx) => {
        topHtml += `
          <div class="genre-top-item">
            <div class="genre-top-item-left">
              <span class="genre-top-rank">#${idx + 1}</span>
              <span class="genre-badge-pill" style="background:${g.color}22;color:${g.color};border:1px solid ${g.color}44;">
                <i class="${g.icon}"></i> <span>${escapeHtml(g.label)}</span>
              </span>
            </div>
            <div class="genre-top-item-right">
              <span class="genre-top-count">${g.count} 作品</span>
              <span class="genre-top-pct">(${g.percentage}%)</span>
            </div>
          </div>
        `;
      });

      card.innerHTML = `
        <div class="calorie-user-header">
          <span class="calorie-user-name"><i class="fa-solid fa-user"></i> @${escapeHtml(uStat.username)}</span>
          <span class="text-muted" style="font-size:0.82rem;">計 ${uStat.totalWatched} 作品中</span>
        </div>
        <div style="font-size:0.82rem;color:var(--text-muted);font-weight:600;">最多鑑賞ジャンル Top 3:</div>
        <div class="genre-top-chips">
          ${topHtml || '<span class="text-muted">データがありません</span>'}
        </div>
      `;
      userSummaryContainer.appendChild(card);
    });

    // 14ジャンル別アコーディオン
    genres.forEach(g => {
      const card = document.createElement('div');
      card.className = 'genre-accordion-card';
      card.id = `genre-card-scored-${g.id.replace(/[^a-zA-Z0-9]/g, '_')}`;

      // 各ユーザーの最大値を計算（バーの相対長用）
      let maxCountInGenre = 1;
      users.forEach(u => {
        const c = g.userCounts?.[u] || 0;
        if (c > maxCountInGenre) maxCountInGenre = c;
      });

      // ユーザー別視聴バーグラフ
      let barsHtml = '';
      users.forEach((u, uIdx) => {
        const count = g.userCounts?.[u] || 0;
        const pct = g.userPercentages?.[u] || 0;
        const barWidth = Math.max(0, Math.min(100, (count / maxCountInGenre) * 100));
        const userColor = colors[uIdx % colors.length];

        barsHtml += `
          <div class="genre-user-bar-item">
            <span class="genre-user-bar-name">@${escapeHtml(u)}</span>
            <div class="genre-bar-track">
              <div class="genre-bar-fill" style="width:${barWidth}%;background:${userColor};"></div>
            </div>
            <span class="genre-user-bar-stat">${count}作 (${pct}%)</span>
          </div>
        `;
      });

      // 全ユーザーの重複を除去した「全員の作品（ユニーク）」を生成
      const allUniqueMap = new Map();
      users.forEach(u => {
        const animes = g.animesByUser?.[u] || [];
        animes.forEach(a => {
          const key = String(a.id || a.title);
          if (!allUniqueMap.has(key)) {
            allUniqueMap.set(key, {
              ...a,
              watchers: [u]
            });
          } else {
            const existing = allUniqueMap.get(key);
            if (!existing.watchers.includes(u)) {
              existing.watchers.push(u);
            }
            // 放送年度の正規化: より古い（初回放送・公開時期）シーズンがあれば更新
            if (a.season && parseSeasonWeight(a.season) > 0) {
              const curWeight = parseSeasonWeight(existing.season);
              const newWeight = parseSeasonWeight(a.season);
              if (curWeight === 0 || (newWeight > 0 && newWeight < curWeight)) {
                existing.season = a.season;
              }
            }
          }
        });
      });

      // 最新順（放送年度・シーズンが新しい順 ➜ 同一シーズンなら視聴者数降順 ➜ タイトル昇順）
      const compareSeasonDesc = (a, b) => {
        const wA = parseSeasonWeight(a.season);
        const wB = parseSeasonWeight(b.season);
        if (wB !== wA) return wB - wA; // 新しい順（降順）
        const countA = a.watchers ? a.watchers.length : 0;
        const countB = b.watchers ? b.watchers.length : 0;
        if (countB !== countA) return countB - countA;
        return a.title.localeCompare(b.title, 'ja');
      };

      const allUniqueAnimes = Array.from(allUniqueMap.values()).sort(compareSeasonDesc);

      // タブ生成（先頭に「全員」、続いて各ユーザー）
      let userTabsHtml = `
        <button class="genre-tab-btn active" data-user="__all__">
          <i class="fa-solid fa-users"></i> 全員 (${allUniqueAnimes.length}作)
        </button>
      `;

      users.forEach(u => {
        const animes = g.animesByUser?.[u] || [];
        userTabsHtml += `
          <button class="genre-tab-btn" data-user="${escapeHtml(u)}">
            <i class="fa-solid fa-user"></i> @${escapeHtml(u)} (${animes.length}作)
          </button>
        `;
      });

      // アニメカード生成ヘルパー
      function buildAnimeCardsHtml(animes, isAll = false) {
        if (!animes || animes.length === 0) {
          return '<p class="text-muted" style="font-size:0.85rem;grid-column:1/-1;padding:1.5rem 0.5rem;text-align:center;">該当する作品はありません</p>';
        }
        return animes.map(a => {
          const safeTitle = escapeHtml(a.title);
          const imgUrl = a.image || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="80" fill="%23334155"><rect width="60" height="80"/></svg>';
          const watchersBadge = isAll && a.watchers && a.watchers.length > 0
            ? `<span class="genre-anime-watchers" style="font-size:0.68rem;color:var(--accent-gold);margin-top:2px;display:flex;align-items:center;gap:3px;" title="視聴者: ${a.watchers.map(w => '@' + escapeHtml(w)).join(', ')}">
                <i class="fa-solid fa-users"></i> ${a.watchers.length}人視聴
               </span>`
            : '';

          return `
            <a href="${escapeHtml(a.url || `https://annict.com/works/${a.id}`)}" target="_blank" rel="noopener noreferrer" class="genre-anime-card" data-anime-title="${safeTitle}" data-anime-image="${escapeHtml(a.image || '')}" data-anime-id="${escapeHtml(String(a.id || ''))}">
              <img src="${escapeHtml(imgUrl)}" alt="${safeTitle}" class="genre-anime-thumb" loading="lazy" decoding="async" />
              <div class="genre-anime-info">
                <span class="genre-anime-title" title="${safeTitle}">${safeTitle}</span>
                <span class="genre-anime-season">${escapeHtml(a.season || '')}</span>
                ${watchersBadge}
              </div>
            </a>
          `;
        }).join('');
      }

      // グリッドHTMLの組み立て（全員用＋各ユーザー用、どちらも最新順にソート）
      let userAnimesGridsHtml = `
        <div class="genre-animes-grid user-animes-__all__" style="display: grid;">
          ${buildAnimeCardsHtml(allUniqueAnimes, true)}
        </div>
      `;

      users.forEach(u => {
        const userAnimes = [...(g.animesByUser?.[u] || [])].sort((a, b) => {
          const wA = parseSeasonWeight(a.season);
          const wB = parseSeasonWeight(b.season);
          if (wB !== wA) return wB - wA;
          return a.title.localeCompare(b.title, 'ja');
        });
        userAnimesGridsHtml += `
          <div class="genre-animes-grid user-animes-${escapeHtml(u)}" style="display: none;">
            ${buildAnimeCardsHtml(userAnimes, false)}
          </div>
        `;
      });

      const topUserBadge = g.topUser
        ? `<span class="genre-top-user-pill badge" style="background:${g.color}22;color:${g.color};border:1px solid ${g.color}44;">最多: @${escapeHtml(g.topUser.username)} (${g.topUser.count}作)</span>`
        : '';

      card.innerHTML = `
        <div class="genre-accordion-header">
          <div class="genre-header-top">
            <div class="genre-title-wrap">
              <div class="genre-icon-box" style="background:${g.color};">
                <i class="${g.icon}"></i>
              </div>
              <div class="genre-names">
                <span class="genre-name-ja">${escapeHtml(g.label)}</span>
                <span class="genre-name-en">(${escapeHtml(g.labelEn || g.id)})</span>
              </div>
            </div>
            <div class="genre-header-meta">
              ${topUserBadge}
              <span class="genre-total-pill text-muted">全員合計 ${allUniqueAnimes.length} 作品 (延べ ${g.totalWorksAcrossUsers} 作)</span>
              <i class="fa-solid fa-chevron-down genre-toggle-icon"></i>
            </div>
          </div>
          <div class="genre-user-bars-row">
            ${barsHtml}
          </div>
        </div>
        <div class="genre-accordion-body">
          <div class="genre-body-user-tabs">
            ${userTabsHtml}
          </div>
          ${userAnimesGridsHtml}
        </div>
      `;

      // アコーディオン開閉イベント（ヘッダークリックでカードに .open をトグル）
      const header = card.querySelector('.genre-accordion-header');
      header.addEventListener('click', () => {
        card.classList.toggle('open');
      });

      // ユーザータブ切替イベント
      const tabBtns = card.querySelectorAll('.genre-tab-btn');
      tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetUser = btn.getAttribute('data-user');
          tabBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');

          const grids = card.querySelectorAll('.genre-animes-grid');
          grids.forEach(grid => {
            if (grid.classList.contains(`user-animes-${targetUser}`)) {
              grid.style.display = 'grid';
            } else {
              grid.style.display = 'none';
            }
          });
        });
      });

      // サムネイル画像クリックで高解像度画像モーダルを開く
      card.querySelectorAll('.genre-anime-thumb').forEach(thumb => {
        thumb.style.cursor = 'zoom-in';
        thumb.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const animeCard = thumb.closest('.genre-anime-card');
          if (animeCard && typeof window.openImageModal === 'function') {
            const title = animeCard.getAttribute('data-anime-title') || '';
            const image = animeCard.getAttribute('data-anime-image') || '';
            const id = animeCard.getAttribute('data-anime-id') || '';
            window.openImageModal(title, image, id);
          }
        });
      });

      breakdownContainer.appendChild(card);
    });
  }

  // 6. 作品スコア診断の実行
  async function executeInspection(title) {
    const container = document.getElementById('inspector-result-container');
    if (!container) return;

    container.style.display = 'block';
    container.innerHTML = `
      <div class="text-center" style="padding:2rem;">
        <div class="spinner"></div>
        <p class="text-muted mt-2">AniListデータとスコアリングを照合中: <strong>${escapeHtml(title)}</strong>...</p>
      </div>
    `;

    try {
      const res = await fetch(`/api/genre-score?title=${encodeURIComponent(title)}`);
      if (!res.ok) {
        throw new Error(`サーバーエラー: ${res.status}`);
      }
      const data = await res.json();
      renderInspectionResult(data);
    } catch (err) {
      container.innerHTML = `
        <div class="empty-state" style="padding:2rem;color:var(--text-danger);">
          <i class="fa-solid fa-triangle-exclamation" style="font-size:2rem;margin-bottom:0.5rem;"></i>
          <p>診断データの取得に失敗しました: ${escapeHtml(err.message)}</p>
        </div>
      `;
    }
  }

  // 7. 診断結果の描画
  function renderInspectionResult(data) {
    const container = document.getElementById('inspector-result-container');
    if (!container) return;

    const defMap = {};
    (data.definitions || []).forEach(d => { defMap[d.id] = d; });

    const legacyDef = defMap[data.legacyCategory] || { label: data.legacyCategory, color: '#64748b', icon: 'fa-solid fa-tag' };
    const scoredCat = data.scored?.category;
    const scoredDef = defMap[scoredCat] || { label: scoredCat, color: '#a855f7', icon: 'fa-solid fa-shapes' };

    // スコア降順ソート
    const scoreEntries = Object.entries(data.scored?.scores || {})
      .filter(([id]) => id !== 'other')
      .map(([id, score]) => ({
        id,
        score: Math.round(score),
        def: defMap[id] || { label: id, color: '#64748b', icon: 'fa-solid fa-tag' },
        reasons: data.scored?.reasons?.[id] || []
      }))
      .sort((a, b) => b.score - a.score);

    const maxScore = scoreEntries[0]?.score || 1;

    let barsHtml = '';
    scoreEntries.forEach(item => {
      const isWinner = item.id === scoredCat;
      const barPct = Math.max(0, Math.min(100, (item.score / maxScore) * 100));
      const reasonHtml = item.reasons.length > 0
        ? `<div class="inspector-item-reasons">${item.reasons.map(r => `<span>${escapeHtml(r)}</span>`).join('')}</div>`
        : '';

      barsHtml += `
        <div class="inspector-score-row ${isWinner ? 'winner' : ''}">
          <div class="inspector-row-label">
            <span class="genre-badge-pill" style="background:${item.def.color}22;color:${item.def.color};">
              <i class="${item.def.icon}"></i> ${escapeHtml(item.def.label)}
            </span>
            ${isWinner ? '<span class="badge badge-gold"><i class="fa-solid fa-crown"></i> 判定</span>' : ''}
          </div>
          <div class="inspector-row-bar-wrap">
            <div class="inspector-row-bar" style="width:${barPct}%;background:${isWinner ? item.def.color : 'var(--text-muted)'};"></div>
          </div>
          <div class="inspector-row-score">
            <strong>${item.score}</strong> pt
          </div>
          ${reasonHtml}
        </div>
      `;
    });

    const tagsHtml = (data.tags || []).map(t => `
      <span class="inspector-tag-chip" title="Rank: ${t.rank}">
        ${escapeHtml(t.name)} <small>(${t.rank})</small>
      </span>
    `).join('');

    const genresHtml = (data.genres || []).map(g => `
      <span class="inspector-genre-chip">${escapeHtml(g)}</span>
    `).join('');

    container.innerHTML = `
      <div class="inspector-result-card">
        <div class="inspector-summary-banner">
          <div>
            <h3 style="margin:0 0 0.4rem 0;">${escapeHtml(data.title)}</h3>
            <div style="display:flex;align-items:center;gap:0.8rem;flex-wrap:wrap;">
              <span class="text-muted" style="font-size:0.85rem;">旧判定:</span>
              <span class="diff-badge legacy" style="border-color:${legacyDef.color}55;color:${legacyDef.color};">
                <i class="${legacyDef.icon}"></i> ${escapeHtml(legacyDef.label)}
              </span>
              <i class="fa-solid fa-arrow-right text-muted"></i>
              <span class="text-muted" style="font-size:0.85rem;">新スコア判定:</span>
              <span class="diff-badge scored" style="background:${scoredDef.color}22;border-color:${scoredDef.color};color:${scoredDef.color};">
                <i class="${scoredDef.icon}"></i> ${escapeHtml(scoredDef.label)} (${data.scored?.score} pt)
              </span>
            </div>
          </div>
        </div>

        <div class="inspector-meta-row mt-3">
          <div class="inspector-meta-group">
            <span class="text-muted" style="font-size:0.8rem;"><i class="fa-solid fa-tags"></i> AniList公式ジャンル:</span>
            <div class="inspector-chips-wrap">${genresHtml || '<span class="text-muted">なし</span>'}</div>
          </div>
          <div class="inspector-meta-group mt-2">
            <span class="text-muted" style="font-size:0.8rem;"><i class="fa-solid fa-hashtag"></i> AniListタグ (${(data.tags || []).length}件):</span>
            <div class="inspector-chips-wrap">${tagsHtml || '<span class="text-muted">なし</span>'}</div>
          </div>
        </div>

        <h4 class="mt-4 mb-2"><i class="fa-solid fa-chart-column text-purple"></i> 全14ジャンルの獲得スコア内訳:</h4>
        <div class="inspector-scores-list">
          ${barsHtml}
        </div>
      </div>
    `;
  }

  function getGenreDefMap() {
    return {
      isekai:           { label: '異世界 / 転生',             icon: 'fa-solid fa-door-open',           color: '#8b5cf6' },
      mahou_shoujo:     { label: '魔法少女 / バトルヒロイン',  icon: 'fa-solid fa-wand-magic-sparkles', color: '#fb7185' },
      mecha:            { label: 'ロボット / メカ',          icon: 'fa-solid fa-robot',               color: '#6b7280' },
      action:           { label: 'アクション / バトル',      icon: 'fa-solid fa-burst',               color: '#ef4444' },
      sports:           { label: 'スポーツ / 競技',          icon: 'fa-solid fa-futbol',              color: '#14b8a6' },
      comedy:           { label: 'コメディ / ギャグ',        icon: 'fa-solid fa-face-laugh-squint',   color: '#f59e0b' },
      romance_drama:    { label: '恋愛 / ラブコメ / 青春ドラマ', icon: 'fa-solid fa-heart',           color: '#ec4899' },
      nichijou:         { label: '日常 / ほのぼの',          icon: 'fa-solid fa-mug-saucer',          color: '#10b981' },
      sf_fantasy:       { label: 'SF / ファンタジー',        icon: 'fa-solid fa-meteor',              color: '#6366f1' },
      horror_suspense:  { label: 'ホラー / サスペンス / 推理', icon: 'fa-solid fa-skull',            color: '#475569' },
      history_military: { label: '歴史 / 戦記 / ミリタリー', icon: 'fa-solid fa-shield-halved',       color: '#64748b' },
      idol_music:       { label: 'アイドル / 音楽',          icon: 'fa-solid fa-music',               color: '#eab308' },
      ecchi:            { label: 'エッチ / お色気',          icon: 'fa-solid fa-fire',                color: '#f43f5e' },
      other:            { label: 'その他',                   icon: 'fa-solid fa-ellipsis',            color: '#9ca3af' }
    };
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
