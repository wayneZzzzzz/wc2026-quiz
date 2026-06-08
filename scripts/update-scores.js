// 自动拉取已完结比赛的比分，判断正确选项，并结算
// The Odds API /scores 端点，每次拉取最近 3 天的比赛
const https = require('https');
const getDb = require('../lib/init-db');
const { doSettle, determineResult } = require('../lib/settle');

const API_KEY   = process.env.ODDS_API_KEY;
const SPORT_KEY = 'soccer_fifa_world_cup';
const SCORES_URL = `https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/scores/?apiKey=${API_KEY}&daysFrom=3`;

const TEAM_MAP = {
  'Brazil':'巴西','France':'法国','Argentina':'阿根廷','Germany':'德国',
  'England':'英格兰','Spain':'西班牙','Portugal':'葡萄牙','Netherlands':'荷兰',
  'Belgium':'比利时','Mexico':'墨西哥','USA':'美国','United States':'美国',
  'Japan':'日本','South Korea':'韩国','Australia':'澳大利亚','Uruguay':'乌拉圭',
  'Turkey':'土耳其','Türkiye':'土耳其','Norway':'挪威','Canada':'加拿大',
  'Colombia':'哥伦比亚','Senegal':'塞内加尔','Morocco':'摩洛哥','Egypt':'埃及',
  'Croatia':'克罗地亚','Austria':'奥地利','Switzerland':'瑞士','Iran':'伊朗',
  'South Africa':'南非','Czech Republic':'捷克','Czechia':'捷克',
  'Bosnia and Herzegovina':'波黑','Qatar':'卡塔尔','Haiti':'海地',
  'Scotland':'苏格兰','Paraguay':'巴拉圭','Ivory Coast':'科特迪瓦',
  "Cote d'Ivoire":'科特迪瓦','Ecuador':'厄瓜多尔','Curacao':'库拉索',
  'Tunisia':'突尼斯','Sweden':'瑞典','New Zealand':'新西兰','Iraq':'伊拉克',
  'Algeria':'阿尔及利亚','Jordan':'约旦','DR Congo':'刚果','Congo DR':'刚果',
  'Uzbekistan':'乌兹别克斯坦','Ghana':'加纳','Panama':'巴拿马',
  'Saudi Arabia':'沙特阿拉伯','Cape Verde':'佛得角',
};
const toZh = name => TEAM_MAP[name] || name;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { reject(new Error('JSON解析失败')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('超时')); });
  });
}

async function updateScores() {
  if (!API_KEY) return;

  const db = await getDb();
  let resp;
  try { resp = await fetchJson(SCORES_URL); }
  catch (e) { console.error('[赛果] 请求失败:', e.message); return; }

  if (resp.status !== 200) { console.error('[赛果] API错误:', resp.status); return; }

  let updated = 0;
  for (const event of resp.body) {
    if (!event.completed || !event.scores) continue;

    const homeZh = toZh(event.home_team);
    const awayZh = toZh(event.away_team);

    // 找到 DB 中还未结算的比赛（状态 voting 或 closed）
    const match = db.prepare(
      `SELECT * FROM matches WHERE home_team=? AND away_team=? AND status IN ('voting','closed','upcoming')`
    ).get(homeZh, awayZh);
    if (!match) continue;

    // 解析比分
    const homeScore = parseInt(event.scores.find(s => s.name === event.home_team)?.score ?? -1);
    const awayScore = parseInt(event.scores.find(s => s.name === event.away_team)?.score ?? -1);
    if (isNaN(homeScore) || isNaN(awayScore) || homeScore < 0) continue;

    // 判断正确选项
    const result = determineResult(homeScore, awayScore, match.handicap_desc, homeZh, awayZh);
    if (!result) {
      console.log(`[赛果] ⚠️ 无法判断结果: ${homeZh} vs ${awayZh} (${homeScore}-${awayScore})，盘口: ${match.handicap_desc}`);
      // 仍然更新比分，等管理员手动选结果
      db.prepare('UPDATE matches SET home_score=?,away_score=?,status=? WHERE id=?')
        .run(homeScore, awayScore, 'closed', match.id);
      continue;
    }

    // 写入结果并结算
    try {
      db.prepare('UPDATE matches SET result=?,status=?,home_score=?,away_score=? WHERE id=?')
        .run(result, 'finished', homeScore, awayScore, match.id);
      doSettle(db, match.id);
      console.log(`[赛果] ✅ 自动结算: ${homeZh} ${homeScore}-${awayScore} ${awayZh}，正确答案: ${result.toUpperCase()}`);
      updated++;
    } catch (e) {
      console.error(`[赛果] 结算失败: ${homeZh} vs ${awayZh}`, e.message);
    }
  }

  if (updated > 0) console.log(`[赛果] 本次自动结算 ${updated} 场`);
  return updated;
}

module.exports = updateScores;
if (require.main === module) {
  updateScores().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
