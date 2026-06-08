const express = require('express');

function getEffectiveStatus(match) {
  if (match.status === 'finished') return 'finished';
  if (match.status === 'closed') return 'closed';
  const now = new Date();
  const matchTime = new Date(match.match_time);
  const openTime = new Date(matchTime.getTime() - 24 * 60 * 60 * 1000);
  if (now >= matchTime) return 'closed';
  if (now >= openTime) return 'voting';
  return 'upcoming';
}

module.exports = function(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const stage = req.query.stage || '';
    let matches;
    if (stage) {
      matches = db.prepare('SELECT * FROM matches WHERE stage = ? ORDER BY match_time ASC').all(stage);
    } else {
      matches = db.prepare('SELECT * FROM matches ORDER BY match_time ASC').all();
    }
    const withStatus = matches.map(m => ({ ...m, effectiveStatus: getEffectiveStatus(m) }));
    res.render('matches', { title: '所有比赛', matches: withStatus, stage });
  });

  router.get('/:id', (req, res) => {
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
    if (!match) return res.redirect('/matches');

    const effectiveStatus = getEffectiveStatus(match);
    const user = req.session.user;

    let myVote = null;
    let allVotes = [];
    let voteCounts = { a: 0, b: 0, c: 0, total: 0 };

    if (user) {
      myVote = db.prepare('SELECT * FROM votes WHERE user_id = ? AND match_id = ?').get(user.id, match.id);
    }

    if (effectiveStatus === 'finished' || myVote) {
      allVotes = db.prepare(`
        SELECT v.id, v.user_id, v.match_id, v.choice, v.created_at, u.nickname
        FROM votes v JOIN users u ON v.user_id = u.id
        WHERE v.match_id = ? ORDER BY v.created_at ASC
      `).all(match.id);
      voteCounts.a = allVotes.filter(v => v.choice === 'a').length;
      voteCounts.b = allVotes.filter(v => v.choice === 'b').length;
      voteCounts.c = allVotes.filter(v => v.choice === 'c').length;
      voteCounts.total = allVotes.length;
    }

    let myLog = null;
    if (user && effectiveStatus === 'finished') {
      myLog = db.prepare('SELECT * FROM point_logs WHERE user_id = ? AND match_id = ?').get(user.id, match.id);
    }

    res.render('match', {
      title: `${match.home_team} vs ${match.away_team}`,
      match, effectiveStatus, myVote, allVotes, voteCounts, myLog
    });
  });

  return router;
};

module.exports.getEffectiveStatus = getEffectiveStatus;
