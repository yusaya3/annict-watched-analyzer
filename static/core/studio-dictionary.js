(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    let GE = null;
    try { GE = require('./genre-engine.js'); } catch (e) {}
    module.exports = factory(GE);
  } else {
    root.StudioDictionary = factory(root.GenreEngine);
  }
}(typeof self !== 'undefined' ? self : this, function (GenreEngine) {
  'use strict';

  /**
   * アニメ制作スタジオ定義（ブランドカラー・短縮名・ローカルフォールバック辞書）
   */
  const STUDIOS = [
    {
      name: '京都アニメーション',
      short: '京アニ',
      color: '#38bdf8',
      keywords: [
        'けいおん', '涼宮ハルヒ', 'ヴァイオレット・エヴァーガーデン', '氷菓', '響け！ユーフォニアム',
        'CLANNAD', 'クラナド', 'Free!', '中二病でも恋がしたい', 'ツルネ', '日常', 'らき☆すた',
        '小林さんちのメイドラゴン', 'たまこまーけっと', 'たまこラブストーリー', '聲の形', '境界の彼方',
        '甘城ブリリアントパーク', 'AIR', 'Kanon', 'フルメタル・パニック? ふもっふ', 'フルメタル・パニック！The Second Raid',
        'リズと青い鳥', '無彩限のファントム・ワールド', 'バジャのスタジオ', '二十世紀電氣目録'
      ]
    },
    {
      name: '動画工房',
      short: '動画工房',
      color: '#f43f5e',
      keywords: [
        'ゆるゆり', '月刊少女野崎くん', 'NEW GAME!', '私に天使が舞い降りた', 'ダンベル何キロ持てる',
        'おちこぼれフルーツタルト', '【推しの子】', '推しの子', 'ガヴリールドロップアウト',
        '恋する小惑星', 'プラスティック・メモリーズ', '干物妹！うまるちゃん', 'うまるちゃん',
        '多田くんは恋をしない', '魔王城でおやすみ', '可愛いだけじゃない式守さん', '夜のクラゲは泳げない',
        '未確認で進行形', 'GJ部', '恋愛ラボ', '三者三葉', 'イエスタデイをうたって',
        '放課後ていぼう日誌', '時々ボソッとロシア語でデレる隣のアーリャさん', '白聖女と黒牧師',
        'RPG不動産', '恋は双子で割り切れない', 'Myself;Yourself'
      ]
    },
    {
      name: 'シャフト',
      short: 'シャフト',
      color: '#a855f7',
      keywords: [
        'まどか☆マギカ', 'マドカ', '化物語', '偽物語', '猫物語', '傾物語', '囮物語', '鬼物語',
        '恋物語', '花物語', '憑物語', '終物語', '傷物語', '続・終物語', '暦物語', '愚物語', '撫物語',
        'さよなら絶望先生', '荒川アンダー ザ ブリッジ', 'ニセコイ', '3月のライオン', 'ひだまりスケッチ',
        '電波女と青春男', '美少年探偵団', 'マギアレコード', 'それでも町は廻っている',
        'ef - a tale', 'ささみさん@がんばらない', '夏のあらし', '月詠', 'これが私の御主人様',
        '幸腹グラフィティ', 'メカクシティアクターズ', 'クビキリサイクル', 'アサルトリリィ BOUQUET',
        'RWBY 氷雪帝国', '五等分の花嫁∽', '忍者と殺し屋のふたりぐらし'
      ]
    },
    {
      name: 'ufotable',
      short: 'ufotable',
      color: '#e11d48',
      keywords: [
        '鬼滅の刃', 'Fate/Zero', 'Fate/stay night [Unlimited Blade Works]', "Fate/stay night [Heaven's Feel]",
        'Fate/stay night [Heaven’s Feel]', '空の境界', '活撃 刀剣乱舞', 'テイルズ オブ ゼスティリア',
        'GOD EATER', '衛宮さんちの今日のごはん', 'フタコイ オルタナティブ', 'がくえんゆーとぴあ まなびストレート'
      ]
    },
    {
      name: 'MAPPA',
      short: 'MAPPA',
      color: '#ec4899',
      keywords: [
        '呪術廻戦', '進撃の巨人 The Final', 'チェンソーマン', '地獄楽', 'ゾンビランドサガ',
        'ユーリ!!! on ICE', 'BANANA FISH', 'ドロヘドロ', 'この世界の片隅に',
        'ヴィンランド・サガ SEASON 2', 'ダンス・ダンス・ダンスール', 'とんでもスキルで異世界放浪メシ',
        '忘却バッテリー', '坂道のアポロン', '残響のテロル', '神撃のバハムート', 'どろろ',
        '恋とプロデューサー', '体操ザムライ', 'RE-MAIN', '平穏世代の韋駄天達', 'ぶっちぎり?!',
        'らんま1/2 (2024)', '全修。', 'ザ・ファブル', 'アリスとテレスのまぼろし工場'
      ]
    },
    {
      name: 'CloverWorks',
      short: 'CloverWorks',
      color: '#10b981',
      keywords: [
        'ぼっち・ざ・ろっく', 'その着せ替え人形は恋をする', 'SPY×FAMILY', '約束のネバーランド',
        '青春ブタ野郎', 'ホリミヤ', '明日ちゃんのセーラー服', 'Fate/Grand Order -絶対魔獣戦線バビロニア-',
        'シャドーハウス', 'WIND BREAKER', '逃げ上手の若君', 'ワンダーエッグ・プライオリティ',
        '空の青さを知る人よ', 'スロウスタート', 'くノ一ツバキの胸の内', 'PERSONA5 the Animation',
        '冴えない彼女の育てかた Fine', '黒執事 -寄宿学校編-', 'ふれる。', '薫る花は凛と咲く',
        'ギルドの受付嬢ですが'
      ]
    },
    {
      name: 'A-1 Pictures',
      short: 'A-1',
      color: '#3b82f6',
      keywords: [
        'ソードアート・オンライン', 'かぐや様は告らせたい', 'リコリス・リコイル', '86―エイティシックス―',
        '四月は君の嘘', 'あの日見た花の名前を僕達はまだ知らない', '青の祓魔師', '冴えない彼女の育てかた',
        'マッシュル', 'アイドルマスター', 'THE IDOLM@STER', '僕だけがいない街', '七つの大罪', 'マギ',
        'WORKING!!', '俺の妹がこんなに可愛いわけがない', 'おおきく振りかぶって', 'かんなぎ',
        'うたの☆プリンスさまっ', '俺の彼女と幼なじみが修羅場すぎる', '銀の匙 Silver Spoon',
        'アルドノア・ゼロ', 'ブレンド・S', 'エロマンガ先生', 'ヲタクに恋は難しい', '負けヒロインが多すぎる',
        '俺だけレベルアップな件', 'NieR:Automata', 'Engage Kiss', 'Fate/Apocrypha', 'ガリレイドンナ'
      ]
    },
    {
      name: 'TRIGGER',
      short: 'TRIGGER',
      color: '#f59e0b',
      keywords: [
        'キルラキル', 'リトルウィッチアカデミア', 'SSSS.GRIDMAN', 'SSSS.DYNAZENON', 'グリッドマン ユニバース',
        'サイバーパンク エッジランナーズ', 'ダンジョン飯', 'プロメア', 'ダーリン・イン・ザ・フランキス',
        'BNA', 'キズナイーバー', '宇宙パトロールルル子', 'New PANTY & STOCKING'
      ]
    },
    {
      name: 'サンライズ',
      short: 'サンライズ',
      color: '#ef4444',
      keywords: [
        'ガンダム', '機動戦士', '水星の魔女', 'コードギアス', 'ラブライブ', '銀魂', 'カウボーイビバップ',
        'COWBOY BEBOP', 'タイガー＆バニー', 'TIGER & BUNNY', 'ケロロ軍曹', 'シティハンター', '舞-HiME',
        '境界線上のホライゾン', 'アクセル・ワールド', 'アイカツ！', '革命機ヴァルヴレイヴ',
        'クロスアンジュ', 'プラネテス', 'スクライド', 'ゼーガペイン'
      ]
    },
    {
      name: 'P.A.WORKS',
      short: 'P.A.',
      color: '#06b6d4',
      keywords: [
        'SHIROBAKO', '花咲くいろは', 'Angel Beats!', 'Charlotte', '色づく世界の明日から',
        'パリピ孔明', 'スキップとローファー', 'true tears', 'TARI TARI', '凪のあすから',
        '有頂天家族', 'サクラクエスト', '神様になった日', 'Buddy Daddies', 'Another', 'CANAAN',
        'グラスリップ', 'ハルチカ', 'クロムクロ', 'さよならの朝に約束の花をかざろう',
        '白い砂のアクアトープ', 'アキバ冥途戦争', '天晴爛漫', '真夜中ぱんチ', '菜なれ花なれ',
        '駒田蒸留所へようこそ', '地球外少年少女'
      ]
    },
    {
      name: 'WIT STUDIO',
      short: 'WIT',
      color: '#8b5cf6',
      keywords: [
        '進撃の巨人', '甲鉄城のカバネリ', '王様ランキング', 'ヴィンランド・サガ',
        "Vivy -Fluorite Eye's Song-", '恋は雨上がりのように', '魔法使いの嫁', 'GREAT PRETENDER',
        'しかのこのこのここしたんたん', '終わりのセラフ', '異世界スーサイド・スクワッド', 'おにぱん！',
        '絆のアリル', 'バブル', '屍者の帝国'
      ]
    },
    {
      name: 'ボンズ',
      short: 'ボンズ',
      color: '#f97316',
      keywords: [
        '僕のヒーローアカデミア', 'ヒロアカ', '鋼の錬金術師', '文豪ストレイドッグス', 'モブサイコ100',
        'ソウルイーター', '血界戦線', '交響詩篇エウレカセブン', 'DARKER THAN BLACK', 'スペース☆ダンディ',
        'SK∞ エスケーエイト', '桜蘭高校ホスト部', 'STAR DRIVER', '絶園のテンペスト', '東京マグニチュード8.0',
        '亡念のザムド', 'ラーゼフォン', 'ノラガミ', '赤髪の白雪姫', 'ヴァニタスの手記', 'メタリックルージュ',
        'キャロル＆チューズデイ', 'ガチアクタ'
      ]
    },
    {
      name: 'マッドハウス',
      short: 'マッドハウス',
      color: '#14b8a6',
      keywords: [
        '葬送のフリーレン', 'ワンパンマン', 'オーバーロード', 'DEATH NOTE', 'デスノート',
        'カードキャプターさくら', 'ちはやふる', 'サマーウォーズ', 'HUNTER×HUNTER(2011)', '宇宙よりも遠い場所',
        'BLACK LAGOON', '四畳半神話大系', 'Sonny Boy', 'サニーボーイ', 'ノーゲーム・ノーライフ',
        '寄生獣 セイの格率', 'ちょびっツ', 'GUNSLINGER GIRL', '学園黙示録', '織田信奈の野望',
        'チ。 ―地球の運動について―', 'ハコヅメ', '山田くんとLv999の恋をする', 'トリリオンゲーム',
        '時をかける少女', 'パプリカ', 'ギャラクシーエンジェル', 'CHAOS;HEAD', '怪物王女', 'takt op.Destiny'
      ]
    },
    {
      name: 'J.C.STAFF',
      short: 'J.C.',
      color: '#eab308',
      keywords: [
        'とある魔術の禁書目録', 'とある科学の超電磁砲', 'ダンまち', 'ダンジョンに出会いを求めるのは間違っているだろうか',
        '食戟のソーマ', 'とらドラ!', 'ゼロの使い魔', '灼眼のシャナ', 'さくら荘のペットな彼女',
        'ハチミツとクローバー', 'まちカドまぞく', 'あずまんが大王', 'あの夏で待ってる', '青い花',
        '会長はメイド様', '彼氏彼女の事情', 'リトルバスターズ', '斉木楠雄のΨ難', '監獄学園',
        'バクマン。', '少女革命ウテナ', 'ふらいんぐうぃっち', '藍より青し', '2.5次元の誘惑'
      ]
    },
    { name: 'SILVER LINK.', short: 'シルリン', color: '#06b6d4', keywords: ['のんのんびより', 'プリズマ☆イリヤ', 'バカとテストと召喚獣', '乙女ゲームの破滅フラグ', '防振り'] },
    { name: 'トムス・エンタテインメント', short: 'トムス', color: '#2563eb', keywords: ['名探偵コナン', 'ルパン三世', '弱虫ペダル', 'Dr.STONE', '彼女、お借りします'] },
    { name: 'スタジオディーン', short: 'DEEN', color: '#6366f1', keywords: ['この素晴らしい世界に祝福を！', 'ひぐらしのなく頃に', '昭和元禄落語心中', 'さんかれあ'] },
    { name: 'Production I.G', short: 'I.G', color: '#0284c7', keywords: ['PSYCHO-PASS', 'サイコパス', 'ハイキュー!!', '攻殻機動隊', '東のエデン', '黒子のバスケ', 'ギルティクラウン'] },
    { name: 'エイトビット', short: '8-bit', color: '#10b981', keywords: ['転生したらスライムだった件', 'ブルーロック', 'ヤマノススメ', 'グリザイアの果実', '魔法科高校の劣等生'] },
    { name: '東映アニメーション', short: '東映アニメ', color: '#dc2626', keywords: ['プリキュア', 'ONE PIECE', 'ワンピース', 'ドラゴンボール', 'スラムダンク', 'おジャ魔女どれみ', 'ガールズバンドクライ'] },
    { name: 'サテライト', short: 'サテライト', color: '#0ea5e9', keywords: ['マクロスF', '戦姫絶唱シンフォギア', 'アクエリオン', 'ログ・ホライズン'] },
    { name: 'ライデンフィルム', short: 'ライデン', color: '#f97316', keywords: ['東京リベンジャーズ', 'よふかしのうた', 'アルスラーン戦記', 'るろうに剣心 －明治剣客浪漫譚－ (2023)'] },
    { name: 'OLM', short: 'OLM', color: '#22c55e', keywords: ['薬屋のひとりごと', 'サマータイムレンダ', '古見さんは、コミュ症です', 'ポケットモンスター'] },
    { name: 'feel.', short: 'feel.', color: '#ec4899', keywords: ['やはり俺の青春ラブコメはまちがっている', '月がきれい', 'ダ・カーポ', 'パパのいうことを聞きなさい'] },
    { name: 'XEBEC', short: 'XEBEC', color: '#7c3aed', keywords: ['蒼穹のファフナー', 'To LOVEる', '這いよれ！ニャル子さん', '宇宙戦艦ヤマト2199'] },
    { name: 'project No.9', short: 'No.9', color: '#f43f5e', keywords: ['先輩はおとこのこ', 'りゅうおうのおしごと', 'ひげを剃る。そして女子高生を拾う', 'お隣の天使様にいつの間にか駄目人間にされていた件'] },
    { name: 'Studio五組', short: '五組', color: '#fb7185', keywords: ['きんいろモザイク', '咲-Saki-', '結城友奈は勇者である', 'ラーメン大好き小泉さん'] },
    { name: 'ディオメディア', short: 'ディオメディア', color: '#38bdf8', keywords: ['艦隊これくしょん', '問題児たちが異世界から来るそうですよ', '侵略！イカ娘'] },
    { name: 'WHITE FOX', short: 'WHITE FOX', color: '#64748b', keywords: ['STEINS;GATE', 'Re:ゼロから始める異世界生活', 'ご注文はうさぎですか', '刀語', 'ヨルムンガンド'] },
    { name: 'Lerche', short: 'Lerche', color: '#8b5cf6', keywords: ['暗殺教室', 'がっこうぐらし', 'ダンガンロンパ', 'ようこそ実力至上主義の教室へ', 'あそびあそばせ'] },
    { name: 'キネマシトラス', short: 'キネマ', color: '#14b8a6', keywords: ['メイドインアビス', '少女☆歌劇 レヴュースタァライト', '盾の勇者の成り上がり', 'ばらかもん'] },
    { name: 'ぴえろ', short: 'ぴえろ', color: '#ea580c', keywords: ['NARUTO', 'BLEACH', 'おそ松さん', '幽☆遊☆白書', 'ブラッククローバー'] },
    { name: 'シンエイ動画', short: 'シンエイ', color: '#16a34a', keywords: ['からかい上手の高木さん', '僕の心のヤバイやつ', 'ドラえもん', 'クレヨンしんちゃん'] },
    { name: 'スタジオジブリ', short: 'ジブリ', color: '#059669', keywords: ['千と千尋の神隠し', 'もののけ姫', 'となりのトトロ', '風の谷のナウシカ', '天空の城ラピュタ'] },
    { name: 'ブレインズ・ベース', short: 'ブレインズ', color: '#4f46e5', keywords: ['夏目友人帳', 'デュラララ', 'バッカーノ', '輪るピングドラム', '虚構推理'] },
    { name: 'david production', short: 'david', color: '#0891b2', keywords: ['ジョジョの奇妙な冒険', 'はたらく細胞', '炎炎ノ消防隊', 'アンデッドアンラック'] },
    { name: 'スタジオバインド', short: 'バインド', color: '#d97706', keywords: ['無職転生', 'お兄ちゃんはおしまい', 'るり', '花は咲く、修羅の如く'] },
    { name: 'Science SARU', short: 'SARU', color: '#e11d48', keywords: ['ダンダダン', '映像研には手を出すな', 'ピンポン', '平家物語', '四畳半タイムマシンブルース'] },
    { name: 'CygamesPictures', short: 'サイピク', color: '#2563eb', keywords: ['プリンセスコネクト', 'ウマ娘 プリティーダービー ROAD TO THE TOP', '勇気爆発バーンブレイバーン'] },
    { name: 'Studio KAI', short: 'KAI', color: '#0d9488', keywords: ['スーパーカブ', 'ウマ娘 プリティーダービー Season 2', 'ウマ娘 プリティーダービー Season 3'] },
    { name: 'サンジゲン', short: 'サンジゲン', color: '#3b82f6', keywords: ['BanG Dream! It', '蒼き鋼のアルペジオ', 'ブブキ・ブランキ'] },
    { name: 'BN Pictures', short: 'BNP', color: '#f59e0b', keywords: ['魔入りました！入間くん', '銀魂°', '銀魂.', 'アイカツスターズ', 'アイカツフレンズ'] },
    { name: 'ZERO-G', short: 'ZERO-G', color: '#6366f1', keywords: ['ぐらんぶる', '理系が恋に落ちたので証明してみた', '同居人はひざ、時々、頭のうえ。'] },
    { name: 'AIC', short: 'AIC', color: '#7c3aed', keywords: ['天地無用', '僕は友達が少ない', 'そらのおとしもの'] },
    { name: 'GONZO', short: 'GONZO', color: '#be185d', keywords: ['咲-Saki-', 'ストライクウィッチーズ', '巌窟王', 'ラストエグザイル'] },
    { name: 'タツノコプロ', short: 'タツノコ', color: '#dc2626', keywords: ['プリティーリズム', 'C THE MONEY OF SOUL', '科学忍者隊ガッチャマン'] },
    { name: 'TYOアニメーションズ', short: 'TYO', color: '#ec4899', keywords: ['ゆるゆり なちゅやちゅみ', 'ゆるゆり さん☆ハイ'] },
    { name: '日本アニメーション', short: '日本アニメ', color: '#0284c7', keywords: ['未来少年コナン', 'ちびまる子ちゃん'] },
    { name: 'セブン・アークス', short: '7Arcs', color: '#8b5cf6', keywords: ['魔法少女リリカルなのは', 'DOG DAYS', 'トニカクカワイイ'] },
    { name: 'GAINAX', short: 'GAINAX', color: '#e11d48', keywords: ['新世紀エヴァンゲリオン', '天元突破グレンラガン', 'トップをねらえ', 'フリクリ'] },
    { name: 'カラー', short: 'カラー', color: '#9333ea', keywords: ['ヱヴァンゲリヲン新劇場版', 'シン・エヴァンゲリオン劇場版'] },
    { name: 'コミックス・ウェーブ・フィルム', short: 'CWF', color: '#0284c7', keywords: ['君の名は。', '天気の子', 'すずめの戸締まり', '秒速5センチメートル', '言の葉の庭'] },
    { name: 'ZEXCS', short: 'ZEXCS', color: '#64748b', keywords: ['舟を編む', '惡の華', 'D.C.', 'シスター・プリンセス'] },
    { name: 'アスリード', short: 'asread', color: '#b91c1c', keywords: ['未来日記', 'みなみけ', 'ありふれた職業で世界最強'] },
    { name: 'C2C', short: 'C2C', color: '#f59e0b', keywords: ['シャングリラ・フロンティア', '魔女の旅々', 'ひとりぼっちの○○生活'] },
    { name: 'TROYCA', short: 'TROYCA', color: '#06b6d4', keywords: ['アイドリッシュセブン', 'やがて君になる', 'Re:CREATORS'] },
    { name: 'Lay-duce', short: 'Lay-duce', color: '#14b8a6', keywords: ['マギ シンドバッドの冒険', 'トモちゃんは女の子'] },
    { name: 'オレンジ', short: 'オレンジ', color: '#f97316', keywords: ['宝石の国', 'BEASTARS', 'トライガン'] },
    { name: '手塚プロダクション', short: '手塚プロ', color: '#0f766e', keywords: ['ブラック・ジャック', '鉄腕アトム', 'カノジョも彼女'] },
    { name: 'スタジオKAI', short: 'KAI', color: '#0d9488', keywords: [] }
  ];

  /**
   * ロール違いや部分一致で誤判定しやすい作品の上書き辞書（ローカルフォールバック用）
   */
  const SPECIAL_OVERRIDES = [
    { pattern: /ガンゲイル・オンライン/i, studios: ['Studio 3Hz'] },
    { pattern: /XENOGLOSSIA/i, studios: ['サンライズ'] },
    { pattern: /シャイニーカラーズ/i, studios: ['ポリゴン・ピクチュアズ'] },
    { pattern: /U149/i, studios: ['CygamesPictures'] },
    { pattern: /ミリオンライブ/i, studios: ['白組'] },
    { pattern: /シンデレラガールズ(?!.*U149)/i, studios: ['A-1 Pictures'] },
    { pattern: /男子高校生の日常/i, studios: ['サンライズ'] },
    { pattern: /異能バトルは日常系のなかで/i, studios: ['TRIGGER'] },
    { pattern: /エヴァンゲリオン.*Air/i, studios: ['GAINAX', 'Production I.G'] },
    { pattern: /中堅冒険者の日常/i, studios: [] },
    { pattern: /七つの大罪.*(神々の逆鱗|憤怒の審判)/i, studios: ['スタジオディーン'] },
    { pattern: /ワンパンマン\s*(第2期|第3期|2|3)/i, studios: ['J.C.STAFF'] },
    { pattern: /マギ\s*シンドバッドの冒険/i, studios: ['Lay-duce'] },
    { pattern: /魔法使いの嫁\s*SEASON\s*2/i, studios: ['スタジオカフカ'] },
    { pattern: /青の祓魔師\s*(島根啓明|雪ノ果|終夜)/i, studios: ['スタジオヴォルン'] },
    { pattern: /進撃の巨人\s*The\s*Final/i, studios: ['MAPPA'] },
    { pattern: /ヴィンランド・サガ\s*SEASON\s*2/i, studios: ['MAPPA'] },
    { pattern: /HUNTER\s*[×x]\s*HUNTER\s*\(?\s*2011/i, studios: ['マッドハウス'] },
    { pattern: /^HUNTER\s*[×x]\s*HUNTER$/i, studios: ['日本アニメーション'] },
    { pattern: /ゆるゆり\s*(さん☆ハイ|さん☆はい|なちゅやちゅみ)/i, studios: ['TYOアニメーションズ'] },
    { pattern: /先輩はおとこのこ/i, studios: ['project No.9'] },
    { pattern: /この素晴らしい世界に祝福を！\s*(3|３)/i, studios: ['ドライブ'] },
    { pattern: /紅伝説/i, studios: ['J.C.STAFF'] },
    { pattern: /Fate\/stay\s*night.*Unlimited Blade Works/i, studios: ['ufotable'] },
    { pattern: /Fate\/stay\s*night.*Heaven/i, studios: ['ufotable'] },
    { pattern: /^Fate\/stay\s*night$/i, studios: ['スタジオディーン'] },
    { pattern: /SPY\s*[×x]\s*FAMILY/i, studios: ['WIT STUDIO', 'CloverWorks'] },
    { pattern: /ダーリン・イン・ザ・フランキス/i, studios: ['TRIGGER', 'CloverWorks'] },
    { pattern: /薬屋のひとりごと/i, studios: ['OLM', 'TOHO animation STUDIO'] },
    { pattern: /からかい上手の高木さん/i, studios: ['シンエイ動画'] },
    { pattern: /ウマ娘.*Season\s*[23]/i, studios: ['Studio KAI'] },
    { pattern: /ウマ娘\s*プリティーダービー$/i, studios: ['P.A.WORKS'] },
    { pattern: /銀魂(?!.*ポロリ|.*銀ノ魂|.*THE FINAL|.*°|.*\.)/i, studios: ['サンライズ'] },
    { pattern: /銀魂\s*(°|\.|ポロリ|銀ノ魂|THE FINAL)/i, studios: ['BN Pictures'] },
    { pattern: /Kanon（新）|Kanon\s*\(2006\)/i, studios: ['京都アニメーション'] },
    { pattern: /^Kanon$/i, studios: ['東映アニメーション'] }
  ];

  // スタジオ表記揺れ・日英混在の正規化辞書
  const RAW_ALIASES = {
    'kyotoanimation': '京都アニメーション',
    '京都アニメーション': '京都アニメーション',
    'dogakobo': '動画工房',
    '動画工房': '動画工房',
    'shaft': 'シャフト',
    'シャフト': 'シャフト',
    'ufotable': 'ufotable',
    'mappa': 'MAPPA',
    'cloverworks': 'CloverWorks',
    'a1pictures': 'A-1 Pictures',
    'trigger': 'TRIGGER',
    'sunrise': 'サンライズ',
    'サンライズ': 'サンライズ',
    'bandainamcofilmworks': 'サンライズ',
    'バンダイナムコフィルムワークス': 'サンライズ',
    'bandainamcopictures': 'BN Pictures',
    'bnpictures': 'BN Pictures',
    'バンダイナムコピクチャーズ': 'BN Pictures',
    'paworks': 'P.A.WORKS',
    'witstudio': 'WIT STUDIO',
    'bones': 'ボンズ',
    'bonesfilm': 'ボンズ',
    'ボンズ': 'ボンズ',
    'ボンズフィルム': 'ボンズ',
    'madhouse': 'マッドハウス',
    'マッドハウス': 'マッドハウス',
    'jcstaff': 'J.C.STAFF',
    'silverlink': 'SILVER LINK.',
    'シルバーリンク': 'SILVER LINK.',
    'tmsentertainment': 'トムス・エンタテインメント',
    'トムスエンタテインメント': 'トムス・エンタテインメント',
    'tokyomovieshinsha': 'トムス・エンタテインメント',
    'tokyomovie': 'トムス・エンタテインメント',
    '東京ムービー新社': 'トムス・エンタテインメント',
    '東京ムービー': 'トムス・エンタテインメント',
    'キョクイチ東京ムービー': 'トムス・エンタテインメント',
    'studiodeen': 'スタジオディーン',
    'スタジオディーン': 'スタジオディーン',
    'productionig': 'Production I.G',
    'プロダクションアイジー': 'Production I.G',
    '8bit': 'エイトビット',
    'エイトビット': 'エイトビット',
    'toeianimation': '東映アニメーション',
    '東映アニメーション': '東映アニメーション',
    '東映動画': '東映アニメーション',
    'satelight': 'サテライト',
    'サテライト': 'サテライト',
    'lidenfilms': 'ライデンフィルム',
    'lidenfilmskyotostudio': 'ライデンフィルム',
    'ライデンフィルム': 'ライデンフィルム',
    'olm': 'OLM',
    'オーエルエム': 'OLM',
    'feel': 'feel.',
    'xebec': 'XEBEC',
    'ジーベック': 'XEBEC',
    'projectno9': 'project No.9',
    'studiogokumi': 'Studio五組',
    'studio五組': 'Studio五組',
    'diomedea': 'ディオメディア',
    'diomedéa': 'ディオメディア',
    'ディオメディア': 'ディオメディア',
    'whitefox': 'WHITE FOX',
    'lerche': 'Lerche',
    'ラルケ': 'Lerche',
    'kinemacitrus': 'キネマシトラス',
    'キネマシトラス': 'キネマシトラス',
    'studiopierrot': 'ぴえろ',
    'pierrot': 'ぴえろ',
    'pierrotfilms': 'ぴえろ',
    'studioぴえろ': 'ぴえろ',
    'スタジオぴえろ': 'ぴえろ',
    'ぴえろ': 'ぴえろ',
    'shineianimation': 'シンエイ動画',
    'シンエイ動画': 'シンエイ動画',
    'emtsquared': 'EMTスクエアード',
    'emtスクエアード': 'EMTスクエアード',
    'studioghibli': 'スタジオジブリ',
    'スタジオジブリ': 'スタジオジブリ',
    'brainsbase': 'ブレインズ・ベース',
    'ブレインズベース': 'ブレインズ・ベース',
    'actas': 'アクタス',
    'アクタス': 'アクタス',
    'passione': 'Passione',
    'パッショーネ': 'Passione',
    'zerog': 'ZERO-G',
    'ゼロジー': 'ZERO-G',
    'aic': 'AIC',
    'aicasta': 'AIC',
    'aicbuild': 'AIC',
    'aicplus': 'AIC',
    'aicspirits': 'AIC',
    'aicフロンティア': 'AIC',
    'gonzo': 'GONZO',
    'ゴンゾ': 'GONZO',
    'davidproduction': 'david production',
    'デイヴィッドプロダクション': 'david production',
    'nomad': 'ノーマッド',
    'ノーマッド': 'ノーマッド',
    'synergysp': 'SynergySP',
    'シナジーsp': 'SynergySP',
    'studiokai': 'Studio KAI',
    'スタジオkai': 'Studio KAI',
    'halfilmmaker': 'Hal Film Maker',
    'ハルフィルムメーカー': 'Hal Film Maker',
    'tatsunokoproduction': 'タツノコプロ',
    'タツノコプロ': 'タツノコプロ',
    'sanzigen': 'サンジゲン',
    'サンジゲン': 'サンジゲン',
    'sciencesaru': 'Science SARU',
    'サイエンスsaru': 'Science SARU',
    'tezukaproductions': '手塚プロダクション',
    '手塚プロダクション': '手塚プロダクション',
    'felixfilm': 'Felix Film',
    'フェリックスフィルム': 'Felix Film',
    'biburyanimationstudios': 'バイブリーアニメーションスタジオ',
    'バイブリーアニメーションスタジオ': 'バイブリーアニメーションスタジオ',
    'engi': 'ENGI',
    'mahofilm': 'MAHO FILM',
    'asread': 'アスリード',
    'アスリード': 'アスリード',
    'productionims': 'プロダクションアイムズ',
    'プロダクションアイムズ': 'プロダクションアイムズ',
    'zexcs': 'ZEXCS',
    'ゼクシズ': 'ZEXCS',
    'gainax': 'GAINAX',
    'ガイナックス': 'GAINAX',
    'studiocomet': 'スタジオコメット',
    'スタジオコメット': 'スタジオコメット',
    'sevenarcs': 'セブン・アークス',
    'sevenarcspictures': 'セブン・アークス',
    'セブンアークス': 'セブン・アークス',
    'cygamespictures': 'CygamesPictures',
    'cypic': 'CygamesPictures',
    'axsiz': 'AXsiZ',
    'tnk': 'TNK',
    'nipponanimation': '日本アニメーション',
    '日本アニメーション': '日本アニメーション',
    'c2c': 'C2C',
    'troyca': 'TROYCA',
    'ajiado': '亜細亜堂',
    '亜細亜堂': '亜細亜堂',
    'okurutonoboru': 'オクルトノボル',
    'オクルトノボル': 'オクルトノボル',
    'geektoys': 'GEEKTOYS',
    'connect': 'CONNECT',
    'studioacat': 'studio A-CAT',
    'studiohoukiboshi': 'studio HōKIBOSHI',
    'studiohōkiboshi': 'studio HōKIBOSHI',
    'studiohokiboshi': 'studio HōKIBOSHI',
    'studiohibari': 'スタジオ雲雀',
    'スタジオ雲雀': 'スタジオ雲雀',
    'beetrain': 'Bee Train',
    'polygonpictures': 'ポリゴン・ピクチュアズ',
    'ポリゴンピクチュアズ': 'ポリゴン・ピクチュアズ',
    'asahiproduction': '旭プロダクション',
    '旭プロダクション': '旭プロダクション',
    'pinejam': 'PINE JAM',
    'studiobind': 'スタジオバインド',
    'スタジオバインド': 'スタジオバインド',
    'ashiproductions': '葦プロダクション',
    '葦プロダクション': '葦プロダクション',
    'tyoanimations': 'TYOアニメーションズ',
    'tyoアニメーションズ': 'TYOアニメーションズ',
    'yumetacompany': 'ゆめ太カンパニー',
    'ゆめ太カンパニー': 'ゆめ太カンパニー',
    'comixwave': 'コミックス・ウェーブ・フィルム',
    'comixwavefilms': 'コミックス・ウェーブ・フィルム',
    'コミックスウェーブフィルム': 'コミックス・ウェーブ・フィルム',
    'nexus': 'Nexus',
    'nut': 'NUT',
    'signalmd': 'Signal.MD',
    'gekkou': '月虹',
    '月虹': '月虹',
    'artland': 'アートランド',
    'アートランド': 'アートランド',
    'daume': '童夢',
    '童夢': '童夢',
    'encouragefilms': 'エンカレッジフィルムズ',
    'エンカレッジフィルムズ': 'エンカレッジフィルムズ',
    'studiocolorido': 'スタジオコロリド',
    'スタジオコロリド': 'スタジオコロリド',
    'typhoongraphics': '颱風グラフィックス',
    '颱風グラフィックス': '颱風グラフィックス',
    'layduce': 'Lay-duce',
    'レイデュース': 'Lay-duce',
    'studiomother': 'studio MOTHER',
    'blade': 'BLADE',
    'quad': 'Quad',
    'arms': 'ARMS',
    'アームス': 'ARMS',
    'manglobe': 'マングローブ',
    'マングローブ': 'マングローブ',
    'acgt': 'A.C.G.T.',
    'gohands': 'GoHands',
    'seven': 'アニメーションスタジオ・セブン',
    'アニメーションスタジオセブン': 'アニメーションスタジオ・セブン',
    'studiokhara': 'カラー',
    'カラー': 'カラー',
    'studiochizu': 'スタジオ地図',
    'スタジオ地図': 'スタジオ地図',
    'yostarpictures': 'Yostar Pictures',
    'kamikazedouga': '神風動画',
    '神風動画': '神風動画',
    'studio4c': 'Studio 4°C',
    'studio4°c': 'Studio 4°C',
    'orange': 'オレンジ',
    'オレンジ': 'オレンジ',
    'shirogumi': '白組',
    '白組': '白組',
    'graphinica': 'グラフィニカ',
    'グラフィニカ': 'グラフィニカ',
    'yokohamaanimationlab': '横浜アニメーションラボ',
    '横浜アニメーションラボ': '横浜アニメーションラボ',
    'studiovoln': 'スタジオヴォルン',
    'voln': 'スタジオヴォルン',
    'スタジオヴォルン': 'スタジオヴォルン',
    'grouptac': 'グループ・タック',
    'グループタック': 'グループ・タック',
    'spacenekocompany': 'スペースネコカンパニー',
    'スペースネコカンパニー': 'スペースネコカンパニー',
    'studiogallop': 'ぎゃろっぷ',
    'スタジオぎゃろっぷ': 'ぎゃろっぷ',
    'ぎゃろっぷ': 'ぎゃろっぷ',
    'studiofantasia': 'スタジオ・ファンタジア',
    'studiomatrix': 'スタジオマトリックス',
    'スタジオマトリックス': 'スタジオマトリックス',
    'studiorikka': 'スタジオ六花',
    'スタジオ六花': 'スタジオ六花',
    'studioblanc': 'スタジオブラン',
    'スタジオブラン': 'スタジオブラン',
    'millepensee': 'ミルパンセ',
    'ミルパンセ': 'ミルパンセ',
    'drive': 'ドライブ',
    'ドライブ': 'ドライブ',
    'eastfishstudio': 'イーストフィッシュスタジオ',
    'イーストフィッシュスタジオ': 'イーストフィッシュスタジオ',
    'shuka': '朱夏',
    '朱夏': '朱夏',
    'radix': 'RADIX',
    'marvyjack': 'マーヴィージャック',
    'マーヴィージャック': 'マーヴィージャック',
    'magicbus': 'マジックバス',
    'doraku': '動楽',
    '動楽': '動楽',
    'hayabusafilm': 'ハヤブサフィルム',
    'ハヤブサフィルム': 'ハヤブサフィルム',
    'creatorsinpack': 'Creators in Pack',
    'creatorsinpackinc': 'Creators in Pack',
    'lapintrack': 'ラパントラック',
    'ラパントラック': 'ラパントラック',
    'studiochromato': 'スタジオクロマト',
    'スタジオクロマト': 'スタジオクロマト',
    'saberworks': 'セイバーワークス',
    'セイバーワークス': 'セイバーワークス',
    'smde': 'SMDE',
    '小学館ミュージックデジタルエンタテイメント': 'SMDE',
    'ehproduction': 'E&H production',
    'bugfilms': 'BUG FILMS',
    'cstation': 'C-Station',
    'pra': 'PRA',
    'ピーアールエー': 'PRA',
    'appp': 'A.P.P.P.',
    'ordet': 'Ordet',
    'studiokafka': 'スタジオカフカ',
    'スタジオカフカ': 'スタジオカフカ',
    'studio3hz': 'Studio 3Hz',
    'tohoanimationstudio': 'TOHO animation STUDIO',
    'hoodsentertainment': 'Hoods Entertainment',
    '100studio': '100studio',
    'fanworks': 'ファンワークス',
    'ファンワークス': 'ファンワークス',
    'dle': 'DLE',
    'dmmfutureworks': 'DMM.futureworks',
    'atelierpontdarc': 'Atelier Pontdarc',
    'arvoanimation': 'ARVO ANIMATION',
    'bakkenrecord': 'BAKKEN RECORD',
    'stapleentertainment': 'Staple Entertainment',
    'studiosignpost': 'スタジオサインポスト',
    'スタジオサインポスト': 'スタジオサインポスト',
    'yaoyorozu': 'ヤオヨロズ',
    'ヤオヨロズ': 'ヤオヨロズ',
    'irodori': 'irodori',
    'studioflad': 'スタジオフラッド',
    'スタジオフラッド': 'スタジオフラッド',
    'geek': 'GEEKTOYS',
    'lesprit': 'レスプリ',
    'レスプリ': 'レスプリ'
  };

  // アニメ制作スタジオではない企業・テレビ局・製作委員会・個人名等のブロックリスト
  const NON_STUDIO_KEYS = new Set([
    'nhk', 'nhkエンタープライズ', 'フジテレビ', 'フジテレビジョン', 'テレビ朝日', 'テレビ東京', 'tbs', '日本テレビ',
    'mbs', 'abcアニメーション', '読売テレビ', 'bs11', 'tokyo mx', 'tokyomx', 'atx', 'wowow',
    'アニプレックス', 'aniplex', 'kadokawa', '角川書店', '東宝', 'toho', '東宝アニメーション',
    'バンダイビジュアル', 'バンダイナムコアーツ', 'ランティス', 'ムービック', 'ポニーキャニオン',
    'キングレコード', 'フライングドッグ', 'エイベックス', 'avex pictures', 'アスミックエース',
    'ホリプロ', 'とらのあな', 'コミックとらのあな', 'asatsudk', 'adk', '電通', '博報堂',
    'nas', 'denaコンテンツ企画部', 'clamp', '福島祐一', 'まさたかp', 'たけはらみのる',
    'ドリームクリエイション', 'ジェネオン', 'マーベラス', 'グッドスマイルカンパニー'
  ]);

  const PALETTE = [
    '#38bdf8', '#f43f5e', '#a855f7', '#e11d48', '#ec4899', '#10b981', '#3b82f6',
    '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6', '#f97316', '#14b8a6', '#eab308',
    '#22c55e', '#6366f1', '#0ea5e9', '#be185d'
  ];

  const STUDIO_BY_NAME = Object.create(null);
  for (let i = 0; i < STUDIOS.length; i++) {
    if (STUDIOS[i].name && !STUDIO_BY_NAME[STUDIOS[i].name]) {
      STUDIO_BY_NAME[STUDIOS[i].name] = STUDIOS[i];
    }
  }

  function makeAliasKey(raw) {
    return String(raw || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/(?:株式会社|有限会社|\(株\)|\(有\)|inc\.?|co\.?,?\s*ltd\.?)/gi, '')
      .replace(/[\s\-_・･.。,:：\/／\\&＆!！+＋'"’”\(\)（）\[\]<>〈〉]+/g, '')
      .trim();
  }

  function cleanStudioRaw(raw) {
    if (!raw || typeof raw !== 'string') return '';
    let s = raw.normalize('NFKC').trim();
    // "SHAFT (シャフト)" / "OLM (オー・エル・エム) (OLM)" のような補足括弧を整形
    s = s.replace(/^(?:株式会社|有限会社)\s*/, '').replace(/\s*(?:株式会社|有限会社)$/, '');
    s = s.replace(/\s*\([^)]*\)\s*$/g, '').trim();
    // 2重括弧が残った場合にも対応
    s = s.replace(/\s*\([^)]*\)\s*$/g, '').trim();
    return s;
  }

  function normalizeStudioName(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const rawTrimmed = raw.normalize('NFKC').trim();
    if (!rawTrimmed) return null;

    // 括弧除去前後の両方でエイリアス・ブロックリスト照合
    const cleaned = cleanStudioRaw(rawTrimmed);
    const kClean = makeAliasKey(cleaned);
    const kRaw = makeAliasKey(rawTrimmed);

    if (!kClean || NON_STUDIO_KEYS.has(kClean) || NON_STUDIO_KEYS.has(kRaw)) {
      return null;
    }

    if (RAW_ALIASES[kClean]) return RAW_ALIASES[kClean];
    if (RAW_ALIASES[kRaw]) return RAW_ALIASES[kRaw];

    // 小文字化キーなしでも括弧外しで一致するならそちらを優先
    return cleaned || rawTrimmed;
  }

  function isKnownStudioName(raw) {
    if (!raw || typeof raw !== 'string') return false;
    const cleaned = cleanStudioRaw(raw);
    const kClean = makeAliasKey(cleaned);
    const kRaw = makeAliasKey(raw);
    return Boolean(RAW_ALIASES[kClean] || RAW_ALIASES[kRaw] || STUDIO_BY_NAME[cleaned]);
  }

  function hashColor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return PALETTE[Math.abs(h) % PALETTE.length];
  }

  function getStudioMeta(name) {
    const canonical = normalizeStudioName(name) || String(name || '').trim();
    if (!canonical) return null;
    if (STUDIO_BY_NAME[canonical]) {
      return STUDIO_BY_NAME[canonical];
    }
    return {
      name: canonical,
      short: canonical.length > 14 ? canonical.slice(0, 12) + '…' : canonical,
      color: hashColor(canonical),
      keywords: []
    };
  }

  function identifyStudios(animeTitle) {
    if (!animeTitle) return [];
    const lowerTitle = String(animeTitle).toLowerCase();

    for (let i = 0; i < SPECIAL_OVERRIDES.length; i++) {
      const ov = SPECIAL_OVERRIDES[i];
      if (ov.pattern.test(animeTitle)) {
        return ov.studios || [];
      }
    }

    if (/^(日常|日常\s|日常の0話|日常（)/.test(animeTitle.trim())) {
      return ['京都アニメーション'];
    }

    if (/(^|\s|劇場版\s*)AIR($|\s|IN\s*SUMMER)/i.test(animeTitle.trim()) && !/エヴァンゲリオン/i.test(animeTitle)) {
      return ['京都アニメーション'];
    }

    const hits = [];
    for (let i = 0; i < STUDIOS.length; i++) {
      const studio = STUDIOS[i];
      for (let j = 0; j < studio.keywords.length; j++) {
        const kw = studio.keywords[j];
        if (!kw || kw === '日常' || kw === 'AIR') continue;
        if (kw === 'BNA') {
          if (/\bBNA\b/i.test(animeTitle)) { hits.push(studio.name); break; }
          continue;
        }
        if (kw === 'マギ') {
          if (/(^|\s)マギ(\s|The|the|第|$)/.test(animeTitle)) {
            hits.push(studio.name);
            break;
          }
          continue;
        }
        if (lowerTitle.includes(kw.toLowerCase())) {
          hits.push(studio.name);
          break;
        }
      }
    }
    return hits;
  }

  function identifyStudio(animeTitle) {
    const list = identifyStudios(animeTitle);
    return list.length > 0 ? getStudioMeta(list[0]) : null;
  }

  const _normStudioIndexCache = new WeakMap();

  function getNormStudioIndex(genreMap) {
    if (!genreMap || typeof genreMap !== 'object') return null;
    const keyCount = Object.keys(genreMap).length;
    const cached = _normStudioIndexCache.get(genreMap);
    if (cached && cached.keyCount === keyCount) {
      return cached.map;
    }

    const map = new Map();
    if (GenreEngine && typeof GenreEngine.normalizeTitleLookupKey === 'function') {
      for (const [title, entry] of Object.entries(genreMap)) {
        const raw = entry?.s ?? entry?.studios;
        const rawStudios = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw ? [raw] : []);
        if (rawStudios.length > 0) {
          const nk = GenreEngine.normalizeTitleLookupKey(title);
          if (nk && !map.has(nk)) {
            map.set(nk, rawStudios);
          }
        }
      }
    }
    _normStudioIndexCache.set(genreMap, { keyCount, map });
    return map;
  }

  /**
   * 作品に対して制作スタジオ名配列を解決する（キャッシュ実データ > 特別上書き/続編変更チェック > 親シリーズ補完 > ローカル辞書）
   */
  function resolveStudiosForAnime(animeOrTitle, genreMap = {}) {
    const title = typeof animeOrTitle === 'string' ? animeOrTitle : (animeOrTitle?.title || '');
    if (!title) return [];

    // 1. 直接キャッシュ hit (AniList / Annict 実データ)
    const entry = genreMap && genreMap[title];
    const directVal = entry ? (entry.s ?? entry.studios) : null;
    const directRaw = Array.isArray(directVal) ? directVal : (typeof directVal === 'string' && directVal ? [directVal] : []);
    if (directRaw.length > 0) {
      const normalized = [];
      for (let i = 0; i < directRaw.length; i++) {
        const n = normalizeStudioName(directRaw[i]);
        if (n && !normalized.includes(n)) normalized.push(n);
      }
      if (normalized.length > 0) return normalized;
    }

    // 2. 続編変更・同名リメイク・誤爆防止用の明示上書き辞書チェック
    for (let i = 0; i < SPECIAL_OVERRIDES.length; i++) {
      if (SPECIAL_OVERRIDES[i].pattern.test(title)) {
        return SPECIAL_OVERRIDES[i].studios || [];
      }
    }

    // 3. シリーズ親タイトルからの安全継承（OVA・特別編・総集編等）
    if (genreMap && GenreEngine && typeof GenreEngine.getTitleMatchCandidates === 'function') {
      const normIndex = getNormStudioIndex(genreMap);
      if (normIndex && normIndex.size > 0) {
        const candidates = GenreEngine.getTitleMatchCandidates(title);
        for (let i = 0; i < candidates.length; i++) {
          const hit = normIndex.get(candidates[i]);
          if (hit && hit.length > 0) {
            const normalized = [];
            for (let j = 0; j < hit.length; j++) {
              const n = normalizeStudioName(hit[j]);
              if (n && !normalized.includes(n)) normalized.push(n);
            }
            if (normalized.length > 0) return normalized;
          }
        }
      }
    }

    // 4. ローカルキーワード辞書フォールバック
    return identifyStudios(title);
  }

  return {
    STUDIOS,
    SPECIAL_OVERRIDES,
    normalizeStudioName,
    isKnownStudioName,
    getStudioMeta,
    identifyStudio,
    identifyStudios,
    resolveStudiosForAnime
  };
}));
