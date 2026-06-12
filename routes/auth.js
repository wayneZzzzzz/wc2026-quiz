const express = require('express');

module.exports = function(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const { getEffectiveStatus } = require('./matches');
    let votedMatchIds = new Set();
    if (req.session.user) {
      const voted = db.prepare('SELECT match_id FROM votes WHERE user_id=?').all(req.session.user.id);
      votedMatchIds = new Set(voted.map(v => v.match_id));
    }
    const upcomingMatches = db.prepare(
      `SELECT * FROM matches WHERE status != 'finished' ORDER BY match_time ASC LIMIT 6`
    ).all().map(m => ({ ...m, effectiveStatus: getEffectiveStatus(m), userVoted: votedMatchIds.has(m.id) }));
    const finishedMatches = db.prepare(
      `SELECT * FROM matches WHERE status = 'finished' ORDER BY match_time DESC LIMIT 2`
    ).all();
    const topUsers = db.prepare(
      `SELECT * FROM users ORDER BY total_points DESC, wins DESC`
    ).all();
    res.render('index', { title: '世界杯竞猜', upcomingMatches, finishedMatches, topUsers });
  });

  router.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    const existingUsers = db.prepare('SELECT nickname FROM users ORDER BY created_at ASC').all();
    res.render('login', { title: '加入竞猜', error: null, existingUsers });
  });

  router.post('/login', (req, res) => {
    const { nickname } = req.body;
    if (!nickname || !nickname.trim()) {
      return res.render('login', { title: '加入竞猜', error: '请输入昵称' });
    }
    const clean = nickname.trim().slice(0, 20);
    let user = db.prepare('SELECT * FROM users WHERE nickname = ?').get(clean);
    const isNew = !user;
    if (!user) {
      const result = db.prepare('INSERT INTO users (nickname) VALUES (?)').run(clean);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    }
    req.session.user = { id: user.id, nickname: user.nickname };
    // 未选择冠军（包括跳过的用户）→ 每次登录提醒；已选择 → 直接进首页
    if (!user.predicted_champion) {
      return res.redirect('/pick-champion');
    }
    res.redirect('/');
  });

  router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
  });

  return router;
};
