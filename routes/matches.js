const express = require('express');

const KNOCKOUT_STAGES = ['32强','16强','八强','四强','决赛'];

function getEffectiveStatus(match) {
  if (match.status === 'finished') return 'finished';
  if (match.status === 'closed') return 'closed';
  if (match.status === 'voting') return 'voting'; // 管理员手动开放，直接生效

  // 仅 upcoming 状态时才用时间自动判断
  const now = new Date();
  const matchTime = new Date(match.match_time.replace(' ','T') + ':00Z');
  const openTime = new Date(matchTime.getTime() - 24 * 60 * 60 * 1000); // 提前24小时开放
  if (now >= matchTime) return 'closed';
  if (now >= openTime) return 'voting';
  return 'upcoming';
}

// 计算某个组的积分榜
function calcStandings(groupMatches) {
  const teams = {};
  const ensure = name => {
    if (!teams[name]) teams[name] = { team: name, p:0, w:0, d:0, l:0, gf:0, ga:0, pts:0 };
  };

  for (const m of groupMatches) {
    ensure(m.home_team); ensure(m.away_team);
    if (m.status !== 'finished' || m.home_score == null) continue;
    const hs = m.home_score, as = m.away_score;
    teams[m.home_team].p++; teams[m.away_team].p++;
    teams[m.home_team].gf += hs; teams[m.home_team].ga += as;
    teams[m.away_team].gf += as; teams[m.away_team].ga += hs;
    if (hs > as) {
      teams[m.home_team].w++; teams[m.home_team].pts += 3;
      teams[m.away_team].l++;
    } else if (hs < as) {
      teams[m.away_team].w++; teams[m.away_team].pts += 3;
      teams[m.home_team].l++;
    } else {
      teams[m.home_team].d++; teams[m.home_team].pts++;
      teams[m.away_team].d++; teams[m.away_team].pts++;
    }
  }
  return Object.values(teams).sort((a,b) =>
    b.pts - a.pts || (b.gf-b.ga)-(a.gf-a.ga) || b.gf - a.gf || a.team.localeCompare(b.team)
  );
}

module.exports = function(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const tab = req.query.tab || 'group'; // group | knockout
    const allMatches = db.prepare('SELECT * FROM matches ORDER BY match_time ASC').all();
    allMatches.forEach(m => m.effectiveStatus = getEffectiveStatus(m));

    // 当前用户已投票的比赛 id 集合，用于在赛程页标注"已投票/待投票"
    let votedMatchIds = new Set();
    if (req.session.user) {
      const voted = db.prepare('SELECT match_id FROM votes WHERE user_id=?').all(req.session.user.id);
      votedMatchIds = new Set(voted.map(v => v.match_id));
    }
    allMatches.forEach(m => m.userVoted = votedMatchIds.has(m.id));

    // 小组赛：按组分
    const groupMatches = allMatches.filter(m => m.stage && m.stage.startsWith('小组赛'));
    const groupMap = {}; // { 'A组': [...], 'B组': [...] }
    for (const m of groupMatches) {
      const grp = m.stage.replace('小组赛 ', '').replace('小组赛', '').trim();
      if (!groupMap[grp]) groupMap[grp] = [];
      groupMap[grp].push(m);
    }
    const groups = Object.entries(groupMap).sort(([a],[b]) => a.localeCompare(b)).map(([name, matches]) => ({
      name,
      matches,
      standings: calcStandings(matches),
    }));

    // 淘汰赛：按阶段分
    const knockoutMatches = allMatches.filter(m => KNOCKOUT_STAGES.includes(m.stage));
    const knockoutMap = {};
    for (const s of KNOCKOUT_STAGES) {
      const ms = knockoutMatches.filter(m => m.stage === s);
      if (ms.length) knockoutMap[s] = ms;
    }

    res.render('matches', { title: '赛程', tab, groups, knockoutMap, KNOCKOUT_STAGES });
  });

  router.get('/:id', (req, res) => {
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
    if (!match) return res.redirect('/matches');

    const effectiveStatus = getEffectiveStatus(match);
    const user = req.session.user;

    let myVote = null, allVotes = [], voteCounts = { a:0, b:0, c:0, total:0 };

    if (user) myVote = db.prepare('SELECT * FROM votes WHERE user_id=? AND match_id=?').get(user.id, match.id);

    if (effectiveStatus === 'finished' || myVote) {
      allVotes = db.prepare(`
        SELECT v.*, u.nickname FROM votes v JOIN users u ON v.user_id=u.id
        WHERE v.match_id=? ORDER BY v.created_at ASC
      `).all(match.id);
      voteCounts.a = allVotes.filter(v=>v.choice==='a').length;
      voteCounts.b = allVotes.filter(v=>v.choice==='b').length;
      voteCounts.c = allVotes.filter(v=>v.choice==='c').length;
      voteCounts.total = allVotes.length;
    }

    let myLog = null;
    if (user && effectiveStatus === 'finished')
      myLog = db.prepare('SELECT * FROM point_logs WHERE user_id=? AND match_id=?').get(user.id, match.id);

    let virtualVotesLeft = 0;
    if (user) {
      const me = db.prepare('SELECT virtual_votes_left FROM users WHERE id=?').get(user.id);
      virtualVotesLeft = me ? me.virtual_votes_left : 0;
    }

    res.render('match', {
      title: `${match.home_team} vs ${match.away_team}`,
      match, effectiveStatus, myVote, allVotes, voteCounts, myLog, virtualVotesLeft
    });
  });

  return router;
};

module.exports.getEffectiveStatus = getEffectiveStatus;
