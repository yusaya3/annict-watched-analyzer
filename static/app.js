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
    refreshAllUsers({ fromHeader: true });
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
const STORAGE_KEY_USERS = 'annict_saved_users_v2';

function saveUsersToStorage(users) {
  if (Array.isArray(users) && users.length > 0) {
    try {
      localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(users));
    } catch (e) {}
  }
}

function loadUsersFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_USERS);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch (e) {}
  return null;
}

// APIレスポンスの安全なJSONパース（Vercelタイムアウト時の非JSONエラー対策）
async function parseApiResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    if (res.status === 504 || text.includes('TIMEOUT') || text.includes('Timed Out')) {
      throw new Error('サーバーの処理制限時間（60秒）を超過しました。もう一度ボタンを押すと、キャッシュされた続きから高速に完了します。');
    }
    throw new Error(`サーバー通信エラー (HTTP ${res.status})`);
  }
}

// =========================================================================
// バックグラウンド非同期処理キュー（UIをブロックせず順番に即座に受け付ける）
// =========================================================================
const taskQueue = {
  tasks: [], // { id, type: 'add'|'delete', username, status: 'pending'|'running'|'done'|'error', errorMsg, stepMsg }
  isProcessing: false,

  enqueue(type, username) {
    const cleanUser = username.trim().replace(/^@/, '');
    if (!cleanUser) return;

    // すでに待機中・実行中の同一タスクがあれば重複追加しない
    const existing = this.tasks.find(t => t.type === type && t.username.toLowerCase() === cleanUser.toLowerCase() && (t.status === 'pending' || t.status === 'running'));
    if (existing) return;

    const task = {
      id: Date.now() + Math.random(),
      type,
      username: cleanUser,
      status: 'pending',
      stepMsg: '待機中...',
      errorMsg: null
    };

    this.tasks.push(task);
    renderModalUserList();
    this.processNext();
  },

  updateStatusText() {
    const statusText = document.getElementById('user-modal-status');
    const runningTask = this.tasks.find(t => t.status === 'running');
    const pendingCount = this.tasks.filter(t => t.status === 'pending').length;

    if (runningTask) {
      statusText.textContent = runningTask.stepMsg || `@${runningTask.username} のデータを取得・更新中...`;
      if (pendingCount > 0) {
        statusText.textContent += ` (他 ${pendingCount} 件待機中)`;
      }
    } else {
      statusText.textContent = '';
    }
  },

  async processNext() {
    if (this.isProcessing) return;
    const task = this.tasks.find(t => t.status === 'pending');
    if (!task) {
      this.updateStatusText();
      renderModalUserList();
      return;
    }

    this.isProcessing = true;
    task.status = 'running';
    task.stepMsg = `@${task.username} の処理を開始中...`;
    this.updateStatusText();
    renderModalUserList();

    try {
      if (task.type === 'add') {
        task.stepMsg = `@${task.username} の最新データをAnnictから取得中...`;
        this.updateStatusText();
        await executeAddUser(task.username, (msg) => {
          task.stepMsg = msg;
          this.updateStatusText();
        });
      } else if (task.type === 'delete') {
        task.stepMsg = `@${task.username} をサーバー同期中...`;
        this.updateStatusText();
        await executeDeleteUser(task.username);
      }

      task.status = 'done';
      task.stepMsg = '完了';
      // 成功したタスクは1.5秒後に自動消滅
      setTimeout(() => {
        this.tasks = this.tasks.filter(t => t.id !== task.id);
        renderModalUserList();
      }, 1500);

    } catch (err) {
      console.error(`タスクエラー [${task.type} @${task.username}]:`, err);
      task.status = 'error';
      task.errorMsg = err.message || '通信エラー';
    } finally {
      this.isProcessing = false;
      this.updateStatusText();
      renderModalUserList();
      // 次のタスクを順次実行
      this.processNext();
    }
  }
};

// 実際のユーザー追加通信処理（キューから順番に呼ばれる）
async function executeAddUser(username, onProgress) {
  const currentUsers = state.data?.users || loadUsersFromStorage() || [];

  let res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, currentUsers })
  });

  let result = await parseApiResponse(res);
  if (!res.ok) {
    throw new Error(result.error || 'ユーザーの追加・更新に失敗しました');
  }

  // 1回目の結果を画面とローカルに即時反映
  state.data = result.report;
  saveUsersToStorage(result.report.users);
  if (!state.selectedVennUsers.includes(username) && state.selectedVennUsers.length < 3) {
    state.selectedVennUsers.push(username);
  }

  renderAllComponents();
  renderModalUserList();

  // ジャンル照合の継続ステップ
  let step = 1;
  while (result.report && result.report.remainingGenres > 0 && step <= 5) {
    if (onProgress) {
      onProgress(`@${username} のジャンルデータを照合中... (残り ${result.report.remainingGenres} 作)`);
    }
    res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, currentUsers: state.data?.users || [], forceRefresh: false })
    });
    result = await parseApiResponse(res);
    if (!res.ok) break;

    state.data = result.report;
    saveUsersToStorage(result.report.users);
    renderAllComponents();
    step++;
  }
}

// 実際のユーザー削除通信処理（キューから順番に呼ばれる）
async function executeDeleteUser(username) {
  const currentUsers = state.data?.users || loadUsersFromStorage() || [];
  const query = currentUsers.length > 0 ? `?currentUsers=${encodeURIComponent(currentUsers.join(','))}` : '';

  const res = await fetch(`/api/users/${encodeURIComponent(username)}${query}`, {
    method: 'DELETE'
  });

  const result = await parseApiResponse(res);
  if (!res.ok) {
    throw new Error(result.error || 'サーバーでのユーザー削除に失敗しました');
  }

  state.data = result.report;
  saveUsersToStorage(result.report.users);
  renderAllComponents();
  renderModalUserList();
}

// UIからのユーザー追加要求（即座に入力クリア＆キューイングで次の操作へ）
function addUser(username) {
  const input = document.getElementById('new-username-input');
  if (input) input.value = '';

  // キューに追加（即時受付）
  taskQueue.enqueue('add', username);
}

// UIからのユーザー削除要求（即座に画面から消してキューイング：体感速度0秒！）
function deleteUser(username) {
  if (!confirm(`@${username} を比較対象から削除しますか？`)) return;

  // 1. 楽観的UI更新：UI上からその場ですぐに消す（待たせない！）
  if (state.data && Array.isArray(state.data.users)) {
    state.data.users = state.data.users.filter(u => u.toLowerCase() !== username.toLowerCase());
    saveUsersToStorage(state.data.users);
    state.selectedVennUsers = state.selectedVennUsers.filter(u => u.toLowerCase() !== username.toLowerCase());
    if (state.selectedVennUsers.length === 0 && state.data.users.length > 0) {
      state.selectedVennUsers = state.data.users.slice(0, 3);
    }
    renderAllComponents();
    renderModalUserList();
  }

  // 2. バックグラウンドキューでサーバーに非同期送信
  taskQueue.enqueue('delete', username);
}

// 全データ再取得
async function refreshAllUsers(options = {}) {
  const { fromHeader = false } = options;
  const loading = document.getElementById('user-modal-loading');
  const statusText = document.getElementById('user-modal-status');
  const btnReload = document.getElementById('btn-reload');
  const metaUpdated = document.getElementById('meta-updated');
  const origBtnHtml = btnReload ? btnReload.innerHTML : '';

  const users = state.data?.users || loadUsersFromStorage() || [];
  if (users.length === 0) {
    return loadData(true);
  }

  try {
    loading.style.display = 'flex';
    if (btnReload) {
      btnReload.disabled = true;
      btnReload.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i> <span>Annict最新取得中...</span>';
    }

    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      const msg = `@${u} の最新データをAnnictから取得中 (${i + 1}/${users.length})...`;
      statusText.textContent = msg;
      if (metaUpdated) metaUpdated.textContent = msg;

      let res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, currentUsers: users })
      });

      let result = await parseApiResponse(res);
      if (!res.ok) {
        throw new Error(result.error || `@${u} の再取得に失敗しました`);
      }

      state.data = result.report;
      saveUsersToStorage(result.report.users);
      renderAllComponents();
      renderModalUserList();

      let step = 1;
      while (result.report && result.report.remainingGenres > 0 && step <= 5) {
        const genreMsg = `@${u} のジャンルデータを追加照合中... (残り ${result.report.remainingGenres} 作品)`;
        statusText.textContent = genreMsg;
        if (metaUpdated) metaUpdated.textContent = genreMsg;

        res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u, currentUsers: users, forceRefresh: false })
        });
        result = await parseApiResponse(res);
        if (!res.ok) break;
        state.data = result.report;
        saveUsersToStorage(result.report.users);
        renderAllComponents();
        step++;
      }
    }

    if (!fromHeader) {
      alert('全ユーザーのAnnict最新データの同期が完了しました！');
    }

  } catch (err) {
    alert(`エラー: ${err.message}`);
  } finally {
    loading.style.display = 'none';
    if (btnReload) {
      btnReload.disabled = false;
      btnReload.innerHTML = origBtnHtml;
    }
    if (state.data && metaUpdated) {
      const date = new Date(state.data.generatedAt);
      metaUpdated.textContent = `更新: ${date.toLocaleString('ja-JP')}`;
    }
  }
}

// モーダル内のユーザーリスト描画（待機中・取得中タスクも即座に表示）
function renderModalUserList() {
  const list = document.getElementById('modal-user-list');
  if (!list) return;
  list.innerHTML = '';

  const users = state.data?.users || [];
  const queuedAddTasks = taskQueue.tasks.filter(t => t.type === 'add');

  if (users.length === 0 && queuedAddTasks.length === 0) {
    list.innerHTML = '<p class="text-muted">ユーザーが登録されていません</p>';
    return;
  }

  // 1. 登録済みユーザーのカード
  users.forEach(u => {
    const count = state.data.userWatchedLists?.[u]?.length || 0;
    const isDeleting = taskQueue.tasks.some(t => t.type === 'delete' && t.username.toLowerCase() === u.toLowerCase());

    const item = document.createElement('div');
    item.className = 'modal-user-item';
    if (isDeleting) {
      item.style.opacity = '0.5';
    }

    item.innerHTML = `
      <div class="modal-user-name">
        <i class="fa-solid fa-user"></i> @${escapeHtml(u)}
      </div>
      <div class="modal-user-meta">
        <span class="badge">${count} 作品</span>
        <button class="btn btn-secondary btn-sm btn-refresh-user" data-user="${escapeHtml(u)}" title="このユーザーの最新データをAnnictから再取得" style="padding:0.25rem 0.5rem;font-size:0.75rem;">
          <i class="fa-solid fa-rotate"></i> 更新
        </button>
        <button class="btn-danger-outline btn-delete-user" data-user="${escapeHtml(u)}" title="削除">
          <i class="fa-solid fa-trash"></i> 削除
        </button>
      </div>
    `;

    item.querySelector('.btn-refresh-user').addEventListener('click', () => {
      taskQueue.enqueue('add', u);
    });

    item.querySelector('.btn-delete-user').addEventListener('click', () => {
      deleteUser(u);
    });

    list.appendChild(item);
  });

  // 2. キュー内の追加タスクカード（取得中・待機中・エラー）
  queuedAddTasks.forEach(task => {
    // すでにusersに含まれている場合は表示不要
    if (users.some(u => u.toLowerCase() === task.username.toLowerCase()) && task.status === 'done') return;

    const item = document.createElement('div');
    item.className = 'modal-user-item';
    item.style.borderLeft = '3px solid var(--accent, #a855f7)';
    item.style.background = 'rgba(168, 85, 247, 0.06)';

    let badgeHtml = '';
    if (task.status === 'running') {
      badgeHtml = `<span class="badge" style="background:#a855f722;color:#c084fc;"><i class="fa-solid fa-spinner fa-spin"></i> 取得中...</span>`;
    } else if (task.status === 'pending') {
      badgeHtml = `<span class="badge" style="background:#64748b22;color:#94a3b8;"><i class="fa-solid fa-clock"></i> 待機中...</span>`;
    } else if (task.status === 'error') {
      badgeHtml = `<span class="badge" style="background:#ef444422;color:#f87171;" title="${escapeHtml(task.errorMsg)}"><i class="fa-solid fa-triangle-exclamation"></i> 失敗</span>`;
    } else if (task.status === 'done') {
      badgeHtml = `<span class="badge" style="background:#10b98122;color:#34d399;"><i class="fa-solid fa-check"></i> 完了</span>`;
    }

    item.innerHTML = `
      <div class="modal-user-name">
        <i class="fa-solid fa-user-plus text-purple"></i> @${escapeHtml(task.username)}
        <small class="text-muted" style="display:block;font-size:0.75rem;">${escapeHtml(task.stepMsg || '')}</small>
      </div>
      <div class="modal-user-meta">
        ${badgeHtml}
        ${task.status === 'error' ? `
          <button class="btn btn-secondary btn-sm btn-retry-task" style="padding:0.2rem 0.4rem;font-size:0.75rem;">
            <i class="fa-solid fa-rotate-right"></i> 再試行
          </button>
        ` : ''}
      </div>
    `;

    if (task.status === 'error') {
      item.querySelector('.btn-retry-task')?.addEventListener('click', () => {
        task.status = 'pending';
        taskQueue.processNext();
      });
    }

    list.appendChild(item);
  });
}

// データ読み込み（ブラウザ再起動時も削除・追加状態を100%確実に復元）
async function loadData(force = false) {
  try {
    const savedUsers = loadUsersFromStorage();
    const usersParam = savedUsers ? `users=${encodeURIComponent(savedUsers.join(','))}&` : '';

    let res = await fetch(`/api/analysis?${usersParam}t=${Date.now()}`);
    if (!res.ok) {
      res = await fetch(`./res/analysis.json?t=${Date.now()}`);
    }
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const data = await res.json();

    // ★重要: クライアント側の二重防御
    // もしローカルストレージにユーザーリストが保存されており、サーバーからそれ以外の不要なユーザー（削除済みユーザー等）が返ってきた場合は
    // クライアント側でも即座にsavedUsersのみにトリミングして、絶対に元の状態に戻らないようにする！
    if (savedUsers && savedUsers.length > 0 && Array.isArray(data.users)) {
      const lowerSaved = new Set(savedUsers.map(u => u.toLowerCase()));
      const needsFilter = data.users.some(u => !lowerSaved.has(u.toLowerCase()));
      if (needsFilter) {
        data.users = data.users.filter(u => lowerSaved.has(u.toLowerCase()));
        if (data.userSummary) {
          data.userSummary = data.userSummary.filter(s => lowerSaved.has(s.username.toLowerCase()));
        }
      }
    }

    state.data = data;
    if (Array.isArray(data.users) && data.users.length > 0) {
      saveUsersToStorage(data.users);
    }

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
