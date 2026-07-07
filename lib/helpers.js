// 国旗映射
const FLAGS = {
  '巴西':'🇧🇷','法国':'🇫🇷','阿根廷':'🇦🇷','德国':'🇩🇪','英格兰':'🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  '西班牙':'🇪🇸','葡萄牙':'🇵🇹','荷兰':'🇳🇱','比利时':'🇧🇪','墨西哥':'🇲🇽',
  '美国':'🇺🇸','日本':'🇯🇵','韩国':'🇰🇷','澳大利亚':'🇦🇺','乌拉圭':'🇺🇾',
  '土耳其':'🇹🇷','挪威':'🇳🇴','加拿大':'🇨🇦','哥伦比亚':'🇨🇴','塞内加尔':'🇸🇳',
  '摩洛哥':'🇲🇦','埃及':'🇪🇬','克罗地亚':'🇭🇷','奥地利':'🇦🇹','瑞士':'🇨🇭',
  '伊朗':'🇮🇷','南非':'🇿🇦','捷克':'🇨🇿','波黑':'🇧🇦','卡塔尔':'🇶🇦',
  '海地':'🇭🇹','苏格兰':'🏴󠁧󠁢󠁳󠁣󠁴󠁿','巴拉圭':'🇵🇾','科特迪瓦':'🇨🇮','厄瓜多尔':'🇪🇨',
  '库拉索':'🇨🇼','突尼斯':'🇹🇳','瑞典':'🇸🇪','新西兰':'🇳🇿','伊拉克':'🇮🇶',
  '阿尔及利亚':'🇩🇿','约旦':'🇯🇴','刚果':'🇨🇩','乌兹别克斯坦':'🇺🇿',
  '加纳':'🇬🇭','巴拿马':'🇵🇦','沙特阿拉伯':'🇸🇦','佛得角':'🇨🇻',
};

// 盘口选项说明
const OPTION_TIPS = {
  '强队胜':    '让球队赢得比赛（不论比分）',
  '弱队胜':    '受让队赢得比赛',
  '平局':      '比赛以平局结束',
  '主队胜':    '主队赢得比赛',
  '客队胜':    '客队赢得比赛',
  '让球胜':    '让球队净胜球数 > 让球数，覆盖盘口',
  '让球平':    '净胜球数 = 让球数，推盘退本（半数情况）',
  '不败':      '受让队平局或赢球，让球队未能覆盖',
  '主队不败':  '主队平局或赢球',
  '让球负':    '让球队虽赢但净胜球不足，或平/负',
  '让两球胜':  '让球队净胜球数 > 2，完全覆盖盘口',
  '让两球平':  '净胜球数 = 2，推盘退本',
  '让两球负':  '让球队净胜球 ≤ 1，或平局/负',
  '大让球胜':  '让球队净胜球数大幅超过让球数',
  '让球大胜':  '让球队净胜球大幅超过让球数',
  '让球胜/平': '让球队赢球或净胜球恰好等于让球数',
  '大胜':      '大比分获胜，完全覆盖盘口',
  '小胜/平/负':'小胜、平局或负，受让队获利',
};

// UTC datetime string → Date 对象（确保按UTC解析）
function parseUTC(dtStr) {
  return new Date(dtStr.replace(' ', 'T') + ':00Z');
}

// 格式化为北京时间
function fmtBJ(dtStr) {
  return parseUTC(dtStr).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric', day: 'numeric',
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  });
}

// 格式化为美东时间
function fmtET(dtStr) {
  return parseUTC(dtStr).toLocaleString('zh-CN', {
    timeZone: 'America/New_York',
    month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// 格式化数据库 CURRENT_TIMESTAMP 字段（'YYYY-MM-DD HH:MM:SS'，UTC）为北京时间，精确到秒
function fmtBJFull(dtStr) {
  if (!dtStr) return '';
  const d = new Date(dtStr.replace(' ', 'T') + 'Z');
  return d.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// 把通用标签（强队/弱队/主队/客队）替换成实际球队名
// 无论 API 有没有覆盖到，显示永远是队名
function resolveLabel(label, homeTeam, awayTeam, handicapDesc) {
  if (!label) return label;
  // 判断让球方：handicap_desc 以哪支队开头，那支队就是让球方
  let giver = homeTeam, receiver = awayTeam;
  if (handicapDesc && handicapDesc !== '平手盘') {
    if (String(handicapDesc).startsWith(awayTeam)) {
      giver = awayTeam; receiver = homeTeam;
    }
  }
  return label
    .replace(/强队/g, giver)
    .replace(/弱队/g, receiver)
    .replace(/主队/g, homeTeam)
    .replace(/客队/g, awayTeam);
}

module.exports = { FLAGS, OPTION_TIPS, parseUTC, fmtBJ, fmtET, fmtBJFull, resolveLabel };
