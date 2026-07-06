// 导入 2026 世界杯全部赛程
// 时间均为 UTC，对应北京时间 UTC+8 请自行加8小时
// 例：19:00 UTC = 次日 03:00 北京时间

const getDb = require('../lib/init-db');

// 48场小组赛数据（时间 UTC）
// 东部夏令时 EDT = UTC-4，已换算
const GROUP_STAGE = [
  // ---- A组 ----
  { home:'墨西哥', away:'南非', time:'2026-06-11 19:00', stage:'小组赛 A组' },
  { home:'韩国', away:'捷克', time:'2026-06-12 02:00', stage:'小组赛 A组' },
  { home:'捷克', away:'南非', time:'2026-06-18 16:00', stage:'小组赛 A组' },
  { home:'墨西哥', away:'韩国', time:'2026-06-19 01:00', stage:'小组赛 A组' },
  { home:'南非', away:'韩国', time:'2026-06-25 01:00', stage:'小组赛 A组' },
  { home:'捷克', away:'墨西哥', time:'2026-06-25 01:00', stage:'小组赛 A组' },

  // ---- B组 ----
  { home:'加拿大', away:'波黑', time:'2026-06-12 19:00', stage:'小组赛 B组' },
  { home:'卡塔尔', away:'瑞士', time:'2026-06-13 19:00', stage:'小组赛 B组' },
  { home:'瑞士', away:'波黑', time:'2026-06-18 19:00', stage:'小组赛 B组' },
  { home:'加拿大', away:'卡塔尔', time:'2026-06-18 22:00', stage:'小组赛 B组' },
  { home:'波黑', away:'卡塔尔', time:'2026-06-24 19:00', stage:'小组赛 B组' },
  { home:'瑞士', away:'加拿大', time:'2026-06-24 19:00', stage:'小组赛 B组' },

  // ---- C组 ----
  { home:'巴西', away:'摩洛哥', time:'2026-06-13 22:00', stage:'小组赛 C组' },
  { home:'海地', away:'苏格兰', time:'2026-06-14 01:00', stage:'小组赛 C组' },
  { home:'苏格兰', away:'摩洛哥', time:'2026-06-19 22:00', stage:'小组赛 C组' },
  { home:'巴西', away:'海地', time:'2026-06-20 00:30', stage:'小组赛 C组' },
  { home:'摩洛哥', away:'海地', time:'2026-06-24 22:00', stage:'小组赛 C组' },
  { home:'苏格兰', away:'巴西', time:'2026-06-24 22:00', stage:'小组赛 C组' },

  // ---- D组 ----
  { home:'美国', away:'巴拉圭', time:'2026-06-13 01:00', stage:'小组赛 D组' },
  { home:'澳大利亚', away:'土耳其', time:'2026-06-14 04:00', stage:'小组赛 D组' },
  { home:'美国', away:'澳大利亚', time:'2026-06-19 19:00', stage:'小组赛 D组' },
  { home:'土耳其', away:'巴拉圭', time:'2026-06-20 03:00', stage:'小组赛 D组' },
  { home:'澳大利亚', away:'巴拉圭', time:'2026-06-26 02:00', stage:'小组赛 D组' },
  { home:'土耳其', away:'美国', time:'2026-06-26 02:00', stage:'小组赛 D组' },

  // ---- E组 ----
  { home:'德国', away:'库拉索', time:'2026-06-14 17:00', stage:'小组赛 E组' },
  { home:'科特迪瓦', away:'厄瓜多尔', time:'2026-06-14 23:00', stage:'小组赛 E组' },
  { home:'德国', away:'科特迪瓦', time:'2026-06-20 20:00', stage:'小组赛 E组' },
  { home:'厄瓜多尔', away:'库拉索', time:'2026-06-21 00:00', stage:'小组赛 E组' },
  { home:'科特迪瓦', away:'库拉索', time:'2026-06-25 20:00', stage:'小组赛 E组' },
  { home:'厄瓜多尔', away:'德国', time:'2026-06-25 20:00', stage:'小组赛 E组' },

  // ---- F组 ----
  { home:'荷兰', away:'日本', time:'2026-06-14 20:00', stage:'小组赛 F组' },
  { home:'突尼斯', away:'瑞典', time:'2026-06-15 02:00', stage:'小组赛 F组' },
  { home:'荷兰', away:'瑞典', time:'2026-06-20 17:00', stage:'小组赛 F组' },
  { home:'突尼斯', away:'日本', time:'2026-06-21 04:00', stage:'小组赛 F组' },
  { home:'日本', away:'瑞典', time:'2026-06-25 23:00', stage:'小组赛 F组' },
  { home:'突尼斯', away:'荷兰', time:'2026-06-25 23:00', stage:'小组赛 F组' },

  // ---- G组 ----
  { home:'比利时', away:'埃及', time:'2026-06-15 19:00', stage:'小组赛 G组' },
  { home:'伊朗', away:'新西兰', time:'2026-06-16 01:00', stage:'小组赛 G组' },
  { home:'比利时', away:'伊朗', time:'2026-06-21 19:00', stage:'小组赛 G组' },
  { home:'新西兰', away:'埃及', time:'2026-06-22 01:00', stage:'小组赛 G组' },
  { home:'埃及', away:'伊朗', time:'2026-06-27 03:00', stage:'小组赛 G组' },
  { home:'新西兰', away:'比利时', time:'2026-06-27 03:00', stage:'小组赛 G组' },

  // ---- H组 ----
  { home:'西班牙', away:'佛得角', time:'2026-06-15 16:00', stage:'小组赛 H组' },
  { home:'沙特阿拉伯', away:'乌拉圭', time:'2026-06-15 22:00', stage:'小组赛 H组' },
  { home:'西班牙', away:'沙特阿拉伯', time:'2026-06-21 16:00', stage:'小组赛 H组' },
  { home:'乌拉圭', away:'佛得角', time:'2026-06-21 22:00', stage:'小组赛 H组' },
  { home:'佛得角', away:'沙特阿拉伯', time:'2026-06-27 00:00', stage:'小组赛 H组' },
  { home:'乌拉圭', away:'西班牙', time:'2026-06-27 00:00', stage:'小组赛 H组' },

  // ---- I组 ----
  { home:'法国', away:'塞内加尔', time:'2026-06-16 19:00', stage:'小组赛 I组' },
  { home:'伊拉克', away:'挪威', time:'2026-06-16 22:00', stage:'小组赛 I组' },
  { home:'法国', away:'伊拉克', time:'2026-06-22 21:00', stage:'小组赛 I组' },
  { home:'挪威', away:'塞内加尔', time:'2026-06-23 00:00', stage:'小组赛 I组' },
  { home:'塞内加尔', away:'伊拉克', time:'2026-06-26 19:00', stage:'小组赛 I组' },
  { home:'挪威', away:'法国', time:'2026-06-26 19:00', stage:'小组赛 I组' },

  // ---- J组 ----
  { home:'阿根廷', away:'阿尔及利亚', time:'2026-06-17 01:00', stage:'小组赛 J组' },
  { home:'奥地利', away:'约旦', time:'2026-06-17 04:00', stage:'小组赛 J组' },
  { home:'阿根廷', away:'奥地利', time:'2026-06-22 17:00', stage:'小组赛 J组' },
  { home:'约旦', away:'阿尔及利亚', time:'2026-06-23 03:00', stage:'小组赛 J组' },
  { home:'阿尔及利亚', away:'奥地利', time:'2026-06-28 02:00', stage:'小组赛 J组' },
  { home:'约旦', away:'阿根廷', time:'2026-06-28 02:00', stage:'小组赛 J组' },

  // ---- K组 ----
  { home:'葡萄牙', away:'刚果', time:'2026-06-17 17:00', stage:'小组赛 K组' },
  { home:'乌兹别克斯坦', away:'哥伦比亚', time:'2026-06-18 02:00', stage:'小组赛 K组' },
  { home:'葡萄牙', away:'乌兹别克斯坦', time:'2026-06-23 17:00', stage:'小组赛 K组' },
  { home:'哥伦比亚', away:'刚果', time:'2026-06-24 02:00', stage:'小组赛 K组' },
  { home:'刚果', away:'乌兹别克斯坦', time:'2026-06-27 23:30', stage:'小组赛 K组' },
  { home:'哥伦比亚', away:'葡萄牙', time:'2026-06-27 23:30', stage:'小组赛 K组' },

  // ---- L组 ----
  { home:'英格兰', away:'克罗地亚', time:'2026-06-17 20:00', stage:'小组赛 L组' },
  { home:'加纳', away:'巴拿马', time:'2026-06-17 23:00', stage:'小组赛 L组' },
  { home:'英格兰', away:'加纳', time:'2026-06-23 20:00', stage:'小组赛 L组' },
  { home:'巴拿马', away:'克罗地亚', time:'2026-06-23 23:00', stage:'小组赛 L组' },
  { home:'克罗地亚', away:'加纳', time:'2026-06-27 21:00', stage:'小组赛 L组' },
  { home:'巴拿马', away:'英格兰', time:'2026-06-27 21:00', stage:'小组赛 L组' },
];

// 32强赛（已确定对阵，盘口已根据 The Odds API 实时数据计算）
const ROUND_OF_32 = [
  { home:'南非', away:'加拿大', time:'2026-06-28 19:00', stage:'32强',
    handicap_desc:'加拿大让0.5球', option_a:'加拿大赢球', option_b:'平局', option_c:'南非赢球' },
  { home:'巴西', away:'日本', time:'2026-06-29 17:00', stage:'32强',
    handicap_desc:'巴西让0.5球', option_a:'巴西赢球', option_b:'平局', option_c:'日本赢球' },
  { home:'德国', away:'巴拉圭', time:'2026-06-29 20:30', stage:'32强',
    handicap_desc:'德国让1.5球', option_a:'德国赢2球及以上', option_b:'德国赢1球', option_c:'平局或巴拉圭赢球' },
  { home:'荷兰', away:'摩洛哥', time:'2026-06-30 01:00', stage:'32强',
    handicap_desc:'荷兰让0.5球', option_a:'荷兰赢球', option_b:'平局', option_c:'摩洛哥赢球' },
  { home:'科特迪瓦', away:'挪威', time:'2026-06-30 17:00', stage:'32强',
    handicap_desc:'挪威让0.5球', option_a:'挪威赢球', option_b:'平局', option_c:'科特迪瓦赢球' },
  { home:'法国', away:'瑞典', time:'2026-06-30 21:00', stage:'32强',
    handicap_desc:'法国让1.5球', option_a:'法国赢2球及以上', option_b:'法国赢1球', option_c:'平局或瑞典赢球' },
  { home:'美国', away:'波黑', time:'2026-07-02 00:00', stage:'32强',
    handicap_desc:'美国让1.5球', option_a:'美国赢2球及以上', option_b:'美国赢1球', option_c:'平局或波黑赢球' },
  { home:'阿根廷', away:'佛得角', time:'2026-07-03 22:00', stage:'32强',
    handicap_desc:'阿根廷让2球', option_a:'阿根廷赢3球及以上', option_b:'阿根廷赢2球', option_c:'阿根廷赢1球以内、平局或佛得角赢球' },
  { home:'墨西哥', away:'厄瓜多尔', time:'2026-07-01 01:00', stage:'32强',
    handicap_desc:'墨西哥让0.5球', option_a:'墨西哥赢球', option_b:'平局', option_c:'厄瓜多尔赢球' },
  { home:'英格兰', away:'刚果', time:'2026-07-01 16:00', stage:'32强',
    handicap_desc:'英格兰让1.5球', option_a:'英格兰赢2球及以上', option_b:'英格兰赢1球', option_c:'平局或刚果赢球' },
  { home:'比利时', away:'塞内加尔', time:'2026-07-01 20:00', stage:'32强',
    handicap_desc:'比利时让0.5球', option_a:'比利时赢球', option_b:'平局', option_c:'塞内加尔赢球' },
  { home:'西班牙', away:'奥地利', time:'2026-07-02 19:00', stage:'32强',
    handicap_desc:'西班牙让1.5球', option_a:'西班牙赢2球及以上', option_b:'西班牙赢1球', option_c:'平局或奥地利赢球' },
  { home:'葡萄牙', away:'克罗地亚', time:'2026-07-02 23:00', stage:'32强',
    handicap_desc:'葡萄牙让0.5球', option_a:'葡萄牙赢球', option_b:'平局', option_c:'克罗地亚赢球' },
  { home:'瑞士', away:'阿尔及利亚', time:'2026-07-03 03:00', stage:'32强',
    handicap_desc:'瑞士让0.5球', option_a:'瑞士赢球', option_b:'平局', option_c:'阿尔及利亚赢球' },
  { home:'澳大利亚', away:'埃及', time:'2026-07-03 18:00', stage:'32强',
    handicap_desc:'平手盘', option_a:'澳大利亚赢球', option_b:'平局', option_c:'埃及赢球' },
  { home:'哥伦比亚', away:'加纳', time:'2026-07-04 01:30', stage:'32强',
    handicap_desc:'哥伦比亚让1球', option_a:'哥伦比亚赢2球及以上', option_b:'哥伦比亚赢1球', option_c:'平局或加纳赢球' },
];

// 16强赛（已确定对阵，盘口已根据 The Odds API 实时数据计算）
const ROUND_OF_16 = [
  { home:'加拿大', away:'摩洛哥', time:'2026-07-04 17:00', stage:'16强',
    handicap_desc:'平手盘', option_a:'加拿大赢球', option_b:'平局', option_c:'摩洛哥赢球' },
  { home:'巴拉圭', away:'法国', time:'2026-07-04 21:00', stage:'16强',
    handicap_desc:'法国让1.5球', option_a:'法国赢2球及以上', option_b:'法国赢1球', option_c:'平局或巴拉圭赢球' },
  { home:'巴西', away:'挪威', time:'2026-07-05 20:00', stage:'16强',
    handicap_desc:'巴西让0.5球', option_a:'巴西赢球', option_b:'平局', option_c:'挪威赢球' },
  { home:'墨西哥', away:'英格兰', time:'2026-07-06 00:00', stage:'16强',
    handicap_desc:'平手盘', option_a:'墨西哥赢球', option_b:'平局', option_c:'英格兰赢球' },
  { home:'葡萄牙', away:'西班牙', time:'2026-07-06 19:00', stage:'16强',
    handicap_desc:'平手盘', option_a:'葡萄牙赢球', option_b:'平局', option_c:'西班牙赢球' },
  { home:'美国', away:'比利时', time:'2026-07-07 00:00', stage:'16强',
    handicap_desc:'平手盘', option_a:'美国赢球', option_b:'平局', option_c:'比利时赢球' },
  { home:'阿根廷', away:'埃及', time:'2026-07-07 16:00', stage:'16强',
    handicap_desc:'阿根廷让1.5球', option_a:'阿根廷赢2球及以上', option_b:'阿根廷赢1球', option_c:'平局或埃及赢球' },
  { home:'瑞士', away:'哥伦比亚', time:'2026-07-07 20:00', stage:'16强',
    handicap_desc:'哥伦比亚让0.5球', option_a:'哥伦比亚赢球', option_b:'平局', option_c:'瑞士赢球' },
];

// 八强赛（已确定对阵，盘口已根据 The Odds API 实时数据计算）
const QUARTER_FINAL = [
  { home:'法国', away:'摩洛哥', time:'2026-07-09 20:00', stage:'八强',
    handicap_desc:'法国让0.5球', option_a:'法国赢球', option_b:'平局', option_c:'摩洛哥赢球' },
  { home:'挪威', away:'英格兰', time:'2026-07-11 21:00', stage:'八强',
    handicap_desc:'英格兰让0.5球', option_a:'英格兰赢球', option_b:'平局', option_c:'挪威赢球' },
];

// 初始盘口估算（根据球队实力，API 会覆盖真实数据）
function estimateHandicap(home, away) {
  const strong = ['巴西','法国','阿根廷','德国','英格兰','西班牙','葡萄牙','荷兰','比利时'];
  const decent = ['墨西哥','美国','日本','韩国','澳大利亚','乌拉圭','土耳其','挪威','加拿大','哥伦比亚','塞内加尔','摩洛哥','埃及','克罗地亚','奥地利','瑞士','伊朗'];

  const homeStrong = strong.includes(home);
  const awayStrong = strong.includes(away);
  const homeDecent = decent.includes(home);
  const awayDecent = decent.includes(away);

  if (homeStrong && !awayStrong && !awayDecent) {
    return { desc: `${home}让1.5球`, a: '让球大胜', b: '让球胜/平', c: '不败' };
  } else if (homeStrong && awayDecent) {
    return { desc: `${home}让1球`, a: '让球胜', b: '让球平', c: '不败' };
  } else if (homeStrong && awayStrong) {
    return { desc: `${home}让0.5球`, a: '强队胜', b: '平局', c: '弱队胜' };
  } else if (awayStrong && !homeStrong && !homeDecent) {
    return { desc: `${away}让1.5球`, a: '主队不败', b: '让球平', c: '让球胜' };
  } else if (awayStrong && homeDecent) {
    return { desc: `${away}让1球`, a: '主队不败', b: '让球平', c: '让球胜' };
  } else if (homeDecent && !awayDecent && !awayStrong) {
    return { desc: `${home}让0.5球`, a: '强队胜', b: '平局', c: '弱队胜' };
  } else if (awayDecent && !homeDecent && !homeStrong) {
    return { desc: `${away}让0.5球`, a: '主队不败', b: '平局', c: '客队胜' };
  } else {
    return { desc: '平手盘', a: '主队胜', b: '平局', c: '客队胜' };
  }
}

async function importMatches() {
  const db = await getDb();
  const count = db.prepare('SELECT COUNT(*) as n FROM matches').get().n;
  if (count > 0) {
    console.log(`数据库已有 ${count} 场比赛，跳过导入。`);
    return count;
  }

  console.log('正在导入赛程...');
  let imported = 0;
  for (const m of GROUP_STAGE) {
    const h = estimateHandicap(m.home, m.away);
    db.prepare(`
      INSERT INTO matches (home_team, away_team, match_time, stage, handicap_desc, option_a, option_b, option_c, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'upcoming')
    `).run(m.home, m.away, m.time, m.stage, h.desc, h.a, h.b, h.c);
    imported++;
  }
  for (const m of [...ROUND_OF_32, ...ROUND_OF_16, ...QUARTER_FINAL]) {
    db.prepare(`
      INSERT INTO matches (home_team, away_team, match_time, stage, handicap_desc, option_a, option_b, option_c, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'upcoming')
    `).run(m.home, m.away, m.time, m.stage, m.handicap_desc, m.option_a, m.option_b, m.option_c);
    imported++;
  }
  console.log(`✅ 导入完成：共 ${imported} 场比赛`);
  return imported;
}

module.exports = importMatches;
module.exports.ROUND_OF_32 = ROUND_OF_32;
module.exports.ROUND_OF_16 = ROUND_OF_16;
module.exports.QUARTER_FINAL = QUARTER_FINAL;

// 独立运行支持
if (require.main === module) {
  importMatches().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
