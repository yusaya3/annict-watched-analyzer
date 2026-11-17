(function (root) {
  'use strict';

  const USER_COLORS = ['#f43f5e', '#38bdf8', '#a855f7', '#fbbf24', '#34d399', '#ec4899', '#06b6d4', '#f97316', '#84cc16'];
  let modalReqSeq = 0;

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * XSS対策：http(s) または安全な相対パスのみ許可し、javascript: スキーム等を完全遮断
   */
  function sanitizeUrl(rawUrl, fallback = '#') {
    if (!rawUrl || typeof rawUrl !== 'string') return fallback;
    const trimmed = rawUrl.trim();
    if (!trimmed) return fallback;
    if (trimmed.startsWith('./') || (trimmed.startsWith('/') && !/^\/[\\/]/.test(trimmed))) return trimmed;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.href;
      }
    } catch (e) {}
    return fallback;
  }

  function showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = {
      success: 'fa-solid fa-circle-check text-green',
      error: 'fa-solid fa-circle-exclamation text-red',
      warn: 'fa-solid fa-triangle-exclamation text-gold',
      info: 'fa-solid fa-circle-info text-blue'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <i class="${icons[type] || icons.info}" style="margin-top:2px;"></i>
      <div style="flex:1;">${escapeHtml(message)}</div>
    `;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'opacity 0.2s, transform 0.2s';
      setTimeout(() => toast.remove(), 220);
    }, duration);
  }

  function showConfirm({ title = '確認', message = '', okText = '実行する', danger = false } = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirm-modal');
      const titleEl = document.getElementById('confirm-modal-title');
      const msgEl = document.getElementById('confirm-modal-message');
      const okBtn = document.getElementById('btn-confirm-ok');
      const cancelBtn = document.getElementById('btn-confirm-cancel');
      const closeBtn = document.getElementById('btn-close-confirm-modal');

      if (!modal || !okBtn || !cancelBtn) {
        resolve(window.confirm(message));
        return;
      }

      titleEl.textContent = title;
      msgEl.textContent = message;
      okBtn.textContent = okText;
      okBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
      modal.style.display = 'flex';

      const cleanup = (result) => {
        modal.style.display = 'none';
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        closeBtn?.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onEsc, true);
        resolve(result);
      };

      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);
      const onBackdrop = (e) => {
        if (e.target === modal) cleanup(false);
      };
      const onEsc = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          cleanup(false);
        }
      };

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      closeBtn?.addEventListener('click', onCancel);
      modal.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onEsc, true);
    });
  }

  function openImageModal(title, imageUrl, workId = null) {
    const modal = document.getElementById('image-modal');
    const titleEl = document.getElementById('image-modal-title');
    const imgEl = document.getElementById('image-modal-img');
    if (!modal || !titleEl || !imgEl) return;

    const myReqId = ++modalReqSeq;
    const safeImg = sanitizeUrl(imageUrl, '');
    titleEl.textContent = title || '作品キービジュアル';
    if (safeImg) {
      imgEl.style.display = '';
      imgEl.src = safeImg;
    } else {
      imgEl.style.display = 'none';
      imgEl.removeAttribute('src');
    }
    imgEl.alt = title || '';
    modal.style.display = 'flex';

    const targetId = workId || (safeImg ? (safeImg.match(/\/workimage\/(\d+)\//) || [])[1] : null);
    if (targetId && /^\d+$/.test(String(targetId))) {
      fetch(`/api/annict-image/${targetId}`)
        .then(r => r.json())
        .then(data => {
          if (myReqId !== modalReqSeq || modal.style.display !== 'flex') return;
          const cleanHi = sanitizeUrl(data?.url, '');
          if (cleanHi) {
            const hi = new Image();
            hi.onload = () => {
              if (myReqId === modalReqSeq && modal.style.display === 'flex') {
                imgEl.src = cleanHi;
              }
            };
            hi.src = cleanHi;
          }
        })
        .catch(() => {});
    }
  }

  /**
   * 統一アニメカードを生成
   * ポスター上にバッジを重ねずカードボディに配置し、アートワークとロゴを保護する
   */
  function createAnimeCardHtml(anime, options = {}) {
    const {
      showGenre = true,
      watchers = null,
      showStoryBtn = false,
      extraMeta = '',
      eager = false
    } = options;

    const title = anime.title || '無題';
    const safeTitle = escapeHtml(title);
    const id = anime.id ? String(anime.id) : '';
    const safeId = escapeHtml(id);
    const workUrl = sanitizeUrl(anime.url || (id ? `https://annict.com/works/${id}` : '#'), '#');
    const imgSrc = sanitizeUrl(anime.image || '', '');

    let genreChipHtml = '';
    if (showGenre && root.AppStore && root.GenreEngine) {
      const catId = root.AppStore.getWorkCategory(title);
      const def = root.GenreEngine.GENRE_DEF_MAP[catId];
      if (def && catId !== 'other') {
        const gcl = def.colorLight || def.color;
        const cardLabel = def.shortLabel || def.label;
        genreChipHtml = `<div class="anime-card-genre-inline" style="--gc:${def.color};--gcl:${gcl};"><i class="${def.icon}"></i> <span>${escapeHtml(cardLabel)}</span></div>`;
      } else {
        genreChipHtml = `<div class="anime-card-genre-inline is-muted"><i class="fa-solid fa-tag"></i> <span>その他</span></div>`;
      }
    }

    const thumbHtml = imgSrc
      ? `<img src="${escapeHtml(imgSrc)}" alt="${safeTitle}" class="anime-card-thumb" data-zoom-title="${safeTitle}" data-zoom-img="${escapeHtml(imgSrc)}" data-zoom-id="${safeId}" loading="${eager ? 'eager' : 'lazy'}"${eager ? ' fetchpriority="high"' : ''} decoding="async" />`
      : `<div class="anime-card-no-thumb"><i class="fa-solid fa-film"></i><span class="anime-card-no-thumb-label">NO IMAGE</span></div>`;

    const seasonHtml = anime.season
      ? `<span><i class="fa-regular fa-calendar"></i> ${escapeHtml(anime.season)}</span>`
      : `<span class="text-muted">時期未設定</span>`;

    let watchersHtml = '';
    if (Array.isArray(watchers) && watchers.length > 0) {
      watchersHtml = `
        <div class="anime-card-watchers">
          ${watchers.slice(0, 4).map(u => `<span class="watcher-pill">@${escapeHtml(u)}</span>`).join('')}
          ${watchers.length > 4 ? `<span class="watcher-pill">+${watchers.length - 4}</span>` : ''}
        </div>
      `;
    }

    const storyBtnHtml = showStoryBtn
      ? `<div class="anime-card-actions">
           <button type="button" class="card-action-btn js-jump-story" data-anime-title="${safeTitle}" title="ストーリー構造が似ている作品を探す">
             <i class="fa-solid fa-brain"></i> <span>類似ストーリー</span>
           </button>
         </div>`
      : '';

    return `
      <a class="anime-card" href="${escapeHtml(workUrl)}" target="_blank" rel="noopener noreferrer" data-work-id="${safeId}">
        <div class="anime-card-thumb-wrap${imgSrc ? '' : ' is-empty'}">
          ${thumbHtml}
        </div>
        <div class="anime-card-body">
          <div class="anime-card-title" title="${safeTitle}">${safeTitle}</div>
          ${genreChipHtml}
          <div class="anime-card-meta">
            ${seasonHtml}
            ${extraMeta}
          </div>
          ${watchersHtml}
          ${storyBtnHtml}
        </div>
      </a>
    `;
  }

  function markThumbLoaded(img) {
    if (!img) return;
    img.classList.add('is-loaded');
    const wrap = img.closest('.anime-card-thumb-wrap');
    if (wrap) {
      wrap.classList.add('is-ready');
      wrap.classList.remove('is-empty');
    }
  }

  function replaceThumbWithNoImage(img) {
    if (!img) return;
    const wrap = img.closest('.anime-card-thumb-wrap, .sim-poster-wrap');
    img.remove();
    if (wrap) {
      wrap.classList.add('is-empty');
      wrap.classList.remove('is-ready');
      if (!wrap.querySelector('.anime-card-no-thumb')) {
        const noThumb = document.createElement('div');
        noThumb.className = 'anime-card-no-thumb';
        noThumb.innerHTML = '<i class="fa-solid fa-film"></i><span class="anime-card-no-thumb-label">NO IMAGE</span>';
        wrap.appendChild(noThumb);
      }
    }
  }

  /**
   * サムネイル読み込み完了・エラーの監視＆既に読込済みの要素への即時状態同期
   */
  function syncThumbStates(container) {
    if (!container) return;
    if (container.dataset.thumbStatesBound !== '1') {
      container.dataset.thumbStatesBound = '1';
      container.addEventListener('load', (e) => {
        const target = e.target;
        if (target && target.tagName === 'IMG' && target.classList.contains('anime-card-thumb')) {
          markThumbLoaded(target);
        }
      }, true);
      container.addEventListener('error', (e) => {
        const target = e.target;
        if (target && target.tagName === 'IMG' && target.classList.contains('anime-card-thumb')) {
          replaceThumbWithNoImage(target);
        }
      }, true);
    }

    container.querySelectorAll('img.anime-card-thumb').forEach(img => {
      if (img.complete) {
        if (img.naturalWidth > 0) {
          markThumbLoaded(img);
        } else {
          replaceThumbWithNoImage(img);
        }
      } else if (!img.dataset.thumbTimeoutBound) {
        img.dataset.thumbTimeoutBound = '1';
        setTimeout(() => {
          if (img.isConnected && !img.complete) {
            replaceThumbWithNoImage(img);
          }
        }, 8000);
      }
    });
  }

  /**
   * 親コンテナに画像ズーム・読み込み状態管理・類似ジャンプのイベント委譲をバインド
   */
  function bindCardContainerEvents(container) {
    if (!container) return;
    syncThumbStates(container);
    if (container.dataset.cardEventsBound === '1') return;
    container.dataset.cardEventsBound = '1';

    container.addEventListener('click', (e) => {
      const storyBtn = e.target.closest('.js-jump-story');
      if (storyBtn) {
        e.preventDefault();
        e.stopPropagation();
        const title = storyBtn.getAttribute('data-anime-title');
        if (title && root.AppRouter?.openStoryByTitle) {
          root.AppRouter.openStoryByTitle(title);
        }
        return;
      }

      const thumb = e.target.closest('.anime-card-thumb');
      if (thumb) {
        e.preventDefault();
        e.stopPropagation();
        openImageModal(
          thumb.getAttribute('data-zoom-title') || thumb.alt,
          thumb.getAttribute('data-zoom-img') || thumb.src,
          thumb.getAttribute('data-zoom-id') || null
        );
      }
    });
  }

  /**
   * 遅延ロード画像を1回のDOM走査 (O(N)) で安全に差し替える
   */
  function applyLazyThumbImages(grid, worksSlice, options = {}) {
    if (!grid || !worksSlice || worksSlice.length === 0) return;
    const { eager = false } = options;
    const workById = new Map();
    for (let i = 0; i < worksSlice.length; i++) {
      const w = worksSlice[i];
      if (w?.id && w?.image) workById.set(String(w.id), w);
    }
    if (workById.size === 0) return;

    const cards = grid.querySelectorAll('.anime-card[data-work-id]');
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const wid = card.getAttribute('data-work-id');
      const w = workById.get(wid);
      if (!w) continue;
      const wrap = card.querySelector('.anime-card-thumb-wrap');
      if (wrap && !wrap.querySelector('.anime-card-thumb')) {
        const cleanSrc = sanitizeUrl(w.image, '');
        if (!cleanSrc) continue;
        wrap.classList.remove('is-empty', 'is-ready');
        wrap.querySelector('.anime-card-no-thumb')?.remove();
        const img = document.createElement('img');
        img.src = cleanSrc;
        img.alt = w.title || '';
        img.className = 'anime-card-thumb';
        img.setAttribute('data-zoom-title', w.title || '');
        img.setAttribute('data-zoom-img', cleanSrc);
        img.setAttribute('data-zoom-id', wid);
        img.loading = eager ? 'eager' : 'lazy';
        img.decoding = 'async';
        wrap.appendChild(img);
        if (img.complete && img.naturalWidth > 0) markThumbLoaded(img);
      }
    }
  }

  async function hydratePopularThumbs(grid, worksSlice) {
    if (!grid || !Array.isArray(worksSlice) || worksSlice.length === 0 || !root.AppStore) return;
    const head = worksSlice.slice(0, 12);
    const tail = worksSlice.slice(12);
    if (await root.AppStore.ensurePopularImages(head)) {
      applyLazyThumbImages(grid, head, { eager: true });
    }
    if (tail.length > 0 && await root.AppStore.ensurePopularImages(tail)) {
      applyLazyThumbImages(grid, tail, { eager: false });
    }
  }

  /**
   * プログレッシブ遅延描画グリッド（最大360件ステップ追加でDOM肥大フリーズ防止）
   */
  function renderLazyGrid(container, items, renderItemHtml, options = {}) {
    if (!container) return;
    bindCardContainerEvents(container);

    const {
      batchSize = 72,
      emptyHtml = '<div class="empty-box"><i class="fa-solid fa-film"></i><p>該当する作品がありません</p></div>',
      onAfterBatch = null
    } = options;

    if (container._lazyObserver) {
      container._lazyObserver.disconnect();
      container._lazyObserver = null;
    }

    if (!items || items.length === 0) {
      container.innerHTML = emptyHtml;
      return;
    }

    let renderedCount = 0;
    const renderNextBatch = (count = batchSize) => {
      const existingMore = container.querySelector('.load-more-row');
      if (existingMore) existingMore.remove();

      const slice = items.slice(renderedCount, renderedCount + count);
      if (slice.length === 0) return;

      const html = slice.map((item, i) => renderItemHtml(item, renderedCount + i)).join('');
      if (renderedCount === 0) {
        container.innerHTML = html;
      } else {
        container.insertAdjacentHTML('beforeend', html);
      }
      renderedCount += slice.length;
      syncThumbStates(container);

      if (onAfterBatch) onAfterBatch(slice, renderedCount);

      if (renderedCount < items.length) {
        const remaining = items.length - renderedCount;
        const nextCount = Math.min(batchSize, remaining);
        const jumpCount = Math.min(360, remaining);
        const wrap = document.createElement('div');
        wrap.className = 'load-more-row';
        wrap.innerHTML = `
          <button type="button" class="btn btn-primary btn-sm js-lazy-more">
            <i class="fa-solid fa-angles-down"></i> さらに ${nextCount.toLocaleString()} 件を表示 (残り ${remaining.toLocaleString()} 件)
          </button>
          ${remaining > batchSize ? `<button type="button" class="btn btn-outline btn-sm js-lazy-jump">+${jumpCount.toLocaleString()} 件表示</button>` : ''}
        `;
        container.appendChild(wrap);

        wrap.querySelector('.js-lazy-more')?.addEventListener('click', () => {
          container._lazyObserver?.disconnect();
          container._lazyObserver = null;
          renderNextBatch(batchSize);
        });
        wrap.querySelector('.js-lazy-jump')?.addEventListener('click', () => {
          container._lazyObserver?.disconnect();
          container._lazyObserver = null;
          renderNextBatch(jumpCount);
        });

        if (window.IntersectionObserver) {
          const obs = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
              obs.disconnect();
              renderNextBatch(batchSize);
            }
          }, { rootMargin: '280px' });
          obs.observe(wrap);
          container._lazyObserver = obs;
        }
      }
    };

    renderNextBatch(batchSize);
  }

  root.UIUtils = {
    USER_COLORS,
    escapeHtml,
    sanitizeUrl,
    showToast,
    showConfirm,
    openImageModal,
    createAnimeCardHtml,
    markThumbLoaded,
    replaceThumbWithNoImage,
    syncThumbStates,
    bindCardContainerEvents,
    applyLazyThumbImages,
    hydratePopularThumbs,
    renderLazyGrid
  };

  root.openImageModal = openImageModal;
}(window));
