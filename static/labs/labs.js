'use strict';

/**
 * お試し機能 (Labs) 専用レンダラー
 * コア機能から完全に独立して動作します
 */
window.renderLabsTab = function(labsData, fullData) {
  if (!labsData) {
    const container = document.getElementById('labs-content-container');
    if (container) {
      container.innerHTML = '<p class="text-muted" style="padding:2rem;text-align:center;">お試し機能のデータがまだ生成されていません。更新ボタンを押してください。</p>';
    }
    return;
  }

  renderCalories(labsData.calorieReport);
  renderTimeline(labsData.timelineReport, fullData);
  renderStudios(labsData.studioReport);
  renderGenres(labsData.genreReport);
};

// 1. 視聴カロリーの描画
function renderCalories(calorieReport) {
  const container = document.getElementById('labs-calorie-cards');
  if (!container || !calorieReport) return;
  container.innerHTML = '';

  Object.values(calorieReport).forEach(cal => {
    const card = document.createElement('div');
    card.className = 'calorie-card';
    card.innerHTML = `
      <div class="calorie-user-header">
        <span class="calorie-user-name"><i class="fa-solid fa-user"></i> @${escapeHtml(cal.username)}</span>
      </div>
      <div class="calorie-main-stat">
        <span class="calorie-number">${cal.totalHours.toLocaleString()}</span>
        <span class="calorie-unit">総鑑賞時間 (約 ${cal.workCount} 作品)</span>
      </div>
      <div class="calorie-life-stat">
        <div class="calorie-life-row">
          <span class="text-muted"><i class="fa-solid fa-clock"></i> 24時間換算:</span>
          <strong>約 ${cal.totalDays} 日分</strong>
        </div>
        <div class="calorie-life-row">
          <span class="text-muted"><i class="fa-solid fa-sun"></i> 覚醒時間(16h/日)換算:</span>
          <strong>約 ${cal.wakingDays} 日分</strong>
        </div>
      </div>
      <div class="calorie-breakdown">
        <span><i class="fa-solid fa-tv"></i> TV: ${cal.breakdown.tvCount}作</span>
        <span><i class="fa-solid fa-film"></i> 映画: ${cal.breakdown.movieCount}作</span>
        <span><i class="fa-solid fa-compact-disc"></i> OVA等: ${cal.breakdown.ovaCount}作</span>
      </div>
    `;
    container.appendChild(card);
  });
}

// 2. 年代別タイムラインの描画（1年ごと / 5年ごと 両対応）
let currentTimelineMode = '1year'; // デフォルトは新機能「1年ごと」
let timelineButtonsBound = false;

function renderTimeline(timelineReport, fullData) {
  const barsContainer = document.getElementById('labs-timeline-bars');
  if (!barsContainer || !timelineReport) return;

  // 切替ボタンのイベントバインド（初回のみ）
  if (!timelineButtonsBound) {
    document.querySelectorAll('.btn-timeline-mode').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-timeline-mode');
        document.querySelectorAll('.btn-timeline-mode').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTimelineMode = mode;
        renderTimeline(timelineReport, fullData);
      });
    });
    timelineButtonsBound = true;
  }

  // ボタンのアクティブ状態を同期
  document.querySelectorAll('.btn-timeline-mode').forEach(btn => {
    if (btn.getAttribute('data-timeline-mode') === currentTimelineMode) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  barsContainer.innerHTML = '';
  const yearsByUser = timelineReport.yearsByUser || {};
  const users = Object.keys(yearsByUser);
  const colors = ['#f43f5e', '#38bdf8', '#a855f7', '#fbbf24', '#34d399', '#ec4899', '#06b6d4'];

  // ==========================================
  // 【新モード】1年ごとタイムライン
  // ==========================================
  if (currentTimelineMode === '1year') {
    // 全年の一覧を収集（降順）
    let allYears = timelineReport.allYears || [];
    if (allYears.length === 0) {
      const yearSet = new Set();
      users.forEach(u => {
        Object.keys(yearsByUser[u]?.yearCounts || {}).forEach(y => yearSet.add(parseInt(y, 10)));
      });
      allYears = Array.from(yearSet).sort((a, b) => b - a);
    }

    if (allYears.length === 0) {
      barsContainer.innerHTML = '<div class="text-muted text-center" style="padding:2rem;">年代データがありません</div>';
      return;
    }

    // 全年での1人あたり最大本数（バーのスケーリング基準）
    let globalMaxCount = 1;
    allYears.forEach(y => {
      users.forEach(u => {
        const c = yearsByUser[u]?.yearCounts?.[y] || 0;
        if (c > globalMaxCount) globalMaxCount = c;
      });
    });

    allYears.forEach(year => {
      // その年の全ユーザー合計とトップユーザー
      let yearTotal = 0;
      let topUser = null;
      let topUserCount = 0;

      users.forEach(u => {
        const c = yearsByUser[u]?.yearCounts?.[year] || 0;
        yearTotal += c;
        if (c > topUserCount) {
          topUserCount = c;
          topUser = u;
        }
      });

      if (yearTotal === 0) return; // 誰も見ていない年はスキップ

      const row = document.createElement('div');
      row.className = 'timeline-year-row';

      // ユーザー別バー
      let barsHtml = '';
      users.forEach((u, uIdx) => {
        const count = yearsByUser[u]?.yearCounts?.[year] || 0;
        const pct = Math.max(0, Math.min(100, (count / globalMaxCount) * 100));
        const color = colors[uIdx % colors.length];

        barsHtml += `
          <div class="timeline-user-bar-item">
            <span class="timeline-user-bar-name">@${escapeHtml(u)}</span>
            <div class="timeline-user-bar-track">
              <div class="timeline-user-bar-fill" style="width:${pct}%;background:${color};"></div>
            </div>
            <span class="timeline-user-bar-stat ${count > 0 ? 'active' : ''}">${count}作</span>
          </div>
        `;
      });

      // その年の各ユーザー作品カード
      let usersAnimesHtml = '';
      users.forEach((u, uIdx) => {
        const animes = yearsByUser[u]?.animesByYear?.[year] || [];
        if (animes.length === 0) return;

        const cardsHtml = animes.map(a => {
          const thumbHtml = a.image
            ? `<img src="${escapeHtml(a.image)}" class="timeline-anime-thumb" alt="${escapeHtml(a.title)}" loading="lazy" decoding="async" onerror="this.outerHTML='<div class=\\'timeline-anime-thumb-empty\\'><i class=\\'fa-solid fa-film\\'></i></div>'" />`
            : `<div class="timeline-anime-thumb-empty"><i class="fa-solid fa-film"></i></div>`;

          const workUrl = a.url || (a.id ? `https://annict.com/works/${a.id}` : '#');

          return `
            <a href="${escapeHtml(workUrl)}" target="_blank" rel="noopener noreferrer" class="timeline-anime-card" data-anime-title="${escapeHtml(a.title)}" data-anime-image="${escapeHtml(a.image || '')}" data-anime-id="${escapeHtml(String(a.id || ''))}">
              <div class="timeline-thumb-box">${thumbHtml}</div>
              <div class="timeline-card-info">
                <span class="timeline-card-title" title="${escapeHtml(a.title)}">${escapeHtml(a.title)}</span>
                <span class="timeline-card-season">${escapeHtml(a.season || `${year}年`)}</span>
              </div>
            </a>
          `;
        }).join('');

        usersAnimesHtml += `
          <div class="year-drawer-user-section">
            <div class="year-drawer-user-header" style="color:${colors[uIdx % colors.length]};">
              <i class="fa-solid fa-user"></i> @${escapeHtml(u)} (${animes.length}作品)
            </div>
            <div class="timeline-animes-grid">
              ${cardsHtml}
            </div>
          </div>
        `;
      });

      const topUserBadge = topUser && topUserCount > 0
        ? `<span class="badge" style="background:rgba(56,189,248,0.15);color:#38bdf8;border:1px solid rgba(56,189,248,0.3);font-size:0.75rem;">最多: @${escapeHtml(topUser)} (${topUserCount}作)</span>`
        : '';

      row.innerHTML = `
        <div class="timeline-year-header">
          <div class="timeline-year-header-left">
            <span class="year-label-pill"><i class="fa-regular fa-calendar"></i> ${year}年</span>
            ${topUserBadge}
            <span class="text-muted" style="font-size:0.8rem;">全員合計 ${yearTotal} 作品</span>
          </div>
          <div class="timeline-year-header-right">
            <span class="text-muted" style="font-size:0.75rem;">作品を見る</span>
            <i class="fa-solid fa-chevron-down timeline-toggle-icon"></i>
          </div>
        </div>
        <div class="timeline-bars-box">
          ${barsHtml}
        </div>
        <div class="timeline-year-drawer">
          ${usersAnimesHtml}
        </div>
      `;

      // アコーディオン開閉
      const header = row.querySelector('.timeline-year-header');
      header.addEventListener('click', () => {
        row.classList.toggle('open');
      });

      // サムネイル画像クリックで画像モーダル
      row.querySelectorAll('.timeline-anime-thumb').forEach(thumb => {
        thumb.style.cursor = 'zoom-in';
        thumb.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const card = thumb.closest('.timeline-anime-card');
          if (card && typeof window.openImageModal === 'function') {
            const title = card.getAttribute('data-anime-title') || '';
            const image = card.getAttribute('data-anime-image') || '';
            const id = card.getAttribute('data-anime-id') || '';
            window.openImageModal(title, image, id);
          }
        });
      });

      barsContainer.appendChild(row);
    });

    return;
  }

  // ==========================================
  // 【従来モード】5年ごとタイムライン
  // ==========================================
  const eraBuckets = timelineReport.eraBuckets || [];

  eraBuckets.forEach(era => {
    const row = document.createElement('div');
    row.className = 'timeline-era-row';

    let maxInEra = 1;
    users.forEach(u => {
      const c = yearsByUser[u]?.bucketCounts?.[era.id] || 0;
      if (c > maxInEra) maxInEra = c;
    });

    let barsHtml = '';
    users.forEach((u, uIdx) => {
      const count = yearsByUser[u]?.bucketCounts?.[era.id] || 0;
      const pct = Math.max(0, Math.min(100, (count / maxInEra) * 100));
      const color = colors[uIdx % colors.length];

      barsHtml += `
        <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.25rem;">
          <span style="font-size:0.78rem;width:90px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">@${escapeHtml(u)}</span>
          <div style="flex:1;background:var(--bg-primary);border-radius:4px;height:18px;overflow:hidden;border:1px solid var(--border-color);">
            <div style="width:${pct}%;background:${color};height:100%;border-radius:3px;transition:width 0.3s ease;"></div>
          </div>
          <span style="font-size:0.8rem;font-weight:700;width:40px;text-align:right;">${count}作</span>
        </div>
      `;
    });

    row.innerHTML = `
      <div class="era-label"><i class="fa-regular fa-calendar-check"></i> ${escapeHtml(era.label)}</div>
      <div style="background:var(--bg-secondary);padding:0.6rem 0.8rem;border-radius:var(--radius-sm);border:1px solid var(--border-color);">
        ${barsHtml}
      </div>
    `;

    barsContainer.appendChild(row);
  });
}

// 3. 制作スタジオ別視聴傾向の描画（クリックで作品リスト展開機能付き）
function renderStudios(studioReport) {
  const container = document.getElementById('labs-studio-cards');
  if (!container || !studioReport) return;
  container.innerHTML = '';

  const stats = studioReport.studioStatsByUser || {};
  Object.values(stats).forEach(userStat => {
    const card = document.createElement('div');
    card.className = 'studio-user-card';

    const rankings = userStat.rankings || [];
    let rankListHtml = '';

    if (rankings.length === 0) {
      rankListHtml = '<p class="text-muted" style="font-size:0.85rem;">該当する主要スタジオ作品がありません</p>';
    } else {
      rankings.slice(0, 5).forEach((st, idx) => {
        const drawerId = `studio-drawer-${escapeHtml(userStat.username)}-${idx}`;
        const animes = st.animes || [];

        // 作品グリッド生成
        const animesHtml = animes.map(a => {
          const thumbHtml = a.image
            ? `<img src="${escapeHtml(a.image)}" class="studio-anime-mini-thumb" alt="${escapeHtml(a.title)}" loading="lazy" decoding="async" onerror="this.outerHTML='<div class=\\'studio-anime-mini-thumb-empty\\'><i class=\\'fa-solid fa-film\\'></i></div>'" />`
            : `<div class="studio-anime-mini-thumb-empty"><i class="fa-solid fa-film"></i></div>`;

          return `
            <a href="${escapeHtml(a.url || `https://annict.com/works/${a.id}`)}" target="_blank" rel="noopener noreferrer" class="studio-anime-mini-card" title="${escapeHtml(a.title)} (Annictで見る)">
              ${thumbHtml}
              <span class="studio-anime-mini-title">${escapeHtml(a.title)}</span>
              ${a.season ? `<span class="studio-anime-mini-season"><i class="fa-regular fa-calendar"></i> ${escapeHtml(a.season)}</span>` : ''}
            </a>
          `;
        }).join('');

        rankListHtml += `
          <div class="studio-rank-group">
            <div class="studio-rank-item" data-drawer="${drawerId}" title="クリックして作品一覧を表示 / 閉じる">
              <div class="studio-rank-name">
                <span style="font-size:0.8rem;color:var(--text-muted);font-weight:700;width:18px;">#${idx + 1}</span>
                <span class="studio-color-dot" style="background-color: ${st.color};"></span>
                <span>${escapeHtml(st.name)}</span>
              </div>
              <div class="studio-rank-right">
                <span class="studio-rank-count">${st.count} 作品</span>
                <i class="fa-solid fa-chevron-down chevron"></i>
              </div>
            </div>
            <div id="${drawerId}" class="studio-animes-drawer">
              <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem;display:flex;justify-content:space-between;align-items:center;">
                <span><i class="fa-solid fa-layer-group"></i> 視聴作品 (${animes.length}件):</span>
                <span style="font-size:0.72rem;">※クリックでAnnict作品ページへ</span>
              </div>
              <div class="studio-animes-grid">
                ${animesHtml}
              </div>
            </div>
          </div>
        `;
      });
    }

    card.innerHTML = `
      <div class="calorie-user-header">
        <span class="calorie-user-name"><i class="fa-solid fa-user"></i> @${escapeHtml(userStat.username)}</span>
      </div>
      <div>
        <div class="studio-title-badge"><i class="fa-solid fa-award"></i> ${escapeHtml(userStat.studioTitle)}</div>
        <small class="text-muted" style="display:block;font-size:0.75rem;margin-top:-0.2rem;margin-bottom:0.4rem;">
          <i class="fa-solid fa-hand-pointer"></i> 各制作会社を押すと視聴作品一覧を確認できます
        </small>
      </div>
      <div class="studio-rank-list">
        ${rankListHtml}
      </div>
    `;

    // クリックイベントの登録（アコーディオン開閉）
    card.querySelectorAll('.studio-rank-item').forEach(item => {
      item.addEventListener('click', () => {
        const drawerId = item.getAttribute('data-drawer');
        const drawer = document.getElementById(drawerId);
        if (drawer) {
          const isOpen = drawer.classList.contains('open');
          drawer.classList.toggle('open', !isOpen);
          item.classList.toggle('active', !isOpen);
        }
      });
    });

    container.appendChild(card);
  });
}

// 4. ジャンル別視聴傾向の描画
function renderGenres(genreReport) {
  if (!genreReport) return;

  const userSummaryContainer = document.getElementById('labs-genre-user-summaries');
  const breakdownContainer = document.getElementById('labs-genre-breakdown-list');
  if (!userSummaryContainer || !breakdownContainer) return;

  userSummaryContainer.innerHTML = '';
  breakdownContainer.innerHTML = '';

  const statsByUser = genreReport.statsByUser || {};
  const genres = genreReport.genres || [];
  const users = Object.keys(statsByUser);

  const colors = ['#f43f5e', '#38bdf8', '#a855f7', '#fbbf24', '#34d399', '#ec4899'];

  // A. ユーザーごとのトップジャンルカード
  Object.values(statsByUser).forEach(uStat => {
    const card = document.createElement('div');
    card.className = 'genre-user-card';

    let topHtml = '';
    (uStat.topGenres || []).forEach((g, idx) => {
      topHtml += `
        <div class="genre-top-item">
          <div class="genre-top-item-left">
            <span class="genre-top-rank">#${idx + 1}</span>
            <span class="genre-badge-pill" style="background:${g.color}22;color:${g.color};border:1px solid ${g.color}44;" title="${escapeHtml(g.label)}">
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

  // B. ジャンル詳細比較リスト（アコーディオン）
  genres.forEach(g => {
    const card = document.createElement('div');
    card.className = 'genre-accordion-card';
    card.id = `genre-card-${g.id.replace(/[^a-zA-Z0-9]/g, '_')}`;

    // 各ユーザーの最大値を計算（バーの相対長用）
    let maxCountInGenre = 1;
    users.forEach(u => {
      const c = g.userCounts?.[u] || 0;
      if (c > maxCountInGenre) maxCountInGenre = c;
    });

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

    // アコーディオンの本文（各ユーザーの作品一覧）
    let userTabsHtml = '';
    let userAnimesGridsHtml = '';

    users.forEach((u, uIdx) => {
      const animes = g.animesByUser?.[u] || [];
      const isActive = uIdx === 0;

      userTabsHtml += `
        <button class="genre-tab-btn ${isActive ? 'active' : ''}" data-user="${escapeHtml(u)}">
          <i class="fa-solid fa-user"></i> @${escapeHtml(u)} (${animes.length}作)
        </button>
      `;

      let animeCardsHtml = '';
      if (animes.length === 0) {
        animeCardsHtml = '<p class="text-muted" style="font-size:0.85rem;grid-column:1/-1;">該当する作品はありません</p>';
      } else {
        animes.forEach(a => {
          const imgUrl = a.image || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="80" fill="%23334155"><rect width="60" height="80"/></svg>';
          animeCardsHtml += `
            <a href="${escapeHtml(a.url || '#')}" target="_blank" rel="noopener noreferrer" class="genre-anime-card">
              <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(a.title)}" class="genre-anime-thumb" loading="lazy" decoding="async" />
              <div class="genre-anime-info">
                <span class="genre-anime-title" title="${escapeHtml(a.title)}">${escapeHtml(a.title)}</span>
                <span class="genre-anime-season">${escapeHtml(a.season || '')}</span>
              </div>
            </a>
          `;
        });
      }

      userAnimesGridsHtml += `
        <div class="genre-animes-grid user-animes-${escapeHtml(u)}" style="display: ${isActive ? 'grid' : 'none'};">
          ${animeCardsHtml}
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
            <span class="genre-total-pill text-muted">計 ${g.totalWorksAcrossUsers} 作品</span>
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

    // 開閉イベント
    const header = card.querySelector('.genre-accordion-header');
    header.addEventListener('click', () => {
      card.classList.toggle('open');
    });

    // ユーザータブ切替イベント
    const tabBtns = card.querySelectorAll('.genre-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetUser = btn.dataset.user;
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

    breakdownContainer.appendChild(card);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
