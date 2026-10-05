'use strict';

// 状態管理
const state = {
  data: null,
  selectedVennUsers: [],
  currentPanelAnimes: [],
  activeExclusiveUser: null,
  activeMissingUser: null,
  // グループ分析用
  groupSelectedUsers: [],
  groupActiveSubtab: 'union', // 'union' または 'unwatched'
  groupSearchQuery: '',
  groupEraFilter: 'all',
  groupSort: 'watchers',
  popularWorks: []
};

// 初期化
document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initTabs();
  initModals();
  checkApiStatus();
  loadData();

  document.getElementById('btn-reload').addEventListener('click', () => {
    refreshAllUsers({ fromHeader: true });
    checkApiStatus();
  });

  document.getElementById('detail-search').addEventListener('input', (e) => {
    filterDetailPanel(e.target.value);
  });

  document.getElementById('global-search-input').addEventListener('input', (e) => {
    handleGlobalSearch(e.target.value);
  });

  initGroupAnalysis();
  loadPopularWorks();
});

// Annict API 接続状態の確認
async function checkApiStatus() {
  const statusEl = document.getElementById('api-status-text');
  if (!statusEl) return;
  try {
    const res = await fetch('/api/status');
    if (res.ok) {
      const json = await res.json();
      if (json.hasToken) {
        statusEl.innerHTML = '<i class="fa-solid fa-bolt" style="color:var(--accent-gold);"></i> <span>公式API: 接続中</span>';
        if (statusEl.parentElement) {
          statusEl.parentElement.title = 'Annict 公式 GraphQL API で高速取得しています';
        }
      } else {
        statusEl.innerHTML = '<i class="fa-solid fa-globe" style="color:var(--text-muted);"></i> <span>スクレイピング</span>';
        if (statusEl.parentElement) {
          statusEl.parentElement.title = 'Webスクレイピング方式で取得しています (ANNICT_TOKEN未設定)';
        }
      }
    }
  } catch (e) {
    statusEl.innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--accent-green);"></i> <span>稼働中</span>';
  }
}

// テーマ切り替え (ダーク / ライト)
function initThemeToggle() {
  const btn = document.getElementById('btn-theme-toggle');
  if (!btn) return;

  const updateIcon = (theme) => {
    if (theme === 'light') {
      btn.innerHTML = '<i class="fa-solid fa-moon"></i>';
      btn.title = 'ダークモードに切り替え';
      btn.setAttribute('aria-label', 'ダークモードに切り替え');
    } else {
      btn.innerHTML = '<i class="fa-solid fa-sun"></i>';
      btn.title = 'ライトモード（ホワイト）に切り替え';
      btn.setAttribute('aria-label', 'ライトモードに切り替え');
    }
  };

  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  updateIcon(currentTheme);

  btn.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const nextTheme = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    try {
      localStorage.setItem('annict_theme', nextTheme);
    } catch (e) {}
    updateIcon(nextTheme);

    // ベン図・シンクロ率・Labsの再描画
    if (typeof renderVenn === 'function' && state.data) {
      renderVenn();
    }
    if (typeof renderSimilarity === 'function' && state.data) {
      renderSimilarity();
    }
    if (window.renderLabsTab && state.data) {
      window.renderLabsTab(state.data.labs, state.data);
    }
  });
}

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
        } else if (targetId === 'tab-similarity') {
          renderSimilarity();
        } else if (targetId === 'tab-group') {
          renderGroupAnalysis();
        } else if (targetId === 'tab-insights') {
          renderInsights();
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

  const inputWrapper = document.querySelector('.input-box-wrapper');
  if (inputWrapper) {
    inputWrapper.addEventListener('click', () => {
      newUsernameInput.focus();
    });
  }

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

// IndexedDB によるクライアント側大容量分析データ永続化（コールドスタート巻き戻り完全防止）
const DB_NAME = 'AnnictAnalyzerDB';
const DB_VERSION = 1;
const STORE_NAME = 'reports';
const REPORT_KEY = 'latest_report';

function openIndexedDB() {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) return resolve(null);
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

async function saveReportToIndexedDB(report) {
  if (!report || !report.generatedAt) return;
  try {
    const db = await openIndexedDB();
    if (!db) return;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(report, REPORT_KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    console.warn('IndexedDB save error:', e);
  }
}

async function loadReportFromIndexedDB() {
  try {
    const db = await openIndexedDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(REPORT_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    console.warn('IndexedDB load error:', e);
    return null;
  }
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
  await saveReportToIndexedDB(result.report);
  if (!state.selectedVennUsers.includes(username) && state.selectedVennUsers.length < 3) {
    state.selectedVennUsers.push(username);
  }
  if (!state.groupSelectedUsers.includes(username)) {
    state.groupSelectedUsers.push(username);
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
    await saveReportToIndexedDB(result.report);
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
  await saveReportToIndexedDB(result.report);
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
      await saveReportToIndexedDB(result.report);
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
        await saveReportToIndexedDB(result.report);
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
        <span class="badge">${count}&nbsp;作品</span>
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

// データ読み込み（IndexedDBによるコールドスタート巻き戻り完全防御）
async function loadData(force = false) {
  try {
    const savedUsers = loadUsersFromStorage();
    const localReport = await loadReportFromIndexedDB();

    // 1. ローカルに最新レポートがあれば即座に初期描画（超高速表示＆巻き戻り防止）
    if (localReport && localReport.generatedAt && !force) {
      state.data = localReport;
      renderAllComponents();
    }

    const usersParam = savedUsers ? `users=${encodeURIComponent(savedUsers.join(','))}&` : '';

    let res = await fetch(`/api/analysis?${usersParam}t=${Date.now()}`);
    if (!res.ok) {
      res = await fetch(`./res/analysis.json?t=${Date.now()}`);
    }
    if (!res.ok) {
      if (localReport) return;
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const serverData = await res.json();

    // ★重要: コールドスタート巻き戻り検知と防御
    // サーバーから返ってきたデータの更新日時がローカル保存のものより古い場合、
    // サーバーが過去の固定ファイル（古いバンドル）を返していると判定し、ローカルの最新データを維持する！
    if (localReport && localReport.generatedAt && serverData && serverData.generatedAt && !force) {
      const localTime = new Date(localReport.generatedAt).getTime();
      const serverTime = new Date(serverData.generatedAt).getTime();
      if (localTime > serverTime) {
        console.log('[Cache] サーバーデータが過去ビルドに戻っているため、ローカルの最新データを維持します');
        state.data = localReport;
        renderAllComponents();
        return;
      }
    }

    // ★重要: クライアント側の二重防御
    // もしローカルストレージにユーザーリストが保存されており、サーバーからそれ以外の不要なユーザー（削除済みユーザー等）が返ってきた場合は
    // クライアント側でも即座にsavedUsersのみにトリミングして、絶対に元の状態に戻らないようにする！
    if (savedUsers && savedUsers.length > 0 && Array.isArray(serverData.users)) {
      const lowerSaved = new Set(savedUsers.map(u => u.toLowerCase()));
      const needsFilter = serverData.users.some(u => !lowerSaved.has(u.toLowerCase()));
      if (needsFilter) {
        serverData.users = serverData.users.filter(u => lowerSaved.has(u.toLowerCase()));
        if (serverData.userSummary) {
          serverData.userSummary = serverData.userSummary.filter(s => lowerSaved.has(s.username.toLowerCase()));
        }
      }
    }

    state.data = serverData;
    await saveReportToIndexedDB(serverData);
    if (Array.isArray(serverData.users) && serverData.users.length > 0) {
      saveUsersToStorage(serverData.users);
    }

    // 初期のベン図対象ユーザー
    if (state.selectedVennUsers.length === 0) {
      state.selectedVennUsers = (serverData.users || []).slice(0, 3);
    }
    if (!state.activeExclusiveUser) {
      state.activeExclusiveUser = serverData.users?.[0] || null;
    }
    if (!state.activeMissingUser) {
      state.activeMissingUser = serverData.users?.[0] || null;
    }

    renderAllComponents();

  } catch (err) {
    console.error('データ読み込み失敗:', err);
    if (!state.data) {
      document.getElementById('meta-updated').textContent = 'データ読込エラー (npm start を実行してください)';
    }
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
  renderGroupAnalysis();
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

  // 画面幅に応じたレスポンシブサイズ
  const isMobile = window.innerWidth <= 768;
  const chartWidth = isMobile ? Math.min(360, Math.max(280, window.innerWidth - 48)) : 550;
  const chartHeight = isMobile ? Math.round(chartWidth * 0.88) : 480;

  const chart = venn.VennDiagram()
    .width(chartWidth)
    .height(chartHeight);

  const div = d3.select('#venn-chart').datum(sets).call(chart);

  // SVGの完全レスポンシブ化（アスペクト比維持とスケーリング）
  d3.select('#venn-chart svg')
    .attr('viewBox', `0 0 ${chartWidth} ${chartHeight}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .style('width', '100%')
    .style('height', 'auto')
    .style('max-height', isMobile ? '350px' : '480px');

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

      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      const alpha = Math.min(1, Math.max(0.1, pct / 80));
      const bg = u1 === u2 ? 'var(--bg-tertiary)' : `rgba(244, 63, 94, ${alpha})`;
      const textColor = u1 === u2 ? 'inherit' : (isLight && alpha < 0.5 ? 'var(--text-main)' : '#ffffff');
      const text = u1 === u2 ? '100%' : `${pct}% <br><small style="font-size:0.75rem;opacity:0.85">(${common}作)</small>`;

      row.innerHTML += `
        <td class="heat-cell" style="background-color: ${bg}; color: ${textColor};" title="@${escapeHtml(u1)} と @${escapeHtml(u2)}: 共通 ${common} 作品 / シンクロ率 ${pct}%">
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

// ==========================================================================
// グループ分析（和集合 & 誰も見ていない人気作品300選）機能
// ==========================================================================

async function loadPopularWorks() {
  if (state.popularWorks && state.popularWorks.length > 0) return;
  try {
    let res = await fetch(`./res/popular_works.json?t=${Date.now()}`);
    if (!res.ok) {
      res = await fetch(`/res/popular_works.json`);
    }
    if (res.ok) {
      const json = await res.json();
      state.popularWorks = json.works || [];
      console.log(`[Group] Annict人気作品リストを読み込みました (${state.popularWorks.length}作品)`);
      if (state.data) {
        renderGroupWorksList();
      }
    }
  } catch (e) {
    console.warn('[Group] popular_works.json の取得エラー:', e.message);
  }
}

function initGroupAnalysis() {
  // 1. サブタブ切り替え
  const subtabBtns = document.querySelectorAll('.group-subtab-btn');
  subtabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      subtabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.groupActiveSubtab = btn.dataset.subtab;

      const descEl = document.getElementById('group-subtab-desc');
      const sortSelect = document.getElementById('group-sort-select');
      if (state.groupActiveSubtab === 'union') {
        descEl.textContent = '選択したユーザーのうち「誰か1人以上が見ている作品」の全一覧です。';
        if (sortSelect) {
          sortSelect.innerHTML = `
            <option value="watchers">視聴人数が多い順</option>
            <option value="season-desc">公開年が新しい順</option>
            <option value="season-asc">公開年が古い順</option>
            <option value="title">タイトル順</option>
          `;
          sortSelect.value = state.groupSort = 'watchers';
        }
      } else {
        descEl.textContent = 'Annictの人気ランキング順をもとに、選択したユーザーが「誰も見ていない」人気作品TOP300です。';
        if (sortSelect) {
          sortSelect.innerHTML = `
            <option value="watchers">Annict人気ランキング順</option>
            <option value="season-desc">公開年が新しい順</option>
            <option value="season-asc">公開年が古い順</option>
            <option value="title">タイトル順</option>
          `;
          sortSelect.value = state.groupSort = 'watchers';
        }
      }

      renderGroupWorksList();
    });
  });

  // 2. 全選択 / 全解除
  const btnSelectAll = document.getElementById('btn-group-select-all');
  const btnDeselectAll = document.getElementById('btn-group-deselect-all');
  if (btnSelectAll) {
    btnSelectAll.addEventListener('click', () => {
      if (!state.data || !state.data.users) return;
      state.groupSelectedUsers = [...state.data.users];
      renderGroupUserCheckboxes();
      renderGroupWorksList();
    });
  }
  if (btnDeselectAll) {
    btnDeselectAll.addEventListener('click', () => {
      state.groupSelectedUsers = [];
      renderGroupUserCheckboxes();
      renderGroupWorksList();
    });
  }

  // 3. タイトル検索入力
  const searchInput = document.getElementById('group-search-input');
  const clearBtn = document.getElementById('btn-group-clear-search');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      state.groupSearchQuery = e.target.value.trim().toLowerCase();
      if (clearBtn) {
        clearBtn.style.display = state.groupSearchQuery ? 'block' : 'none';
      }
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        renderGroupWorksList();
      }, 120);
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        state.groupSearchQuery = '';
        clearBtn.style.display = 'none';
        renderGroupWorksList();
        searchInput.focus();
      }
    });
  }

  // 4. 年代フィルター
  const eraFilterContainer = document.getElementById('group-era-filters');
  if (eraFilterContainer) {
    eraFilterContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip-btn');
      if (!chip) return;
      eraFilterContainer.querySelectorAll('.chip-btn').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.groupEraFilter = chip.dataset.era || 'all';
      renderGroupWorksList();
    });
  }

  // 5. 並び替えソート
  const sortSelect = document.getElementById('group-sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      state.groupSort = e.target.value;
      renderGroupWorksList();
    });
  }
}

// グループ分析タブ全体の描画更新
function renderGroupAnalysis() {
  if (!state.data || !Array.isArray(state.data.users)) return;

  // 初期化: 初回のみ全ユーザーを選択状態にする
  if (!state.groupSelectedUsers || state.groupSelectedUsers.length === 0) {
    state.groupSelectedUsers = [...state.data.users];
  } else {
    // 削除されたユーザーを安全に除外
    state.groupSelectedUsers = state.groupSelectedUsers.filter(u => state.data.users.includes(u));
  }

  renderGroupUserCheckboxes();
  renderGroupWorksList();
}

// ユーザー選択チェックボックスの描画
function renderGroupUserCheckboxes() {
  const container = document.getElementById('group-user-checkboxes');
  const summaryEl = document.getElementById('group-selected-summary');
  if (!container || !state.data) return;

  const allUsers = state.data.users || [];
  const selectedSet = new Set(state.groupSelectedUsers);

  if (summaryEl) {
    summaryEl.textContent = `(全${allUsers.length}人中 ${selectedSet.size}人選択中)`;
  }

  container.innerHTML = '';
  allUsers.forEach(username => {
    const isChecked = selectedSet.has(username);
    const count = state.data.userWatchedLists?.[username]?.length || 0;

    const label = document.createElement('label');
    label.className = `chip-checkbox ${isChecked ? 'checked' : ''}`;
    label.title = `@${username} (${count}作品)`;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = isChecked;
    input.value = username;

    input.addEventListener('change', () => {
      if (input.checked) {
        if (!state.groupSelectedUsers.includes(username)) {
          state.groupSelectedUsers.push(username);
        }
      } else {
        state.groupSelectedUsers = state.groupSelectedUsers.filter(u => u !== username);
      }
      renderGroupUserCheckboxes();
      renderGroupWorksList();
    });

    label.appendChild(input);
    label.appendChild(document.createTextNode(`@${username} (${count})`));
    container.appendChild(label);
  });
}

// 作品リストの計算・抽出・描画
function renderGroupWorksList() {
  const gridContainer = document.getElementById('group-works-grid');
  const unionBadge = document.getElementById('badge-group-union-count');
  const unwatchedBadge = document.getElementById('badge-group-unwatched-count');
  const resultsMetaText = document.getElementById('group-results-count-text');
  if (!gridContainer || !state.data) return;

  const selectedUsers = state.groupSelectedUsers || [];
  const userWatchedLists = state.data.userWatchedLists || {};

  // 1. 和集合（誰か1人以上が見ている作品）の集計
  // Map<workId, { work, watchers: string[] }>
  const unionMap = new Map();
  selectedUsers.forEach(u => {
    const animes = userWatchedLists[u] || [];
    animes.forEach(a => {
      const id = String(a.id);
      if (!unionMap.has(id)) {
        unionMap.set(id, {
          work: a,
          watchers: [u]
        });
      } else {
        const item = unionMap.get(id);
        if (!item.watchers.includes(u)) {
          item.watchers.push(u);
        }
      }
    });
  });

  const unionTotalCount = unionMap.size;
  if (unionBadge) unionBadge.textContent = `${unionTotalCount.toLocaleString()} 作品`;

  // 2. 誰も見ていない人気作品（300選）の抽出
  // 選択されたユーザー全員の全視聴作品ID Set
  const unionWatchedIdSet = new Set(unionMap.keys());
  const unwatched300List = [];
  const popularList = state.popularWorks || [];

  if (popularList.length > 0) {
    for (let i = 0; i < popularList.length; i++) {
      const pw = popularList[i];
      const id = String(pw.id);
      if (!unionWatchedIdSet.has(id)) {
        unwatched300List.push({
          work: pw,
          popularRank: i + 1
        });
        if (unwatched300List.length >= 300) {
          break;
        }
      }
    }
  }

  const unwatchedTotalCount = unwatched300List.length;
  if (unwatchedBadge) unwatchedBadge.textContent = `${unwatchedTotalCount.toLocaleString()} 作品`;

  // 3. 現在アクティブなサブタブに応じて表示対象を決定
  const isUnion = state.groupActiveSubtab === 'union';
  let targetItems = [];

  if (selectedUsers.length === 0) {
    gridContainer.innerHTML = '<div style="padding:2.5rem 1rem;color:var(--text-muted);grid-column:1/-1;text-align:center;"><i class="fa-solid fa-user-xmark" style="font-size:1.8rem;margin-bottom:0.8rem;display:block;"></i>対象ユーザーを1人以上選択してください</div>';
    if (resultsMetaText) resultsMetaText.textContent = '表示中: 0 件';
    return;
  }

  if (isUnion) {
    targetItems = Array.from(unionMap.values());
  } else {
    targetItems = unwatched300List;
  }

  // 4. 絞り込み（検索キーワード & 年代フィルター）
  const query = state.groupSearchQuery;
  const era = state.groupEraFilter;

  let filtered = targetItems.filter(item => {
    const work = item.work;
    // タイトル検索
    if (query && !work.title.toLowerCase().includes(query)) {
      return false;
    }
    // 年代フィルター
    if (era && era !== 'all') {
      if (!matchWorkEra(work.season, era)) {
        return false;
      }
    }
    return true;
  });

  // 5. 並び替え（ソート）
  const sortMode = state.groupSort;
  filtered.sort((a, b) => {
    if (isUnion) {
      if (sortMode === 'watchers') {
        const diff = b.watchers.length - a.watchers.length;
        if (diff !== 0) return diff;
      }
    } else {
      // 未視聴作品の初期ソートはAnnict人気順
      if (sortMode === 'watchers') {
        return a.popularRank - b.popularRank;
      }
    }

    if (sortMode === 'season-desc') {
      return compareSeason(b.work.season, a.work.season);
    } else if (sortMode === 'season-asc') {
      return compareSeason(a.work.season, b.work.season);
    } else if (sortMode === 'title') {
      return a.work.title.localeCompare(b.work.title, 'ja');
    }
    return 0;
  });

  // 6. メタ情報テキストの更新
  if (resultsMetaText) {
    resultsMetaText.textContent = `表示中: ${filtered.length.toLocaleString()} 件 / 全 ${targetItems.length.toLocaleString()} 件`;
  }

  // 7. カードグリッドの描画（全件一括高速レンダリング）
  if (filtered.length === 0) {
    gridContainer.innerHTML = '<div style="padding:2.5rem 1rem;color:var(--text-muted);grid-column:1/-1;text-align:center;"><i class="fa-solid fa-film" style="font-size:1.8rem;margin-bottom:0.8rem;display:block;"></i>条件に一致する作品はありません</div>';
    return;
  }

  // 和集合・未視聴ともに制限なく全作品を描画
  const cardsHtml = filtered.map(item => {
    const work = item.work;
    const url = work.url || `https://annict.com/works/${work.id}`;
    const safeTitle = escapeHtml(work.title);

    const thumbHtml = work.image
      ? `<img src="${work.image}" alt="${safeTitle}" data-title="${safeTitle}" class="grid-card-thumb" loading="lazy" />`
      : `<div class="grid-card-no-thumb"><i class="fa-solid fa-film"></i></div>`;

    if (isUnion) {
      // 和集合: 視聴者バッジと視聴者数タグ
      const watchers = item.watchers || [];
      const userBadgesHtml = watchers.map(u => `<span class="watched-user-badge">@${escapeHtml(u)}</span>`).join('');
      const seasonHtml = work.season
        ? `<span><i class="fa-regular fa-calendar"></i> ${escapeHtml(work.season)}</span>`
        : `<span style="visibility:hidden;pointer-events:none;"><i class="fa-regular fa-calendar"></i> 年代未設定</span>`;

      return `
        <a class="anime-grid-card" href="${url}" target="_blank" rel="noopener noreferrer">
          ${thumbHtml}
          <div class="grid-card-body">
            <div class="grid-card-title" title="${safeTitle}">${safeTitle}</div>
            <div class="grid-card-meta">
              ${seasonHtml}
              <span class="watched-count-tag"><i class="fa-solid fa-users"></i> ${watchers.length}人視聴</span>
            </div>
            <div class="watched-users-badge-list">
              ${userBadgesHtml}
            </div>
          </div>
        </a>
      `;
    } else {
      // 未視聴作品: シンプルに作品情報のみ（タイトル・画像・シーズン）
      const seasonHtml = work.season
        ? `<span><i class="fa-regular fa-calendar"></i> ${escapeHtml(work.season)}</span>`
        : `<span class="text-muted small">シーズン未設定</span>`;

      return `
        <a class="anime-grid-card" href="${url}" target="_blank" rel="noopener noreferrer">
          ${thumbHtml}
          <div class="grid-card-body">
            <div class="grid-card-title" title="${safeTitle}">${safeTitle}</div>
            <div class="grid-card-meta">
              ${seasonHtml}
            </div>
          </div>
        </a>
      `;
    }
  }).join('');

  gridContainer.innerHTML = cardsHtml;

  // 親コンテナへのイベント委譲で画像プレビューモーダルを開く（高速・省メモリ）
  gridContainer.onclick = (e) => {
    const thumb = e.target.closest('.grid-card-thumb');
    if (thumb) {
      e.preventDefault();
      e.stopPropagation();
      const title = thumb.getAttribute('data-title') || thumb.alt;
      const src = thumb.src;
      openImageModal(title, src);
    }
  };
}

// 年代判定ヘルパー
function matchWorkEra(seasonStr, era) {
  if (!seasonStr) {
    return era === 'classic'; // シーズン不明・古い作品はclassicに分類
  }
  const m = seasonStr.match(/(\d{4})年/);
  if (!m) return era === 'classic';
  const year = parseInt(m[1], 10);
  if (era === '2020s') return year >= 2020 && year <= 2029;
  if (era === '2010s') return year >= 2010 && year <= 2019;
  if (era === '2000s') return year >= 2000 && year <= 2009;
  if (era === 'classic') return year < 2000;
  return true;
}

// シーズン文字列の比較ヘルパー (例: "2024年春" vs "2018年秋")
function compareSeason(aStr, bStr) {
  const getWeight = (s) => {
    if (!s) return 0;
    const m = s.match(/(\d{4})年?(冬|春|夏|秋)?/);
    if (!m) return 0;
    const year = parseInt(m[1], 10) || 0;
    const sMap = { '冬': 1, '春': 2, '夏': 3, '秋': 4 };
    const seasonWeight = sMap[m[2]] || 0;
    return year * 10 + seasonWeight;
  };
  return getWeight(aStr) - getWeight(bStr);
}

