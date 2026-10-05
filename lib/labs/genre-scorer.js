'use strict';

const { GENRE_DEFINITIONS } = require('./genre-client.js');

/**
 * 重み付けスコアリング方式（多重加点・タグランク活用）による高精度アニメジャンル分類エンジン
 * 各カテゴリの総合スコアを算出し、最高得点のカテゴリを判定します。
 * 
 * @param {string[]} genres - AniListジャンル配列
 * @param {{name: string, rank: number}[]} tags - AniListタグ配列
 * @param {string} title - アニメタイトル
 * @returns {{ category: string, score: number, scores: Object.<string, number>, reasons: Object.<string, string[]>, topReasons: string[] }}
 */
function scoreAnimeDetailed(genres = [], tags = [], title = '') {
  const g = new Set(genres || []);
  const tagMap = new Map();
  (tags || []).forEach(t => {
    if (t && t.name) {
      tagMap.set(t.name, t.rank || 0);
    }
  });

  const getTag = (name) => tagMap.get(name) || 0;
  const hasTag = (name, minRank = 40) => (tagMap.get(name) || 0) >= minRank;
  const t = title || '';

  // スコアと加点理由
  const scores = {};
  const reasons = {};
  GENRE_DEFINITIONS.forEach(def => {
    scores[def.id] = 0;
    reasons[def.id] = [];
  });

  const addScore = (catId, pts, reason) => {
    if (scores[catId] !== undefined && pts > 0) {
      scores[catId] += pts;
      reasons[catId].push(`${reason} (+${Math.round(pts)})`);
    }
  };

  // ----------------------------------------------------
  // 1. 異世界 / 転生 (isekai)
  // ----------------------------------------------------
  const hasIsekaiTag = tagMap.has('Isekai') || tagMap.has('Reverse Isekai');
  const hasIsekaiTitle = /(?:異世界|転生|転移|悪役令嬢|追放され|魔王様|勇者(?:パーティー)?|スライム.*件|チート|治癒魔法|無職転生|陰の実力者|オーバーロード|この素晴らしい世界に祝福を|このすば|Re:ゼロ|盾の勇者|本好きの下剋上|賢者の弟子|ベヒーモス|聖女なのに|Sランクになってた|シンデレラ・シェフ|第七王子|ダンジョン飯|貴族転生)/i.test(t);
  
  if (hasIsekaiTag || hasIsekaiTitle) {
    if (tagMap.has('Isekai')) addScore('isekai', getTag('Isekai') * 2.0, `タグ: Isekai(${getTag('Isekai')})`);
    if (tagMap.has('Reverse Isekai')) addScore('isekai', getTag('Reverse Isekai') * 1.8, `タグ: Reverse Isekai`);
    if (tagMap.has('Villainess')) addScore('isekai', getTag('Villainess') * 1.6, `タグ: Villainess(悪役令嬢)`);
    if (tagMap.has('Reincarnation')) addScore('isekai', getTag('Reincarnation') * 1.5, `タグ: Reincarnation(転生)`);
    if (hasIsekaiTitle) addScore('isekai', 160, `異世界・転生代表タイトル`);
    // 異世界作品の場合、FantasyやMagicが付随するためボーナス
    if (g.has('Fantasy')) addScore('isekai', 50, `ファンタジー異世界`);
  }
  if (/ダンジョンに出会いを|ダンまち/i.test(t)) {
    scores.isekai = 0; // 生粋のダンジョン探索ファンタジーは除外
  }

  // ----------------------------------------------------
  // 2. 魔法少女 / バトルヒロイン (mahou_shoujo)
  // ----------------------------------------------------
  if (g.has('Mahou Shoujo')) addScore('mahou_shoujo', 200, `公式ジャンル: Mahou Shoujo`);
  if (tagMap.has('Magical Girl')) addScore('mahou_shoujo', getTag('Magical Girl') * 2.0, `タグ: Magical Girl`);
  if (tagMap.has('Majokko')) addScore('mahou_shoujo', getTag('Majokko') * 1.8, `タグ: Majokko`);
  // 変身ヒロイン: 女性主人公 or 女性メインキャストがあり、少年バトル・ゴア・ロボットでない場合のみ加点
  const isFemaleLead = tagMap.has('Female Protagonist') || tagMap.has('Primarily Female Cast');
  if (tagMap.has('Henshin') && isFemaleLead && !tagMap.has('Shounen') && !tagMap.has('Gore') && !g.has('Mecha')) {
    addScore('mahou_shoujo', getTag('Henshin') * 1.0, `タグ: Henshin(ヒロイン変身)`);
  }
  if (/(?:プリキュア|まどか|なのは|シンフォギア|プリズマ|魔法少女|セーラームーン|結城友奈|ストライクウィッチーズ|グランベルム|幻影ヲ駆ケル太陽|キューティーハニー|りりかSOS|ファンファンファーマシィー|プリンセッション)/i.test(t)) {
    addScore('mahou_shoujo', 180, `代表魔法少女タイトル`);
  }

  // ----------------------------------------------------
  // 3. ロボット / メカ (mecha)
  // ----------------------------------------------------
  if (g.has('Mecha')) addScore('mecha', 160, `公式ジャンル: Mecha`);
  if (tagMap.has('Real Robot')) addScore('mecha', getTag('Real Robot') * 1.6, `タグ: Real Robot`);
  if (tagMap.has('Super Robot')) addScore('mecha', getTag('Super Robot') * 1.6, `タグ: Super Robot`);
  if (tagMap.has('Piloted Robot')) addScore('mecha', getTag('Piloted Robot') * 1.4, `タグ: Piloted Robot`);
  if (/(?:ガンダム|エヴァンゲリオン|ヱヴァンゲリヲン|マクロス|コードギアス|パトレイバー|ダイナゼノン|グリッドマン|アクエリオン|マジンガー|ゲッターロボ|フルメタル・パニック|ゾイド|ビーストウォーズ|トランスフォーマー)/i.test(t)) {
    addScore('mecha', 150, `代表メカタイトル`);
  }

  // ----------------------------------------------------
  // 4. スポーツ / 競技 (sports)
  // ----------------------------------------------------
  if (g.has('Sports')) addScore('sports', 180, `公式ジャンル: Sports`);
  if (tagMap.has('Athletics')) addScore('sports', getTag('Athletics') * 1.2, `タグ: Athletics`);
  const sportsTags = ['Baseball', 'Basketball', 'Football', 'Volleyball', 'Swimming', 'Tennis', 'Boxing', 'Cycling', 'Motor Sports', 'Ice Skating', 'Martial Arts Competition', 'Badminton'];
  sportsTags.forEach(st => {
    if (tagMap.has(st)) addScore('sports', getTag(st) * 1.4, `競技タグ: ${st}`);
  });
  if (/(?:メジャー|MAJOR|ハイキュー|黒子のバスケ|ブルーロック|ダイヤのA|スラムダンク|弱虫ペダル|Free!|キャプテン翼|テニスの王子様|MFゴースト|頭文字D|イニシャルD|3月のライオン|ちはやふる|ヒカルの碁|ウマ娘)/i.test(t)) {
    addScore('sports', 150, `代表スポーツタイトル`);
  }

  // ----------------------------------------------------
  // 5. アイドル / 音楽 (idol_music)
  // ----------------------------------------------------
  if (tagMap.has('Idol')) addScore('idol_music', getTag('Idol') * 1.8, `タグ: Idol(${getTag('Idol')})`);
  if (tagMap.has('Band')) addScore('idol_music', getTag('Band') * 1.6, `タグ: Band`);
  if (tagMap.has('Musical Theater')) addScore('idol_music', getTag('Musical Theater') * 1.2, `タグ: Musical Theater`);
  if (tagMap.has('Rock Music')) addScore('idol_music', getTag('Rock Music') * 1.2, `タグ: Rock Music`);
  if (g.has('Music')) {
    const isPureMusic = !g.has('Action') && !g.has('Fantasy');
    addScore('idol_music', isPureMusic ? 120 : 60, `公式ジャンル: Music`);
  }
  if (/(?:アイドルマスター|IDOLM＠STER|アイマス|Jupiter|シンデレラガールズ|ミリオンライブ|シャイニーカラーズ|SideM|ラブライブ|バンドリ|BanG Dream|ぼっち・ざ・ろっく|ガールズバンドクライ|ガルクラ|トゲナシトゲアリ|D4DJ|アイカツ|プリパラ|ゾンビランドサガ|ヒプノシスマイク|プロジェクトセカイ|プロセカ|初音ミク)/i.test(t)) {
    addScore('idol_music', 150, `代表音楽・アイドルタイトル`);
  }

  // ----------------------------------------------------
  // 6. コメディ / ギャグ (comedy)
  // ----------------------------------------------------
  if (tagMap.has('Slapstick')) addScore('comedy', getTag('Slapstick') * 1.2, `タグ: Slapstick`);
  if (tagMap.has('Surreal Comedy')) addScore('comedy', getTag('Surreal Comedy') * 1.2, `タグ: Surreal Comedy`);
  if (tagMap.has('Parody')) addScore('comedy', getTag('Parody') * 1.1, `タグ: Parody`);
  if (tagMap.has('Satire')) addScore('comedy', getTag('Satire') * 1.0, `タグ: Satire`);
  if (g.has('Comedy')) {
    const pure = !g.has('Romance') && !g.has('Slice of Life') && !g.has('Action');
    addScore('comedy', pure ? 70 : 35, `公式ジャンル: Comedy`);
  }
  if (/(?:銀魂|あそびあそばせ|男子高校生の日常|斉木楠雄|女子高生の無駄づかい|てーきゅう|ポプテピピック|ぐらんぶる|邪神ちゃん|ヒナまつり|これはゾンビですか|でじこ|しかのこのこのこ|さばげぶっ|日常|こちら葛飾区|こち亀|バカとテスト|おねがい！ポコタ)/i.test(t)) {
    addScore('comedy', 140, `代表コメディタイトル`);
  }

  // ----------------------------------------------------
  // 7. 日常 / ほのぼの (nichijou)
  // ----------------------------------------------------
  if (tagMap.has('Cute Girls Doing Cute Things')) addScore('nichijou', getTag('Cute Girls Doing Cute Things') * 1.2, `タグ: CGDCT`);
  if (tagMap.has('Cute Boys Doing Cute Things')) addScore('nichijou', getTag('Cute Boys Doing Cute Things') * 1.2, `タグ: CBDCT`);
  if (tagMap.has('Outdoor Activities')) addScore('nichijou', getTag('Outdoor Activities') * 1.1, `タグ: Outdoor`);
  if (tagMap.has('Camping')) addScore('nichijou', getTag('Camping') * 1.1, `タグ: Camping`);
  // 癒やし系タグ: ハイファンタジー（フリーレン等）は日常に吸い込まれないよう減衰
  if (tagMap.has('Iyashikei')) {
    const isEpic = (g.has('Fantasy') && g.has('Adventure')) || g.has('Action');
    addScore('nichijou', getTag('Iyashikei') * (isEpic ? 0.3 : 1.2), `タグ: Iyashikei`);
  }
  if (g.has('Slice of Life')) {
    const isPure = !g.has('Action') && !g.has('Romance');
    addScore('nichijou', isPure ? 80 : 40, `公式ジャンル: Slice of Life`);
  }
  if (/(?:ゆるキャン|へやキャン|のんのんびより|ごちうさ|ご注文はうさぎですか|きんいろモザイク|NEW GAME|みなみけ|らき☆すた|ヤマノススメ|スローループ|ゆるゆり|小林さんちのメイドラゴン|ブルーアーカイブ|ブルアカ|もめんたりー・リリィ|mono|ざつ旅|雨と君と|クジマ歌えば|日々は過ぎれど|三ツ星カラーズ|私に天使が舞い降りた|わたてん|スロウスタート|あんハピ|ブレンド・S|GA 芸術科|苺ましまろ|しろくまカフェ|WORKING|ふらいんぐうぃっち)/i.test(t)) {
    addScore('nichijou', 140, `代表日常系タイトル`);
  }

  // ----------------------------------------------------
  // 8. 恋愛 / ラブコメ / 青春ドラマ (romance_drama)
  // ----------------------------------------------------
  if (g.has('Romance')) addScore('romance_drama', 130, `公式ジャンル: Romance`);
  if (tagMap.has('Love Triangle')) addScore('romance_drama', getTag('Love Triangle') * 1.0, `タグ: Love Triangle`);
  if (tagMap.has('Coming of Age')) addScore('romance_drama', getTag('Coming of Age') * 0.9, `タグ: Coming of Age`);
  if (tagMap.has('Yuri') && !g.has('Music')) addScore('romance_drama', getTag('Yuri') * 0.8, `タグ: Yuri`);
  if (tagMap.has('Boys\' Love')) addScore('romance_drama', getTag('Boys\' Love') * 1.2, `タグ: BL`);
  if (tagMap.has('Female Harem')) addScore('romance_drama', getTag('Female Harem') * 0.9, `タグ: Female Harem`);
  if (g.has('Drama') && (tagMap.has('School') || tagMap.has('Work') || tagMap.has('Coming of Age')) && !g.has('Action')) {
    addScore('romance_drama', 80, `学園/お仕事/青春ドラマ`);
  }
  if (/(?:その着せ替え人形|着せ恋|僕の心のヤバイやつ|五等分の花嫁|かぐや様|とらドラ|やはり俺の青春|俺ガイル|ヴァイオレット・エヴァーガーデン|宇宙よりも遠い場所|よりもい|SHIROBAKO|四月は君の嘘|あの日見た花|CLANNAD|クラナド|響け！ユーフォニアム|カノジョも彼女|女神のカフェテラス|わたしが恋人になれるわけないじゃん|神のみぞ知るセカイ|政宗くんのリベンジ|花咲くいろは|サクラクエスト|白い砂のアクアトープ|聲の形|リズと青い鳥)/i.test(t)) {
    addScore('romance_drama', 140, `代表恋愛/ドラマタイトル`);
  }

  // ----------------------------------------------------
  // 9. 歴史 / 戦記 / ミリタリー (history_military)
  // ----------------------------------------------------
  if (tagMap.has('Historical')) addScore('history_military', getTag('Historical') * 1.2, `タグ: Historical`);
  if (tagMap.has('Ancient China')) addScore('history_military', getTag('Ancient China') * 1.4, `タグ: Ancient China`);
  if (tagMap.has('Samurai')) addScore('history_military', getTag('Samurai') * 1.1, `タグ: Samurai`);
  if (tagMap.has('Medieval')) addScore('history_military', getTag('Medieval') * 0.7, `タグ: Medieval`);
  if (tagMap.has('Tanks')) addScore('history_military', 160, `タグ: Tanks(戦車)`);
  if (tagMap.has('Aviation')) addScore('history_military', 90, `タグ: Aviation`);
  // 超能力・魔法・SFがメインの作品（進撃の巨人、Dr.STONE等）はミリタリースコアを強く減衰
  const hasSupernaturalOrSciFi = tagMap.has('Super Power') || tagMap.has('Magic') || g.has('Sci-Fi');
  if (tagMap.has('Military')) {
    const mult = hasSupernaturalOrSciFi ? 0.3 : 1.1;
    addScore('history_military', getTag('Military') * mult, `タグ: Military`);
  }
  if (tagMap.has('War')) {
    const mult = hasSupernaturalOrSciFi ? 0.3 : 1.0;
    addScore('history_military', getTag('War') * mult, `タグ: War`);
  }
  if (/(?:ガールズ＆パンツァー|ガールズ&パンツァー|ガルパン|アンツィオ|幼女戦記|GATE 自衛隊|アズールレーン|艦隊これくしょん|艦これ|ハイスクール・フリート|キングダム|ヴィンランド・サガ|平家物語|るろうに剣心|ゴールデンカムイ|銀魂|薄桜鬼|信長|ドリフターズ|アルスラーン戦記|銀河英雄伝説|火喰鳥)/i.test(t)) {
    addScore('history_military', 140, `代表歴史・ミリタリータイトル`);
  }

  // ----------------------------------------------------
  // 10. ホラー / サスペンス / 推理 (horror_suspense)
  // ----------------------------------------------------
  if (g.has('Horror')) addScore('horror_suspense', 130, `公式ジャンル: Horror`);
  if (g.has('Mystery')) addScore('horror_suspense', 120, `公式ジャンル: Mystery`);
  if (g.has('Thriller')) addScore('horror_suspense', 100, `公式ジャンル: Thriller`);
  if (g.has('Psychological')) addScore('horror_suspense', 80, `公式ジャンル: Psychological`);
  if (tagMap.has('Detective')) addScore('horror_suspense', getTag('Detective') * 1.3, `タグ: Detective`);
  if (tagMap.has('Crime')) addScore('horror_suspense', getTag('Crime') * 1.0, `タグ: Crime`);
  if (tagMap.has('Police')) addScore('horror_suspense', getTag('Police') * 0.9, `タグ: Police`);
  if (tagMap.has('Death Game')) addScore('horror_suspense', getTag('Death Game') * 1.2, `タグ: Death Game`);
  if (/(?:薬屋のひとりごと|GOSICK|ゴシック|ロード・エルメロイ|ひぐらし|Another|PSYCHO-PASS|サイコパス|約束のネバーランド|サマータイムレンダ|Death Note|デスノート|MONSTER|シャドーハウス|死亡遊戯で飯を食う|探偵様)/i.test(t)) {
    addScore('horror_suspense', 140, `代表推理・サスペンスタイトル`);
  }

  // ----------------------------------------------------
  // 11. エッチ / お色気 (ecchi)
  // ----------------------------------------------------
  if (g.has('Hentai')) addScore('ecchi', 300, `公式ジャンル: Hentai`);
  if (g.has('Ecchi')) {
    const hasExplicitNudity = tagMap.has('Nudity') || tagMap.has('Fanservice');
    addScore('ecchi', hasExplicitNudity ? 100 : 50, `公式ジャンル: Ecchi`);
  }
  if (tagMap.has('Nudity')) addScore('ecchi', getTag('Nudity') * 1.2, `タグ: Nudity`);
  if (tagMap.has('Fanservice')) addScore('ecchi', getTag('Fanservice') * 0.8, `タグ: Fanservice`);
  if (tagMap.has('Ecchi')) addScore('ecchi', getTag('Ecchi') * 1.1, `タグ: Ecchi`);
  if (/(?:変ゼミ|To LOVEる|ハイスクールD×D|ヨスガノソラ|監獄学園|魔装学園|新妹魔王|異種族レビュアーズ|回復術士|ド級編隊|ギルティホール)/i.test(t)) {
    addScore('ecchi', 150, `代表お色気タイトル`);
  }

  // ----------------------------------------------------
  // 12. アクション / バトル (action)
  // ----------------------------------------------------
  if (g.has('Action')) addScore('action', 90, `公式ジャンル: Action`);
  if (g.has('Adventure')) addScore('action', 30, `公式ジャンル: Adventure`);
  if (tagMap.has('Super Power')) addScore('action', getTag('Super Power') * 1.1, `タグ: Super Power`);
  if (tagMap.has('Swordplay')) addScore('action', getTag('Swordplay') * 1.0, `タグ: Swordplay`);
  if (tagMap.has('Martial Arts')) addScore('action', getTag('Martial Arts') * 1.0, `タグ: Martial Arts`);
  if (tagMap.has('Guns')) addScore('action', getTag('Guns') * 1.1, `タグ: Guns`);
  if (tagMap.has('Battle Royale')) addScore('action', getTag('Battle Royale') * 1.1, `タグ: Battle Royale`);
  if (tagMap.has('Superhero')) addScore('action', getTag('Superhero') * 1.1, `タグ: Superhero`);
  if (tagMap.has('Shounen') && g.has('Action')) addScore('action', getTag('Shounen') * 0.9, `タグ: Shounen`);
  if (tagMap.has('Kaiju')) addScore('action', getTag('Kaiju') * 0.9, `タグ: Kaiju`);
  if (tagMap.has('Revenge') && g.has('Action')) addScore('action', getTag('Revenge') * 0.9, `タグ: Revenge`);
  if (/(?:チェンソーマン|呪術廻戦|鬼滅の刃|進撃の巨人|リコリス・リコイル|僕のヒーローアカデミア|ヒロアカ|ワンパンマン|モブサイコ|BLEACH|NARUTO|ナルト|ONE PIECE|ワンピース|ドラゴンボール|HUNTER×HUNTER|ハンターハンター|ブラッククローバー|東京喰種|Fate\/stay night|Fate\/Zero|空の境界|キルラキル|アクセル・ワールド|ストライク・ザ・ブラッド|超電磁砲|レールガン|シャナ|デート・ア・ライブ)/i.test(t)) {
    addScore('action', 150, `代表アクションタイトル`);
  }

  // ----------------------------------------------------
  // 13. SF / ファンタジー (sf_fantasy)
  // ----------------------------------------------------
  if (g.has('Fantasy')) addScore('sf_fantasy', 75, `公式ジャンル: Fantasy`);
  if (g.has('Sci-Fi')) addScore('sf_fantasy', 90, `公式ジャンル: Sci-Fi`);
  if (tagMap.has('Magic')) addScore('sf_fantasy', getTag('Magic') * 0.9, `タグ: Magic`);
  if (tagMap.has('Elf')) addScore('sf_fantasy', getTag('Elf') * 1.1, `タグ: Elf`);
  if (tagMap.has('Dungeon')) addScore('sf_fantasy', getTag('Dungeon') * 1.2, `タグ: Dungeon`);
  if (tagMap.has('Dragons')) addScore('sf_fantasy', getTag('Dragons') * 1.0, `タグ: Dragons`);
  if (tagMap.has('Time Manipulation')) addScore('sf_fantasy', getTag('Time Manipulation') * 1.1, `タグ: Time Manipulation`);
  if (tagMap.has('Cyberpunk')) addScore('sf_fantasy', getTag('Cyberpunk') * 1.2, `タグ: Cyberpunk`);
  if (tagMap.has('Space')) addScore('sf_fantasy', getTag('Space') * 1.1, `タグ: Space`);
  if (tagMap.has('Artificial Intelligence')) addScore('sf_fantasy', getTag('Artificial Intelligence') * 1.1, `タグ: AI`);
  if (tagMap.has('Virtual World')) addScore('sf_fantasy', getTag('Virtual World') * 1.1, `タグ: Virtual World`);
  if (tagMap.has('Urban Fantasy')) addScore('sf_fantasy', getTag('Urban Fantasy') * 0.8, `タグ: Urban Fantasy`);
  if (tagMap.has('Post-Apocalyptic')) addScore('sf_fantasy', getTag('Post-Apocalyptic') * 0.9, `タグ: Post-Apocalyptic`);
  // ※「マギ」は単語としてマッチさせ、まどマギ等への誤爆を防止
  if (/(?:葬送のフリーレン|フリーレン|魔女の旅々|ダンジョン飯|ダンまち|ダンジョンに出会いを|STEINS;GATE|シュタゲ|Dr.STONE|ドクターストーン|サマーウォーズ|とある魔術|禁書目録|メイドインアビス|ウィストリア|シャンフロ|シャングリラ・フロンティア|SAO|ソードアート|電脳コイル|攻殻機動隊|ヴィヴィ|Vivy|寄生獣|ハクメイとミコチ|虫師|夏目友人帳|宇宙戦艦ヤマト|マギ The labyrinth|マギ シンドバッド)/i.test(t)) {
    addScore('sf_fantasy', 140, `代表SF/ファンタジータイトル`);
  }

  // ----------------------------------------------------
  // 最高得点カテゴリの判定
  // ----------------------------------------------------
  let bestCat = 'other';
  let maxScore = 20; // 最低閾値

  for (const def of GENRE_DEFINITIONS) {
    if (def.id === 'other') continue;
    const s = scores[def.id] || 0;
    if (s > maxScore) {
      maxScore = s;
      bestCat = def.id;
    }
  }

  const sortedReasons = (reasons[bestCat] || []).slice(0, 4);

  return {
    category: bestCat,
    score: Math.round(maxScore),
    scores,
    reasons,
    topReasons: sortedReasons
  };
}

/**
 * 簡易呼び出し用（カテゴリIDのみ返す）
 */
function classifyAnimeScored(genres = [], tags = [], title = '') {
  return scoreAnimeDetailed(genres, tags, title).category;
}

module.exports = {
  scoreAnimeDetailed,
  classifyAnimeScored
};
