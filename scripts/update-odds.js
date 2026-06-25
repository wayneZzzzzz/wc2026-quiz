// 从 The Odds API 拉取盘口，自动去掉赢半/输半
// 让球说明用球队名直接表达：墨西哥赢2球及以上 / 墨西哥赢1球 / 平局或南非赢球

const https = require('https');
const getDb = require('../lib/init-db');

const API_KEY = process.env.ODDS_API_KEY;
const SPORT_KEY = 'soccer_fifa_world_cup';
const API_URL = `https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/odds/?apiKey=${API_KEY}&regions=eu,us&markets=spreads&oddsFormat=decimal&dateFormat=iso`;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { reject(new Error('JSON解析失败: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

// 将四分之一球盘口取整：根据让球方的赔率决定向上或向下
// 赔率 < 2.0（让球方被看好）→ 向上取整（更难覆盖）
// 赔率 ≥ 2.0（让球方未必胜）→ 向下取整（更容易覆盖）
// 规则：x.25 → floor(x) 或 ceil(x)；x.75 → floor(x) 或 ceil(x)
function roundQuarterBall(absLine, giverDecimalOdds) {
  const frac = parseFloat((absLine % 1).toFixed(2));
  if (frac !== 0.25 && frac !== 0.75) return absLine; // 已经是整数或半球

  const base = Math.floor(absLine); // e.g. 1.25 → base=1, 0.75 → base=0
  if (giverDecimalOdds < 2.0) {
    // 让球方被赔率看好，向上取整（更难让球）
    return base + 1;
  } else {
    // 让球方优势不明显，向下取整（让球数更小）
    return base; // 可能是 0（平手盘）
  }
}

// 整数/半球盘口在赔率极端时再做 ±0.5 微调，让A/B/C三个选项概率更均衡。
// 例：让1球但让球方赔率极低（≤1.5，几乎必赢更多球）→ 加深至让1.5球；
//     让1球但让球方赔率极高（≥2.75，覆盖让球概率偏低）→ 收窄至让0.5球（最低收到0，平手盘）。
// 该调整在 roundQuarterBall 之后执行，只在赔率非常极端时触发，不影响正常盘口。
function balanceExtremeOdds(line, giverDecimalOdds) {
  if (giverDecimalOdds <= 1.5) return line + 0.5;
  if (giverDecimalOdds >= 2.75) return Math.max(0, line - 0.5);
  return line;
}

// 根据球队名和让球数生成直白中文描述
function buildHandicapInfo(giverTeam, receiverTeam, absLine) {
  let desc, optA, optB, optC;

  const fmt = n => Number.isInteger(n) ? String(n) : String(n); // 1 → "1", 1.5 → "1.5"

  if (absLine === 0) {
    // 平手盘
    desc = '平手盘';
    optA = `${giverTeam}赢球`;
    optB = '平局';
    optC = `${receiverTeam}赢球`;
  } else if (absLine === 0.5) {
    desc = `${giverTeam}让0.5球`;
    optA = `${giverTeam}赢球`;
    optB = '平局';
    optC = `${receiverTeam}赢球`;
  } else {
    // N 或 N.5（N ≥ 1）
    const N = Math.floor(absLine); // 基准整数
    desc = `${giverTeam}让${fmt(absLine)}球`;

    // A：让球方净胜 ≥ N+1 球
    optA = `${giverTeam}赢${N + 1}球及以上`;

    // B：让球方净胜恰好 N 球
    optB = `${giverTeam}赢${N}球`;

    // C：让球方净胜 < N 球、平局或受让方赢
    if (N === 1) {
      optC = `平局或${receiverTeam}赢球`;
    } else {
      optC = `${giverTeam}赢${N - 1}球以内、平局或${receiverTeam}赢球`;
    }
  }

  return { desc, optA, optB, optC };
}

// 队名映射（英文 → 中文）
const TEAM_MAP = {
  'Brazil':'巴西','France':'法国','Argentina':'阿根廷','Germany':'德国',
  'England':'英格兰','Spain':'西班牙','Portugal':'葡萄牙','Netherlands':'荷兰',
  'Belgium':'比利时','Mexico':'墨西哥','USA':'美国','United States':'美国',
  'Japan':'日本','South Korea':'韩国','Australia':'澳大利亚','Uruguay':'乌拉圭',
  'Turkey':'土耳其','Türkiye':'土耳其','Norway':'挪威','Canada':'加拿大',
  'Colombia':'哥伦比亚','Senegal':'塞内加尔','Morocco':'摩洛哥','Egypt':'埃及',
  'Croatia':'克罗地亚','Austria':'奥地利','Switzerland':'瑞士','Iran':'伊朗',
  'South Africa':'南非','Czech Republic':'捷克','Czechia':'捷克',
  'Bosnia and Herzegovina':'波黑','Bosnia & Herzegovina':'波黑','Qatar':'卡塔尔','Haiti':'海地',
  'Scotland':'苏格兰','Paraguay':'巴拉圭','Ivory Coast':'科特迪瓦',
  "Cote d'Ivoire":'科特迪瓦','Ecuador':'厄瓜多尔','Curacao':'库拉索','Curaçao':'库拉索',
  'Tunisia':'突尼斯','Sweden':'瑞典','New Zealand':'新西兰','Iraq':'伊拉克',
  'Algeria':'阿尔及利亚','Jordan':'约旦','DR Congo':'刚果','Congo DR':'刚果',
  'Uzbekistan':'乌兹别克斯坦','Ghana':'加纳','Panama':'巴拿马',
  'Saudi Arabia':'沙特阿拉伯','Cape Verde':'佛得角',
};
const toZh = name => TEAM_MAP[name] || name;

async function updateOdds() {
  if (!API_KEY) {
    console.log('[盘口] 未设置 ODDS_API_KEY，跳过（申请: https://the-odds-api.com/）');
    return { updated: 0 };
  }

  const db = await getDb();
  console.log('[盘口] 正在拉取最新盘口...');

  let resp;
  try { resp = await fetchJson(API_URL); }
  catch (e) {
    console.error('[盘口] 请求失败:', e.message);
    return { updated: 0, error: `请求失败: ${e.message}` };
  }

  if (resp.status !== 200) {
    const apiMsg = resp.body?.message || JSON.stringify(resp.body).slice(0, 200);
    console.error('[盘口] API错误:', resp.status, apiMsg);
    return { updated: 0, error: `API错误(${resp.status}): ${apiMsg}` };
  }

  let updated = 0, skipped = 0;

  for (const event of resp.body) {
    const homeZh = toZh(event.home_team);
    const awayZh = toZh(event.away_team);

    const match = db.prepare(
      `SELECT * FROM matches WHERE home_team=? AND away_team=? AND status='upcoming'`
    ).get(homeZh, awayZh);
    if (!match) { skipped++; continue; }

    // 已有人投票则锁定盘口，避免选项变化导致已投票内容含义改变
    const voteCount = db.prepare('SELECT COUNT(*) AS c FROM votes WHERE match_id=?').get(match.id);
    if (voteCount.c > 0) {
      console.log(`  ⏸ ${homeZh} vs ${awayZh} 已有投票，盘口锁定，跳过更新`);
      skipped++;
      continue;
    }

    // 管理员手动调整过的盘口，自动抓取不再覆盖（手动为准）
    if (match.manual_odds) {
      console.log(`  ✋ ${homeZh} vs ${awayZh} 盘口已被管理员手动调整，跳过自动更新`);
      skipped++;
      continue;
    }

    // 找 spreads 盘口
    const bm = event.bookmakers?.find(b => b.markets?.some(m => m.key === 'spreads'));
    if (!bm) { skipped++; continue; }
    const mkt = bm.markets.find(m => m.key === 'spreads');

    const homeOut = mkt.outcomes.find(o => o.name === event.home_team);
    const awayOut = mkt.outcomes.find(o => o.name === event.away_team);
    if (!homeOut || !awayOut) { skipped++; continue; }

    // 确定让球方（point 为负数者）
    let giverOut, receiverOut, giverTeam, receiverTeam;
    if (homeOut.point <= 0) {
      giverOut = homeOut; receiverOut = awayOut;
      giverTeam = homeZh; receiverTeam = awayZh;
    } else {
      giverOut = awayOut; receiverOut = homeOut;
      giverTeam = awayZh; receiverTeam = homeZh;
    }

    const rawAbs = Math.abs(giverOut.point);
    const giverPrice = giverOut.price; // decimal odds

    // 去掉赢半/输半：四分之一球取整 → 极端赔率下再±0.5微调，保证三选项均衡
    const quarterRounded = roundQuarterBall(rawAbs, giverPrice);
    const cleanAbs = balanceExtremeOdds(quarterRounded, giverPrice);

    // 如果取整发生了，打印说明
    const rounded = cleanAbs !== rawAbs
      ? ` (原${rawAbs}球→${cleanAbs}球，赔率${giverPrice.toFixed(2)})`
      : '';

    const info = buildHandicapInfo(giverTeam, receiverTeam, cleanAbs);

    db.prepare(
      `UPDATE matches SET handicap_desc=?, option_a=?, option_b=?, option_c=? WHERE id=?`
    ).run(info.desc, info.optA, info.optB, info.optC, match.id);

    console.log(`  ✓ ${homeZh} vs ${awayZh} → ${info.desc}${rounded}`);
    console.log(`      A: ${info.optA}`);
    console.log(`      B: ${info.optB}`);
    console.log(`      C: ${info.optC}`);
    updated++;
  }

  console.log(`[盘口] 完成：${updated} 场更新，${skipped} 场未匹配，${new Date().toLocaleString('zh-CN')}`);
  return { updated, skipped };
}

module.exports = updateOdds;
if (require.main === module) {
  updateOdds().then(r => { console.log(r); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}
