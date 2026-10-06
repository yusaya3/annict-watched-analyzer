'use strict';

/**
 * パーティーLab (Party Lab)
 * 2番: 布教マッチング (Fukyo Matcher)
 * 3番: 上映会ルーレット (Party Roulette)
 * 5番: スタジオ・クリエイター偏愛レーダー (Studio & Creator Radar)
 */

(function() {
  let partyInitialized = false;
  let cachedData = null;

  // 公開エントリーポイント
  window.renderPartyLabTab = function(labsData, fullData) {
    if (!fullData || !fullData.users || fullData.users.length === 0) return;
    cachedData = fullData;

    if (!partyInitialized) {
      initPartyEvents();
      partyInitialized = true;
    }

    renderFukyoMatcher();
    renderPartyRoulette();
    renderStudioRadar();
  };

  // サブタブ切り替えイベント
  function initPartyEvents() {
    const subnavBtns = document.querySelectorAll('.party-subnav-btn');
    subnavBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('active')) return;
        subnavBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const targetSubtab = btn.getAttribute('data-party-subtab');
        document.querySelectorAll('.party-subpane').forEach(p => {
          p.classList.remove('active');
        });

        const targetPane = document.getElementById(`party-subtab-${targetSubtab}`);
        if (targetPane) {
          targetPane.classList.add('active');
        }
      });
    });
  }

  // ==========================================================================
  // 1. 布教マッチング (Fukyo Matcher)
  // ==========================================================================
  function renderFukyoMatcher() {
    const fromSelect = document.getElementById('fukyo-from-user');
    const toSelect = document.getElementById('fukyo-to-user');
    const swapBtn = document.getElementById('fukyo-swap-btn');
    if (!fromSelect || !toSelect || !cachedData) return;

    const users = cachedData.users || [];
    if (users.length < 2) return;

    // セレクトボックスの選択肢初期化（未設定時のみ）
    if (fromSelect.children.length === 0) {
      users.forEach((u, i) => {
        const optFrom = document.createElement('option');
        optFrom.value = u;
        optFrom.textContent = `@${u}`;
        if (i === 0) optFrom.selected = true;
        fromSelect.appendChild(optFrom);

        const optTo = document.createElement('option');
        optTo.value = u;
        optTo.textContent = `@${u}`;
        if (i === 1) optTo.selected = true;
        toSelect.appendChild(optTo);
      });

      fromSelect.addEventListener('change', updateFukyoList);
      toSelect.addEventListener('change', updateFukyoList);

      if (swapBtn) {
        swapBtn.addEventListener('click', () => {
          const temp = fromSelect.value;
          fromSelect.value = toSelect.value;
          toSelect.value = temp;
          updateFukyoList();
        });
      }
    }

    updateFukyoList();
  }

  function updateFukyoList() {
    const fromSelect = document.getElementById('fukyo-from-user');
    const toSelect = document.getElementById('fukyo-to-user');
    const container = document.getElementById('fukyo-results-grid');
    const summaryText = document.getElementById('fukyo-summary-text');
    if (!fromSelect || !toSelect || !container || !cachedData) return;

    const fromUser = fromSelect.value;
    const toUser = toSelect.value;

    if (fromUser === toUser) {
      container.innerHTML = '<div style="padding:2.5rem 1rem;color:var(--text-muted);grid-column:1/-1;text-align:center;"><i class="fa-solid fa-triangle-exclamation" style="font-size:2rem;margin-bottom:0.8rem;display:block;color:var(--accent-pink);"></i>異なる2人のユーザーを選択してください</div>';
      if (summaryText) summaryText.textContent = '推薦者と布教対象が同じです';
      return;
    }

    const fromList = cachedData.userWatchedLists?.[fromUser] || [];
    const toList = cachedData.userWatchedLists?.[toUser] || [];
    const toWatchedIds = new Set(toList.map(a => String(a.id)));

    // 推薦候補: fromUserが視聴済み、かつtoUserが未視聴の作品
    const candidates = fromList.filter(a => !toWatchedIds.has(String(a.id)));

    if (candidates.length === 0) {
      container.innerHTML = `<div style="padding:2.5rem 1rem;color:var(--text-muted);grid-column:1/-1;text-align:center;"><i class="fa-solid fa-heart" style="font-size:2rem;margin-bottom:0.8rem;display:block;color:var(--accent-pink);"></i>@${escapeHtml(fromUser)} が観ている作品は、@${escapeHtml(toUser)} もすべて履修済みです！布教大成功済みです✨</div>`;
      if (summaryText) summaryText.textContent = `候補作品: 0 件`;
      return;
    }

    // toUserの好みのプロファイリング
    // 1) 好きなスタジオ
    const studioStats = cachedData.labs?.studioReport?.studioStatsByUser?.[toUser]?.rankings || [];
    const favoriteStudiosMap = new Map();
    studioStats.forEach(st => {
      if (st.count > 0) favoriteStudiosMap.set(st.name, st.count);
    });

    // 2) 好きな年代傾向
    const eraCounts = {};
    toList.forEach(w => {
      const match = (w.season || '').match(/^(\d{4})/);
      if (match) {
        const era = Math.floor(parseInt(match[1]) / 10) * 10;
        eraCounts[era] = (eraCounts[era] || 0) + 1;
      }
    });

    // 候補作品ごとにマッチスコア計算
    const scoredCandidates = candidates.map(work => {
      let score = 50; // ベース
      const reasons = [];

      // スタジオ一致判定
      const allStudios = cachedData.labs?.studioReport?.allStudios || [];
      for (const st of allStudios) {
        if (st.keywords && st.keywords.some(kw => work.title.includes(kw))) {
          const userWatchCount = favoriteStudiosMap.get(st.name) || 0;
          if (userWatchCount > 0) {
            score += Math.min(25, 10 + userWatchCount * 2);
            reasons.push({ icon: 'fa-solid fa-palette', text: `@${toUser} 好みの「${st.short || st.name}」関連作` });
          }
          break;
        }
      }

      // 年代一致判定
      const seasonMatch = (work.season || '').match(/^(\d{4})/);
      if (seasonMatch) {
        const workEra = Math.floor(parseInt(seasonMatch[1]) / 10) * 10;
        const eraCnt = eraCounts[workEra] || 0;
        if (eraCnt > 15) {
          score += 15;
          reasons.push({ icon: 'fa-regular fa-calendar', text: `よく観る ${workEra}年代のアニメ` });
        }
      }

      // 一般知名度（Annict IDが若い＝歴史的名作、またはタイトルにシリーズ感）
      if (parseInt(work.id) < 5000) {
        score += 8;
      }

      // 最低限の理由フォールバック
      if (reasons.length === 0) {
        reasons.push({ icon: 'fa-solid fa-star', text: `@${fromUser} が太鼓判を押す視聴済み作品` });
      }

      // スコアを65%〜98%の範囲に整える
      const finalScore = Math.min(98, Math.max(68, score));

      return {
        work,
        score: finalScore,
        reasons
      };
    });

    // スコア降順ソート
    scoredCandidates.sort((a, b) => b.score - a.score);
    const topCandidates = scoredCandidates.slice(0, 12);

    if (summaryText) {
      summaryText.textContent = `@${fromUser} の視聴作から @${toUser} 未視聴の ${candidates.length} 作品中、相性ベスト ${topCandidates.length} 件を表示中`;
    }

    container.innerHTML = topCandidates.map((item, idx) => {
      const a = item.work;
      const rank = idx + 1;
      const rankClass = rank <= 3 ? `fukyo-rank-${rank}` : '';
      const safeTitle = escapeHtml(a.title);
      const url = a.url || `https://annict.com/works/${a.id}`;
      const thumb = a.image || '';

      const reasonsHtml = item.reasons.map(r => `
        <span class="fukyo-tag"><i class="${r.icon}"></i> ${escapeHtml(r.text)}</span>
      `).join('');

      const copyMsg = `@${toUser} さん！あなたに絶対おすすめのアニメ『${a.title}』を布教します！@${fromUser} も視聴済みで、あなたの視聴傾向との相性度は【${item.score}%】です！ぜひ見てみてね✨ ${url}`;

      return `
        <div class="fukyo-card ${rankClass}">
          <div class="fukyo-rank-badge">#${rank}</div>
          <div class="fukyo-thumb-box">
            ${thumb ? `<img src="${thumb}" alt="${safeTitle}" class="fukyo-thumb" loading="lazy" decoding="async" />` : '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);"><i class="fa-solid fa-film"></i></div>'}
          </div>
          <div class="fukyo-card-content">
            <a href="${url}" target="_blank" rel="noopener noreferrer" class="fukyo-card-title" title="${safeTitle}">${safeTitle}</a>
            <div class="fukyo-match-meter">
              <div class="fukyo-match-bar-bg">
                <div class="fukyo-match-bar-fill" style="width: ${item.score}%;"></div>
              </div>
              <span class="fukyo-match-score">${item.score}% 相性</span>
            </div>
            <div class="fukyo-reasons">
              ${reasonsHtml}
            </div>
            <div class="fukyo-actions">
              <button class="fukyo-copy-btn" data-msg="${escapeHtml(copyMsg)}" title="布教メッセージをクリップボードにコピー">
                <i class="fa-solid fa-copy"></i> 布教文をコピー
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // コピーボタンイベント
    container.querySelectorAll('.fukyo-copy-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const msg = btn.getAttribute('data-msg');
        if (navigator.clipboard) {
          navigator.clipboard.writeText(msg).then(() => {
            const original = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-check text-success"></i> コピーしました！';
            setTimeout(() => { btn.innerHTML = original; }, 2000);
          });
        }
      });
    });
  }

  // ==========================================================================
  // 2. 上映会ルーレット (Party Roulette)
  // ==========================================================================
  let selectedRouletteUsers = [];
  let currentRouletteMode = 'unwatched'; // 'unwatched' | 'common' | 'host'
  let currentRouletteEra = 'all';
  let isSpinning = false;

  function renderPartyRoulette() {
    const userContainer = document.getElementById('roulette-user-chips');
    const selectAllBtn = document.getElementById('btn-roulette-select-all');
    const deselectAllBtn = document.getElementById('btn-roulette-deselect-all');
    const modeBtns = document.querySelectorAll('.roulette-mode-btn');
    const eraBtns = document.querySelectorAll('#roulette-era-chips .chip-btn');
    const spinBtn = document.getElementById('btn-spin-roulette');
    if (!userContainer || !cachedData) return;

    const users = cachedData.users || [];
    if (selectedRouletteUsers.length === 0) {
      selectedRouletteUsers = [...users];
    }

    // ユーザーチップ生成
    function updateRouletteChips() {
      userContainer.innerHTML = '';
      users.forEach(u => {
        const isSelected = selectedRouletteUsers.includes(u);
        const chip = document.createElement('div');
        chip.className = `user-chip ${isSelected ? 'selected' : ''}`;
        chip.innerHTML = `
          <i class="fa-${isSelected ? 'solid fa-check' : 'regular fa-circle'}"></i>
          <span>@${escapeHtml(u)}</span>
        `;
        chip.addEventListener('click', () => {
          if (isSelected) {
            selectedRouletteUsers = selectedRouletteUsers.filter(x => x !== u);
          } else {
            selectedRouletteUsers.push(u);
          }
          updateRouletteChips();
        });
        userContainer.appendChild(chip);
      });
    }
    updateRouletteChips();

    if (selectAllBtn) {
      selectAllBtn.onclick = () => {
        selectedRouletteUsers = [...users];
        updateRouletteChips();
      };
    }
    if (deselectAllBtn) {
      deselectAllBtn.onclick = () => {
        selectedRouletteUsers = [];
        updateRouletteChips();
      };
    }

    // モード切替
    modeBtns.forEach(btn => {
      btn.onclick = () => {
        modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentRouletteMode = btn.getAttribute('data-mode');
      };
    });

    // 年代切替
    eraBtns.forEach(btn => {
      btn.onclick = () => {
        eraBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentRouletteEra = btn.getAttribute('data-era') || 'all';
      };
    });

    // スピンボタン
    if (spinBtn) {
      spinBtn.onclick = () => {
        if (isSpinning) return;
        spinRoulette();
      };
    }
  }

  function spinRoulette() {
    const reelBox = document.getElementById('roulette-reel-box');
    const resultBox = document.getElementById('roulette-winner-container');
    const spinBtn = document.getElementById('btn-spin-roulette');
    if (!reelBox || !resultBox || !cachedData) return;

    if (selectedRouletteUsers.length === 0) {
      alert('参加者を1人以上選択してください！');
      return;
    }

    // 候補作品リストの作成
    let candidates = [];
    const userLists = cachedData.userWatchedLists || {};
    const popularList = state.popularWorks || [];

    if (currentRouletteMode === 'unwatched') {
      // 完全初見枠: 選択ユーザー全員が未視聴の人気作品
      const allWatchedSet = new Set();
      selectedRouletteUsers.forEach(u => {
        (userLists[u] || []).forEach(a => allWatchedSet.add(String(a.id)));
      });

      candidates = popularList.filter(p => !allWatchedSet.has(String(p.id)));
      if (candidates.length === 0) {
        // フォールバック: 全体の作品から未視聴を検索
        const unionSet = new Set();
        (cachedData.users || []).forEach(u => {
          (userLists[u] || []).forEach(a => {
            if (!allWatchedSet.has(String(a.id))) unionSet.add(a);
          });
        });
        candidates = Array.from(unionSet);
      }
    } else if (currentRouletteMode === 'common') {
      // 全員履修済み枠: 選択ユーザー全員が共通して視聴している作品
      if (selectedRouletteUsers.length === 1) {
        candidates = userLists[selectedRouletteUsers[0]] || [];
      } else {
        const firstUserList = userLists[selectedRouletteUsers[0]] || [];
        const otherSets = selectedRouletteUsers.slice(1).map(u => new Set((userLists[u] || []).map(a => String(a.id))));
        candidates = firstUserList.filter(a => otherSets.every(s => s.has(String(a.id))));
      }
    } else if (currentRouletteMode === 'host') {
      // 布教・プレゼン枠: 誰か1人だけが観ていて、他全員が未視聴の作品
      const counts = {};
      const workMap = {};
      selectedRouletteUsers.forEach(u => {
        (userLists[u] || []).forEach(a => {
          const id = String(a.id);
          counts[id] = (counts[id] || 0) + 1;
          workMap[id] = { work: a, watcher: u };
        });
      });

      Object.entries(counts).forEach(([id, cnt]) => {
        if (cnt === 1) {
          candidates.push(workMap[id]);
        }
      });
    }

    // 年代フィルター適用
    if (currentRouletteEra !== 'all') {
      candidates = candidates.filter(item => {
        const w = item.work || item;
        return matchWorkEra(w.season, currentRouletteEra);
      });
    }

    if (candidates.length === 0) {
      alert('選択した条件に一致する作品が見つかりませんでした。年代やモードを変更してみてください！');
      return;
    }

    // アニメーション開始
    isSpinning = true;
    spinBtn.disabled = true;
    reelBox.classList.add('spinning');
    resultBox.style.display = 'none';

    let count = 0;
    const maxCycles = 25;
    const intervalTime = 60;

    const timer = setInterval(() => {
      const randomIdx = Math.floor(Math.random() * candidates.length);
      const raw = candidates[randomIdx];
      const w = raw.work || raw;

      reelBox.innerHTML = `
        <div style="display:flex;align-items:center;gap:1rem;padding:1rem;color:#fff;">
          <img src="${w.image || ''}" style="width:60px;height:80px;object-fit:cover;border-radius:4px;" />
          <div style="font-size:1.15rem;font-weight:800;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:300px;">
            ${escapeHtml(w.title)}
          </div>
        </div>
      `;

      count++;
      if (count >= maxCycles) {
        clearInterval(timer);
        isSpinning = false;
        spinBtn.disabled = false;
        reelBox.classList.remove('spinning');

        // 最終決定作品
        const winnerRaw = candidates[Math.floor(Math.random() * candidates.length)];
        const winner = winnerRaw.work || winnerRaw;
        const hostUser = winnerRaw.watcher;

        showWinner(winner, hostUser);
      }
    }, intervalTime);
  }

  function showWinner(anime, hostUser) {
    const resultBox = document.getElementById('roulette-winner-container');
    if (!resultBox) return;

    let modeDesc = '';
    if (currentRouletteMode === 'unwatched') {
      modeDesc = `🎉 参加者全員（${selectedRouletteUsers.length}人）がまだ誰も見ていない初見作品！`;
    } else if (currentRouletteMode === 'common') {
      modeDesc = `💖 参加者全員（${selectedRouletteUsers.length}人）が履修済みの共通作品！みんなで語り合おう！`;
    } else if (currentRouletteMode === 'host') {
      modeDesc = `🎁 @${hostUser} だけが見ている布教作品！今夜は @${hostUser} のプレゼン上映会！`;
    }

    const safeTitle = escapeHtml(anime.title);
    const url = anime.url || `https://annict.com/works/${anime.id}`;

    resultBox.innerHTML = `
      <div class="roulette-winner-card">
        <img src="${anime.image || ''}" alt="${safeTitle}" class="roulette-winner-thumb" />
        <div class="roulette-winner-info">
          <span class="roulette-winner-tag"><i class="fa-solid fa-crown"></i> 本日の当選作品！</span>
          <h3 class="roulette-winner-title">${safeTitle}</h3>
          <div class="roulette-winner-meta">
            ${anime.season ? `<span><i class="fa-regular fa-calendar"></i> ${escapeHtml(anime.season)}</span> • ` : ''}
            <span>${modeDesc}</span>
          </div>
          <div style="margin-top:auto;display:flex;gap:0.75rem;">
            <a href="${url}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">
              <i class="fa-solid fa-arrow-up-right-from-square"></i> Annictで見る
            </a>
          </div>
        </div>
      </div>
    `;

    resultBox.style.display = 'block';
  }

  // ==========================================================================
  // 3. スタジオ・クリエイター偏愛レーダー (Studio & Creator Radar)
  // ==========================================================================
  function renderStudioRadar() {
    const radarGrid = document.getElementById('radar-users-grid');
    const tableContainer = document.getElementById('radar-battle-table-container');
    if (!radarGrid || !cachedData) return;

    const sr = cachedData.labs?.studioReport;
    if (!sr || !sr.allStudios || !sr.studioStatsByUser) {
      radarGrid.innerHTML = '<p class="text-muted" style="padding:1rem;">スタジオ集計データがありません</p>';
      return;
    }

    const users = cachedData.users || [];
    const allStudios = sr.allStudios;

    // 1) ユーザー別スタジオ偏愛カード
    radarGrid.innerHTML = users.map(u => {
      const stat = sr.studioStatsByUser[u];
      if (!stat || !stat.rankings) return '';

      const top5 = stat.rankings.slice(0, 5).filter(s => s.count > 0);
      const maxCount = top5[0]?.count || 1;

      const itemsHtml = top5.map(s => {
        const pct = Math.round((s.count / maxCount) * 100);
        return `
          <div class="radar-studio-item">
            <div class="radar-studio-top">
              <span>${escapeHtml(s.short || s.name)}</span>
              <span><strong>${s.count}</strong> 作</span>
            </div>
            <div class="radar-bar-track">
              <div class="radar-bar-fill" style="width: ${pct}%; background-color: ${s.color || 'var(--accent-pink)'};"></div>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="radar-user-card">
          <div class="radar-user-header">
            <span class="radar-user-name"><i class="fa-solid fa-user text-pink"></i> @${escapeHtml(u)}</span>
            <span class="radar-user-badge">${escapeHtml(stat.studioTitle || 'アニメ愛好家')}</span>
          </div>
          <div class="radar-studio-list">
            ${itemsHtml || '<p class="text-muted">該当作品なし</p>'}
          </div>
        </div>
      `;
    }).join('');

    // 2) 主要スタジオ比較表（誰が一番見てる？）
    if (tableContainer) {
      const topStudios = allStudios.slice(0, 10);
      let headThs = '<th>スタジオ</th>' + users.map(u => `<th>@${escapeHtml(u)}</th>`).join('');

      let rowsHtml = topStudios.map(st => {
        let maxWatched = 0;
        let countsByUser = {};
        users.forEach(u => {
          const uStats = sr.studioStatsByUser[u]?.rankings || [];
          const found = uStats.find(x => x.name === st.name);
          const c = found ? found.count : 0;
          countsByUser[u] = c;
          if (c > maxWatched) maxWatched = c;
        });

        let tds = `<td><strong style="color:${st.color || 'inherit'}">${escapeHtml(st.short || st.name)}</strong></td>`;
        users.forEach(u => {
          const c = countsByUser[u];
          const isTop = c > 0 && c === maxWatched;
          const topClass = isTop ? 'class="studio-battle-top"' : '';
          tds += `<td ${topClass}>${c}作 ${isTop ? '👑' : ''}</td>`;
        });

        return `<tr>${tds}</tr>`;
      }).join('');

      tableContainer.innerHTML = `
        <table class="studio-battle-table">
          <thead>
            <tr>${headThs}</tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      `;
    }
  }

  // ユーティリティ: 年代判定
  function matchWorkEra(season, era) {
    if (!season) return era === 'older';
    const match = season.match(/^(\d{4})/);
    if (!match) return era === 'older';
    const year = parseInt(match[1]);
    if (era === '2020s') return year >= 2020;
    if (era === '2010s') return year >= 2010 && year < 2020;
    if (era === '2000s') return year >= 2000 && year < 2010;
    if (era === 'older') return year < 2000;
    return true;
  }

})();
