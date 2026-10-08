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
  popularWorks: [],
  genreMap: {}
};

if (typeof window !== 'undefined') {
  window.state = state;
}

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
  loadWorkGenres();
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
      if (btn.classList.contains('active')) return;

      // 1. タブボタンのアクティブ状態を即座に更新（即時フィードバック）
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetId = btn.getAttribute('data-tab');

      // 2. ブラウザがタブボタンの赤色再描画を即座に完了できるよう、
      // ペインの切り替えを requestAnimationFrame で次フレームに渡す
      requestAnimationFrame(() => {
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        const targetPane = document.getElementById(targetId);
        if (targetPane) {
          targetPane.classList.add('active');
        }

        // 3. Venn図のSVGがまだ未描画の場合（フォールバック）のみ描画
        if (targetId === 'tab-venn') {
          const svg = document.querySelector('#venn-chart svg');
          if (!svg && state.data && state.selectedVennUsers.length >= 2) {
            renderVenn();
          }
        }

        if (targetId === 'tab-similarity-search') {
          if (typeof window.initSimilaritySearchTab === 'function') {
            window.initSimilaritySearchTab();
          }
        }

        if (targetId === 'tab-episode-similarity') {
          if (typeof window.initEpisodeSimilarityTab === 'function') {
            window.initEpisodeSimilarityTab();
          }
        }
      });
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

// =========================================================================
// 【提案2: Local-First】IndexedDB ブラウザ永続化データストア (v2)
// =========================================================================
const DB_NAME = 'AnnictAnalyzerDB';
const DB_VERSION = 2; // v2: reports, work_genres, user_watches
const STORE_REPORTS = 'reports';
const STORE_GENRES = 'work_genres';
const STORE_USER_WATCHES = 'user_watches';
const REPORT_KEY = 'latest_report';
const GENRES_KEY = 'all_work_genres';

function openIndexedDB() {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) return resolve(null);
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_REPORTS)) {
          db.createObjectStore(STORE_REPORTS);
        }
        if (!db.objectStoreNames.contains(STORE_GENRES)) {
          db.createObjectStore(STORE_GENRES);
        }
        if (!db.objectStoreNames.contains(STORE_USER_WATCHES)) {
          db.createObjectStore(STORE_USER_WATCHES);
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

// レポート全体の保存・取得
async function saveReportToIndexedDB(report) {
  if (!report || !report.generatedAt) return;
  try {
    const db = await openIndexedDB();
    if (!db) return;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_REPORTS, 'readwrite');
      tx.objectStore(STORE_REPORTS).put(report, REPORT_KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    console.warn('IndexedDB saveReport error:', e);
  }
}

async function loadReportFromIndexedDB() {
  try {
    const db = await openIndexedDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_REPORTS, 'readonly');
      const req = tx.objectStore(STORE_REPORTS).get(REPORT_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    console.warn('IndexedDB loadReport error:', e);
    return null;
  }
}

// 作品ジャンル辞書（2,500作＋新規作）の保存・取得
async function saveWorkGenresToIndexedDB(genreMap) {
  if (!genreMap || typeof genreMap !== 'object') return;
  try {
    const db = await openIndexedDB();
    if (!db) return;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_GENRES, 'readwrite');
      tx.objectStore(STORE_GENRES).put(genreMap, GENRES_KEY);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    console.warn('IndexedDB saveGenres error:', e);
  }
}

async function loadWorkGenresFromIndexedDB() {
  try {
    const db = await openIndexedDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_GENRES, 'readonly');
      const req = tx.objectStore(STORE_GENRES).get(GENRES_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    console.warn('IndexedDB loadGenres error:', e);
    return null;
  }
}

// ユーザーごとの視聴作品リストの保存・取得・削除
async function saveUserWatchedToIndexedDB(username, animes) {
  if (!username || !Array.isArray(animes)) return;
  try {
    const db = await openIndexedDB();
    if (!db) return;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_USER_WATCHES, 'readwrite');
      tx.objectStore(STORE_USER_WATCHES).put(animes, username.toLowerCase());
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    console.warn('IndexedDB saveUserWatched error:', e);
  }
}

async function loadAllUserWatchesFromIndexedDB() {
  try {
    const db = await openIndexedDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_USER_WATCHES, 'readonly');
      const store = tx.objectStore(STORE_USER_WATCHES);
      const req = store.openCursor();
      const result = {};
      let count = 0;
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          result[cursor.key] = cursor.value;
          count++;
          cursor.continue();
        } else {
          resolve(count > 0 ? result : null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    console.warn('IndexedDB loadAllUserWatches error:', e);
    return null;
  }
}

async function deleteUserWatchedFromIndexedDB(username) {
  if (!username) return;
  try {
    const db = await openIndexedDB();
    if (!db) return;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_USER_WATCHES, 'readwrite');
      tx.objectStore(STORE_USER_WATCHES).delete(username.toLowerCase());
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (e) {
    console.warn('IndexedDB deleteUserWatched error:', e);
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

// =========================================================================
// 【新方式】ブラウザ内リアルタイム集計エンジン連携
// =========================================================================

// ブラウザ内で0.05秒で全集計（ベン図、シンクロ率、インサイト、カロリー、年代、ジャンル）を実行し即時再描画
function recalculateClientReport() {
  if (!window.ClientAnalyzer || !state.data || !state.data.userWatchedLists) return;
  const analyzer = new window.ClientAnalyzer(state.data.userWatchedLists);
  const newReport = analyzer.buildFullReport(state.data.labs, state.genreMap);
  state.data = newReport;
  saveUsersToStorage(newReport.users);
  saveReportToIndexedDB(newReport);
  renderAllComponents();
  renderModalUserList();
}

// 全作品の軽量ジャンル辞書をロード（IndexedDB優先 → 静的JSON → API）
async function loadWorkGenres() {
  try {
    // 1. まずIndexedDB（手元）から瞬時に取得
    const cachedMap = await loadWorkGenresFromIndexedDB();
    if (cachedMap && Object.keys(cachedMap).length > 0) {
      if (!state.genreMap) state.genreMap = {};
      Object.assign(state.genreMap, cachedMap);
      console.log(`[Local-First] IndexedDBから作品辞書をロード (${Object.keys(cachedMap).length}作品)`);
      return;
    }

    // 2. なければ静的ファイル (./res/work-genres.json) または API (/api/work-genres) から取得
    let res = await fetch('./res/work-genres.json');
    if (!res.ok) {
      res = await fetch('/api/work-genres');
    }
    if (res.ok) {
      const map = await res.json();
      if (!state.genreMap) state.genreMap = {};
      Object.assign(state.genreMap, map);
      // 手元のIndexedDBにキャッシュ保存！
      await saveWorkGenresToIndexedDB(state.genreMap);
      console.log(`[Local-First] 作品辞書を初期取得＆IndexedDBへ保存 (${Object.keys(map).length}作品)`);
      if (state.data && state.data.userWatchedLists) {
        recalculateClientReport();
      }
    }
  } catch (e) {
    console.warn('[Genre] ジャンル辞書ロードエラー (スキップ):', e.message);
  }
}

// 1人の最新視聴データのみをAnnictから取得する超軽量通信関数（所要時間1〜2秒、数十KB）
async function fetchUserWatched(username) {
  const res = await fetch(`/api/user-watched/${encodeURIComponent(username)}?force=true`);
  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson.error) errorMsg = errJson.error;
    } catch (e) {}
    throw new Error(`@${username} のデータ取得に失敗しました (${errorMsg})`);
  }
  return await res.json();
}

// 実際のユーザー追加・個別更新通信処理（手元のIndexedDBに保存＆ブラウザで一瞬で再集計！）
async function executeAddUser(username, onProgress) {
  if (onProgress) onProgress(`@${username} の最新データをAnnictから取得中...`);

  // 1人分の視聴データと新規作品のジャンル分類を取得
  const result = await fetchUserWatched(username);

  if (!state.data) state.data = { users: [], userWatchedLists: {} };
  if (!state.data.userWatchedLists) state.data.userWatchedLists = {};

  const animes = result.animes || [];
  state.data.userWatchedLists[username] = animes;

  // 手元のIndexedDBにこのユーザーの視聴データを永続保存！
  await saveUserWatchedToIndexedDB(username, animes);

  // 新規作品のジャンル分類結果を手元のstate.genreMapにマージし、IndexedDBにも追記保存！
  if (result.workGenres && typeof result.workGenres === 'object') {
    if (!state.genreMap) state.genreMap = {};
    Object.assign(state.genreMap, result.workGenres);
    await saveWorkGenresToIndexedDB(state.genreMap);
  }

  // もし辞書にもAniList照合結果にも含まれなかった未登録作品があれば、ブラウザ直接照合フォールバックで救済
  if (window.fetchAniListMediaInBrowser && window.classifyAnimeScored) {
    const unmapped = animes.filter(a => a && a.title && !state.genreMap[a.title]);
    if (unmapped.length > 0) {
      if (onProgress) onProgress(`未登録作品(${unmapped.length}件)をAniListから直接照合中...`);
      for (const a of unmapped.slice(0, 8)) {
        try {
          const media = await window.fetchAniListMediaInBrowser(a.title);
          if (media) {
            const cat = window.classifyAnimeScored(media.genres, media.tags, a.title);
            state.genreMap[a.title] = { c: cat, g: media.genres };
          }
        } catch (e) {}
      }
      await saveWorkGenresToIndexedDB(state.genreMap);
    }
  }

  if (!Array.isArray(state.data.users)) state.data.users = [];
  if (!state.data.users.some(u => u.toLowerCase() === username.toLowerCase())) {
    state.data.users.push(username);
  }

  if (!state.selectedVennUsers.includes(username) && state.selectedVennUsers.length < 3) {
    state.selectedVennUsers.push(username);
  }
  if (!state.groupSelectedUsers.includes(username)) {
    state.groupSelectedUsers.push(username);
  }

  // ブラウザ内で一瞬（0.05秒）で全ジャンル・全指標を再集計＆IndexedDB保存＆画面再描画！
  recalculateClientReport();
}

// 実際のユーザー削除通信処理（ブラウザ手元のIndexedDBから削除＆即座に再集計＆サーバー通知）
async function executeDeleteUser(username) {
  if (state.data?.userWatchedLists) {
    delete state.data.userWatchedLists[username];
  }
  if (state.data?.users) {
    state.data.users = state.data.users.filter(u => u.toLowerCase() !== username.toLowerCase());
  }

  // 手元のIndexedDBからも削除！
  await deleteUserWatchedFromIndexedDB(username);

  // 即座にブラウザ内で再集計＆画面更新
  recalculateClientReport();

  // サーバーのリストも非同期で削除同期（背景で実行、ユーザーを待たせない）
  fetch(`/api/users/${encodeURIComponent(username)}`, { method: 'DELETE' }).catch(() => {});
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

// 【新方式】全データ再取得（1人ずつ順番に軽量差分取得し、ブラウザでリアルタイム再集計）
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
      btnReload.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i> <span>同期中...</span>';
    }

    for (let i = 0; i < users.length; i++) {
      const u = users[i];
      const msg = `@${u} の最新データを更新中 (${i + 1}/${users.length})...`;
      if (statusText) statusText.textContent = msg;
      if (metaUpdated) metaUpdated.textContent = msg;

      try {
        const result = await fetchUserWatched(u);
        if (!state.data.userWatchedLists) state.data.userWatchedLists = {};
        state.data.userWatchedLists[u] = result.animes || [];

        // 1人更新されるごとに即座に画面全体をリアルタイム再集計！
        recalculateClientReport();
      } catch (err) {
        console.warn(`@${u} の個別更新をスキップ:`, err.message);
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

// データ読み込み（【提案2: Local-First】IndexedDB完全主権ロード）
async function loadData(force = false) {
  try {
    const savedUsers = loadUsersFromStorage();
    const localReport = await loadReportFromIndexedDB();
    const localWatches = await loadAllUserWatchesFromIndexedDB();
    await loadWorkGenres(); // 作品辞書をIndexedDB/静的JSONからロード

    // 1. ローカルIndexedDBに最新レポートがあれば即座に初期描画（超高速0ms表示）
    if (localReport && localReport.generatedAt && !force) {
      state.data = localReport;
      renderAllComponents();
      console.log('[Local-First] IndexedDBの最新レポートから即時描画完了');

      // 旧キャッシュ互換性チェック: timelineReport に 1年ごとデータ(allYears)がない場合は自動で手元のデータから再集計
      const hasTimelineAllYears = !!localReport.labs?.timelineReport?.allYears;
      if (!hasTimelineAllYears && state.data.userWatchedLists) {
        console.log('[Local-First] タイムライン新機能向けにローカルデータを自動アップグレード');
        recalculateClientReport();
      }
    }

    // 2. 手元IndexedDBにユーザーの視聴データ（user_watches）が保存されている場合
    if (localWatches && Object.keys(localWatches).length > 0 && !force) {
      const localUserKeys = Object.keys(localWatches);
      const activeUsers = (savedUsers && savedUsers.length > 0)
        ? savedUsers.filter(u => localWatches[u.toLowerCase()])
        : localUserKeys;

      if (activeUsers.length > 0) {
        const userWatchedLists = {};
        activeUsers.forEach(u => {
          userWatchedLists[u] = localWatches[u.toLowerCase()];
        });

        if (!state.data) state.data = {};
        state.data.users = activeUsers;
        state.data.userWatchedLists = userWatchedLists;

        if (state.selectedVennUsers.length === 0) {
          state.selectedVennUsers = activeUsers.slice(0, 3);
        }
        if (!state.activeExclusiveUser) {
          state.activeExclusiveUser = activeUsers[0] || null;
        }
        if (!state.activeMissingUser) {
          state.activeMissingUser = activeUsers[0] || null;
        }

        // ブラウザ内リアルタイムエンジンで即時再集計＆再描画！（サーバー通信完全不要）
        recalculateClientReport();
        console.log(`[Local-First] 手元の視聴データ(${activeUsers.length}人)から完全ローカル再集計完了 (通信ゼロ・サーバーレス)`);
        return;
      }
    }

    // 3. 初回アクセス等で手元にデータがない場合のみ、サーバーから初期データを取得してシード保存
    console.log('[Local-First] 初回セットアップ: サーバーから初期データをフェッチします...');
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

    // 手元のIndexedDBに各ユーザーの視聴データをシード保存！
    if (serverData.userWatchedLists && typeof serverData.userWatchedLists === 'object') {
      for (const [u, list] of Object.entries(serverData.userWatchedLists)) {
        await saveUserWatchedToIndexedDB(u, list);
      }
    }

    // 既存のLabsデータからジャンル辞書をシード
    if (serverData.labs?.genreReportScored?.genres) {
      if (!state.genreMap) state.genreMap = {};
      serverData.labs.genreReportScored.genres.forEach(g => {
        Object.values(g.animesByUser || {}).forEach(list => {
          (list || []).forEach(a => {
            if (a && a.title && !state.genreMap[a.title]) {
              state.genreMap[a.title] = { category: g.id };
            }
          });
        });
      });
      await saveWorkGenresToIndexedDB(state.genreMap);
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

    // ブラウザ内で再集計＆描画
    recalculateClientReport();
    console.log('[Local-First] 初回データの同期とIndexedDB永続化が完了しました');

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
  // ジャンル実験室 (Genre Lab) の描画
  if (window.renderGenreLabTab && state.data) {
    window.renderGenreLabTab(state.data.labs, state.data);
  }
  // パーティーLab (Party Lab: 布教マッチング、ルーレット、スタジオ偏愛レーダー) の描画
  if (window.renderPartyLabTab && state.data) {
    window.renderPartyLabTab(state.data.labs, state.data);
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
  if (!users || users.length < 2) {
    chartContainer.style.display = 'none';
    if (emptyMsg) emptyMsg.style.display = 'flex';

    // 詳細パネルの空状態表示
    const detailTitle = document.getElementById('detail-title');
    const detailBadge = document.getElementById('detail-badge');
    const detailDesc = document.getElementById('detail-desc');
    const detailList = document.getElementById('detail-list');
    if (detailTitle) detailTitle.innerHTML = '<i class="fa-solid fa-list-check"></i> 作品リスト';
    if (detailBadge) detailBadge.textContent = '0 作品';
    if (detailDesc) detailDesc.textContent = '2人または3人のユーザーを選択すると、共通・固有の作品リストが表示されます。';
    if (detailList) detailList.innerHTML = '<div class="empty-state" style="padding: 2.5rem 1rem;"><i class="fa-solid fa-users" style="font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.4;"></i><p>ユーザーを選択してください</p></div>';
    return;
  }

  chartContainer.style.display = 'flex';
  if (emptyMsg) emptyMsg.style.display = 'none';

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
      ? `<img src="${anime.image}" alt="${escapeHtml(anime.title)}" class="anime-thumb" loading="lazy" decoding="async" />`
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

  // 視点別・他ユーザーの視聴カバー率を描画
  renderSimilarityCoverage();
}

// シンクロ率タブ: 視点別・他ユーザーの視聴カバー率の描画
function renderSimilarityCoverage() {
  const chipsContainer = document.getElementById('sim-coverage-user-chips');
  const contentContainer = document.getElementById('sim-coverage-content');
  if (!chipsContainer || !contentContainer || !state.data) return;

  const users = state.data.users || [];
  const userLists = state.data.userWatchedLists || {};
  if (users.length < 2) {
    chipsContainer.innerHTML = '';
    contentContainer.innerHTML = '<p class="text-muted" style="padding:1rem;">比較対象ユーザーが2人未満です</p>';
    return;
  }

  // デフォルト選択ユーザー（未設定なら1人目）
  if (!state.simCoverageBaseUser || (!users.includes(state.simCoverageBaseUser) && state.simCoverageBaseUser !== '__all__')) {
    state.simCoverageBaseUser = users[0];
  }

  // 1. ユーザー選択チップの生成
  chipsContainer.innerHTML = '';

  // 各ユーザーボタン
  users.forEach(u => {
    const total = (userLists[u] || []).length;
    const btn = document.createElement('button');
    btn.className = `chip-btn ${state.simCoverageBaseUser === u ? 'active' : ''}`;
    btn.textContent = `@${u} (${total}作)`;
    btn.onclick = () => {
      state.simCoverageBaseUser = u;
      renderSimilarityCoverage();
    };
    chipsContainer.appendChild(btn);
  });

  // 「全員並列表示」ボタン
  const allBtn = document.createElement('button');
  allBtn.className = `chip-btn ${state.simCoverageBaseUser === '__all__' ? 'active' : ''}`;
  allBtn.innerHTML = '<i class="fa-solid fa-users-viewfinder"></i> 全員並列表示';
  allBtn.onclick = () => {
    state.simCoverageBaseUser = '__all__';
    renderSimilarityCoverage();
  };
  chipsContainer.appendChild(allBtn);

  // 高速検索用Map
  const userMaps = {};
  users.forEach(u => {
    userMaps[u] = new Map((userLists[u] || []).map(a => [String(a.id), a]));
  });

  // 2. コンテンツ描画
  contentContainer.innerHTML = '';

  if (state.simCoverageBaseUser === '__all__') {
    // 全員並列表示モード
    const grid = document.createElement('div');
    grid.className = 'coverage-multi-grid';

    users.forEach(me => {
      const myAnimes = userLists[me] || [];
      const myTotal = myAnimes.length;

      const block = document.createElement('div');
      block.className = 'coverage-user-block';

      const header = document.createElement('div');
      header.className = 'coverage-user-header';
      header.innerHTML = `
        <span class="coverage-user-badge"><i class="fa-solid fa-user text-pink"></i> @${escapeHtml(me)} 視点</span>
        <span class="coverage-user-total">全 ${myTotal} 作</span>
      `;
      block.appendChild(header);

      const list = document.createElement('div');
      list.className = 'coverage-target-list';

      const others = users.filter(u => u !== me);
      // カバー率の高い順にソート
      const rankedOthers = others.map(other => {
        const otherMap = userMaps[other];
        const commonCount = myAnimes.filter(a => otherMap && otherMap.has(String(a.id))).length;
        const pct = myTotal > 0 ? (commonCount / myTotal) * 100 : 0;
        return { other, commonCount, pct };
      }).sort((a, b) => b.pct - a.pct);

      rankedOthers.forEach(item => {
        const row = document.createElement('div');
        row.className = 'coverage-target-item';
        const pctStr = item.pct.toFixed(1);
        row.innerHTML = `
          <div class="coverage-target-top">
            <span class="coverage-target-name">@${escapeHtml(item.other)}</span>
            <div class="coverage-target-stat-wrap">
              <strong class="coverage-target-pct">${pctStr}%</strong>
              <span class="coverage-target-count">(${item.commonCount} / ${myTotal}作)</span>
            </div>
          </div>
          <div class="coverage-bar-track">
            <div class="coverage-bar-fill" style="width: ${pctStr}%;"></div>
          </div>
        `;
        list.appendChild(row);
      });

      block.appendChild(list);
      grid.appendChild(block);
    });

    contentContainer.appendChild(grid);
  } else {
    // 単一ユーザー視点モード（ランキングバー表示）
    const me = state.simCoverageBaseUser;
    const myAnimes = userLists[me] || [];
    const myTotal = myAnimes.length;

    const singleView = document.createElement('div');
    singleView.className = 'coverage-single-view';

    const meta = document.createElement('div');
    meta.className = 'coverage-single-meta';
    meta.innerHTML = `
      <div class="coverage-single-user-info">
        <i class="fa-solid fa-user-check text-pink"></i>
        <span><strong>@${escapeHtml(me)}</strong> が観ている全 <strong>${myTotal}</strong> 作品中</span>
      </div>
      <span class="coverage-meta-hint"><i class="fa-solid fa-arrow-down-wide-short"></i> カバー率（高い順）</span>
    `;
    singleView.appendChild(meta);

    const rankList = document.createElement('div');
    rankList.className = 'coverage-rank-list';

    const others = users.filter(u => u !== me);
    const rankedOthers = others.map(other => {
      const otherMap = userMaps[other];
      const commonCount = myAnimes.filter(a => otherMap && otherMap.has(String(a.id))).length;
      const pct = myTotal > 0 ? (commonCount / myTotal) * 100 : 0;
      return { other, commonCount, pct };
    }).sort((a, b) => b.pct - a.pct);

    rankedOthers.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'coverage-rank-row';
      const pctStr = item.pct.toFixed(1);
      const rankColor = idx === 0 ? 'var(--accent-gold, #f59e0b)' : (idx === 1 ? '#94a3b8' : (idx === 2 ? '#b45309' : 'var(--text-muted)'));
      const crown = idx === 0 ? '<i class="fa-solid fa-crown text-gold" style="margin-left:4px;"></i>' : '';

      row.innerHTML = `
        <div class="coverage-rank-top">
          <div class="coverage-rank-user">
            <span class="coverage-rank-order" style="color:${rankColor};">#${idx + 1}</span>
            <span class="coverage-rank-name">@${escapeHtml(item.other)}</span>
            ${crown}
          </div>
          <div class="coverage-rank-stat">
            <strong class="coverage-stat-pct">${pctStr}%</strong>
            <span class="coverage-stat-count">(${item.commonCount} / ${myTotal}作)</span>
          </div>
        </div>
        <div class="coverage-bar-track">
          <div class="coverage-bar-fill" style="width: ${pctStr}%;"></div>
        </div>
      `;
      rankList.appendChild(row);
    });

    singleView.appendChild(rankList);
    contentContainer.appendChild(singleView);
  }
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
      if (state.activeExclusiveUser === u) return;
      state.activeExclusiveUser = u;
      exclusiveSel.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      requestAnimationFrame(() => {
        const exclusiveList = (state.activeExclusiveUser && insights.exclusivePerUser?.[state.activeExclusiveUser]) || [];
        renderAnimeGrid(document.getElementById('list-exclusive'), exclusiveList);
      });
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
      if (state.activeMissingUser === u) return;
      state.activeMissingUser = u;
      missingSel.querySelectorAll('.chip-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      requestAnimationFrame(() => {
        const missingList = (state.activeMissingUser && insights.missingPerUser?.[state.activeMissingUser]) || [];
        renderAnimeGrid(document.getElementById('list-missing'), missingList);
      });
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
      ? `<img src="${anime.image}" alt="${escapeHtml(anime.title)}" class="grid-card-thumb" loading="lazy" decoding="async" />`
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
        openImageModal(anime.title, anime.image, anime.id);
      });
    }

    container.appendChild(a);
  });
}

// 画像プレビューモーダル（Annict公式高解像度 OGP画像 プログレッシブローダー対応）
function openImageModal(title, imageUrl, workId = null) {
  const modal = document.getElementById('image-modal');
  const titleEl = document.getElementById('image-modal-title');
  const imgEl = document.getElementById('image-modal-img');

  titleEl.textContent = title;
  imgEl.src = imageUrl;
  imgEl.alt = title;
  modal.style.display = 'flex';

  // Annict公式の超高画質OGP画像 (s:640:853) を非同期取得してスムーズにアップグレード
  const targetId = workId || (imageUrl ? (imageUrl.match(/\/workimage\/(\d+)\//) || [])[1] : null);
  if (targetId) {
    fetch(`/api/annict-image/${targetId}`)
      .then(res => res.json())
      .then(data => {
        if (data.url && modal.style.display === 'flex' && titleEl.textContent === title) {
          const highResImg = new Image();
          highResImg.onload = () => {
            imgEl.src = data.url;
          };
          highResImg.src = data.url;
        }
      })
      .catch(() => {});
  }
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
      ? `<img src="${anime.image}" alt="${escapeHtml(anime.title)}" class="grid-card-thumb" loading="lazy" decoding="async" />`
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
        openImageModal(anime.title, anime.image, anime.id);
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
      if (btn.classList.contains('active')) return;
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

      requestAnimationFrame(() => renderGroupWorksList());
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
    const isSelected = selectedSet.has(username);
    const count = state.data.userWatchedLists?.[username]?.length || 0;

    const chip = document.createElement('div');
    chip.className = `user-chip ${isSelected ? 'selected' : ''}`;
    chip.title = `@${username} (${count}作品)`;
    chip.innerHTML = `
      <i class="fa-${isSelected ? 'solid fa-check' : 'regular fa-circle'}"></i>
      <span>@${username} (${count})</span>
    `;

    chip.addEventListener('click', () => {
      if (isSelected) {
        state.groupSelectedUsers = state.groupSelectedUsers.filter(u => u !== username);
      } else {
        state.groupSelectedUsers.push(username);
      }
      renderGroupUserCheckboxes();
      renderGroupWorksList();
    });

    container.appendChild(chip);
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
      ? `<img src="${work.image}" alt="${safeTitle}" data-title="${safeTitle}" data-work-id="${work.id}" class="grid-card-thumb" loading="lazy" decoding="async" />`
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
      const workId = thumb.getAttribute('data-work-id');
      openImageModal(title, src, workId);
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

// グローバルスコープへの明示的公開（Local-First連携・テスト用）
if (typeof window !== 'undefined') {
  window.executeAddUser = executeAddUser;
  window.executeDeleteUser = executeDeleteUser;
  window.recalculateClientReport = recalculateClientReport;
  window.loadAllUserWatchesFromIndexedDB = loadAllUserWatchesFromIndexedDB;
  window.loadWorkGenresFromIndexedDB = loadWorkGenresFromIndexedDB;
  window.saveWorkGenresToIndexedDB = saveWorkGenresToIndexedDB;
  window.saveUserWatchedToIndexedDB = saveUserWatchedToIndexedDB;
  window.deleteUserWatchedFromIndexedDB = deleteUserWatchedFromIndexedDB;
  window.loadReportFromIndexedDB = loadReportFromIndexedDB;
  window.saveReportToIndexedDB = saveReportToIndexedDB;
}


