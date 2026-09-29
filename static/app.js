'use strict';

// 状態管理
const state = {
  data: null,
  selectedVennUsers: [],
  currentPanelAnimes: [],
  activeExclusiveUser: null,
  activeMissingUser: null
};

// 初期化
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initModals();
  loadData();

  document.getElementById('btn-reload').addEventListener('click', () => {
    loadData(true);
  });

  document.getElementById('detail-search').addEventListener('input', (e) => {
    filterDetailPanel(e.target.value);
  });

  document.getElementById('global-search-input').addEventListener('input', (e) => {
    handleGlobalSearch(e.target.value);
  });
});

// タブ制御
function initTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      const targetPane = document.getElementById(targetId);
      if (targetPane) {
        targetPane.classList.add('active');
        if (targetId === 'tab-venn') {
          renderVenn();
        } else if (targetId === 'tab-labs') {
          if (window.renderLabsTab && state.data) {
            window.renderLabsTab(state.data.labs, state.data);
          }
        }
      }
    });
  });
}

// モーダル初期化
function initModals() {
  const userModal = document.getElementById('user-modal');
  const btnOpenUserModal = document.getElementById('btn-open-user-modal');
  const btnCloseUserModal = document.getElementById('btn-close-user-modal');
  const btnDoneUserModal = document.getElementById('btn-done-user-modal');
  const btnAddUser = document.getElementById('btn-add-user');
  const newUsernameInput = document.getElementById('new-username-input');
  const btnRefreshAll = document.getElementById('btn-refresh-all');

  const imageModal = document.getElementById('image-modal');
  const btnCloseImageModal = document.getElementById('btn-close-image-modal');

  // ユーザー管理モーダル開閉
  btnOpenUserModal.addEventListener('click', () => {
    renderModalUserList();
    userModal.style.display = 'flex';
    newUsernameInput.focus();
  });

  const closeUserModal = () => {
    userModal.style.display = 'none';
  };
  btnCloseUserModal.addEventListener('click', closeUserModal);
  btnDoneUserModal.addEventListener('click', closeUserModal);

  // ユーザー追加
  btnAddUser.addEventListener('click', () => {
    const val = newUsernameInput.value.trim().replace(/^@/, '');
    if (!val) {
      alert('ユーザーIDを入力してください');
      return;
    }
    addUser(val);
  });

  newUsernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      btnAddUser.click();
    }
  });

  // 全データ再取得
  btnRefreshAll.addEventListener('click', () => {
    if (confirm('全ユーザーの視聴データをAnnictから再取得しますか？\n（作品数が多い場合は数十秒かかります）')) {
      refreshAllUsers();
    }
  });

  // 画像プレビューモーダル閉じる
  btnCloseImageModal.addEventListener('click', () => {
    imageModal.style.display = 'none';
  });

  // 背景クリックで閉じる
  userModal.addEventListener('click', (e) => {
    if (e.target === userModal) closeUserModal();
  });
  imageModal.addEventListener('click', (e) => {
    if (e.target === imageModal) imageModal.style.display = 'none';
  });
}

// ユーザー追加APIの呼び出し
async function addUser(username) {
  const loading = document.getElementById('user-modal-loading');
  const statusText = document.getElementById('user-modal-status');
  const btnAddUser = document.getElementById('btn-add-user');
  const input = document.getElementById('new-username-input');

  try {
    loading.style.display = 'flex';
    statusText.textContent = `@${username} の視聴データをAnnictから取得・分析中...`;
    btnAddUser.disabled = true;

    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });

    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || 'ユーザーの追加に失敗しました');
    }

    input.value = '';
    // 状態を更新
    state.data = result.report;
    if (!state.selectedVennUsers.includes(username) && state.selectedVennUsers.length < 3) {
      state.selectedVennUsers.push(username);
    }

    renderAllComponents();
    renderModalUserList();

  } catch (err) {
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      alert(`【Web公開版でのユーザー追加について】\nWeb公開版ではGitHub Actionsから安全に追加・再集計できます。\nGitHubリポジトリの「Actions」タブから「Update Annict Users」を実行してください。`);
    } else {
      alert(`エラー: ${err.message}`);
    }
  } finally {
    loading.style.display = 'none';
    btnAddUser.disabled = false;
  }
}

// ユーザー削除APIの呼び出し
async function deleteUser(username) {
  if (!confirm(`@${username} を比較対象から削除しますか？`)) return;

  const loading = document.getElementById('user-modal-loading');
  const statusText = document.getElementById('user-modal-status');

  try {
    loading.style.display = 'flex';
    statusText.textContent = `@${username} を削除し再集計中...`;

    const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
      method: 'DELETE'
    });

    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || 'ユーザーの削除に失敗しました');
    }

    state.data = result.report;
    state.selectedVennUsers = state.selectedVennUsers.filter(u => u !== username);
    if (state.selectedVennUsers.length === 0 && result.report.users.length > 0) {
      state.selectedVennUsers = result.report.users.slice(0, 3);
    }

    renderAllComponents();
    renderModalUserList();

  } catch (err) {
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      alert(`【Web公開版でのユーザー削除について】\nWeb公開版ではGitHub Actionsから安全に更新できます。\nGitHubリポジトリの「Actions」タブから「Update Annict Users」を実行してください。`);
    } else {
      alert(`エラー: ${err.message}`);
    }
  } finally {
    loading.style.display = 'none';
  }
}

// 全データ再取得
async function refreshAllUsers() {
  const loading = document.getElementById('user-modal-loading');
  const statusText = document.getElementById('user-modal-status');

  try {
    loading.style.display = 'flex';
    statusText.textContent = '全ユーザーの最新データを再取得中...';

    const res = await fetch('/api/refresh', {
      method: 'POST'
    });

    const result = await res.json();
    if (!res.ok) {
      throw new Error(result.error || '再取得に失敗しました');
    }

    state.data = result.report;
    renderAllComponents();
    renderModalUserList();
    alert('全データの最新同期が完了しました！');

  } catch (err) {
    alert(`エラー: ${err.message}`);
  } finally {
    loading.style.display = 'none';
  }
}

// モーダル内のユーザーリスト描画
function renderModalUserList() {
  const list = document.getElementById('modal-user-list');
  list.innerHTML = '';

  const users = state.data?.users || [];
  if (users.length === 0) {
    list.innerHTML = '<p class="text-muted">ユーザーが登録されていません</p>';
    return;
  }

  users.forEach(u => {
    const count = state.data.userWatchedLists[u]?.length || 0;
    const item = document.createElement('div');
    item.className = 'modal-user-item';
    item.innerHTML = `
      <div class="modal-user-name">
        <i class="fa-solid fa-user"></i> @${escapeHtml(u)}
      </div>
      <div class="modal-user-meta">
        <span class="badge">${count} 作品</span>
        <button class="btn-danger-outline btn-delete-user" data-user="${escapeHtml(u)}" title="削除">
          <i class="fa-solid fa-trash"></i> 削除
        </button>
      </div>
    `;

    item.querySelector('.btn-delete-user').addEventListener('click', () => {
      deleteUser(u);
    });

    list.appendChild(item);
  });
}

// データ読み込み
async function loadData(force = false) {
  try {
    const res = await fetch(`./res/analysis.json?t=${Date.now()}`);
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const data = await res.json();
    state.data = data;

    // ヘッダー情報
    const date = new Date(data.generatedAt);
    document.getElementById('meta-updated').textContent = `更新: ${date.toLocaleString('ja-JP')}`;

    // 初期のベン図対象ユーザー
    state.selectedVennUsers = (data.users || []).slice(0, 3);
    state.activeExclusiveUser = data.users[0] || null;
    state.activeMissingUser = data.users[0] || null;

    renderAllComponents();

  } catch (err) {
    console.error('データ読み込み失敗:', err);
    document.getElementById('meta-updated').textContent = 'データ読込エラー (npm start を実行してください)';
  }
}

// 全UIの再描画
function renderAllComponents() {
  if (!state.data) return;

  const date = new Date(state.data.generatedAt);
  document.getElementById('meta-updated').textContent = `更新: ${date.toLocaleString('ja-JP')}`;

  if (!state.activeExclusiveUser || !state.data.users.includes(state.activeExclusiveUser)) {
    state.activeExclusiveUser = state.data.users[0] || null;
  }
  if (!state.activeMissingUser || !state.data.users.includes(state.activeMissingUser)) {
    state.activeMissingUser = state.data.users[0] || null;
  }

  renderUserChips();
  renderVenn();
  renderSimilarity();
  renderInsights();
  handleGlobalSearch(document.getElementById('global-search-input').value);

  // お試し機能 (Labs) の描画（存在する場合のみ安全に実行）
  if (window.renderLabsTab && state.data) {
    window.renderLabsTab(state.data.labs, state.data);
  }
}

// ユーザー選択チップの生成 (ベン図用)
function renderUserChips() {
  const container = document.getElementById('venn-user-checkboxes');
  container.innerHTML = '';

  (state.data.users || []).forEach(username => {
    const count = state.data.userWatchedLists[username]?.length || 0;
    const chip = document.createElement('div');
    const isSelected = state.selectedVennUsers.includes(username);

    chip.className = `user-chip ${isSelected ? 'selected' : ''}`;
    chip.innerHTML = `
      <i class="fa-${isSelected ? 'solid fa-check' : 'regular fa-circle'}"></i>
      <span>@${username} (${count})</span>
    `;

    chip.addEventListener('click', () => {
      const idx = state.selectedVennUsers.indexOf(username);
      if (idx >= 0) {
        if (state.selectedVennUsers.length <= 1) {
          alert('最低1人のユーザーを選択してください');
          return;
        }
        state.selectedVennUsers.splice(idx, 1);
      } else {
        if (state.selectedVennUsers.length >= 3) {
          alert('ベン図の視認性を保つため、同時選択は最大3人までです');
          return;
        }
        state.selectedVennUsers.push(username);
      }
      renderUserChips();
      renderVenn();
    });

    container.appendChild(chip);
  });
}

// ベン図の描画 (Venn.js + D3.js)
function renderVenn() {
  const chartContainer = document.getElementById('venn-chart');
  const emptyMsg = document.getElementById('venn-empty-msg');
  chartContainer.innerHTML = '';

  const users = state.selectedVennUsers;
  if (!users || users.length === 0) {
    emptyMsg.style.display = 'block';
    return;
  }
  emptyMsg.style.display = 'none';

  const sets = generateSetsForUsers(users);

  if (typeof venn === 'undefined') {
    chartContainer.innerHTML = '<p class="text-muted">Venn.js ライブラリを読み込み中...</p>';
    return;
  }

  const chart = venn.VennDiagram()
    .width(550)
    .height(480);

  const div = d3.select('#venn-chart').datum(sets).call(chart);

  const colors = ['#f43f5e', '#38bdf8', '#a855f7'];

  div.selectAll('g')
    .each(function(d, i) {
      const node = d3.select(this);
      const isSingle = d.sets.length === 1;

      if (isSingle) {
        const uIdx = users.indexOf(d.sets[0]);
        const color = colors[uIdx % colors.length];
        node.select('path').style('fill', color);
      }

      node.on('click', () => {
        div.selectAll('g').classed('active', false);
        node.classed('active', true);

        const areaLabel = d.sets.map(u => `@${u}`).join(' & ');
        const isSingleUser = d.sets.length === 1;
        const title = isSingleUser ? `${areaLabel} の視聴作品` : `${areaLabel} の共通視聴作品`;
        updateDetailPanel(title, d.animes || []);
      });
    });

  const commonSet = sets.find(s => s.sets.length === users.length) || sets[0];
  if (commonSet) {
    const areaLabel = commonSet.sets.map(u => `@${u}`).join(' & ');
    const title = commonSet.sets.length > 1 ? `${areaLabel} の共通視聴作品` : `${areaLabel} の視聴作品`;
    updateDetailPanel(title, commonSet.animes || []);
  }
}

// 選択ユーザーに応じた集合リストを計算
function generateSetsForUsers(users) {
  const userLists = state.data.userWatchedLists;
  const userMaps = {};
  users.forEach(u => {
    userMaps[u] = new Map((userLists[u] || []).map(a => [String(a.id), a]));
  });

  const sets = [];
  const n = users.length;

  // 1人
  users.forEach(u => {
    sets.push({
      sets: [u],
      size: userLists[u]?.length || 0,
      label: `@${u} (${userLists[u]?.length || 0})`,
      animes: userLists[u] || []
    });
  });

  // 2人
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const u1 = users[i];
      const u2 = users[j];
      const animes = (userLists[u1] || []).filter(a => userMaps[u2].has(String(a.id)));
      sets.push({
        sets: [u1, u2],
        size: animes.length,
        animes
      });
    }
  }

  // 3人
  if (n === 3) {
    const u1 = users[0];
    const u2 = users[1];
    const u3 = users[2];
    const animes = (userLists[u1] || []).filter(a => userMaps[u2].has(String(a.id)) && userMaps[u3].has(String(a.id)));
    sets.push({
      sets: [u1, u2, u3],
      size: animes.length,
      animes
    });
  }

  return sets;
}

// 詳細パネルの更新
function updateDetailPanel(title, animes) {
  state.currentPanelAnimes = animes;
  document.getElementById('detail-title').innerHTML = `<i class="fa-solid fa-list-check"></i> ${title}`;
  document.getElementById('detail-badge').textContent = `${animes.length} 作品`;
  document.getElementById('detail-desc').textContent = `${animes.length} 件のアニメが該当します。クリックすると Annict の作品ページを開きます。`;
  document.getElementById('detail-search').value = '';

  renderAnimeListInPanel(animes);
}

// 詳細パネル内アニメカード描画
function renderAnimeListInPanel(animes) {
  const container = document.getElementById('detail-anime-list');
  container.innerHTML = '';

  if (!animes || animes.length === 0) {
    container.innerHTML = `
      <div class="empty-list-placeholder">
        <i class="fa-solid fa-folder-open"></i>
        <p>該当するアニメはありません</p>
      </div>
    `;
    return;
  }

  animes.forEach(anime => {
    const a = document.createElement('a');
    a.className = 'anime-item-card';
    a.href = anime.url || `https://annict.com/works/${anime.id}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';

    const thumbHtml = anime.image
      ? `<img src="${anime.image}" alt="${escapeHtml(anime.title)}" class="anime-thumb" loading="lazy" />`
      : `<div class="anime-no-thumb"><i class="fa-solid fa-film"></i></div>`;

    a.innerHTML = `
      ${thumbHtml}
      <div class="anime-info">
        <div class="anime-title" title="${escapeHtml(anime.title)}">${escapeHtml(anime.title)}</div>
        <div class="anime-meta">
          <span><i class="fa-solid fa-hashtag"></i> ID: ${anime.id}</span>
          ${anime.season ? `<span> • <i class="fa-regular fa-calendar"></i> ${escapeHtml(anime.season)}</span>` : ''}
        </div>
      </div>
    `;
    container.appendChild(a);
  });
}

function filterDetailPanel(keyword) {
  const q = keyword.trim().toLowerCase();
  if (!q) {
    renderAnimeListInPanel(state.currentPanelAnimes);
    return;
  }
  const filtered = state.currentPanelAnimes.filter(a =>
    a.title.toLowerCase().includes(q) || String(a.id).includes(q)
  );
  renderAnimeListInPanel(filtered);
}

// シンクロ率マトリクス描画
function renderSimilarity() {
  const users = state.data.users || [];
  const matrix = state.data.similarity?.matrix || [];
  const ranking = state.data.similarity?.ranking || [];

  const table = document.getElementById('similarity-table');
  table.innerHTML = '';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.innerHTML = '<th>ユーザー</th>' + users.map(u => `<th>@${escapeHtml(u)}</th>`).join('');
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  users.forEach(u1 => {
    const row = document.createElement('tr');
    row.innerHTML = `<th class="text-start">@${escapeHtml(u1)}</th>`;

    users.forEach(u2 => {
      const item = matrix.find(m => m.user1 === u1 && m.user2 === u2);
      const pct = item ? item.percentage : 0;
      const common = item ? item.intersection : 0;

      const alpha = Math.min(1, Math.max(0.1, pct / 80));
      const bg = u1 === u2 ? 'var(--bg-tertiary)' : `rgba(244, 63, 94, ${alpha})`;
      const text = u1 === u2 ? '100%' : `${pct}% <br><small style="font-size:0.75rem;opacity:0.8">(${common}作)</small>`;

      row.innerHTML += `
        <td class="heat-cell" style="background-color: ${bg};" title="@${escapeHtml(u1)} と @${escapeHtml(u2)}: 共通 ${common} 作品 / シンクロ率 ${pct}%">
          ${text}
        </td>
      `;
    });

    tbody.appendChild(row);
  });
  table.appendChild(tbody);

  const rankContainer = document.getElementById('ranking-list');
  rankContainer.innerHTML = '';

  if (ranking.length === 0) {
    rankContainer.innerHTML = '<p class="text-muted">比較対象が2人未満です</p>';
    return;
  }

  ranking.forEach((r, idx) => {
    const item = document.createElement('div');
    item.className = `ranking-item rank-${idx + 1}`;
    item.innerHTML = `
      <div class="rank-badge">${idx + 1}</div>
      <div class="rank-pair">@${escapeHtml(r.pair[0])} × @${escapeHtml(r.pair[1])}</div>
      <div class="rank-score">${r.percentage}% <small style="font-size:0.8rem;color:var(--text-muted)">(${r.intersection}作品)</small></div>
    `;
    rankContainer.appendChild(item);
  });
}

// インサイトタブ描画
function renderInsights() {
  const insights = state.data.insights || {};
  const users = state.data.users || [];

  // 1. 全員が見ているアニメ
  const allWatched = insights.watchedByAll || [];
  document.getElementById('badge-all-watched').textContent = `${allWatched.length} 作品`;
  renderAnimeGrid(document.getElementById('list-all-watched'), allWatched);

  // 2. この人だけが見ているアニメのセレクタ
  const exclusiveSel = document.getElementById('exclusive-user-selector');
  exclusiveSel.innerHTML = '';
  users.forEach(u => {
    const count = insights.exclusivePerUser?.[u]?.length || 0;
    const btn = document.createElement('button');
    btn.className = `chip-btn ${state.activeExclusiveUser === u ? 'active' : ''}`;
    btn.textContent = `@${u} (${count})`;
    btn.addEventListener('click', () => {
      state.activeExclusiveUser = u;
      renderInsights();
    });
    exclusiveSel.appendChild(btn);
  });

  const exclusiveList = (state.activeExclusiveUser && insights.exclusivePerUser?.[state.activeExclusiveUser]) || [];
  renderAnimeGrid(document.getElementById('list-exclusive'), exclusiveList);

  // 3. この人以外みんな見ているアニメのセレクタ
  const missingSel = document.getElementById('missing-user-selector');
  missingSel.innerHTML = '';
  users.forEach(u => {
    const count = insights.missingPerUser?.[u]?.length || 0;
    const btn = document.createElement('button');
    btn.className = `chip-btn ${state.activeMissingUser === u ? 'active' : ''}`;
    btn.textContent = `@${u} (${count})`;
    btn.addEventListener('click', () => {
      state.activeMissingUser = u;
      renderInsights();
    });
    missingSel.appendChild(btn);
  });

  const missingList = (state.activeMissingUser && insights.missingPerUser?.[state.activeMissingUser]) || [];
  renderAnimeGrid(document.getElementById('list-missing'), missingList);
}

// グリッド形式でアニメカード一覧を表示 (高画質対応)
function renderAnimeGrid(container, animes) {
  container.innerHTML = '';
  if (!animes || animes.length === 0) {
    container.innerHTML = '<div style="padding:1.5rem;color:var(--text-muted);grid-column: 1/-1;">該当する作品はありません</div>';
    return;
  }

  animes.forEach(anime => {
    const a = document.createElement('a');
    a.className = 'anime-grid-card';
    a.href = anime.url || `https://annict.com/works/${anime.id}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';

    const thumbHtml = anime.image
      ? `<img src="${anime.image}" alt="${escapeHtml(anime.title)}" class="grid-card-thumb" loading="lazy" />`
      : `<div class="grid-card-no-thumb"><i class="fa-solid fa-film"></i></div>`;

    a.innerHTML = `
      ${thumbHtml}
      <div class="grid-card-body">
        <div class="grid-card-title" title="${escapeHtml(anime.title)}">${escapeHtml(anime.title)}</div>
        <div class="grid-card-meta">
          ${anime.season ? `<i class="fa-regular fa-calendar"></i> ${escapeHtml(anime.season)}` : ''}
        </div>
      </div>
    `;

    // サムネイル画像クリックでプレビューを開く
    if (anime.image) {
      const imgEl = a.querySelector('.grid-card-thumb');
      imgEl.addEventListener('click', (e) => {
        e.preventDefault();
        openImageModal(anime.title, anime.image);
      });
    }

    container.appendChild(a);
  });
}

// 画像プレビューモーダル
function openImageModal(title, imageUrl) {
  const modal = document.getElementById('image-modal');
  const titleEl = document.getElementById('image-modal-title');
  const imgEl = document.getElementById('image-modal-img');

  titleEl.textContent = title;
  imgEl.src = imageUrl;
  imgEl.alt = title;
  modal.style.display = 'flex';
}

// 作品逆引き検索
function handleGlobalSearch(keyword) {
  const q = keyword.trim().toLowerCase();
  const container = document.getElementById('global-search-results');
  const countBadge = document.getElementById('search-count');
  container.innerHTML = '';

  if (!state.data) return;

  const users = state.data.users || [];
  const animeMap = new Map();

  users.forEach(u => {
    const list = state.data.userWatchedLists[u] || [];
    list.forEach(a => {
      if (!animeMap.has(String(a.id))) {
        animeMap.set(String(a.id), { anime: a, watchers: [] });
      }
      animeMap.get(String(a.id)).watchers.push(u);
    });
  });

  const allAnimes = Array.from(animeMap.values());
  const matches = q
    ? allAnimes.filter(item => item.anime.title.toLowerCase().includes(q) || String(item.anime.id).includes(q))
    : allAnimes.slice(0, 30);

  countBadge.textContent = `${matches.length} 件ヒット`;

  if (matches.length === 0) {
    container.innerHTML = '<div style="padding:1.5rem;color:var(--text-muted);grid-column: 1/-1;">見つかりませんでした</div>';
    return;
  }

  matches.forEach(({ anime, watchers }) => {
    const a = document.createElement('a');
    a.className = 'anime-grid-card';
    a.href = anime.url || `https://annict.com/works/${anime.id}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';

    const thumbHtml = anime.image
      ? `<img src="${anime.image}" alt="${escapeHtml(anime.title)}" class="grid-card-thumb" loading="lazy" />`
      : `<div class="grid-card-no-thumb"><i class="fa-solid fa-film"></i></div>`;

    const watchersHtml = watchers.map(w => `<span class="badge" style="margin-right:2px;">@${escapeHtml(w)}</span>`).join(' ');

    a.innerHTML = `
      ${thumbHtml}
      <div class="grid-card-body">
        <div class="grid-card-title" title="${escapeHtml(anime.title)}">${escapeHtml(anime.title)}</div>
        <div class="grid-card-meta" style="margin-top:0.5rem;">
          <div style="font-size:0.75rem;margin-bottom:0.2rem;color:var(--accent-blue);">視聴者:</div>
          <div>${watchersHtml}</div>
        </div>
      </div>
    `;

    if (anime.image) {
      const imgEl = a.querySelector('.grid-card-thumb');
      imgEl.addEventListener('click', (e) => {
        e.preventDefault();
        openImageModal(anime.title, anime.image);
      });
    }

    container.appendChild(a);
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
