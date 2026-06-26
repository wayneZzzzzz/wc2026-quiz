// 通用结算模块：撤销旧积分 → 按当前投票重新计算
// 供自动结算、管理员重新结算复用

function doSettle(db, matchId) {
  const match = db.prepare('SELECT * FROM matches WHERE id=?').get(matchId);
  if (!match || !match.result) throw new Error('比赛尚未有结果');

  db.transaction(() => {
    // 1. 撤销该场所有历史积分记录
    const logs = db.prepare('SELECT * FROM point_logs WHERE match_id=?').all(matchId);
    for (const log of logs) {
      db.prepare('UPDATE users SET total_points=total_points-? WHERE id=?').run(log.points, log.user_id);
      if (log.points > 0) {
        db.prepare('UPDATE users SET wins=MAX(0,wins-1) WHERE id=?').run(log.user_id);
      }
    }
    db.prepare('DELETE FROM point_logs WHERE match_id=?').run(matchId);

    // 2. 按当前所有投票重新计算（虚拟投票不参与积分结算）
    const votes  = db.prepare('SELECT * FROM votes WHERE match_id=? AND is_virtual=0').all(matchId);
    const winners = votes.filter(v => v.choice === match.result);
    const losers  = votes.filter(v => v.choice !== match.result);

    // 全员猜错时不扣分也不加分，视为此场作废
    if (winners.length === 0) return;

    const pts = Math.round(losers.length * 100 / winners.length);

    for (const w of winners) {
      db.prepare('UPDATE users SET total_points=total_points+?, wins=wins+1 WHERE id=?').run(pts, w.user_id);
      db.prepare('INSERT INTO point_logs (user_id,match_id,points,description) VALUES (?,?,?,?)').run(w.user_id, matchId, pts, `猜中！获得 ${pts} 分`);
    }
    for (const l of losers) {
      db.prepare('UPDATE users SET total_points=total_points-100 WHERE id=?').run(l.user_id);
      db.prepare('INSERT INTO point_logs (user_id,match_id,points,description) VALUES (?,?,?,?)').run(l.user_id, matchId, -100, '未猜中，扣除 100 分');
    }
  })();

  console.log(`[结算] 比赛 ${matchId} (${match.home_team} vs ${match.away_team}) 重新结算完成，投票 ${db.prepare('SELECT COUNT(*) as n FROM votes WHERE match_id=?').get(matchId).n} 人`);
}

// 根据比分和盘口，自动判断正确选项 (a/b/c)
// 规则：N = floor(让球数)，giverDiff = 让球方净胜球
//   diff >= N+1 → A，diff == N → B，diff <= N-1 → C
function determineResult(homeScore, awayScore, handicapDesc, homeTeam, awayTeam) {
  let giverTeam, absLine;

  if (handicapDesc === '平手盘') {
    giverTeam = homeTeam;
    absLine = 0;
  } else {
    // 格式："巴西让1.5球" 或 "西班牙让2球"
    const m = String(handicapDesc).match(/^(.+?)让(\d+\.?\d*)球$/);
    if (!m) return null;
    giverTeam = m[1].trim();
    absLine = parseFloat(m[2]);
  }

  const giverScore    = giverTeam === homeTeam ? homeScore    : awayScore;
  const receiverScore = giverTeam === homeTeam ? awayScore    : homeScore;
  const diff = giverScore - receiverScore;
  const N = Math.floor(absLine); // 0.5→0, 1→1, 1.5→1, 2→2

  if (diff >= N + 1) return 'a';
  if (diff === N)    return 'b';
  return 'c';
}

module.exports = { doSettle, determineResult };
