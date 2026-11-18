(function (root) {
  'use strict';

  const VIEW_IDS = ['venn', 'similarity', 'insights', 'group', 'analytics', 'genre', 'search', 'story'];

  function normalizeUserList(users) {
    if (!Array.isArray(users)) return [];
    const map = new Map();
    for (let i = 0; i < users.length; i++) {
      const raw = users[i];
      if (!raw || typeof raw !== 'string') continue;
      const clean = raw.trim().replace(/^@/, '');
      if (!clean) continue;
      const lower = clean.toLowerCase();
      if (!map.has(lower)) {
        map.set(lower, clean);
      } else {
        const existing = map.get(lower);
        if (!/[A-Z]/.test(existing) && /[A-Z]/.test(clean)) {
          map.set(lower, clean);
        }
      }
    }
    return Array.from(map.values());
  }

  function findUserKeyCI(obj, username) {
    if (!obj || !username) return null;
    const lower = String(username).toLowerCase();
    return Object.keys(obj).find(k => k.toLowerCase() === lower) || null;
  }

  function setUserWatchedCI(obj, canonicalUser, animes) {
    const existingKey = findUserKeyCI(obj, canonicalUser);
    if (existingKey && existingKey !== canonicalUser) {
      delete obj[existingKey];
    }
    obj[canonicalUser] = animes;
  }

  function expandBootstrap(bootstrap) {
    if (!bootstrap || !bootstrap.works || !bootstrap.userWorkIds) return null;
    const worksCache = {};
    const userWatchedLists = {};
    const users = normalizeUserList(bootstrap.users || Object.keys(bootstrap.userWorkIds));
    const expandImg = root.AnalyzerEngine.expandAnnictImg;

    for (const [id, tuple] of Object.entries(bootstrap.works)) {
      worksCache[id] = {
        id: String(id),
        title: tuple[0] || '',
        season: tuple[1] || '',
        image: expandImg(tuple[2] || ''),
        episodesCount: tuple[3] || null,
        media: tuple[4] || '',
        url: `https://annict.com/works/${id}`
      };
    }

    for (const u of users) {
      const matchKey = findUserKeyCI(bootstrap.userWorkIds, u);
      const ids = matchKey ? (bootstrap.userWorkIds[matchKey] || []) : [];
      userWatchedLists[u] = ids.map(id => worksCache[String(id)]).filter(Boolean);
    }

    return {
      generatedAt: bootstrap.generatedAt || new Date().toISOString(),
      users,
      userWatchedLists
    };
  }

  const state = {
    generatedAt: null,
    registeredUsers: [],
    enabledUsers: [],
    userWatchedLists: {},
    genreMap: {},
    report: null,
    selectedVennUsers: [],
    popularWorks: null,
    popularLoadError: null,
    popularImgShards: {},
    popularShardPromises: {},
    popularLoadingPromise: null,
    activeView: 'venn',
    dirtyViews: new Set(VIEW_IDS),
    listeners: new Set(),
    isRefreshingAll: false
  };

  function invalidateCategoryCache() {
    state._categoryCache = new Map();
  }

  function getWorkCategory(title) {
    if (!title) return 'other';
    if (!state._categoryCache) state._categoryCache = new Map();
    if (state._categoryCache.has(title)) return state._categoryCache.get(title);
    const cat = root.AnalyzerEngine.resolveCategoryId(title, state.genreMap);
    state._categoryCache.set(title, cat);
    return cat;
  }

  function getEffectiveUsers() {
    const effective = state.enabledUsers.filter(u =>
      state.registeredUsers.some(r => r.toLowerCase() === u.toLowerCase())
    );
    return effective.length > 0 ? effective : [...state.registeredUsers];
  }

  function isUserEnabled(username) {
    const lower = String(username || '').toLowerCase();
    return getEffectiveUsers().some(u => u.toLowerCase() === lower);
  }

  function toggleUserEnabled(username, isEnabled) {
    const lower = String(username || '').toLowerCase();
    let current = getEffectiveUsers();
    if (isEnabled) {
      if (!current.some(u => u.toLowerCase() === lower)) {
        const canonical = state.registeredUsers.find(u => u.toLowerCase() === lower) || username;
        current.push(canonical);
      }
    } else {
      current = current.filter(u => u.toLowerCase() !== lower);
      if (current.length === 0) {
        root.UIUtils.showToast('少なくとも1人の分析対象ユーザーが必要です', 'warn');
        return false;
      }
    }
    state.enabledUsers = normalizeUserList(current);
    root.AppStorage.saveEnabledUsersToLS(state.enabledUsers);
    recalculate();
    return true;
  }

  function selectAllEnabledUsers() {
    state.enabledUsers = [...state.registeredUsers];
    root.AppStorage.saveEnabledUsersToLS(state.enabledUsers);
    recalculate();
  }

  function keepSingleEnabledUser() {
    if (state.registeredUsers.length > 0) {
      state.enabledUsers = [state.registeredUsers[0]];
      root.AppStorage.saveEnabledUsersToLS(state.enabledUsers);
      recalculate();
    }
  }

  function recalculate() {
    const effective = getEffectiveUsers();
    const targetLists = {};
    for (const u of effective) {
      const key = findUserKeyCI(state.userWatchedLists, u);
      targetLists[u] = key ? (state.userWatchedLists[key] || []) : [];
    }

    const engine = new root.AnalyzerEngine.AnalyzerEngine(targetLists);
    const report = engine.buildFullReport(state.genreMap);
    report.generatedAt = state.generatedAt || report.generatedAt;
    state.report = report;

    const effectiveSetLower = new Set(effective.map(u => u.toLowerCase()));
    state.selectedVennUsers = state.selectedVennUsers.filter(u => effectiveSetLower.has(u.toLowerCase()))
      .map(u => effective.find(e => e.toLowerCase() === u.toLowerCase()) || u);
    if (state.selectedVennUsers.length === 0 && effective.length > 0) {
      state.selectedVennUsers = effective.slice(0, Math.min(3, effective.length));
    }

    root.AppStorage.saveUsersToLS(state.registeredUsers);
    markAllDirty();
    notifyListeners();
  }

  function markAllDirty() {
    for (const v of VIEW_IDS) state.dirtyViews.add(v);
  }

  function markViewsDirty(viewIds) {
    for (const v of viewIds) state.dirtyViews.add(v);
  }

  function subscribe(fn) {
    state.listeners.add(fn);
    return () => state.listeners.delete(fn);
  }

  function notifyListeners() {
    for (const fn of state.listeners) {
      try { fn(state); } catch (e) { console.error(e); }
    }
  }

  const GENRE_SCHEMA_VER = 'v3.2';

  function mergeWorkGenreEntry(prev, val) {
    if (!val || typeof val !== 'object') return { changed: false, entry: prev };
    if (!prev) {
      return { changed: true, entry: val };
    }
    const nextCat = (prev.c === 'other' || (val.c && val.c !== 'other')) ? (val.c || prev.c) : prev.c;
    const prevS = Array.isArray(prev.s) ? prev.s : [];
    const nextS = (Array.isArray(val.s) && val.s.length > 0) ? val.s : prevS;
    const prevG = Array.isArray(prev.g) ? prev.g : [];
    const nextG = (Array.isArray(val.g) && val.g.length > 0) ? val.g : prevG;
    const studiosChanged = nextS.length !== prevS.length || nextS.some((x, idx) => x !== prevS[idx]);
    const changed = nextCat !== prev.c || studiosChanged;
    const entry = { c: nextCat, g: nextG };
    if (nextS.length > 0) entry.s = nextS;
    return { changed, entry };
  }

  async function fetchFreshWorkGenres() {
    try {
      let res = await fetch('./res/work-genres.json');
      if (!res.ok) res = await fetch('/api/work-genres');
      if (res.ok) {
        const data = await res.json();
        let hasNewOrChanged = false;
        for (const [t, val] of Object.entries(data)) {
          const { changed, entry } = mergeWorkGenreEntry(state.genreMap[t], val);
          if (changed) hasNewOrChanged = true;
          if (entry) state.genreMap[t] = entry;
        }
        invalidateCategoryCache();
        await root.AppStorage.saveWorkGenres(state.genreMap);
        await root.AppStorage.saveMeta('genreSyncAt', Date.now());
        await root.AppStorage.saveMeta('genreSchemaVer', GENRE_SCHEMA_VER);
        if (hasNewOrChanged && state.report) {
          recalculate();
        }
      }
    } catch (e) {}
  }

  async function loadWorkGenres() {
    try {
      const [cached, lastSync, schemaVer] = await Promise.all([
        root.AppStorage.loadWorkGenres(),
        root.AppStorage.loadMeta('genreSyncAt'),
        root.AppStorage.loadMeta('genreSchemaVer')
      ]);
      if (cached && Object.keys(cached).length > 0 && schemaVer === GENRE_SCHEMA_VER) {
        Object.assign(state.genreMap, cached);
        invalidateCategoryCache();
        // 24時間以上経過していればバックグラウンドで最新辞書を同期（永久古辞書防止）
        if (!lastSync || (Date.now() - lastSync > 24 * 60 * 60 * 1000)) {
          fetchFreshWorkGenres();
        }
        return;
      }
      await fetchFreshWorkGenres();
    } catch (e) {
      console.warn('[GenreDict] ロードエラー:', e.message);
    }
  }

  async function initData(forceServer = false) {
    const savedUsers = root.AppStorage.loadUsersFromLS();
    const savedEnabled = root.AppStorage.loadEnabledUsersFromLS();

    // 並列でIndexedDB視聴リスト・ジャンル辞書・メタ情報を取得
    const [rawWatches, , savedGenAt] = await Promise.all([
      forceServer ? Promise.resolve(null) : root.AppStorage.loadAllUserWatches(),
      loadWorkGenres(),
      root.AppStorage.loadMeta('generatedAt')
    ]);

    let localWatches = rawWatches;
    if (!localWatches && !forceServer) {
      const legacy = await root.AppStorage.migrateLegacyUserWatches();
      if (legacy) {
        localWatches = legacy;
        await Promise.all(
          Object.entries(legacy).map(([u, list]) => root.AppStorage.saveUserWatched(u, list))
        );
      }
    }

    if (localWatches && Object.keys(localWatches).length > 0 && !forceServer) {
      const localKeys = Object.keys(localWatches);
      const candidates = [...(savedUsers || [])];
      for (const k of localKeys) {
        if (!candidates.some(u => u.toLowerCase() === k.toLowerCase())) {
          candidates.push(k);
        }
      }
      const registered = normalizeUserList(candidates).filter(u => !!findUserKeyCI(localWatches, u));

      if (registered.length > 0) {
        const watchedMap = {};
        for (const u of registered) {
          const k = findUserKeyCI(localWatches, u);
          watchedMap[u] = (k ? localWatches[k] : []) || [];
        }
        state.registeredUsers = registered;
        state.userWatchedLists = watchedMap;
        state.enabledUsers = savedEnabled && savedEnabled.length > 0
          ? savedEnabled.filter(u => registered.some(r => r.toLowerCase() === u.toLowerCase()))
              .map(u => registered.find(r => r.toLowerCase() === u.toLowerCase()) || u)
          : [...registered];
        if (state.enabledUsers.length === 0) state.enabledUsers = [...registered];
        state.generatedAt = savedGenAt || new Date().toISOString();

        recalculate();
        return;
      }
    }

    const usersParam = savedUsers ? `?users=${encodeURIComponent(savedUsers.join(','))}` : '';
    let res = null;
    try {
      res = await fetch(`/api/bootstrap${usersParam}`);
    } catch (e) {
      res = null;
    }
    if (!res || !res.ok) {
      res = await fetch(`./res/bootstrap.json?t=${Date.now()}`);
    }
    if (!res.ok) throw new Error(`初期データの取得に失敗しました (HTTP ${res.status})`);

    const bootstrap = await res.json();
    const expanded = expandBootstrap(bootstrap);
    if (!expanded) throw new Error('ブートストラップデータの展開に失敗しました');

    state.generatedAt = expanded.generatedAt;
    state.registeredUsers = expanded.users;
    state.userWatchedLists = expanded.userWatchedLists;
    state.enabledUsers = savedEnabled && savedEnabled.length > 0
      ? savedEnabled.filter(u => expanded.users.some(r => r.toLowerCase() === u.toLowerCase()))
          .map(u => expanded.users.find(r => r.toLowerCase() === u.toLowerCase()) || u)
      : [...expanded.users];
    if (state.enabledUsers.length === 0) state.enabledUsers = [...expanded.users];

    await Promise.all([
      root.AppStorage.saveMeta('generatedAt', state.generatedAt),
      ...Object.entries(state.userWatchedLists).map(([u, list]) => root.AppStorage.saveUserWatched(u, list))
    ]);

    recalculate();
  }

  // 削除中レース防止用セット
  const deletedInFlight = new Set();

  async function fetchAndMergeUser(username, onProgress, isRefreshExisting = false) {
    const cleanUser = String(username || '').trim().replace(/^@/, '');
    if (!cleanUser) throw new Error('ユーザーIDが指定されていません');
    const lower = cleanUser.toLowerCase();

    if (!isRefreshExisting) {
      deletedInFlight.delete(lower);
    } else {
      if (deletedInFlight.has(lower) || !state.registeredUsers.some(u => u.toLowerCase() === lower)) {
        return 'aborted';
      }
    }

    if (onProgress) onProgress(`@${cleanUser} の最新データをAnnictから取得中...`);

    const res = await fetch(`/api/user-watched/${encodeURIComponent(cleanUser)}?force=true`);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch (e) {}
      throw new Error(msg);
    }

    const result = await res.json();
    // 通信中にユーザーが削除された場合は復活させない
    if (deletedInFlight.has(lower)) return 'aborted';
    if (isRefreshExisting && !state.registeredUsers.some(u => u.toLowerCase() === lower)) return 'aborted';

    const animes = result.animes || [];
    const existingCanonical = state.registeredUsers.find(u => u.toLowerCase() === lower);
    const canonicalName = existingCanonical || cleanUser;

    // 4並列バッチで未登録作のジャンル・制作会社をAniListから補完
    if (result.workGenres && typeof result.workGenres === 'object') {
      for (const [t, val] of Object.entries(result.workGenres)) {
        const { entry } = mergeWorkGenreEntry(state.genreMap[t], val);
        if (entry) state.genreMap[t] = entry;
      }
      invalidateCategoryCache();
      await root.AppStorage.saveWorkGenres(state.genreMap);
    }

    if (root.GenreEngine?.fetchAniListMediaInBrowser) {
      const unmapped = animes
        .filter(a => a?.title && !state.genreMap[a.title])
        .slice(0, 8);
      if (unmapped.length > 0) {
        if (onProgress) onProgress(`新規 ${unmapped.length} 作品のジャンル・制作会社を照合中...`);
        for (let i = 0; i < unmapped.length; i += 4) {
          if (deletedInFlight.has(lower)) return 'aborted';
          await Promise.all(unmapped.slice(i, i + 4).map(async (a) => {
            try {
              const yearHint = root.GenreEngine.extractYearHint ? root.GenreEngine.extractYearHint(a.season || a.title) : null;
              const media = await root.GenreEngine.fetchAniListMediaInBrowser(a.title, yearHint);
              if (media) {
                const cat = root.GenreEngine.classifyAnimeScored(media.genres, media.tags, a.title);
                const studios = Array.isArray(media.studios) ? media.studios : [];
                const nextEntry = { c: cat, g: media.genres || [] };
                if (studios.length > 0) nextEntry.s = studios;
                state.genreMap[a.title] = nextEntry;
              }
            } catch (e) {}
          }));
        }
        invalidateCategoryCache();
        await root.AppStorage.saveWorkGenres(state.genreMap);
      }
    }

    // 長時間待機中（AniList補完等）にユーザーが削除された場合も復活させない
    if (deletedInFlight.has(lower)) return 'aborted';
    if (isRefreshExisting && !state.registeredUsers.some(u => u.toLowerCase() === lower)) return 'aborted';

    setUserWatchedCI(state.userWatchedLists, canonicalName, animes);
    await root.AppStorage.saveUserWatched(canonicalName, animes);

    state.registeredUsers = normalizeUserList([...state.registeredUsers, canonicalName]);
    if (!state.enabledUsers.some(u => u.toLowerCase() === lower)) {
      state.enabledUsers = normalizeUserList([...state.enabledUsers, canonicalName]);
      root.AppStorage.saveEnabledUsersToLS(state.enabledUsers);
    }

    state.generatedAt = new Date().toISOString();
    await root.AppStorage.saveMeta('generatedAt', state.generatedAt);
    recalculate();
    return 'ok';
  }

  async function removeUser(username) {
    const clean = String(username || '').trim().replace(/^@/, '');
    const lower = clean.toLowerCase();
    if (state.registeredUsers.length <= 1) {
      root.UIUtils.showToast('最低1人のユーザーを残す必要があります', 'warn');
      return false;
    }

    deletedInFlight.add(lower);
    // 待機中の追加・更新タスクもキャンセル
    taskQueue.tasks = taskQueue.tasks.filter(t => !(t.status === 'pending' && t.username.toLowerCase() === lower));
    state.registeredUsers = state.registeredUsers.filter(u => u.toLowerCase() !== lower);
    state.enabledUsers = state.enabledUsers.filter(u => u.toLowerCase() !== lower);
    const key = findUserKeyCI(state.userWatchedLists, clean);
    if (key) delete state.userWatchedLists[key];

    root.AppStorage.saveUsersToLS(state.registeredUsers);
    root.AppStorage.saveEnabledUsersToLS(state.enabledUsers);
    await root.AppStorage.deleteUserWatched(clean);
    recalculate();
    taskQueue.onUpdate?.();

    fetch(`/api/users/${encodeURIComponent(clean)}`, { method: 'DELETE' }).catch(() => {});
    return true;
  }

  const taskQueue = {
    tasks: [],
    isProcessing: false,
    onUpdate: null,

    enqueue(type, username) {
      const clean = String(username || '').trim().replace(/^@/, '');
      if (!clean) return;
      const dup = this.tasks.find(
        t => t.type === type && t.username.toLowerCase() === clean.toLowerCase() && (t.status === 'pending' || t.status === 'running')
      );
      if (dup) return;

      this.tasks.push({
        id: Date.now() + Math.random(),
        type, // 'add' | 'refresh'
        username: clean,
        status: 'pending',
        stepMsg: '待機中...',
        errorMsg: null
      });
      this.onUpdate?.();
      this.processNext();
    },

    dismissTask(id) {
      this.tasks = this.tasks.filter(t => t.id !== id);
      this.onUpdate?.();
    },

    async processNext() {
      if (this.isProcessing) return;
      const task = this.tasks.find(t => t.status === 'pending');
      if (!task) {
        this.onUpdate?.();
        return;
      }

      this.isProcessing = true;
      task.status = 'running';
      task.stepMsg = `@${task.username} のデータを取得中...`;
      this.onUpdate?.();

      try {
        const status = await fetchAndMergeUser(task.username, (msg) => {
          task.stepMsg = msg;
          this.onUpdate?.();
        }, task.type === 'refresh');

        task.status = 'done';
        task.stepMsg = status === 'aborted' ? 'キャンセル済み' : '完了';
        if (status !== 'aborted') {
          root.UIUtils.showToast(`@${task.username} のデータを反映しました`, 'success');
        }
        setTimeout(() => {
          this.tasks = this.tasks.filter(t => t.id !== task.id);
          this.onUpdate?.();
        }, 1200);
      } catch (err) {
        task.status = 'error';
        task.errorMsg = err.message || '通信エラー';
        root.UIUtils.showToast(task.errorMsg, 'error', 5000);
      } finally {
        this.isProcessing = false;
        this.onUpdate?.();
        this.processNext();
      }
    }
  };

  async function refreshAllUsers(onProgress) {
    if (state.isRefreshingAll) return;
    const targets = getEffectiveUsers();
    if (targets.length === 0) return;

    state.isRefreshingAll = true;
    try {
      for (let i = 0; i < targets.length; i++) {
        const u = targets[i];
        if (onProgress) onProgress(`@${u} を同期中 (${i + 1}/${targets.length})...`);
        try {
          await fetchAndMergeUser(u, null, true);
        } catch (err) {
          console.warn(`@${u} 更新スキップ:`, err.message);
        }
      }
      fetch('/api/sync-new-works')
        .then(r => r.json())
        .then(res => {
          if (res?.added > 0) {
            state.popularWorks = null;
            state.popularImgShards = {};
          }
        })
        .catch(() => {});
      root.UIUtils.showToast('全選択メンバーの最新データを同期しました', 'success');
    } finally {
      state.isRefreshingAll = false;
      notifyListeners();
    }
  }

  async function ensurePopularIndex() {
    if (state.popularWorks) return state.popularWorks;
    if (state.popularLoadingPromise) return state.popularLoadingPromise;
    state.popularLoadError = null;

    state.popularLoadingPromise = (async () => {
      try {
        const res = await fetch('./res/popular/index.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const items = data.items || [];
        state.popularWorks = items.map(([id, title, season], idx) => ({
          id: String(id),
          title: title || '',
          season: season || '',
          image: '',
          url: `https://annict.com/works/${id}`,
          popularRank: idx + 1
        }));
        return state.popularWorks;
      } catch (e) {
        state.popularLoadError = e.message || '読み込みエラー';
        return null;
      } finally {
        state.popularLoadingPromise = null;
      }
    })();

    return state.popularLoadingPromise;
  }

  function getShardIndex(id) {
    const n = parseInt(id, 10);
    if (!Number.isNaN(n)) return Math.abs(n) % 16;
    let h = 0;
    const s = String(id);
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h) % 16;
  }

  async function ensurePopularImages(worksSlice) {
    if (!Array.isArray(worksSlice) || worksSlice.length === 0) return false;
    const expandImg = root.AnalyzerEngine.expandAnnictImg;
    const neededShards = new Set();

    for (let i = 0; i < worksSlice.length; i++) {
      const w = worksSlice[i];
      if (!w.image) {
        const sIdx = getShardIndex(w.id);
        if (!state.popularImgShards[sIdx]) neededShards.add(sIdx);
      }
    }

    if (neededShards.size > 0) {
      await Promise.all(
        Array.from(neededShards).map((sIdx) => {
          if (!state.popularShardPromises[sIdx]) {
            state.popularShardPromises[sIdx] = fetch(`./res/popular/imgs_${String(sIdx).padStart(2, '0')}.json`)
              .then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
              })
              .then(json => { state.popularImgShards[sIdx] = json; return json; })
              .catch(() => ({}))
              .finally(() => { delete state.popularShardPromises[sIdx]; });
          }
          return state.popularShardPromises[sIdx];
        })
      );
    }

    let updated = false;
    for (let i = 0; i < worksSlice.length; i++) {
      const w = worksSlice[i];
      if (!w.image) {
        const shard = state.popularImgShards[getShardIndex(w.id)];
        const raw = shard?.[w.id];
        if (raw && !raw.includes('no-image') && !raw.includes('color-white-')) {
          w.image = expandImg(raw);
          updated = true;
        }
      }
    }
    return updated;
  }

  function getUserUniqueCount(username) {
    if (!username) return 0;
    const summaryItem = (state.report?.userSummary || []).find(s => s.username === username);
    if (summaryItem && typeof summaryItem.count === 'number') return summaryItem.count;
    const rawList = state.userWatchedLists?.[username] || [];
    return new Set(rawList.map(a => String(a.id))).size;
  }

  root.AppStore = {
    VIEW_IDS,
    state,
    normalizeUserList,
    getEffectiveUsers,
    getUserUniqueCount,
    isUserEnabled,
    toggleUserEnabled,
    selectAllEnabledUsers,
    keepSingleEnabledUser,
    getWorkCategory,
    recalculate,
    markAllDirty,
    markViewsDirty,
    subscribe,
    initData,
    fetchAndMergeUser,
    removeUser,
    taskQueue,
    refreshAllUsers,
    ensurePopularIndex,
    ensurePopularImages
  };
}(window));
