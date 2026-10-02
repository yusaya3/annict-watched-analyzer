'use strict';

/**
 * 主要アニメ制作スタジオと代表作・判定キーワード辞書
 */
const STUDIOS = [
  {
    name: '京都アニメーション',
    short: '京アニ',
    color: '#38bdf8',
    keywords: [
      'けいおん', '涼宮ハルヒ', 'ヴァイオレット・エヴァーガーデン', '氷菓', '響け！ユーフォニアム',
      'CLANNAD', 'クラナド', 'Free!', '中二病でも恋がしたい', 'ツルネ', '日常', 'らき☆すた',
      '小林さんちのメイドラゴン', 'たまこまーけっと', '聲の形', '境界の彼方', '甘城ブリリアントパーク',
      'AIR', 'Kanon', 'フルメタル・パニック? ふもっふ', 'リズと青い鳥'
    ]
  },
  {
    name: '動画工房',
    short: '動画工房',
    color: '#f43f5e',
    keywords: [
      'ゆるゆり', '月刊少女野崎くん', 'NEW GAME!', '私に天使が舞い降りた', 'ダンベル何キロ持てる',
      'おちこぼれフルーツタルト', '【推しの子】', '推しの子', '先輩はおとこのこ', 'ガヴリールドロップアウト',
      '恋する小惑星', 'プラスティック・メモリーズ', '干物妹！うまるちゃん', 'うまるちゃん',
      '多田くんは恋をしない', '魔王城でおやすみ', '可愛いだけじゃない式守さん', '夜のクラゲは泳げない'
    ]
  },
  {
    name: 'シャフト',
    short: 'シャフト',
    color: '#a855f7',
    keywords: [
      'まどか☆マギカ', 'マドカ', '化物語', '偽物語', '猫物語', '傾物語', '囮物語', '鬼物語',
      '恋物語', '花物語', '憑物語', '終物語', '傷物語', '物語シリーズ', 'さよなら絶望先生',
      '荒川アンダー ザ ブリッジ', 'ニセコイ', '3月のライオン', 'ひだまりスケッチ', '電波女と青春男',
      '美少年探偵団', 'マギアレコード'
    ]
  },
  {
    name: 'ufotable',
    short: 'ufotable',
    color: '#e11d48',
    keywords: [
      '鬼滅の刃', 'Fate/Zero', 'Fate/stay night [Unlimited Blade Works]', 'Fate/stay night [Heaven\'s Feel]',
      '空の境界', '活撃 刀剣乱舞', 'テイルズ オブ ゼスティリア', 'GOD EATER'
    ]
  },
  {
    name: 'MAPPA',
    short: 'MAPPA',
    color: '#ec4899',
    keywords: [
      '呪術廻戦', '進撃の巨人 The Final', 'チェンソーマン', '地獄楽', 'ゾンビランドサガ',
      'ユーリ!!! on ICE', 'BANANA FISH', 'ドロヘドロ', 'takt op.Destiny', 'この世界の片隅に',
      'ヴィンランド・サガ SEASON 2', 'ダンス・ダンス・ダンスール', 'とんでもスキルで異世界放浪メシ',
      '忘却バッテリー'
    ]
  },
  {
    name: 'CloverWorks',
    short: 'CloverWorks',
    color: '#10b981',
    keywords: [
      'ぼっち・ざ・ろっく', 'その着せ替え人形は恋をする', 'SPY×FAMILY', '約束のネバーランド',
      '青春ブタ野郎', 'ホリミヤ', '明日ちゃんのセーラー服', 'Fate/Grand Order -絶対魔獣戦線バビロニア-',
      'シャドーハウス', 'WIND BREAKER', '逃げ上手の若君'
    ]
  },
  {
    name: 'A-1 Pictures',
    short: 'A-1 Pictures',
    color: '#3b82f6',
    keywords: [
      'ソードアート・オンライン', 'かぐや様は告らせたい', 'リコリス・リコイル', '86―エイティシックス―',
      '四月は君の嘘', 'あの日見た花の名前を僕達はまだ知らない', '青の祓魔師', '冴えない彼女の育てかた',
      'マッシュル', 'アイドルマスター', '僕だけがいない街', '七つの大罪', 'マギ', 'WORKING!!'
    ]
  },
  {
    name: 'TRIGGER',
    short: 'TRIGGER',
    color: '#f59e0b',
    keywords: [
      'キルラキル', 'リトルウィッチアカデミア', 'SSSS.GRIDMAN', 'SSSS.DYNAZENON', 'グリッドマン',
      'サイバーパンク エッジランナーズ', 'ダンジョン飯', 'プロメア', 'ダーリン・イン・ザ・フランキス',
      'BNA', 'キズナイーバー', '宇宙パトロールルル子'
    ]
  },
  {
    name: 'サンライズ',
    short: 'サンライズ',
    color: '#ef4444',
    keywords: [
      'ガンダム', '機動戦士', '水星の魔女', 'コードギアス', 'ラブライブ', '銀魂', 'カウボーイビバップ',
      'タイガー＆バニー', 'TIGER & BUNNY', 'ケロロ軍曹', 'シティハンター', '舞-HiME', '境界線上のホライゾン',
      'アクセル・ワールド'
    ]
  },
  {
    name: 'P.A.WORKS',
    short: 'P.A.WORKS',
    color: '#06b6d4',
    keywords: [
      'SHIROBAKO', '花咲くいろは', 'Angel Beats!', 'Charlotte', '色づく世界の明日から',
      'パリピ孔明', 'スキップとローファー', 'true tears', 'TARI TARI', '凪のあすから',
      '有頂天家族', 'サクラクエスト', '神様になった日', 'Buddy Daddies'
    ]
  },
  {
    name: 'WIT STUDIO',
    short: 'WIT STUDIO',
    color: '#8b5cf6',
    keywords: [
      '進撃の巨人', '甲鉄城のカバネリ', '王様ランキング', 'ヴィンランド・サガ',
      'Vivy -Fluorite Eye\'s Song-', '恋は雨上がりのように', '魔法使いの嫁', 'GREAT PRETENDER',
      'しかのこのこのここしたんたん'
    ]
  },
  {
    name: 'ボンズ',
    short: 'ボンズ',
    color: '#f97316',
    keywords: [
      '僕のヒーローアカデミア', 'ヒロアカ', '鋼の錬金術師', '文豪ストレイドッグス', 'モブサイコ100',
      'ソウルイーター', '血界戦線', '交響詩篇エウレカセブン', 'DARKER THAN BLACK', 'スペース☆ダンディ',
      'SK∞ エスケーエイト'
    ]
  },
  {
    name: 'マッドハウス',
    short: 'マッドハウス',
    color: '#14b8a6',
    keywords: [
      '葬送のフリーレン', 'ワンパンマン', 'オーバーロード', 'DEATH NOTE', 'デスノート',
      'カードキャプターさくら', 'ちはやふる', 'サマーウォーズ', 'HUNTER×HUNTER', '宇宙よりも遠い場所',
      'BLACK LAGOON', '四畳半神話大系', 'サニーボーイ'
    ]
  },
  {
    name: 'J.C.STAFF',
    short: 'J.C.STAFF',
    color: '#eab308',
    keywords: [
      'とある魔術の禁書目録', 'とある科学の超電磁砲', 'ダンまち', 'ダンジョンに出会いを求めるのは間違っているだろうか',
      '食戟のソーマ', 'とらドラ!', 'ゼロの使い魔', '灼眼のシャナ', 'さくら荘のペットな彼女',
      'ハチミツとクローバー', 'まちカドまぞく'
    ]
  }
];

const SPECIAL_OVERRIDES = [
  // SAOオルタナティブ ガンゲイル・オンライン は Studio 3Hz 制作
  { pattern: /ガンゲイル・オンライン/i, studioName: null },
  // アイドルマスター XENOGLOSSIA は サンライズ 制作
  { pattern: /XENOGLOSSIA/i, studioName: 'サンライズ' },
  // シャイニーカラーズ は ポリゴン・ピクチュアズ 制作
  { pattern: /シャイニーカラーズ/i, studioName: null },
  // シンデレラガールズ U149 は CygamesPictures 制作
  { pattern: /U149/i, studioName: null },
  // ミリオンライブ は 白組 制作
  { pattern: /ミリオンライブ/i, studioName: null },
  // 男子高校生の日常 は サンライズ 制作
  { pattern: /男子高校生の日常/i, studioName: 'サンライズ' },
  // 異能バトルは日常系のなかで は TRIGGER 制作
  { pattern: /異能バトルは日常系のなかで/i, studioName: 'TRIGGER' },
  // エヴァンゲリオン Air は GAINAX/Production I.G 制作（京アニAIRの誤爆防止）
  { pattern: /エヴァンゲリオン.*Air/i, studioName: null },
  // 29歳独身中堅冒険者の日常 などの一般日常タイトル（京アニ誤爆防止）
  { pattern: /中堅冒険者の日常/i, studioName: null },
  // 七つの大罪 神々の逆鱗・憤怒の審判 は スタジオディーン 制作
  { pattern: /七つの大罪.*(神々の逆鱗|憤怒の審判)/i, studioName: null },
];

function identifyStudio(animeTitle) {
  if (!animeTitle) return null;
  const lowerTitle = animeTitle.toLowerCase();

  // 1. 特殊オーバーライド（スピンオフや誤爆しやすいタイトルの優先解決）
  for (const ov of SPECIAL_OVERRIDES) {
    if (ov.pattern.test(animeTitle)) {
      if (!ov.studioName) return null;
      return STUDIOS.find(s => s.name === ov.studioName) || null;
    }
  }

  // 2. 京アニの『日常』特別判定（あらゐけいいち原作の「日常」のみマッチ）
  if (/^(日常|日常\s|日常の0話|日常（)/.test(animeTitle.trim())) {
    return STUDIOS.find(s => s.name === '京都アニメーション');
  }

  // 3. 京アニの『AIR』特別判定（エヴァンゲリオン Air などを除外）
  if (/(^|\s|劇場版\s*)AIR($|\s|IN\s*SUMMER)/i.test(animeTitle.trim()) && !/エヴァンゲリオン/i.test(animeTitle)) {
    return STUDIOS.find(s => s.name === '京都アニメーション');
  }

  // 4. 通常スタジオループ
  for (const studio of STUDIOS) {
    for (const kw of studio.keywords) {
      if (kw === '日常' || kw === 'AIR') continue; // 特別判定で処理済み
      if (kw === 'マギ') {
        if (/(^|\s)マギ(\s|The|the|第|$)/.test(animeTitle)) {
          return studio;
        }
        continue;
      }
      if (lowerTitle.includes(kw.toLowerCase())) {
        return studio;
      }
    }
  }
  return null;
}

module.exports = {
  STUDIOS,
  identifyStudio
};
