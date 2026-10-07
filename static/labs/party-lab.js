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
  // 3. スタジオ・声優・クリエイター偏愛レーダー (Studio, VA & Creator Radar)
  // ==========================================================================
  let currentRadarType = 'va'; // 'va' | 'creator' | 'studio'

  const VOICE_ACTORS = [
    { name: '花澤香菜', short: '花澤香菜', color: '#f43f5e', keywords: ['化物語', '物語シリーズ', 'Angel Beats', 'STEINS;GATE', 'シュタインズ', 'PSYCHO-PASS', 'サイコパス', 'ニセコイ', 'はたらく細胞', '五等分の花嫁', '鬼滅の刃', 'To LOVEる', 'インフィニット・ストラトス', 'IS＜', '俺の妹がこんなに可愛いわけがない', '青の祓魔師', '言の葉の庭', '結城友奈は勇者である', '久保さんは僕を許さない', '宇宙よりも遠い場所', 'よりもい', '狂乱家族日記', 'セキレイ', '咲-Saki-', 'ぽてまよ', 'PandoraHearts', 'デュラララ', '会長はメイド様', '神のみぞ知るセカイ', 'モーレツ宇宙海賊', '貧乏神が!', 'ささみさん@がんばらない', '東京喰種', 'トーキョーグール', '寄生獣', '監獄学園', 'orange', 'ハッピーシュガーライフ', '消滅都市', '魔女の旅々', 'ゾンビランドサガ', 'うる星やつら'] },
    { name: '早見沙織', short: '早見沙織', color: '#38bdf8', keywords: ['俺の青春ラブコメはまちがっている', '俺ガイル', '魔法科高校の劣等生', '鬼滅の刃', 'SPY×FAMILY', 'スパイファミリー', '聲の形', '賭ケグルイ', 'あの日見た花の名前を僕達はまだ知らない', 'あの花', 'そらのおとしもの', 'バクマン', '赤髪の白雪姫', '山田くんと7人の魔女', 'ダンジョンに出会いを求めるのは間違っているだろうか', 'ダンまち', '響け！ユーフォニアム', 'ユーフォ', '神のみぞ知るセカイ', 'RDG', 'マンガ家さんとアシスタントさんと', '異能バトルは日常系のなかで', 'SHOW BY ROCK!!', '終わりのセラフ', '無彩限のファントム・ワールド', '覆面系ノイズ', '十二大戦', '宇宙よりも遠い場所', '痛いのは嫌なので防御力に極振りしたいと思います', '防振り', '平家物語'] },
    { name: '水瀬いのり', short: '水瀬いのり', color: '#06b6d4', keywords: ['Re:ゼロから始める異世界生活', 'リゼロ', 'ご注文はうさぎですか', 'ごちうさ', 'ダンジョンに出会いを求めるのは間違っているだろうか', 'ダンまち', '宇宙よりも遠い場所', 'よりもい', '青春ブタ野郎', '青ブタ', '五等分の花嫁', '心が叫びたがってるんだ', 'ここさけ', '政宗くんのリベンジ', '魔王城でおやすみ', '天体のメソッド', 'がっこうぐらし！', '戦姫絶唱シンフォギア', 'ネトゲの嫁は女の子じゃないと思った？', '信長の忍び', '徒然チルドレン', '少女終末旅行', '刀使ノ巫女', 'ロード・エルメロイ', 'ソマリと森の神様', '現実主義勇者の王国再建記', '阿波連さんははかれない', '山田くんとLv999の恋をする'] },
    { name: '悠木碧', short: '悠木碧', color: '#a855f7', keywords: ['魔法少女まどか☆マギカ', 'まどか☆マギカ', '幼女戦記', 'シンフォギア', 'やはり俺の青春ラブコメはまちがっている', '俺ガイル', 'ワンパンマン', '僕のヒーローアカデミア', 'ヒロアカ', '七つの大罪', '平家物語', '薬屋のひとりごと', '夢色パティシエール', 'ダンス イン ザ ヴァンパイアバンド', '百花繚乱', 'GOSICK', 'Aチャンネル', 'べるぜバブ', '咲-Saki-', '氷菓', 'ソードアート・オンライン', 'SAO', '六花の勇者', '僕だけがいない街', 'アホガール', 'キノの旅', 'スパイ教室', 'アンデッドアンラック'] },
    { name: '松岡禎丞', short: '松岡禎丞', color: '#ef4444', keywords: ['ソードアート・オンライン', 'SAO', 'ノーゲーム・ノーライフ', 'ノゲノラ', 'ダンジョンに出会いを求めるのは間違っているだろうか', 'ダンまち', '食戟のソーマ', '五等分の花嫁', '冴えない彼女の育てかた', '冴えカノ', '鬼滅の刃', 'リコリス・リコイル', '神様のメモ帳', 'さくら荘のペットな彼女', 'トリニティセブン', 'アブソリュート・デュオ', '落第騎士の英雄譚', 'エロマンガ先生', 'ひとりぼっちの○○生活', 'ドッグ・アンド・シザーズ', '魔王城でおやすみ', '探偵はもう、死んでいる。', '佐々木と宮野'] },
    { name: '神谷浩史', short: '神谷浩史', color: '#8b5cf6', keywords: ['化物語', '物語シリーズ', 'デュラララ!!', '進撃の巨人', '夏目友人帳', '黒子のバスケ', 'ノラガミ', 'おそ松さん', '斉木楠雄のΨ難', 'Angel Beats!', '青の祓魔師', 'さよなら絶望先生', '荒川アンダー ザ ブリッジ', 'WORKING!!', 'しろくまカフェ', 'ハマトラ', 'キャプテン・アース', 'ハイキュー!!', '監獄学園', '文豪ストレイドッグス', 'ブルーロック'] },
    { name: '中村悠一', short: '中村悠一', color: '#14b8a6', keywords: ['CLANNAD', 'クラナド', 'マクロスF', '俺の妹がこんなに可愛いわけがない', '氷菓', '魔法科高校の劣等生', '呪術廻戦', 'おそ松さん', 'Dr.STONE', 'ドクターストーン', '月刊少女野崎くん', 'おおきく振りかぶって', '機動戦士ガンダム00', 'FAIRY TAIL', 'うどんの国の金色毛鞠', 'ゴブリンスレイヤー', 'フルーツバスケット', '無能なナナ'] },
    { name: '佐倉綾音', short: '佐倉綾音', color: '#ec4899', keywords: ['ご注文はうさぎですか', 'ごちうさ', 'やはり俺の青春ラブコメはまちがっている', '俺ガイル', '僕のヒーローアカデミア', 'ヒロアカ', '五等分の花嫁', 'のんのんびより', '四月は君の嘘', 'Charlotte', 'シャーロット', 'トリニティセブン', '夢喰いメリー', 'プリティーリズム', 'じょしらく', 'ビビッドレッド・オペレーション', '有頂天家族', '東京レイヴンズ', 'selector', 'レーカン！', 'りゅうおうのおしごと！', 'スパイ教室', 'カノジョも彼女'] },
    { name: '高橋李依', short: '高橋李依', color: '#10b981', keywords: ['Re:ゼロから始める異世界生活', 'リゼロ', 'この素晴らしい世界に祝福を！', 'このすば', 'からかい上手の高木さん', '高木さん', '【推しの子】', '推しの子', 'ゆるキャン△', '彼女、お借りします', 'かのかり', 'Fate/Grand Order', 'FGO', 'それが声優！', '魔法つかいプリキュア！', 'ナイツ＆マジック', 'コミックガールズ', 'はたらく細胞', 'かくしごと', 'トモちゃんは女の子！', 'ティアムーン帝国物語'] },
    { name: '種崎敦美', short: '種崎敦美', color: '#0ea5e9', keywords: ['SPY×FAMILY', 'スパイファミリー', '葬送のフリーレン', 'フリーレン', '響け！ユーフォニアム', 'ユーフォ', 'リズと青い鳥', '青春ブタ野郎', '青ブタ', '僕の心のヤバイやつ', '僕ヤバ', '魔法使いの嫁', 'ダイの大冒険', 'Vivy', 'ヴィヴィ', '約束のネバーランド', 'この音とまれ！', '魔導具師ダリヤ'] },
    { name: '櫻井孝宏', short: '櫻井孝宏', color: '#7c3aed', keywords: ['化物語', '物語シリーズ', 'コードギアス', '反逆のルルーシュ', '呪術廻戦', '鬼滅の刃', 'PSYCHO-PASS', 'サイコパス', 'モブサイコ100', 'おそ松さん', 'ダイヤのA', 'あの日見た花の名前を僕達はまだ知らない', 'あの花', 'ジョジョの奇妙な冒険', '有頂天家族', '響け！ユーフォニアム'] },
    { name: '梶裕貴', short: '梶裕貴', color: '#d97706', keywords: ['進撃の巨人', '七つの大罪', '僕のヒーローアカデミア', 'ヒロアカ', 'ハイキュー!!', 'アオハライド', 'アクセル・ワールド', 'ギルティクラウン', 'ノラガミ', 'からかい上手の高木さん', '高木さん', 'マギ The', 'マギ シンドバッド', 'ワールドトリガー'] },
    { name: '内山昂輝', short: '内山昂輝', color: '#059669', keywords: ['ハイキュー!!', '僕のヒーローアカデミア', 'ヒロアカ', '呪術廻戦', 'ホリミヤ', '山田くんとLv999の恋をする', 'ピンポン', 'Charlotte', 'シャーロット', 'ニセコイ', '機動戦士ガンダムUC', 'ソウルイーター', 'Free!'] },
    { name: '雨宮天', short: '雨宮天', color: '#2563eb', keywords: ['この素晴らしい世界に祝福を！', 'このすば', 'アカメが斬る！', '一週間フレンズ。', '七つの大罪', '東京喰種', 'トーキョーグール', 'プラスティック・メモリーズ', '彼女、お借りします', 'かのかり', '見える子ちゃん', 'アルドノア・ゼロ', 'パンチライン', 'モンスター娘のいる日常', 'クオリディア・コード', 'ポッピンQ', '理系が恋に落ちたので証明してみた。', 'キミと僕の最後の戦場、あるいは世界が始まる聖戦'] },
    { name: '杉田智和', short: '杉田智和', color: '#64748b', keywords: ['涼宮ハルヒ', '銀魂', 'ジョジョの奇妙な冒険', '無職転生', '暗殺教室', '荒川アンダー ザ ブリッジ', '男子高校生の日常', 'SKET DANCE', '翠星のガルガンティア', 'ヲタクに恋は難しい', 'ちょびっツ', 'ハニカム', 'ペルソナ5'] },
    { name: '釘宮理恵', short: '釘宮理恵', color: '#f59e0b', keywords: ['灼眼のシャナ', 'シャナ', 'ゼロの使い魔', 'とらドラ！', '銀魂', '鋼の錬金術師', 'ハヤテのごとく！', '緋弾のアリア', 'アイドルマスター', 'アイマス', 'FAIRY TAIL', '境界のRINNE', '楽園追放', '十二国記', '金色のガッシュベル!!', 'BLEACH', '咲-Saki-', 'ペルソナ4', '東京喰種', '血界戦線', '呪術廻戦'] },
    { name: '内田真礼', short: '内田真礼', color: '#eab308', keywords: ['中二病でも恋がしたい！', 'ノラガミ', 'アオハライド', 'ご注文はうさぎですか', 'ごちうさ', 'アイドルマスター シンデレラガールズ', 'ダンまち', 'ダンジョンに出会いを求めるのは間違っているだろうか', '乙女ゲームの破滅フラグしかない悪役令嬢に転生してしまった…', 'はめふら', '約束のネバーランド', '約ネバ', '青春ブタ野郎', '青ブタ', 'ドメスティックな彼女', 'さんかれあ'] },
    { name: '東山奈央', short: '東山奈央', color: '#fb923c', keywords: ['やはり俺の青春ラブコメはまちがっている', '俺ガイル', '神のみぞ知るセカイ', 'きんいろモザイク', 'きんモザ', 'はたらく魔王さま！', 'ニセコイ', 'ゆるキャン△', 'マクロスΔ', '青春ブタ野郎', '青ブタ', '彼女、お借りします', 'かのかり', '咲-Saki-'] },
    { name: '茅野愛衣', short: '茅野愛衣', color: '#f472b6', keywords: ['あの日見た花の名前を僕達はまだ知らない', 'あの花', 'ギルティクラウン', '氷菓', 'さくら荘のペットな彼女', 'ノーゲーム・ノーライフ', 'ノゲノラ', '四月は君の嘘', '冴えない彼女の育てかた', '冴えカノ', 'この素晴らしい世界に祝福を！', 'このすば', '3月のライオン', 'ソードアート・オンライン', 'SAO', '無職転生'] },
    { name: '鬼頭明里', short: '鬼頭明里', color: '#e11d48', keywords: ['鬼滅の刃', 'ようこそ実力至上主義の教室へ', 'よう実', '私に天使が舞い降りた！', 'わたてん', 'まちカドまぞく', '地縛少年花子くん', 'トニカクカワイイ', 'ラブライブ！虹ヶ咲学園スクールアイドル同好会', 'ニジガク', 'ウマ娘 プリティーダービー', 'シャドーハウス', '明日ちゃんのセーラー服', 'カッコウの許嫁'] }
  ];

  const DIRECTORS_AND_WRITERS = [
    { name: '新房昭之 (監督)', short: '新房昭之', type: '監督', color: '#a855f7', keywords: ['化物語', '物語シリーズ', '魔法少女まどか☆マギカ', 'まどか☆マギカ', 'さよなら絶望先生', '荒川アンダー ザ ブリッジ', 'ニセコイ', '3月のライオン', 'ひだまりスケッチ', '電波女と青春男', 'メカクシティアクターズ', '美少年探偵団'] },
    { name: '水島努 (監督)', short: '水島努', type: '監督', color: '#10b981', keywords: ['ガールズ＆パンツァー', 'ガルパン', 'SHIROBAKO', '侵略!イカ娘', '監獄学園', 'Another', 'よんでますよ、アザゼルさん', '荒野のコトブキ飛行隊', '終末トレインどこへいく？', 'おおきく振りかぶって'] },
    { name: '長井龍雪 (監督)', short: '長井龍雪', type: '監督', color: '#3b82f6', keywords: ['とある科学の超電磁砲', 'レールガン', 'とらドラ！', 'あの日見た花の名前を僕達はまだ知らない', 'あの花', '心が叫びたがってるんだ', 'ここさけ', '機動戦士ガンダム 鉄血のオルフェンズ', '空の青さを知る人よ', 'ふれる。'] },
    { name: '山田尚子 (監督)', short: '山田尚子', type: '監督', color: '#38bdf8', keywords: ['けいおん！', '聲の形', 'たまこまーけっと', 'リズと青い鳥', '平家物語', 'きみの色'] },
    { name: '石原立也 (監督)', short: '石原立也', type: '監督', color: '#06b6d4', keywords: ['涼宮ハルヒの憂鬱', 'CLANNAD', 'クラナド', 'AIR', 'Kanon', '日常', '中二病でも恋がしたい！', '響け！ユーフォニアム', 'ユーフォ', '無彩限のファントム・ワールド'] },
    { name: '荒木哲郎 (監督)', short: '荒木哲郎', type: '監督', color: '#ef4444', keywords: ['進撃の巨人', 'DEATH NOTE', 'デスノート', 'ギルティクラウン', '甲鉄城のカバネリ', 'バブル', '学園黙示録'] },
    { name: '今石洋之 (監督)', short: '今石洋之', type: '監督', color: '#f59e0b', keywords: ['天元突破グレンラガン', 'グレンラガン', 'キルラキル', 'プロメア', 'サイバーパンク エッジランナーズ', 'パンティ&ストッキング'] },
    { name: '岸誠二 (監督)', short: '岸誠二', type: '監督', color: '#14b8a6', keywords: ['Angel Beats!', 'AngelBeats', 'Persona4', 'ペルソナ4', 'ダンガンロンパ', '暗殺教室', '月がきれい', '結城友奈は勇者である', 'ゆゆゆ', 'あそびあそばせ', 'ようこそ実力至上主義の教室へ'] },
    { name: '花田十輝 (脚本)', short: '花田十輝', type: '脚本', color: '#f43f5e', keywords: ['ラブライブ！', '響け！ユーフォニアム', 'ユーフォ', '宇宙よりも遠い場所', 'よりもい', 'STEINS;GATE', 'シュタインズ', '中二病でも恋がしたい！', '境界の彼方', '日常', 'ノーゲーム・ノーライフ', '僕の心のヤバイやつ', '僕ヤバ', 'ガールズバンドクライ', '艦隊これくしょん'] },
    { name: '岡田麿里 (脚本)', short: '岡田麿里', type: '脚本', color: '#ec4899', keywords: ['あの日見た花の名前を僕達はまだ知らない', 'あの花', '心が叫びたがってるんだ', 'ここさけ', 'さよならの朝に約束の花をかざろう', 'とらドラ！', '花咲くいろは', '機動戦士ガンダム 鉄血のオルフェンズ', '凪のあすから', '荒ぶる季節の乙女どもよ。', 'アリスとテレスのまぼろし工場'] },
    { name: '虚淵玄 (脚本)', short: '虚淵玄', type: '脚本', color: '#8b5cf6', keywords: ['魔法少女まどか☆マギカ', 'まどか☆マギカ', 'Fate/Zero', 'PSYCHO-PASS', 'サイコパス', '翠星のガルガンティア', '楽園追放', 'アルドノア・ゼロ', 'Thunderbolt Fantasy'] },
    { name: '吉田玲子 (脚本)', short: '吉田玲子', type: '脚本', color: '#eab308', keywords: ['けいおん！', 'ガールズ＆パンツァー', 'ガルパン', 'ヴァイオレット・エヴァーガーデン', 'たまこまーけっと', 'リズと青い鳥', 'のんのんびより', 'ARIA', '平家物語', '若おかみは小学生！', 'きみの色'] },
    { name: '横手美智子 (脚本)', short: '横手美智子', type: '脚本', color: '#22c55e', keywords: ['SHIROBAKO', '侵略!イカ娘', 'からかい上手の高木さん', '高木さん', '監獄学園', '政宗くんのリベンジ', 'ジャヒー様はくじけない！', '荒川アンダー ザ ブリッジ'] },
    { name: '大河内一楼 (脚本)', short: '大河内一楼', type: '脚本', color: '#d946ef', keywords: ['コードギアス', '機動戦士ガンダム 水星の魔女', '水星の魔女', '甲鉄城のカバネリ', 'プリンセス・プリンシパル', 'スパイ教室', '革命機ヴァルヴレイヴ', 'プラネテス'] }
  ];

  function matchEntity(title, item) {
    if (!item.keywords || !title) return false;
    return item.keywords.some(kw => {
      if (kw === '日常') {
        return title === '日常' || title.startsWith('日常 ') || title.startsWith('日常（') || title.startsWith('日常(');
      }
      if (kw === 'K') {
        return (title === 'K' || title.startsWith('K ') || title.startsWith('K RETURN') || title.startsWith('K SEVEN') || title.includes('劇場版 K')) && !title.includes('Kiss') && !title.includes('SKY') && !title.includes('BLACK') && !title.includes('DARK');
      }
      return title.includes(kw);
    });
  }

  // 声優・クリエイター作品一覧モーダル表示
  let radarModalInit = false;
  function initRadarModalEvents() {
    if (radarModalInit) return;
    const modal = document.getElementById('radar-works-modal');
    const closeBtn = document.getElementById('btn-close-radar-modal');
    const doneBtn = document.getElementById('btn-done-radar-modal');
    if (!modal) return;

    const closeModal = () => { modal.style.display = 'none'; };
    if (closeBtn) closeBtn.onclick = closeModal;
    if (doneBtn) doneBtn.onclick = closeModal;
    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };
    radarModalInit = true;
  }

  function openRadarWorksModal(user, entityName, works) {
    initRadarModalEvents();
    const modal = document.getElementById('radar-works-modal');
    const titleEl = document.getElementById('radar-modal-title');
    const contentEl = document.getElementById('radar-modal-content');
    if (!modal || !titleEl || !contentEl) return;

    titleEl.innerHTML = `<i class="fa-solid fa-film text-pink"></i> <strong>@${escapeHtml(user)}</strong> の <strong>${escapeHtml(entityName)}</strong> 視聴作品 (${works.length}作)`;

    if (works.length === 0) {
      contentEl.innerHTML = '<p class="text-muted" style="padding:2rem;text-align:center;">該当する視聴作品がありません</p>';
    } else {
      contentEl.innerHTML = works.map(w => {
        const safeTitle = escapeHtml(w.title);
        const thumb = w.image || '';
        const url = w.url || `https://annict.com/works/${w.id}`;
        return `
          <a href="${url}" target="_blank" rel="noopener noreferrer" class="radar-work-card" title="${safeTitle}">
            <div class="radar-work-thumb-wrap">
              ${thumb ? `<img src="${thumb}" alt="${safeTitle}" class="radar-work-thumb" loading="lazy" />` : '<i class="fa-solid fa-film radar-work-fallback"></i>'}
            </div>
            <div class="radar-work-meta">
              <span class="radar-work-title">${safeTitle}</span>
              ${w.season ? `<span class="radar-work-season"><i class="fa-regular fa-calendar"></i> ${escapeHtml(w.season)}</span>` : ''}
            </div>
            <i class="fa-solid fa-arrow-up-right-from-square radar-work-ext"></i>
          </a>
        `;
      }).join('');
    }

    modal.style.display = 'flex';
  }

  function renderStudioRadar() {
    const radarGrid = document.getElementById('radar-users-grid');
    const tableContainer = document.getElementById('radar-battle-table-container');
    const sectionTitle = document.getElementById('radar-section-title');
    const sectionDesc = document.getElementById('radar-section-desc');
    const battleTitle = document.getElementById('radar-battle-title');
    const battleDesc = document.getElementById('radar-battle-desc');
    const toggleBtns = document.querySelectorAll('.radar-type-toggle-bar .chip-btn');
    if (!radarGrid || !cachedData) return;

    // トグルボタンイベント登録
    toggleBtns.forEach(btn => {
      btn.onclick = () => {
        toggleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentRadarType = btn.getAttribute('data-radar-type');
        renderStudioRadar();
      };
    });

    const users = cachedData.users || [];
    const userWatchedLists = cachedData.userWatchedLists || {};

    let entityList = [];
    let topN = 5;

    if (currentRadarType === 'va') {
      entityList = VOICE_ACTORS;
      topN = 10;
      if (sectionTitle) sectionTitle.innerHTML = '<i class="fa-solid fa-microphone-lines text-pink"></i> 各ユーザーの「よく見ている声優」TOP10';
      if (sectionDesc) sectionDesc.textContent = '各ユーザーが最も多く出演作を視聴している人気声優ランキングと作品数です（作品名や作品数クリックで詳細展開）';
      if (battleTitle) battleTitle.innerHTML = '<i class="fa-solid fa-trophy text-gold"></i> 声優別・履修数バトル（誰が一番見てる？）';
      if (battleDesc) battleDesc.textContent = '声優ごとに出演作を最も多く視聴しているユーザーに王冠マークが付きます（数字クリックで作品一覧を表示）';
    } else if (currentRadarType === 'creator') {
      entityList = DIRECTORS_AND_WRITERS;
      topN = 8;
      if (sectionTitle) sectionTitle.innerHTML = '<i class="fa-solid fa-clapperboard text-purple"></i> 各ユーザーの「監督・脚本家」偏愛ランキング';
      if (sectionDesc) sectionDesc.textContent = '新房昭之、水島努、長井龍雪、花田十輝、岡田麿里など、名クリエイターの作品視聴傾向です';
      if (battleTitle) battleTitle.innerHTML = '<i class="fa-solid fa-trophy text-gold"></i> 監督・脚本家別・履修数バトル（誰が一番見てる？）';
      if (battleDesc) battleDesc.textContent = 'クリエイターごとに担当作を最も多く視聴しているユーザーに王冠マークが付きます（数字クリックで作品一覧を表示）';
    } else {
      // studio
      const sr = cachedData.labs?.studioReport;
      entityList = (sr?.allStudios || []).map(s => ({
        name: s.name,
        short: s.short || s.name,
        color: s.color,
        keywords: s.keywords || []
      }));
      topN = 5;
      if (sectionTitle) sectionTitle.innerHTML = '<i class="fa-solid fa-building text-pink"></i> 各ユーザーのスタジオ偏愛ランキング';
      if (sectionDesc) sectionDesc.textContent = '京都アニメーション、動画工房、シャフト、ufotableなど、どの制作会社を多く履修しているかの偏りです';
      if (battleTitle) battleTitle.innerHTML = '<i class="fa-solid fa-trophy text-gold"></i> スタジオ別・履修数バトル（誰が一番見てる？）';
      if (battleDesc) battleDesc.textContent = 'スタジオごとに最も多くの作品を視聴しているユーザーに王冠マークが付きます（数字クリックで作品一覧を表示）';
    }

    // 各ユーザーの集計計算＆作品マップ構築
    const statsByUser = {};
    const worksByUserEntity = {}; // key: `${user}___${entityName}` => works[]

    users.forEach(u => {
      const animes = userWatchedLists[u] || [];
      const ranked = entityList.map(item => {
        const seenIds = new Set();
        const matchedWorks = [];
        animes.forEach(a => {
          if (!seenIds.has(String(a.id)) && matchEntity(a.title, item)) {
            seenIds.add(String(a.id));
            matchedWorks.push(a);
          }
        });

        worksByUserEntity[`${u}___${item.name}`] = matchedWorks;

        return {
          name: item.name,
          short: item.short || item.name,
          color: item.color,
          count: matchedWorks.length,
          works: matchedWorks
        };
      }).filter(r => r.count > 0);

      ranked.sort((a, b) => b.count - a.count);
      statsByUser[u] = ranked;
    });

    // 1) ユーザー別カード描画
    radarGrid.innerHTML = users.map(u => {
      const ranked = statsByUser[u] || [];
      const topItems = ranked.slice(0, topN);
      const maxCount = topItems[0]?.count || 1;
      const topOne = topItems[0];
      const badgeText = topOne ? `${topOne.short} 最多 (${topOne.count}作)` : '視聴データなし';

      const itemsHtml = topItems.map((item, idx) => {
        const pct = Math.round((item.count / maxCount) * 100);
        const rankLabel = idx < 3
          ? `<span class="radar-rank-num top3">#${idx + 1}</span>`
          : `<span class="radar-rank-num">#${idx + 1}</span>`;
        const works = item.works || [];
        const itemId = `radar-works-${escapeHtml(u)}-${idx}`;

        // プレビュー表示: 代表3作
        const previewWorks = works.slice(0, 3);
        const moreCount = works.length - previewWorks.length;

        const previewChipsHtml = previewWorks.map(w => {
          const safeTitle = escapeHtml(w.title);
          const thumb = w.image || '';
          const url = w.url || `https://annict.com/works/${w.id}`;
          return `
            <a href="${url}" target="_blank" rel="noopener noreferrer" class="radar-work-mini-chip" title="${safeTitle}${w.season ? ' (' + escapeHtml(w.season) + ')' : ''}">
              ${thumb ? `<img src="${thumb}" alt="" class="radar-mini-thumb" loading="lazy" />` : '<i class="fa-solid fa-film radar-mini-icon"></i>'}
              <span class="radar-mini-title">${safeTitle}</span>
            </a>
          `;
        }).join('');

        // 全作品一覧（展開用）
        const allWorksGridHtml = works.map(w => {
          const safeTitle = escapeHtml(w.title);
          const thumb = w.image || '';
          const url = w.url || `https://annict.com/works/${w.id}`;
          return `
            <a href="${url}" target="_blank" rel="noopener noreferrer" class="radar-work-card" title="${safeTitle}">
              <div class="radar-work-thumb-wrap">
                ${thumb ? `<img src="${thumb}" alt="${safeTitle}" class="radar-work-thumb" loading="lazy" />` : '<i class="fa-solid fa-film radar-work-fallback"></i>'}
              </div>
              <div class="radar-work-meta">
                <span class="radar-work-title">${safeTitle}</span>
                ${w.season ? `<span class="radar-work-season"><i class="fa-regular fa-calendar"></i> ${escapeHtml(w.season)}</span>` : ''}
              </div>
              <i class="fa-solid fa-arrow-up-right-from-square radar-work-ext"></i>
            </a>
          `;
        }).join('');

        return `
          <div class="radar-studio-item" data-item-id="${itemId}">
            <div class="radar-studio-top radar-item-clickable" data-toggle-target="${itemId}" title="クリックで作品一覧を展開/折りたたみ">
              <div class="radar-item-left">
                ${rankLabel}
                <span class="radar-entity-name">${escapeHtml(item.name)}</span>
              </div>
              <div class="radar-item-right">
                <span class="radar-work-count"><strong>${item.count}</strong> 作</span>
                <i class="fa-solid fa-chevron-down radar-chevron"></i>
              </div>
            </div>
            <div class="radar-bar-track">
              <div class="radar-bar-fill" style="width: ${pct}%; background-color: ${item.color || 'var(--accent-pink)'};"></div>
            </div>

            <!-- 作品プレビュー -->
            <div class="radar-works-preview">
              ${previewChipsHtml}
              ${moreCount > 0 ? `<button type="button" class="radar-more-chip" data-toggle-target="${itemId}" title="他${moreCount}作を展開">+他${moreCount}作</button>` : ''}
            </div>

            <!-- 展開時の全作品リスト -->
            <div id="${itemId}" class="radar-works-expanded" style="display: none;">
              <div class="radar-works-expanded-header">
                <span><i class="fa-solid fa-film text-pink"></i> <strong>@${escapeHtml(u)}</strong> の <strong>${escapeHtml(item.short || item.name)}</strong> 視聴作品（全${item.count}作）</span>
                <button type="button" class="radar-collapse-btn" data-toggle-target="${itemId}"><i class="fa-solid fa-chevron-up"></i> 閉じる</button>
              </div>
              <div class="radar-works-grid">
                ${allWorksGridHtml}
              </div>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="radar-user-card" data-user="${escapeHtml(u)}">
          <div class="radar-user-header">
            <span class="radar-user-name"><i class="fa-solid fa-user text-pink"></i> @${escapeHtml(u)}</span>
            <div class="radar-user-actions">
              <span class="radar-user-badge">${escapeHtml(badgeText)}</span>
              <button type="button" class="radar-toggle-user-all-btn" data-user="${escapeHtml(u)}" title="全作品の表示を切り替え">
                <i class="fa-solid fa-angles-down"></i> 全展開
              </button>
            </div>
          </div>
          <div class="radar-studio-list">
            ${itemsHtml || '<p class="text-muted" style="padding:1rem;text-align:center;">該当する作品がありません</p>'}
          </div>
        </div>
      `;
    }).join('');

    // 2) バトル比較表
    if (tableContainer) {
      const battleEntities = entityList.slice(0, currentRadarType === 'va' ? 14 : 10);
      const colTitle = currentRadarType === 'va' ? '声優' : (currentRadarType === 'creator' ? 'クリエイター' : 'スタジオ');
      let headThs = `<th>${colTitle}</th>` + users.map(u => `<th>@${escapeHtml(u)}</th>`).join('');

      let rowsHtml = battleEntities.map(ent => {
        let maxWatched = 0;
        let countsByUser = {};

        users.forEach(u => {
          const uRanked = statsByUser[u] || [];
          const found = uRanked.find(x => x.name === ent.name);
          const c = found ? found.count : 0;
          countsByUser[u] = c;
          if (c > maxWatched) maxWatched = c;
        });

        let tds = `<td><strong style="color:${ent.color || 'inherit'}">${escapeHtml(ent.short || ent.name)}</strong></td>`;
        users.forEach(u => {
          const c = countsByUser[u];
          const isTop = c > 0 && c === maxWatched;
          const topClass = isTop ? 'class="studio-battle-top"' : '';

          if (c > 0) {
            tds += `
              <td ${topClass}>
                <button type="button" class="radar-cell-btn" data-user="${escapeHtml(u)}" data-entity-name="${escapeHtml(ent.name)}" data-entity-short="${escapeHtml(ent.short || ent.name)}" title="クリックで作品一覧を表示">
                  <span>${c}作</span> ${isTop ? '👑' : ''}
                </button>
              </td>
            `;
          } else {
            tds += `<td style="color:var(--text-muted);opacity:0.5;">0作</td>`;
          }
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

    // 3) イベントバインディング
    bindRadarItemEvents(worksByUserEntity);
  }

  // レーダー項目クリックイベント等のバインド
  function bindRadarItemEvents(worksByUserEntity) {
    // A) 各アイテムの開閉トグル（ヘッダー、+他○作ボタン、閉じるボタン）
    const toggleTargets = document.querySelectorAll('[data-toggle-target]');
    toggleTargets.forEach(el => {
      el.onclick = (e) => {
        e.stopPropagation();
        const targetId = el.getAttribute('data-toggle-target');
        const targetEl = document.getElementById(targetId);
        if (!targetEl) return;

        const parentItem = targetEl.closest('.radar-studio-item');
        const isHidden = targetEl.style.display === 'none';

        if (isHidden) {
          targetEl.style.display = 'block';
          if (parentItem) parentItem.classList.add('open');
        } else {
          targetEl.style.display = 'none';
          if (parentItem) parentItem.classList.remove('open');
        }
      };
    });

    // B) ユーザーカードごとの「全展開 / 全折りたたみ」ボタン
    const allBtns = document.querySelectorAll('.radar-toggle-user-all-btn');
    allBtns.forEach(btn => {
      btn.onclick = () => {
        const user = btn.getAttribute('data-user');
        const card = btn.closest('.radar-user-card');
        if (!card) return;

        const expandedSections = card.querySelectorAll('.radar-works-expanded');
        const items = card.querySelectorAll('.radar-studio-item');

        // すでに全展開されているかチェック
        const anyHidden = Array.from(expandedSections).some(s => s.style.display === 'none');

        if (anyHidden) {
          // すべて展開
          expandedSections.forEach(s => s.style.display = 'block');
          items.forEach(it => it.classList.add('open'));
          btn.innerHTML = '<i class="fa-solid fa-angles-up"></i> 全折りたたみ';
        } else {
          // すべて折りたたみ
          expandedSections.forEach(s => s.style.display = 'none');
          items.forEach(it => it.classList.remove('open'));
          btn.innerHTML = '<i class="fa-solid fa-angles-down"></i> 全展開';
        }
      };
    });

    // C) バトル表のセルボタン（モーダルで作品表示）
    const cellBtns = document.querySelectorAll('.radar-cell-btn');
    cellBtns.forEach(btn => {
      btn.onclick = () => {
        const u = btn.getAttribute('data-user');
        const entName = btn.getAttribute('data-entity-name');
        const entShort = btn.getAttribute('data-entity-short') || entName;
        const works = worksByUserEntity[`${u}___${entName}`] || [];
        openRadarWorksModal(u, entShort, works);
      };
    });
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
