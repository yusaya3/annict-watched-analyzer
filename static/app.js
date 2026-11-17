(function (root) {
  'use strict';

  const VIEW_META = {
    venn:       { title: 'ベン図比較',             sub: '1〜3人の視聴作品をインタラクティブなベン図で重ねて比較' },
    similarity: { title: 'シンクロ率・カバー率',   sub: '全ペアの趣味一致度マトリクスと視点別視聴網羅率を分析' },
    insights:   { title: '視聴インサイト',         sub: '全員視聴・1人だけの独自推し・未履修の会話ネタを発見' },
    group:      { title: 'グループ作品カタログ',   sub: '誰かが見ている和集合と、誰も見ていないAnnict全作品を探索' },
    analytics:  { title: '視聴アナリティクス',     sub: '総視聴時間・年代別タイムライン・制作スタジオの多角分析' },
    genre:      { title: 'ジャンル分析 & 診断',   sub: '15カテゴリの重み付けジャンル傾向と作品スコア内訳診断' },
    search:     { title: '作品検索・逆引き',       sub: '作品名・略称から視聴メンバーやAnnict全作品を横断検索' },
    story:      { title: 'ストーリー構造類似検索', sub: '起承転結プロット×世界観のデュアルAIベクトルで次の1本を発見' }
  };

  const Router = {
    navigateTo(viewId, updateHash = true) {
      if (!VIEW_META[viewId]) viewId = 'venn';
      const state = root.AppStore.state;
      state.activeView = viewId;

      if (updateHash && window.location.hash !== `#${viewId}`) {
        history.replaceState(null, '', `#${viewId}`);
      }

      document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-view') === viewId);
      });
      document.querySelectorAll('.view-pane').forEach(pane => {
        pane.classList.toggle('active', pane.getAttribute('data-view') === viewId);
      });

      const meta = VIEW_META[viewId];
      const titleEl = document.getElementById('topbar-title');
      const subEl = document.getElementById('topbar-subtitle');
      if (titleEl) titleEl.textContent = meta.title;
      if (subEl) subEl.textContent = meta.sub;

      // モバイルドロワーを閉じる
      document.getElementById('app-shell')?.classList.remove('mobile-menu-open');

      if (window.scrollY > 0 || document.documentElement.scrollTop > 0) {
        try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch (_) { window.scrollTo(0, 0); }
      }

      requestAnimationFrame(() => {
        const view = root.AppViews?.[viewId];
        const pane = document.getElementById(`view-${viewId}`);
        if (view && pane) {
          view.mount(pane);
          if (state.dirtyViews.has(viewId) && state.report) {
            state.dirtyViews.delete(viewId);
            view.render(state);
          }
        }
      });
    },

    openStoryByTitle(title) {
      const storyView = root.AppViews?.story;
      if (storyView) {
        storyView.pendingJumpTitle = title;
      }
      root.AppStore.state.dirtyViews.add('story');
      this.navigateTo('story');
    }
  };

  root.AppRouter = Router;

  function initSidebarAndShell() {
    const shell = document.getElementById('app-shell');
    const collapseBtn = document.getElementById('btn-sidebar-collapse');
    const mobileMenuBtn = document.getElementById('btn-mobile-menu');
    const mobileCloseBtn = document.getElementById('btn-sidebar-close-mobile');
    const backdrop = document.getElementById('sidebar-backdrop');

    try {
      if (localStorage.getItem(root.AppStorage.LS_COLLAPSED) === '1') {
        shell?.classList.add('sidebar-collapsed');
      }
    } catch (e) {}

    collapseBtn?.addEventListener('click', () => {
      const collapsed = shell?.classList.toggle('sidebar-collapsed');
      try {
        localStorage.setItem(root.AppStorage.LS_COLLAPSED, collapsed ? '1' : '0');
      } catch (e) {}
    });

    mobileMenuBtn?.addEventListener('click', () => shell?.classList.add('mobile-menu-open'));
    mobileCloseBtn?.addEventListener('click', () => shell?.classList.remove('mobile-menu-open'));
    backdrop?.addEventListener('click', () => shell?.classList.remove('mobile-menu-open'));

    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        Router.navigateTo(btn.getAttribute('data-view'));
      });
    });

    document.querySelector('.sidebar-brand')?.addEventListener('click', (e) => {
      e.preventDefault();
      Router.navigateTo('venn');
    });

    window.addEventListener('hashchange', () => {
      const hashView = window.location.hash.replace('#', '');
      if (VIEW_META[hashView] && hashView !== root.AppStore.state.activeView) {
        Router.navigateTo(hashView, false);
      }
    });
  }

  function initThemeToggle() {
    const btn = document.getElementById('btn-theme-toggle');
    if (!btn) return;

    const syncIcon = (theme) => {
      btn.innerHTML = theme === 'light'
        ? '<i class="fa-solid fa-moon"></i> <span>ダーク</span>'
        : '<i class="fa-solid fa-sun"></i> <span>ライト</span>';
    };

    syncIcon(document.documentElement.getAttribute('data-theme') || 'dark');

    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('annict_theme', next); } catch (e) {}
      syncIcon(next);

      // テーマ色依存ビューのみ再描画
      root.AppStore.state.dirtyViews.add('venn');
      root.AppStore.state.dirtyViews.add('similarity');
      const active = root.AppStore.state.activeView;
      if ((active === 'venn' || active === 'similarity') && root.AppStore.state.report) {
        root.AppStore.state.dirtyViews.delete(active);
        root.AppViews[active]?.render(root.AppStore.state);
      }
    });
  }

  async function checkApiStatus() {
    const textEl = document.getElementById('api-status-text');
    if (!textEl) return;
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const json = await res.json();
        textEl.textContent = json.hasToken ? '公式API接続中' : '公開データ取得';
      } else {
        textEl.textContent = '稼働中';
      }
    } catch (e) {
      textEl.textContent = 'オフライン';
    }
  }

  function updateGlobalMetaUI(storeState) {
    const metaUpdated = document.getElementById('meta-updated');
    const topUsersLabel = document.getElementById('topbar-users-label');

    if (metaUpdated && storeState.generatedAt && !storeState.isRefreshingAll) {
      const d = new Date(storeState.generatedAt);
      metaUpdated.innerHTML = `<i class="fa-regular fa-clock"></i> ${d.toLocaleString('ja-JP')}`;
    }

    if (topUsersLabel) {
      const effective = root.AppStore.getEffectiveUsers();
      const total = storeState.registeredUsers.length;
      topUsersLabel.textContent = effective.length === total
        ? `対象: ${total}人`
        : `対象: ${effective.length}/${total}人`;
    }
  }

  function renderModalUserList() {
    const listEl = document.getElementById('modal-user-list');
    const countBadge = document.getElementById('modal-users-count');
    if (!listEl) return;

    const allUsers = root.AppStore.state.registeredUsers || [];
    const tasks = root.AppStore.taskQueue.tasks || [];
    const queuedDisplay = tasks.filter(t => t.type === 'add' || t.status === 'error');
    const esc = root.UIUtils.escapeHtml;

    if (countBadge) countBadge.textContent = `${allUsers.length}人`;

    if (allUsers.length === 0 && queuedDisplay.length === 0) {
      listEl.innerHTML = '<div class="empty-box" style="padding:1.5rem;"><p>メンバーが登録されていません</p></div>';
      return;
    }

    listEl.innerHTML = '';

    allUsers.forEach(u => {
      const enabled = root.AppStore.isUserEnabled(u);
      const count = root.AppStore.getUserUniqueCount(u);
      const activeRefresh = tasks.find(
        t => t.type === 'refresh' && t.username.toLowerCase() === u.toLowerCase() && (t.status === 'pending' || t.status === 'running')
      );
      const item = document.createElement('div');
      item.className = `modal-user-item ${enabled ? '' : 'disabled-user'}`;
      item.innerHTML = `
        <div class="modal-user-left">
          <input type="checkbox" id="m-user-${esc(u)}" ${enabled ? 'checked' : ''} style="accent-color:var(--accent-pink);width:16px;height:16px;cursor:pointer;" />
          <label for="m-user-${esc(u)}" class="modal-user-name">@${esc(u)}</label>
          <span class="badge ${enabled ? 'badge-green' : ''}" style="font-size:0.7rem;">${enabled ? '対象中' : '除外中'}</span>
        </div>
        <div class="modal-user-meta">
          <span class="badge">${count.toLocaleString()} 作品</span>
          <button type="button" class="btn btn-outline btn-xs js-refresh-one" ${activeRefresh ? 'disabled' : ''}>
            ${activeRefresh ? '<i class="fa-solid fa-rotate fa-spin"></i> 更新中' : '<i class="fa-solid fa-rotate"></i> 更新'}
          </button>
          <button type="button" class="btn-danger-outline js-delete-one"><i class="fa-solid fa-trash"></i> 削除</button>
        </div>
      `;

      item.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
        const ok = root.AppStore.toggleUserEnabled(u, e.target.checked);
        if (!ok) e.target.checked = true;
        renderModalUserList();
      });

      item.querySelector('.js-refresh-one').addEventListener('click', () => {
        root.AppStore.taskQueue.enqueue('refresh', u);
        renderModalUserList();
      });

      item.querySelector('.js-delete-one').addEventListener('click', async () => {
        const ok = await root.UIUtils.showConfirm({
          title: 'メンバー削除の確認',
          message: `@${u} を比較対象から削除しますか？`,
          okText: '削除する',
          danger: true
        });
        if (ok) {
          if (await root.AppStore.removeUser(u)) {
            root.UIUtils.showToast(`@${u} を削除しました`, 'info');
            renderModalUserList();
          }
        }
      });

      listEl.appendChild(item);
    });

    queuedDisplay.forEach(task => {
      if (task.type === 'add' && task.status !== 'error' && allUsers.some(u => u.toLowerCase() === task.username.toLowerCase())) {
        return;
      }
      const isErr = task.status === 'error';
      const item = document.createElement('div');
      item.className = 'modal-user-item';
      item.style.borderLeft = `3px solid ${isErr ? 'var(--accent-pink)' : 'var(--accent-purple)'}`;
      item.innerHTML = `
        <div style="min-width:0;flex:1;">
          <strong>
            <i class="fa-solid ${task.type === 'refresh' ? 'fa-arrows-rotate' : 'fa-user-plus'} ${isErr ? 'text-pink' : 'text-purple'}"></i>
            @${esc(task.username)}
          </strong>
          <div class="small ${isErr ? 'text-pink' : 'text-muted'}">${esc(isErr ? (task.errorMsg || '取得エラー') : (task.stepMsg || ''))}</div>
        </div>
        <div class="chips-wrap">
          <span class="badge ${isErr ? 'badge-pink' : 'badge-purple'}">
            ${task.status === 'running' ? '<i class="fa-solid fa-spinner fa-spin"></i> 取得中' : isErr ? '失敗' : '待機中'}
          </span>
          ${isErr ? `<button type="button" class="btn btn-outline btn-xs js-dismiss-task" title="エラー通知を閉じる"><i class="fa-solid fa-xmark"></i> 閉じる</button>` : ''}
        </div>
      `;
      item.querySelector('.js-dismiss-task')?.addEventListener('click', () => {
        root.AppStore.taskQueue.dismissTask(task.id);
      });
      listEl.appendChild(item);
    });
  }

  function initModals() {
    const userModal = document.getElementById('user-modal');
    const openBtn = document.getElementById('btn-open-user-modal');
    const topSummary = document.getElementById('topbar-users-summary');
    const closeBtn = document.getElementById('btn-close-user-modal');
    const doneBtn = document.getElementById('btn-done-user-modal');
    const addBtn = document.getElementById('btn-add-user');
    const input = document.getElementById('new-username-input');
    const refreshAllBtn = document.getElementById('btn-refresh-all');

    const openUserModal = () => {
      renderModalUserList();
      if (userModal) userModal.style.display = 'flex';
      input?.focus();
    };
    const closeUserModal = () => {
      if (userModal) userModal.style.display = 'none';
    };

    openBtn?.addEventListener('click', openUserModal);
    topSummary?.addEventListener('click', openUserModal);
    closeBtn?.addEventListener('click', closeUserModal);
    doneBtn?.addEventListener('click', closeUserModal);
    userModal?.addEventListener('click', (e) => { if (e.target === userModal) closeUserModal(); });

    addBtn?.addEventListener('click', () => {
      const val = (input?.value || '').trim().replace(/^@/, '');
      if (!val) {
        root.UIUtils.showToast('AnnictユーザーIDを入力してください', 'warn');
        input?.focus();
        return;
      }
      if (input) input.value = '';
      root.AppStore.taskQueue.enqueue('add', val);
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addBtn?.click();
    });

    document.getElementById('btn-modal-select-all')?.addEventListener('click', () => {
      root.AppStore.selectAllEnabledUsers();
      renderModalUserList();
    });
    document.getElementById('btn-modal-deselect-all')?.addEventListener('click', () => {
      root.AppStore.keepSingleEnabledUser();
      renderModalUserList();
    });

    const triggerFullRefresh = async () => {
      const loadingBar = document.getElementById('user-modal-loading');
      const statusTxt = document.getElementById('user-modal-status');
      const reloadBtn = document.getElementById('btn-reload');
      if (loadingBar) loadingBar.style.display = 'flex';
      if (reloadBtn) reloadBtn.disabled = true;
      if (refreshAllBtn) refreshAllBtn.disabled = true;

      try {
        await root.AppStore.refreshAllUsers((msg) => {
          if (statusTxt) statusTxt.textContent = msg;
        });
      } finally {
        if (loadingBar) loadingBar.style.display = 'none';
        if (reloadBtn) reloadBtn.disabled = false;
        if (refreshAllBtn) refreshAllBtn.disabled = false;
        renderModalUserList();
      }
    };

    refreshAllBtn?.addEventListener('click', async () => {
      const ok = await root.UIUtils.showConfirm({
        title: '全メンバー再同期',
        message: '有効なメンバー全員の最新データをAnnictから再取得しますか？',
        okText: '同期を開始'
      });
      if (ok) triggerFullRefresh();
    });

    document.getElementById('btn-reload')?.addEventListener('click', () => {
      triggerFullRefresh();
      checkApiStatus();
    });

    // 画像・ペアモーダル閉じる
    const imgModal = document.getElementById('image-modal');
    document.getElementById('btn-close-image-modal')?.addEventListener('click', () => { if (imgModal) imgModal.style.display = 'none'; });
    imgModal?.addEventListener('click', (e) => { if (e.target === imgModal) imgModal.style.display = 'none'; });

    const pairModal = document.getElementById('pair-common-modal');
    const closePair = () => { if (pairModal) pairModal.style.display = 'none'; };
    document.getElementById('btn-close-pair-modal')?.addEventListener('click', closePair);
    document.getElementById('btn-done-pair-modal')?.addEventListener('click', closePair);
    pairModal?.addEventListener('click', (e) => { if (e.target === pairModal) closePair(); });

    // ESCキーでモーダルを閉じる（確認モーダル表示中はそちらが優先）
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (document.getElementById('confirm-modal')?.style.display === 'flex') return;
        closeUserModal();
        if (imgModal) imgModal.style.display = 'none';
        closePair();
      }
    });

    // タスクキュー進捗のUI反映
    root.AppStore.taskQueue.onUpdate = () => {
      const loadingBar = document.getElementById('user-modal-loading');
      const statusTxt = document.getElementById('user-modal-status');
      const running = root.AppStore.taskQueue.tasks.find(t => t.status === 'running');
      if (loadingBar && statusTxt) {
        if (running) {
          loadingBar.style.display = 'flex';
          statusTxt.textContent = running.stepMsg;
        } else {
          loadingBar.style.display = 'none';
        }
      }
      if (userModal?.style.display === 'flex') {
        renderModalUserList();
      }
    };
  }

  document.addEventListener('DOMContentLoaded', async () => {
    initSidebarAndShell();
    initThemeToggle();
    initModals();
    checkApiStatus();

    root.AppStore.subscribe((storeState) => {
      updateGlobalMetaUI(storeState);
      const active = storeState.activeView;
      const pane = document.getElementById(`view-${active}`);
      const view = root.AppViews?.[active];
      if (view && pane && storeState.dirtyViews.has(active) && storeState.report) {
        view.mount(pane);
        storeState.dirtyViews.delete(active);
        view.render(storeState);
      }
    });

    const initialHash = window.location.hash.replace('#', '');
    const startView = VIEW_META[initialHash] ? initialHash : 'venn';
    Router.navigateTo(startView, true);

    try {
      await root.AppStore.initData();
    } catch (err) {
      console.error('[App Init Error]:', err);
      root.UIUtils.showToast(err.message || 'データの読み込みに失敗しました', 'error', 6000);
    }
  });
}(window));
