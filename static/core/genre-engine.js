(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GenreEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * 15大アニメジャンル定義（メイン公式分類）
   */
  const GENRE_DEFINITIONS = [
    { id: 'isekai',           label: '異世界 / 転生',             labelEn: 'Isekai',                        icon: 'fa-solid fa-door-open',           color: '#a78bfa', colorLight: '#7c3aed' },
    { id: 'mahou_shoujo',     label: '魔法少女 / バトルヒロイン', shortLabel: '魔法少女 / ヒロイン', labelEn: 'Magical Girl / Battle Heroine', icon: 'fa-solid fa-wand-magic-sparkles', color: '#fb7185', colorLight: '#e11d48' },
    { id: 'mecha',            label: 'ロボット / メカ',           labelEn: 'Mecha',                         icon: 'fa-solid fa-robot',               color: '#94a3b8', colorLight: '#475569' },
    { id: 'action',           label: 'アクション / バトル',       labelEn: 'Action / Battle',               icon: 'fa-solid fa-burst',               color: '#f87171', colorLight: '#dc2626' },
    { id: 'sports',           label: 'スポーツ / 競技',           labelEn: 'Sports',                        icon: 'fa-solid fa-futbol',              color: '#2dd4bf', colorLight: '#0f766e' },
    { id: 'comedy',           label: 'コメディ / ギャグ',         labelEn: 'Comedy / Gag',                  icon: 'fa-solid fa-face-laugh-squint',   color: '#fbbf24', colorLight: '#b45309' },
    { id: 'romance',          label: '恋愛 / ラブコメ',           labelEn: 'Romance / Rom-Com',             icon: 'fa-solid fa-heart',               color: '#f472b6', colorLight: '#db2777' },
    { id: 'drama',            label: 'ドラマ / 青春',             labelEn: 'Drama / Youth',                 icon: 'fa-solid fa-masks-theater',       color: '#38bdf8', colorLight: '#0369a1' },
    { id: 'nichijou',         label: '日常 / ほのぼの',           labelEn: 'Slice of Life',                 icon: 'fa-solid fa-mug-saucer',          color: '#34d399', colorLight: '#047857' },
    { id: 'sf_fantasy',       label: 'SF / ファンタジー',         labelEn: 'Sci-Fi / Fantasy',              icon: 'fa-solid fa-meteor',              color: '#818cf8', colorLight: '#4f46e5' },
    { id: 'horror_suspense',  label: 'ホラー / サスペンス / 推理', shortLabel: 'ホラー / 推理',       labelEn: 'Suspense & Mystery',            icon: 'fa-solid fa-skull',               color: '#a5b4fc', colorLight: '#4338ca' },
    { id: 'history_military', label: '歴史 / 戦記 / ミリタリー',  shortLabel: '歴史 / 戦記',         labelEn: 'Historical & Military',         icon: 'fa-solid fa-shield-halved',       color: '#a3e635', colorLight: '#4d7c0f' },
    { id: 'idol_music',       label: 'アイドル / 音楽',           labelEn: 'Idol / Music',                  icon: 'fa-solid fa-music',               color: '#facc15', colorLight: '#a16207' },
    { id: 'ecchi',            label: 'エッチ / お色気',           labelEn: 'Ecchi',                         icon: 'fa-solid fa-fire',                color: '#fb7185', colorLight: '#be123c' },
    { id: 'other',            label: 'その他',                    labelEn: 'Other',                         icon: 'fa-solid fa-ellipsis',            color: '#cbd5e1', colorLight: '#475569' }
  ];

  const GENRE_DEF_MAP = Object.create(null);
  for (let i = 0; i < GENRE_DEFINITIONS.length; i++) {
    GENRE_DEF_MAP[GENRE_DEFINITIONS[i].id] = GENRE_DEFINITIONS[i];
  }

  /**
   * 略称・通称マッピング（スコア診断・検索補助用）
   */
  const TITLE_ALIASES = {
    '着せ恋': 'その着せ替え人形は恋をする',
    'このすば': 'この素晴らしい世界に祝福を！',
    'ごちうさ': 'ご注文はうさぎですか？',
    'リゼロ': 'Re:ゼロから始める異世界生活',
    'まどマギ': '魔法少女まどか☆マギカ',
    '俺ガイル': 'やはり俺の青春ラブコメはまちがっている。',
    '青ブタ': '青春ブタ野郎はバニーガール先輩の夢を見ない',
    'ダンまち': 'ダンジョンに出会いを求めるのは間違っているだろうか',
    '防振り': '痛いのは嫌なので防御力に極振りしたいと思います。',
    'わたてん': '私に天使が舞い降りた！',
    'よりもい': '宇宙よりも遠い場所',
    'ガルパン': 'ガールズ＆パンツァー',
    'ハルヒ': '涼宮ハルヒの憂鬱',
    'ヒロアカ': '僕のヒーローアカデミア',
    '東リベ': '東京リベンジャーズ',
    'マケイン': '負けヒロインが多すぎる！',
    'ロシデレ': '時々ボソッとロシア語でデレる隣のアーリャさん',
    'ガルクラ': 'ガールズバンドクライ',
    'ぼざろ': 'ぼっち・ざ・ろっく！',
    'シュタゲ': 'STEINS;GATE',
    'エヴァ': '新世紀エヴァンゲリオン'
  };

  /**
   * タイトル文字列からのスマート救済推論（セーフティネット）
   * @param {string} title
   * @returns {string}
   */
  function inferCategoryFromTitle(title) {
    if (!title) return 'other';
    const t = String(title);

    if (/(?:異世界|転生|転移|悪役令嬢|追放|スライム|魔王|勇者|チート|治癒|スキル|ステータス|レベル|ダンジョン|冒険者|聖女|公爵|辺境|ギルド|鑑定|テイマー|錬金術|魔術|魔導|セカンドライフ|無双|召喚|スローライフ|精霊幻想記|セリア先生のドキドキ|リーゼロッテのわくわく)/i.test(t) && !/ダンジョンに出会いを|ダンまち/i.test(t)) {
      return 'isekai';
    }
    if (/(?:魔法少女|プリキュア|魔女|変身ヒロイン|マギカ|マジカル|ウィッチ|セーラー)/i.test(t) && !/リーゼロッテのわくわくまじかる/i.test(t)) return 'mahou_shoujo';
    if (/(?:ガンダム|メカ|ロボ|ロボット|マクロス|エヴァ|パトレイバー|ダイナ|カイザー|トランスフォーマー|ギア|バルキリー|イデオン|マジンガー)/i.test(t)) return 'mecha';
    if (/(?:サッカー|野球|バスケ|バレー|テニス|ゴルフ|競走|レース|水泳|ボクシング|格闘|相撲|将棋|囲碁|かるた|麻雀|ダンス|体操|自転車|ペダル|フットボール|陸上|卓球|ボウリング|競馬|イナズマイレブン|(?:^|[\s「『])カーズ(?:$|[\s」』\d・]))/i.test(t)) return 'sports';
    if (/(?:アイドル|バンド|ライブ|ソング|ミュージック|うた|歌|メロディ|オーケストラ|吹奏楽|ピアノ|ギター|合唱|ボーカル|シンガー|Wake Up,\s*Girls|Run Run Lantern|LONELINESS WILL SHINE|Cirque le coeur|Music\s*Video|(?:^|[\s」』\)])MV(?:$|[\s「『\(]))/i.test(t)) return 'idol_music';
    if (/(?:恋|愛|彼女|彼氏|カノジョ|カレシ|ラブコメ|告白|好き|同棲|結婚|許嫁|ウェディング|キス|両想い|片想い|失恋|初恋|純情|初体験|カップル|お見合い|プロポーズ|ハレ婚|レンチキュラーズ|古見さんは|エロマンガ先生|少女たちは荒野|はじめてのギャル)/i.test(t)) return 'romance';
    if (/(?:日常|キャンプ|キャン△|ごちうさ|うさぎ|きんいろ|のんのん|ゆる|ぼっち|きらら|ほのぼの|カフェ|喫茶|暮らし|生活|女子会|散歩|家族|ごちそう|料理|ごはん|食堂|のんびり)/i.test(t)) return 'nichijou';
    if (/(?:青春|ドラマ|絆|家族|友情|仕事|部活|お仕事|吹奏楽|クラシック|人生|再生|旅立ち|成長|君の嘘|聲の形|あの花|よりもい|いろは|ユーフォ|あかね噺|あかね小噺|かぐや姫の物語|ツインズひなひま|リメンバー・ミー|ReLIFE|一週間フレンズ)/i.test(t)) return 'drama';
    if (/(?:殺人|探偵|推理|事件|サスペンス|ホラー|怪談|呪い|幽霊|サイコ|デス|死|密室|ミステリー|サイコパス|謎|陰謀|悪夢|ゴースト)/i.test(t)) return 'horror_suspense';
    if (/(?:武将|戦国|幕末|歴史|三国志|大河|軍|兵|艦隊|戦艦|空母|ミリタリー|戦争|部隊|大戦|帝国|皇国|侍|新選組|維新)/i.test(t)) return 'history_military';
    if (/(?:ギャグ|コメディ|コメディー|バカ|コント|パロディ|お笑い|珍道中|騒動|ハチャメチャ|漫才|おバカ|プラノサウルス|鬼灯の冷徹|坂本ですが|だがしかし|生徒会役員共|斉木楠雄)/i.test(t)) return 'comedy';
    if (/(?:バトル|ファイト|バスター|ブレード|ソード|ストライク|ファイター|アサシン|ハンター|ウォリアー|リベンジ|復讐|激闘|討伐|拳|格闘|戦士|ウォーズ|7FATES|CHAKHO|ポケットモンスター|ポケモン|\bFate\s*[\/:]|ソウルイーター|SOUL EATER|テラフォーマーズ|TERRAFORMARS|亜人|青の祓魔師)/i.test(t)) return 'action';
    if (/(?:SF|ファンタジー|エイリアン|アンドロイド|サイボーグ|宇宙|惑星|異星|次元|魔術|魔法|エルフ|ドラゴン|ダンジョン|タイムトラベル|冒険|超かぐや姫|ニューサーガ|ドンキホーテ幻の花|もうひとつの未来を|サイバーパンク|FAIRY TAIL|マッシュル|どろろ|HELLO WORLD|ブレイブストーリー|ドロヘドロ|アリスと蔵六|夜桜四重奏|雪使いシュガー|藤本タツキ 17-26)/i.test(t)) return 'sf_fantasy';
    return 'other';
  }

  /**
   * 重み付けスコアリング方式による高精度アニメジャンル分類（メインエンジン）
   * @param {string[]} genres - AniList公式ジャンル配列
   * @param {{name: string, rank: number}[]} tags - AniListタグ配列
   * @param {string} title - アニメタイトル
   * @returns {{ category: string, score: number, scores: Object.<string, number>, reasons: Object.<string, string[]>, topReasons: string[] }}
   */
  function scoreAnimeDetailed(genres, tags, title) {
    const g = new Set(genres || []);
    const tagMap = new Map();
    if (Array.isArray(tags)) {
      for (let i = 0; i < tags.length; i++) {
        const item = tags[i];
        if (item && item.name) {
          tagMap.set(item.name, item.rank || 0);
        } else if (Array.isArray(item) && item[0]) {
          tagMap.set(item[0], item[1] || 0);
        }
      }
    }

    const getTag = (name) => tagMap.get(name) || 0;
    const t = title || '';

    const scores = {};
    const reasons = {};
    for (let i = 0; i < GENRE_DEFINITIONS.length; i++) {
      const id = GENRE_DEFINITIONS[i].id;
      scores[id] = 0;
      reasons[id] = [];
    }

    const addScore = (catId, pts, reason) => {
      if (scores[catId] !== undefined && pts > 0) {
        scores[catId] += pts;
        reasons[catId].push(`${reason} (+${Math.round(pts)})`);
      }
    };

    // 1. 異世界 / 転生 (isekai)
    const hasIsekaiTag = tagMap.has('Isekai') || tagMap.has('Reverse Isekai');
    const hasIsekaiTitle = /(?:異世界|転生|転移|悪役令嬢|追放され|魔王様|勇者(?:パーティー)?|スライム.*件|チート|治癒魔法|無職転生|陰の実力者|オーバーロード|この素晴らしい世界に祝福を|このすば|Re:ゼロ|盾の勇者|本好きの下剋上|賢者の弟子|ベヒーモス|聖女なのに|Sランクになってた|シンデレラ・シェフ|第七王子|貴族転生|精霊幻想記|セリア先生のドキドキ|リーゼロッテのわくわくまじかる)/i.test(t);
    if (hasIsekaiTag || hasIsekaiTitle) {
      if (tagMap.has('Isekai')) addScore('isekai', getTag('Isekai') * 2.0, `タグ: Isekai(${getTag('Isekai')})`);
      if (tagMap.has('Reverse Isekai')) addScore('isekai', getTag('Reverse Isekai') * 1.8, 'タグ: Reverse Isekai');
      if (tagMap.has('Villainess')) addScore('isekai', getTag('Villainess') * 1.6, 'タグ: Villainess(悪役令嬢)');
      if (tagMap.has('Reincarnation')) addScore('isekai', getTag('Reincarnation') * 1.5, 'タグ: Reincarnation(転生)');
      if (hasIsekaiTitle) addScore('isekai', 160, '異世界・転生代表タイトル');
      if (g.has('Fantasy')) addScore('isekai', 50, 'ファンタジー異世界');
    }
    if (/ダンジョンに出会いを|ダンまち/i.test(t)) {
      scores.isekai = 0;
      reasons.isekai = [];
    }

    // 2. 魔法少女 / バトルヒロイン (mahou_shoujo)
    if (g.has('Mahou Shoujo')) addScore('mahou_shoujo', 200, '公式ジャンル: Mahou Shoujo');
    if (tagMap.has('Magical Girl')) addScore('mahou_shoujo', getTag('Magical Girl') * 2.0, 'タグ: Magical Girl');
    if (tagMap.has('Majokko')) addScore('mahou_shoujo', getTag('Majokko') * 1.8, 'タグ: Majokko');
    const isFemaleLead = tagMap.has('Female Protagonist') || tagMap.has('Primarily Female Cast');
    if (tagMap.has('Henshin') && isFemaleLead && !tagMap.has('Shounen') && !tagMap.has('Gore') && !g.has('Mecha')) {
      addScore('mahou_shoujo', getTag('Henshin') * 1.0, 'タグ: Henshin(ヒロイン変身)');
    }
    if (/(?:プリキュア|まどか|なのは|シンフォギア|プリズマ|魔法少女|セーラームーン|結城友奈|ストライクウィッチーズ|グランベルム|幻影ヲ駆ケル太陽|キューティーハニー|りりかSOS|ファンファンファーマシィー|プリンセッション)/i.test(t)) {
      addScore('mahou_shoujo', 180, '代表魔法少女タイトル');
    }

    // 3. ロボット / メカ (mecha)
    if (g.has('Mecha')) addScore('mecha', 160, '公式ジャンル: Mecha');
    if (tagMap.has('Real Robot')) addScore('mecha', getTag('Real Robot') * 1.6, 'タグ: Real Robot');
    if (tagMap.has('Super Robot')) addScore('mecha', getTag('Super Robot') * 1.6, 'タグ: Super Robot');
    if (tagMap.has('Piloted Robot')) addScore('mecha', getTag('Piloted Robot') * 1.4, 'タグ: Piloted Robot');
    if (/(?:ガンダム|エヴァンゲリオン|ヱヴァンゲリヲン|マクロス|コードギアス|パトレイバー|ダイナゼノン|グリッドマン|アクエリオン|マジンガー|ゲッターロボ|フルメタル・パニック|ゾイド|ビーストウォーズ|トランスフォーマー)/i.test(t)) {
      addScore('mecha', 150, '代表メカタイトル');
    }

    // 4. スポーツ / 競技 (sports)
    if (g.has('Sports')) addScore('sports', 180, '公式ジャンル: Sports');
    if (tagMap.has('Athletics')) addScore('sports', getTag('Athletics') * 1.2, 'タグ: Athletics');
    const sportsTags = ['Baseball', 'Basketball', 'Football', 'Volleyball', 'Swimming', 'Tennis', 'Boxing', 'Cycling', 'Motor Sports', 'Ice Skating', 'Martial Arts Competition', 'Badminton'];
    for (let i = 0; i < sportsTags.length; i++) {
      const st = sportsTags[i];
      if (tagMap.has(st)) addScore('sports', getTag(st) * 1.4, `競技タグ: ${st}`);
    }
    if (/(?:メジャー|MAJOR|ハイキュー|黒子のバスケ|ブルーロック|ダイヤのA|スラムダンク|弱虫ペダル|Free!|キャプテン翼|テニスの王子様|MFゴースト|頭文字D|イニシャルD|3月のライオン|ちはやふる|ヒカルの碁|ウマ娘|イナズマイレブン|(?:^|[\s「『])カーズ(?:$|[\s」』\d・]))/i.test(t)) {
      addScore('sports', 150, '代表スポーツタイトル');
    }

    // 5. アイドル / 音楽 (idol_music)
    if (tagMap.has('Idol')) addScore('idol_music', getTag('Idol') * 1.8, `タグ: Idol(${getTag('Idol')})`);
    if (tagMap.has('Band')) addScore('idol_music', getTag('Band') * 1.6, 'タグ: Band');
    if (tagMap.has('Musical Theater')) addScore('idol_music', getTag('Musical Theater') * 1.2, 'タグ: Musical Theater');
    if (tagMap.has('Rock Music')) addScore('idol_music', getTag('Rock Music') * 1.2, 'タグ: Rock Music');
    if (g.has('Music')) {
      const isPureMusic = !g.has('Action') && !g.has('Fantasy');
      addScore('idol_music', isPureMusic ? 120 : 60, '公式ジャンル: Music');
    }
    if (g.size === 0 && /(?:Animation\s*Music\s*Video|アニメーション\s*Music\s*Video|Music\s*Video|(?:^|[\s」』\)])MV(?:$|[\s「『\(]))/i.test(t)) {
      addScore('idol_music', 90, 'ミュージックビデオ / MV判定');
    }
    if (/(?:アイドルマスター|IDOLM＠STER|アイマス|Jupiter|シンデレラガールズ|ミリオンライブ|シャイニーカラーズ|SideM|ラブライブ|バンドリ|BanG Dream|ぼっち・ざ・ろっく|ガールズバンドクライ|ガルクラ|トゲナシトゲアリ|D4DJ|アイカツ|プリパラ|ゾンビランドサガ|ヒプノシスマイク|プロジェクトセカイ|プロセカ|初音ミク|Wake Up,\s*Girls|Run Run Lantern|LONELINESS WILL SHINE|Cirque le coeur)/i.test(t)) {
      addScore('idol_music', 150, '代表音楽・アイドルタイトル');
    }

    // 6. コメディ / ギャグ (comedy)
    if (tagMap.has('Slapstick')) addScore('comedy', getTag('Slapstick') * 1.2, 'タグ: Slapstick');
    if (tagMap.has('Surreal Comedy')) addScore('comedy', getTag('Surreal Comedy') * 1.2, 'タグ: Surreal Comedy');
    if (tagMap.has('Parody')) addScore('comedy', getTag('Parody') * 1.1, 'タグ: Parody');
    if (tagMap.has('Satire')) addScore('comedy', getTag('Satire') * 1.0, 'タグ: Satire');
    if (g.has('Comedy')) {
      const pure = !g.has('Romance') && !g.has('Slice of Life') && !g.has('Action');
      addScore('comedy', pure ? 70 : 35, '公式ジャンル: Comedy');
    }
    if (/(?:銀魂|あそびあそばせ|男子高校生の日常|斉木楠雄|女子高生の無駄づかい|てーきゅう|ポプテピピック|ぐらんぶる|邪神ちゃん|ヒナまつり|これはゾンビですか|でじこ|しかのこのこのこ|さばげぶっ|(?:^|\s)日常(?:\s|$|[（\(])|こちら葛飾区|こち亀|バカとテスト|おねがい！ポコタ|生徒会の一存|ひつじのショーン|クックルン|Di Gi Charat|みらくる! ぱんぞう|おれたちイジワルケイ|ドンキーコング|ハウス・オブ・マウス|BPS バトルプログラマーシラセ|破産富豪|プラノサウルス|鬼灯の冷徹|坂本ですが|だがしかし|生徒会役員共)/i.test(t)) {
      addScore('comedy', 140, '代表コメディタイトル');
    }

    // 7. 日常 / ほのぼの (nichijou)
    if (tagMap.has('Cute Girls Doing Cute Things')) addScore('nichijou', getTag('Cute Girls Doing Cute Things') * 1.2, 'タグ: CGDCT');
    if (tagMap.has('Cute Boys Doing Cute Things')) addScore('nichijou', getTag('Cute Boys Doing Cute Things') * 1.2, 'タグ: CBDCT');
    if (tagMap.has('Outdoor Activities')) addScore('nichijou', getTag('Outdoor Activities') * 1.1, 'タグ: Outdoor');
    if (tagMap.has('Camping')) addScore('nichijou', getTag('Camping') * 1.1, 'タグ: Camping');
    if (tagMap.has('Iyashikei')) {
      const isEpic = (g.has('Fantasy') && g.has('Adventure')) || g.has('Action');
      addScore('nichijou', getTag('Iyashikei') * (isEpic ? 0.3 : 1.2), 'タグ: Iyashikei');
    }
    if (g.has('Slice of Life')) {
      const isPure = !g.has('Action') && !g.has('Romance');
      addScore('nichijou', isPure ? 80 : 40, '公式ジャンル: Slice of Life');
    }
    if (/(?:ゆるキャン|へやキャン|のんのんびより|ごちうさ|ご注文はうさぎですか|きんいろモザイク|NEW GAME|みなみけ|らき☆すた|ヤマノススメ|スローループ|ゆるゆり|小林さんちのメイドラゴン|ブルーアーカイブ|ブルアカ|もめんたりー・リリィ|mono|ざつ旅|雨と君と|クジマ歌えば|日々は過ぎれど|三ツ星カラーズ|私に天使が舞い降りた|わたてん|スロウスタート|あんハピ|ブレンド・S|GA 芸術科|苺ましまろ|しろくまカフェ|WORKING|ふらいんぐうぃっち|パパのいうこと|クロワーゼ|異国迷路のクロワーゼ|グルメ日記|着ぐるみガール)/i.test(t)) {
      addScore('nichijou', 140, '代表日常系タイトル');
    }

    // 8. 恋愛 / ラブコメ (romance)
    if (g.has('Romance')) addScore('romance', 130, '公式ジャンル: Romance');
    if (tagMap.has('Romantic Comedy')) addScore('romance', getTag('Romantic Comedy') * 1.3, 'タグ: Romantic Comedy');
    if (tagMap.has('Love Triangle')) addScore('romance', getTag('Love Triangle') * 1.1, 'タグ: Love Triangle');
    if (tagMap.has('Female Harem')) addScore('romance', getTag('Female Harem') * 1.0, 'タグ: Female Harem');
    if (tagMap.has('Male Harem')) addScore('romance', getTag('Male Harem') * 1.0, 'タグ: Male Harem');
    if (tagMap.has('Yuri') && !g.has('Music')) addScore('romance', getTag('Yuri') * 0.9, 'タグ: Yuri');
    if (tagMap.has("Boys' Love")) addScore('romance', getTag("Boys' Love") * 1.3, 'タグ: BL');
    if (tagMap.has('Tsundere')) addScore('romance', getTag('Tsundere') * 0.7, 'タグ: Tsundere');
    if (tagMap.has('Arranged Marriage')) addScore('romance', getTag('Arranged Marriage') * 1.1, 'タグ: Arranged Marriage');
    if (tagMap.has('First Love')) addScore('romance', getTag('First Love') * 1.1, 'タグ: First Love');
    if (tagMap.has('Unrequited Love')) addScore('romance', getTag('Unrequited Love') * 1.0, 'タグ: Unrequited Love');
    if (tagMap.has('Cohabitation')) addScore('romance', getTag('Cohabitation') * 0.8, 'タグ: 同棲');
    if (tagMap.has('Marriage')) addScore('romance', getTag('Marriage') * 0.8, 'タグ: 結婚');
    if (tagMap.has('Dating Sim') || tagMap.has('Visual Novel')) {
      if (g.has('Romance') || tagMap.has('Female Harem')) addScore('romance', 80, 'タグ: 恋愛ノベル原作');
    }
    if (/(?:その着せ替え人形|着せ恋|僕の心のヤバイやつ|五等分の花嫁|かぐや様|とらドラ|やはり俺の青春|俺ガイル|カノジョも彼女|女神のカフェテラス|わたしが恋人になれるわけないじゃん|わたなれ|神のみぞ知るセカイ|神のみ|政宗くんのリベンジ|シスター・プリンセス|シスプリ|citrus|シトラス|Фなるあぷろーち|ウィッシュ|W ～ウィッシュ～|漣蒼士|あんた私のことを好きだったの|これは二度目で最後の初恋|君主様に胸やけ|小さい潜水艦に恋をした|冴えない彼女|冴えカノ|ニセコイ|君に届け|アオハライド|山田くんとLv999|お隣の天使様|恋は雨上がりのように|ゴールデンタイム|高嶺のハナさん|疑似ハーレム|ロシデレ|時々ボソッとロシア語でデレる隣のアーリャさん|負けヒロインが多すぎる|マケイン|レンチキュラーズ|古見さんは|エロマンガ先生|少女たちは荒野|はじめてのギャル|みだらな青ちゃん)/i.test(t)) {
      addScore('romance', 150, '代表恋愛/ラブコメタイトル');
    }

    // 9. ドラマ / 青春 (drama)
    const hasStrongWorldGenre = g.has('Fantasy') || g.has('Sci-Fi') || g.has('Mecha') || tagMap.has('Isekai');
    const dramaMult = hasStrongWorldGenre ? 0.45 : 1.0;
    if (g.has('Drama')) {
      const isPureDrama = !g.has('Romance') && !tagMap.has('Romantic Comedy') && !tagMap.has('Female Harem');
      addScore('drama', (isPureDrama ? 120 : 60) * dramaMult, isPureDrama ? '公式ジャンル: Drama (純粋ドラマ)' : '公式ジャンル: Drama');
    }
    if (tagMap.has('Coming of Age')) addScore('drama', getTag('Coming of Age') * 1.3 * dramaMult, 'タグ: Coming of Age (青春・成長)');
    if (tagMap.has('Work')) addScore('drama', getTag('Work') * 1.2 * dramaMult, 'タグ: Work (お仕事ドラマ)');
    if (tagMap.has('School Club') && !g.has('Sports') && !g.has('Music')) addScore('drama', getTag('School Club') * 0.8 * dramaMult, 'タグ: School Club (部活・青春)');
    if (tagMap.has('Family Life')) addScore('drama', getTag('Family Life') * 1.1 * dramaMult, 'タグ: Family Life (家族ドラマ)');
    if (tagMap.has('Tragedy') && !g.has('Action') && !g.has('Horror')) addScore('drama', getTag('Tragedy') * 1.0 * dramaMult, 'タグ: Tragedy (人間ドラマ)');
    if (tagMap.has('Rehabilitation')) addScore('drama', getTag('Rehabilitation') * 1.2 * dramaMult, 'タグ: Rehabilitation (挫折と再生)');
    if (tagMap.has('Bullying')) addScore('drama', getTag('Bullying') * 1.2 * dramaMult, 'タグ: Bullying (葛藤ドラマ)');
    if (tagMap.has('Disability')) addScore('drama', getTag('Disability') * 1.3 * dramaMult, 'タグ: Disability (共生・心理ドラマ)');
    if (tagMap.has('Youth')) addScore('drama', getTag('Youth') * 1.1 * dramaMult, 'タグ: Youth (青春)');
    if (tagMap.has('Ensemble Cast') && g.has('Drama')) addScore('drama', 70 * dramaMult, 'タグ: Ensemble Cast (群像劇)');
    if (tagMap.has('Melodrama')) addScore('drama', getTag('Melodrama') * 1.0 * dramaMult, 'タグ: Melodrama');
    if (/(?:宇宙よりも遠い場所|よりもい|SHIROBAKO|花咲くいろは|サクラクエスト|白い砂のアクアトープ|ヴァイオレット・エヴァーガーデン|響け！ユーフォニアム|四月は君の嘘|あの日見た花|あの花|CLANNAD|クラナド|聲の形|リズと青い鳥|銀の匙|Silver Spoon|ビーバーになる時|ルックバック|さよならの朝に約束の花をかざろう|氷菓|プラネテス|波よ聞いてくれ|スキップとローファー|バクマン|BLUE GIANT|平家物語|東京マグニチュード|花緑青|僕らの雨いろプロトコル|クジラの話|あの夏|あかね噺|あかね小噺|かぐや姫の物語|ツインズひなひま|リメンバー・ミー|ReLIFE|一週間フレンズ)/i.test(t)) {
      addScore('drama', 150, '代表ドラマ/青春タイトル');
    }

    // 10. 歴史 / 戦記 / ミリタリー (history_military)
    if (tagMap.has('Historical')) addScore('history_military', getTag('Historical') * 1.2, 'タグ: Historical');
    if (tagMap.has('Ancient China')) addScore('history_military', getTag('Ancient China') * 1.4, 'タグ: Ancient China');
    if (tagMap.has('Samurai')) addScore('history_military', getTag('Samurai') * 1.1, 'タグ: Samurai');
    if (tagMap.has('Medieval')) addScore('history_military', getTag('Medieval') * 0.7, 'タグ: Medieval');
    if (tagMap.has('Tanks')) addScore('history_military', 160, 'タグ: Tanks(戦車)');
    if (tagMap.has('Aviation')) addScore('history_military', 90, 'タグ: Aviation');
    const hasSupernaturalOrSciFi = tagMap.has('Super Power') || tagMap.has('Magic') || g.has('Sci-Fi');
    if (tagMap.has('Military')) {
      const mult = hasSupernaturalOrSciFi ? 0.3 : 1.1;
      addScore('history_military', getTag('Military') * mult, 'タグ: Military');
    }
    if (tagMap.has('War')) {
      const mult = hasSupernaturalOrSciFi ? 0.3 : 1.0;
      addScore('history_military', getTag('War') * mult, 'タグ: War');
    }
    if (/(?:ガールズ＆パンツァー|ガールズ&パンツァー|ガルパン|アンツィオ|幼女戦記|GATE 自衛隊|アズールレーン|艦隊これくしょん|艦これ|ハイスクール・フリート|キングダム|ヴィンランド・サガ|平家物語|るろうに剣心|ゴールデンカムイ|薄桜鬼|信長|ドリフターズ|アルスラーン戦記|銀河英雄伝説|火喰鳥|静岡県史|歴史を変える男たち|戦国を駆ける武将|らいむいろ|どん兵衛)/i.test(t)) {
      addScore('history_military', 140, '代表歴史・ミリタリータイトル');
    }

    // 11. ホラー / サスペンス / 推理 (horror_suspense)
    if (g.has('Horror')) addScore('horror_suspense', 130, '公式ジャンル: Horror');
    if (g.has('Mystery')) addScore('horror_suspense', 120, '公式ジャンル: Mystery');
    if (g.has('Thriller')) addScore('horror_suspense', 100, '公式ジャンル: Thriller');
    if (g.has('Psychological')) addScore('horror_suspense', 80, '公式ジャンル: Psychological');
    if (tagMap.has('Detective')) addScore('horror_suspense', getTag('Detective') * 1.3, 'タグ: Detective');
    if (tagMap.has('Crime')) addScore('horror_suspense', getTag('Crime') * 1.0, 'タグ: Crime');
    if (tagMap.has('Police')) addScore('horror_suspense', getTag('Police') * 0.9, 'タグ: Police');
    if (tagMap.has('Death Game')) addScore('horror_suspense', getTag('Death Game') * 1.2, 'タグ: Death Game');
    if (/(?:薬屋のひとりごと|GOSICK|ゴシック|ロード・エルメロイ|ひぐらし|Another|PSYCHO-PASS|サイコパス|約束のネバーランド|サマータイムレンダ|Death Note|デスノート|MONSTER|シャドーハウス|死亡遊戯で飯を食う|探偵様|ブラッディ・メアリー|なつみSTEP)/i.test(t)) {
      addScore('horror_suspense', 140, '代表推理・サスペンスタイトル');
    }

    // 12. エッチ / お色気 (ecchi)
    if (g.has('Hentai')) addScore('ecchi', 300, '公式ジャンル: Hentai');
    if (g.has('Ecchi')) {
      const hasExplicitNudity = tagMap.has('Nudity') || tagMap.has('Fanservice');
      addScore('ecchi', hasExplicitNudity ? 100 : 50, '公式ジャンル: Ecchi');
    }
    if (tagMap.has('Nudity')) addScore('ecchi', getTag('Nudity') * 1.2, 'タグ: Nudity');
    if (tagMap.has('Fanservice')) addScore('ecchi', getTag('Fanservice') * 0.8, 'タグ: Fanservice');
    if (tagMap.has('Ecchi')) addScore('ecchi', getTag('Ecchi') * 1.1, 'タグ: Ecchi');
    if (/(?:変ゼミ|To LOVEる|ハイスクールD×D|ヨスガノソラ|監獄学園|魔装学園|新妹魔王|異種族レビュアーズ|回復術士|ド級編隊|ギルティホール|最近、妹のようすが|妹ちょ|お姉さまに恋してる|オトボク|うしろの正面カムイさん)/i.test(t)) {
      addScore('ecchi', 150, '代表お色気タイトル');
    }

    // 13. アクション / バトル (action)
    if (g.has('Action')) addScore('action', 90, '公式ジャンル: Action');
    if (g.has('Adventure')) addScore('action', 30, '公式ジャンル: Adventure');
    if (tagMap.has('Super Power')) addScore('action', getTag('Super Power') * 1.1, 'タグ: Super Power');
    if (tagMap.has('Swordplay')) addScore('action', getTag('Swordplay') * 1.0, 'タグ: Swordplay');
    if (tagMap.has('Martial Arts')) addScore('action', getTag('Martial Arts') * 1.0, 'タグ: Martial Arts');
    if (tagMap.has('Guns')) addScore('action', getTag('Guns') * 1.1, 'タグ: Guns');
    if (tagMap.has('Battle Royale')) addScore('action', getTag('Battle Royale') * 1.1, 'タグ: Battle Royale');
    if (tagMap.has('Superhero')) addScore('action', getTag('Superhero') * 1.1, 'タグ: Superhero');
    if (tagMap.has('Shounen') && g.has('Action')) addScore('action', getTag('Shounen') * 0.9, 'タグ: Shounen');
    if (tagMap.has('Kaiju')) addScore('action', getTag('Kaiju') * 0.9, 'タグ: Kaiju');
    if (tagMap.has('Revenge') && g.has('Action')) addScore('action', getTag('Revenge') * 0.9, 'タグ: Revenge');
    if (/(?:チェンソーマン|呪術廻戦|鬼滅の刃|進撃の巨人|リコリス・リコイル|僕のヒーローアカデミア|ヒロアカ|ワンパンマン|モブサイコ|BLEACH|NARUTO|ナルト|ONE PIECE|ワンピース|ドラゴンボール|HUNTER×HUNTER|ハンターハンター|ブラッククローバー|東京喰種|Fate\/stay night|Fate\/Zero|\bFate\s*[\/:]|空の境界|キルラキル|アクセル・ワールド|ストライク・ザ・ブラッド|超電磁砲|レールガン|シャナ|デート・ア・ライブ|ブラック★ロックシューター|シーキューブ|C3|心臓に復讐|Mr.War|AKIBA’S TRIP|リボンヒーロー|LAZARUS|7FATES|CHAKHO|ポケットモンスター|ポケモン|ソウルイーター|SOUL EATER|テラフォーマーズ|TERRAFORMARS|亜人|青の祓魔師)/i.test(t)) {
      addScore('action', 150, '代表アクションタイトル');
    }

    // 14. SF / ファンタジー (sf_fantasy)
    if (g.has('Fantasy')) addScore('sf_fantasy', 75, '公式ジャンル: Fantasy');
    if (g.has('Sci-Fi')) addScore('sf_fantasy', 90, '公式ジャンル: Sci-Fi');
    if (tagMap.has('Magic')) addScore('sf_fantasy', getTag('Magic') * 0.9, 'タグ: Magic');
    if (tagMap.has('Witch') && !g.has('Mahou Shoujo')) addScore('sf_fantasy', getTag('Witch') * 1.1, 'タグ: Witch(魔女)');
    if (tagMap.has('Elf')) addScore('sf_fantasy', getTag('Elf') * 1.1, 'タグ: Elf');
    if (tagMap.has('Dungeon')) addScore('sf_fantasy', getTag('Dungeon') * 1.2, 'タグ: Dungeon');
    if (tagMap.has('Dragons')) addScore('sf_fantasy', getTag('Dragons') * 1.0, 'タグ: Dragons');
    if (tagMap.has('Time Manipulation')) addScore('sf_fantasy', getTag('Time Manipulation') * 1.1, 'タグ: Time Manipulation');
    if (tagMap.has('Cyberpunk')) addScore('sf_fantasy', getTag('Cyberpunk') * 1.2, 'タグ: Cyberpunk');
    if (tagMap.has('Space')) addScore('sf_fantasy', getTag('Space') * 1.1, 'タグ: Space');
    if (tagMap.has('Artificial Intelligence')) addScore('sf_fantasy', getTag('Artificial Intelligence') * 1.1, 'タグ: AI');
    if (tagMap.has('Virtual World')) addScore('sf_fantasy', getTag('Virtual World') * 1.1, 'タグ: Virtual World');
    if (tagMap.has('Urban Fantasy')) addScore('sf_fantasy', getTag('Urban Fantasy') * 0.8, 'タグ: Urban Fantasy');
    if (tagMap.has('Post-Apocalyptic')) addScore('sf_fantasy', getTag('Post-Apocalyptic') * 0.9, 'タグ: Post-Apocalyptic');
    if (/(?:葬送のフリーレン|フリーレン|魔女の旅々|ダンジョン飯|ダンまち|ダンジョンに出会いを|STEINS;GATE|シュタゲ|Dr.STONE|ドクターストーン|サマーウォーズ|とある魔術|禁書目録|メイドインアビス|ウィストリア|シャンフロ|シャングリラ・フロンティア|SAO|ソードアート|電脳コイル|攻殻機動隊|ヴィヴィ|Vivy|寄生獣|ハクメイとミコチ|虫師|夏目友人帳|宇宙戦艦ヤマト|マギ The labyrinth|マギ シンドバッド|マリオ|プラスティック・メモリーズ|プラメモ|BEATLESS|ビートレス|AYAKA|トイ・ストーリー|神椿市|FF:U|ファイナルファンタジー|グルグル|魔法陣グルグル|ワンダーエッグ|xxxHOLiC|ホリック|COWBOY BEBOP|カウボーイビバップ|しらぬひ|サイレント・ウィッチ|とんがり帽子のアトリエ|ある魔女が死ぬまで|魔術師クノン|超かぐや姫|強くてニューサーガ|大喜利ニューサーガ|井戸端会議でニューサーガ|ちっちゃな雪使いシュガー|藤本タツキ 17-26|ドンキホーテ幻の花|もうひとつの未来を|サイバーパンク|FAIRY TAIL|マッシュル|どろろ|HELLO WORLD|ブレイブストーリー|ドロヘドロ|アリスと蔵六|夜桜四重奏)/i.test(t)) {
      addScore('sf_fantasy', 140, '代表SF/ファンタジータイトル');
    }

    // 最高得点カテゴリの判定（最低閾値: 20点）
    let bestCat = 'other';
    let maxScore = 20;

    for (let i = 0; i < GENRE_DEFINITIONS.length; i++) {
      const id = GENRE_DEFINITIONS[i].id;
      if (id === 'other') continue;
      const s = scores[id] || 0;
      if (s > maxScore) {
        maxScore = s;
        bestCat = id;
      }
    }

    // セーフティネット救済（未照合・公式情報不足作品のタイトル推論）
    if (bestCat === 'other') {
      const inferred = inferCategoryFromTitle(t);
      if (inferred && inferred !== 'other') {
        bestCat = inferred;
        maxScore = 60;
        scores[bestCat] = Math.max(scores[bestCat] || 0, 60);
        reasons[bestCat].push('スマート推論・セーフティネット救済 (+60)');
      } else {
        let fbCat = null;
        let fbReason = '';
        if (g.has('Fantasy') || g.has('Sci-Fi') || g.has('Supernatural')) { fbCat = 'sf_fantasy'; fbReason = '公式ジャンルフォールバック (Fantasy/Sci-Fi)'; }
        else if (g.has('Slice of Life')) { fbCat = 'nichijou'; fbReason = '公式ジャンルフォールバック (Slice of Life)'; }
        else if (g.has('Action') || g.has('Adventure')) { fbCat = 'action'; fbReason = '公式ジャンルフォールバック (Action/Adventure)'; }
        else if (g.has('Romance')) { fbCat = 'romance'; fbReason = '公式ジャンルフォールバック (Romance)'; }
        else if (g.has('Drama')) { fbCat = 'drama'; fbReason = '公式ジャンルフォールバック (Drama)'; }
        else if (g.has('Comedy')) { fbCat = 'comedy'; fbReason = '公式ジャンルフォールバック (Comedy)'; }
        else if (g.has('Ecchi') || g.has('Hentai')) { fbCat = 'ecchi'; fbReason = '公式ジャンルフォールバック (Ecchi)'; }
        else if (g.has('Horror') || g.has('Thriller') || g.has('Mystery') || g.has('Psychological')) { fbCat = 'horror_suspense'; fbReason = '公式ジャンルフォールバック (Mystery/Horror)'; }

        if (fbCat) {
          bestCat = fbCat;
          maxScore = 40;
          scores[bestCat] = Math.max(scores[bestCat] || 0, 40);
          reasons[bestCat].push(`${fbReason} (+40)`);
        }
      }
    }

    const topReasons = (reasons[bestCat] || []).slice(0, 4);

    return {
      category: bestCat,
      score: Math.round(maxScore),
      scores,
      reasons,
      topReasons
    };
  }

  /**
   * 簡易カテゴリ判定（15カテゴリのIDのみ返却）
   * @param {string[]} genres
   * @param {Array} tags
   * @param {string} title
   * @returns {string}
   */
  function classifyAnimeScored(genres, tags, title) {
    return scoreAnimeDetailed(genres, tags, title).category;
  }

  const ROMAN_ASCII_MAP = {
    'Ⅰ': 'I', 'Ⅱ': 'II', 'Ⅲ': 'III', 'Ⅳ': 'IV', 'Ⅴ': 'V',
    'Ⅵ': 'VI', 'Ⅶ': 'VII', 'Ⅷ': 'VIII', 'Ⅸ': 'IX', 'Ⅹ': 'X'
  };

  function replaceRomanNumerals(str) {
    return String(str || '').replace(/[Ⅰ-Ⅹ]/g, ch => ROMAN_ASCII_MAP[ch] || ch);
  }

  function toHiragana(str) {
    return String(str || '').replace(/[\u30A1-\u30F6]/g, ch =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60)
    );
  }

  function extractYearHint(str) {
    const m = String(str || '').match(/((?:19|20)\d{2})/);
    return m ? parseInt(m[1], 10) : null;
  }

  function normalizeAniListTitle(title, stage = 1) {
    if (!title) return '';
    let cleaned = replaceRomanNumerals(String(title))
      .replace(/[！-～]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      .replace(/\s*[\(（][^\)）]+[\)）]/g, '')
      .replace(/\s*\[[^\]]+\]/g, '')
      .replace(/\s*(?:Season\s*\d+|第\d+期|第\d+クール|\d+(?:st|nd|rd|th)\s*Season|The\s*Final\s*Season).*$/i, '')
      .replace(/\s+[1-9Ⅰ-Ⅹ]+$/i, '')
      .replace(/^(?:劇場版|映画|アニメ)\s*/i, '')
      .trim();

    if (stage >= 2) {
      cleaned = cleaned
        .replace(/\s*[~〜～][^~〜～]+[~〜～]/g, '')
        .replace(/\s*[―—][^―—]+[―—]\s*$/g, '')
        .replace(/\s+:[^:]+$/g, '')
        .replace(/\s+-.+$/g, '')
        .trim();
    }
    return cleaned || title;
  }

  function extractAniListStudios(media) {
    if (!media?.studios?.edges) return [];
    const edges = media.studios.edges.filter(e => e && e.node?.name && e.node.isAnimationStudio);
    const main = [];
    const all = [];
    for (let i = 0; i < edges.length; i++) {
      const name = String(edges[i].node.name).trim();
      if (!name) continue;
      if (!all.includes(name)) all.push(name);
      if (edges[i].isMain && !main.includes(name)) main.push(name);
    }
    return main.length > 0 ? main : all;
  }

  function selectBestAniListMedia(candidates, searchTitle, expectedYear = null) {
    if (!candidates || candidates.length === 0) return null;
    const norm = (s) => {
      if (!s) return '';
      return toHiragana(
        replaceRomanNumerals(String(s))
          .normalize('NFKC')
          .toLowerCase()
          .replace(/\s*[\(（][^\)）]+[\)）]/g, '')
          .replace(/[\s\-_・･:：!！?？~～〜～,，.。\/／\\\(\)（）\[\]「」『』【】〈〉《》'"’”☆♥♡♪+＋×―—]+/g, '')
      ).trim();
    };
    const normSearch = norm(searchTitle);
    const normBase = norm(normalizeAniListTitle(searchTitle, 2));
    const targetYear = expectedYear || extractYearHint(searchTitle);
    const fmtScores = { TV: 100, MOVIE: 100, TV_SHORT: 70, OVA: 40, ONA: 30, SPECIAL: 10, MUSIC: 0 };

    let best = null;
    let bestScore = -Infinity;
    let bestTitleScore = 0;

    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      const nNat = norm(cand.title?.native);
      const nRom = norm(cand.title?.romaji);
      const nEng = norm(cand.title?.english);
      const nSyn = (cand.synonyms || []).map(norm).filter(Boolean);
      const allCandNorms = [nNat, nRom, nEng, ...nSyn].filter(Boolean);

      let titleScore = 0;
      if (normSearch && (nNat === normSearch || nRom === normSearch)) titleScore = 1000;
      else if (normSearch && nEng === normSearch) titleScore = 950;
      else if (normSearch && nSyn.includes(normSearch)) titleScore = 900;
      else if (normBase && normBase.length >= 2 && allCandNorms.includes(normBase)) titleScore = 750;
      else if (normSearch && ((nNat && nNat.startsWith(normSearch)) || (nRom && nRom.startsWith(normSearch)) || (nNat && nNat.length >= 3 && normSearch.startsWith(nNat)))) titleScore = 500;
      else if (normSearch && ((nNat && normSearch.length >= 3 && nNat.includes(normSearch)) || (nRom && normSearch.length >= 3 && nRom.includes(normSearch)) || (nNat && nNat.length >= 4 && normSearch.includes(nNat)))) titleScore = 250;
      else if (normBase && normBase.length >= 4 && allCandNorms.some(c => c.startsWith(normBase) || normBase.startsWith(c))) titleScore = 220;

      // タイトル文字列との妥当な一致が無い誤候補（別作品）は除外
      if (normSearch && titleScore === 0) continue;

      let score = titleScore;
      const candYear = cand.startDate?.year || null;
      if (targetYear && candYear) {
        const diff = Math.abs(targetYear - candYear);
        if (diff === 0) score += 450;
        else if (diff === 1) score += 200;
        else if (diff >= 3) score -= 350;
      }

      score += fmtScores[cand.format] || 0;
      score += Math.min(100, Math.log10((cand.popularity || 0) + 1) * 20);
      if (score > bestScore) {
        bestScore = score;
        best = cand;
        bestTitleScore = titleScore;
      }
    }
    return bestTitleScore > 0 ? best : null;
  }

  /**
   * ブラウザからAniList GraphQL APIを直接叩いてタグ・ジャンル・制作会社を取得（サーバー同一選定基準）
   */
  async function fetchAniListMediaInBrowser(title, expectedYear = null) {
    if (!title || typeof fetch !== 'function') return null;
    const cleanTitle = normalizeAniListTitle(title, 1);

    const query = `
      query ($search: String) {
        Page(page: 1, perPage: 8) {
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id
            format
            popularity
            startDate { year }
            synonyms
            title { romaji english native }
            genres
            tags { name rank isMediaSpoiler }
            studios {
              edges {
                isMain
                node { name isAnimationStudio }
              }
            }
          }
        }
      }
    `;

    const querySearch = async (searchStr) => {
      const fetchOpts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query, variables: { search: searchStr } })
      };
      if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        fetchOpts.signal = AbortSignal.timeout(10000);
      }
      const res = await fetch('https://graphql.anilist.co', fetchOpts);
      if (!res.ok) return [];
      const data = await res.json();
      return data?.data?.Page?.media || [];
    };

    try {
      let bestMedia = selectBestAniListMedia(await querySearch(title), title, expectedYear);
      if (!bestMedia && cleanTitle && cleanTitle !== title) {
        bestMedia = selectBestAniListMedia(await querySearch(cleanTitle), title, expectedYear);
      }
      if (!bestMedia) {
        const subTitle = normalizeAniListTitle(title, 2);
        if (subTitle && subTitle !== cleanTitle && subTitle !== title) {
          bestMedia = selectBestAniListMedia(await querySearch(subTitle), title, expectedYear);
        }
      }
      if (!bestMedia) return null;

      return {
        genres: bestMedia.genres || [],
        tags: (bestMedia.tags || []).filter(tag => !tag.isMediaSpoiler).map(tag => ({ name: tag.name, rank: tag.rank })),
        studios: extractAniListStudios(bestMedia)
      };
    } catch (e) {
      return null;
    }
  }

  function normalizeTitleLookupKey(title) {
    if (!title) return '';
    return String(title)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s\-_・:：!！?？~～〜～,，.。\/／\\\(\)（）\[\]「」『』【】〈〉《》'"’”]+/g, '')
      .trim();
  }

  function isValidLookupKey(key) {
    if (!key) return false;
    const isAsciiOnly = /^[\x00-\x7F]+$/.test(key);
    return isAsciiOnly ? key.length >= 4 : key.length >= 3;
  }

  function getTitleMatchCandidates(title) {
    if (!title) return [];
    const seen = new Set();
    const out = [];
    const pushKey = (raw) => {
      const k = normalizeTitleLookupKey(raw);
      if (isValidLookupKey(k) && !seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    };

    const s = String(title).normalize('NFKC').trim();
    pushKey(s);
    const n1 = normalizeAniListTitle(s, 1);
    pushKey(n1);
    const n2 = normalizeAniListTitle(s, 2);
    pushKey(n2);

    const stripDerived = (raw) => String(raw || '')
      .replace(/^(?:TVアニメ|テレビアニメ|アニメ|映画|劇場版|完全版|続・劇場版|新・)\s*/i, '')
      .replace(/\s*(?:特別編|総集編|完結編|ミニアニメ(?:劇場)?|OVA|OAD|SP|番外編|外伝|セレクション).*$/i, '')
      .replace(/\s*(?:続・劇場版|劇場版|Part\s*\d+|前篇|後篇|前編|後編|[ⅠⅡⅢⅣⅤ].*|[（(][^）)]*[)）]|「[^」]*」|『[^』]*』).*$/i, '')
      .replace(/\s*(?:第?\s*[0-9一二三四五六七八九十]+[期クール部章]|\d+nd|\d+rd|\d+th|\s+[0-9]+)$/i, '')
      .trim();

    const d1 = stripDerived(s);
    pushKey(d1);
    const d2 = stripDerived(n1);
    pushKey(d2);
    const d3 = stripDerived(d2);
    pushKey(d3);

    const noTrailDigit = d3.replace(/([^\d\-:\.])[1-9]$/, '$1').trim();
    if (noTrailDigit && noTrailDigit !== d3) pushKey(noTrailDigit);

    const bookMatch = s.match(/『([^』]{3,})』/);
    if (bookMatch && bookMatch[1]) pushKey(bookMatch[1]);

    const headChunk = d1.split(/\s+/)[0];
    if (headChunk && normalizeTitleLookupKey(headChunk).length >= 5) {
      pushKey(headChunk);
    }

    return out;
  }

  const STORY_GENRE_TOKEN_MAP = {
    'ロボット/メカ': 'mecha',
    'ロボ/メカ': 'mecha',
    'スポーツ/競技': 'sports',
    'ホラー/サスペンス/推理': 'horror_suspense',
    '歴史/戦記': 'history_military',
    '戦争/ミリタリー': 'history_military',
    'ライブ/ラジオ/etc.': 'idol_music',
    'アイドル/音楽': 'idol_music',
    '恋愛/ラブコメ': 'romance',
    '日常/ほのぼの': 'nichijou',
    'コメディ/ギャグ': 'comedy',
    'ドラマ/青春': 'drama',
    'アクション/バトル': 'action',
    'SF/ファンタジー': 'sf_fantasy',
    '異世界/転生': 'isekai',
    '魔法少女/バトルヒロイン': 'mahou_shoujo',
    'エッチ/お色気': 'ecchi'
  };

  function mapStoryGenresToCategory(genreStr, title) {
    const byTitle = classifyAnimeScored([], [], title || '');
    if (byTitle && byTitle !== 'other') return byTitle;

    const tokens = String(genreStr || '').split(/[,、]/).map(s => s.trim()).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok === 'ショート' || tok === 'キッズ/ファミリー') continue;
      if (STORY_GENRE_TOKEN_MAP[tok]) return STORY_GENRE_TOKEN_MAP[tok];
    }
    if (tokens.includes('キッズ/ファミリー')) return 'nichijou';
    if (tokens.includes('ショート')) return 'comedy';
    return 'other';
  }

  return {
    GENRE_DEFINITIONS,
    GENRE_DEF_MAP,
    TITLE_ALIASES,
    inferCategoryFromTitle,
    scoreAnimeDetailed,
    classifyAnimeScored,
    normalizeAniListTitle,
    normalizeTitleLookupKey,
    getTitleMatchCandidates,
    mapStoryGenresToCategory,
    extractAniListStudios,
    extractYearHint,
    selectBestAniListMedia,
    fetchAniListMediaInBrowser
  };
}));
