const express = require('express');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin2026';

module.exports = function(db) {
  const router = express.Router();

  function requireAdmin(req, res, next) {
    if (!req.session.isAdmin) return res.redirect('/admin/login');
    next();
  }

  router.get('/login', (req, res) => {
    if (req.session.isAdmin) return res.redirect('/admin');
    res.render('admin/login', { title: '管理员登录', error: null });
  });

  router.post('/login', (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) {
      req.session.isAdmin = true;
      return res.redirect('/admin');
    }
    res.render('admin/login', { title: '管理员登录', error: '密码错误' });
  });

  router.get('/logout', (req, res) => {
    req.session.isAdmin = false;
    res.redirect('/');
  });

  router.get('/', requireAdmin, (req, res) => {
    const matches = db.prepare('SELECT * FROM matches ORDER BY match_time ASC').all();
    const users = db.prepare('SELECT * FROM users ORDER BY total_points DESC').all();
    res.render('admin/dashboard', { title: '管理后台', matches, users, query: req.query });
  });

  router.get('/matches/new', requireAdmin, (req, res) => {
    res.render('admin/create-match', { title: '添加比赛', match: null, error: null });
  });

  router.post('/matches', requireAdmin, (req, res) => {
    const { home_team, away_team, match_time, stage, handicap_desc, option_a, option_b, option_c } = req.body;
    if (!home_team || !away_team || !match_time || !stage || !handicap_desc || !option_a || !option_b || !option_c) {
      return res.render('admin/create-match', { title: '添加比赛', match: req.body, error: '所有字段均为必填' });
    }
    db.prepare(`
      INSERT INTO matches (home_team, away_team, match_time, stage, handicap_desc, option_a, option_b, option_c)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(home_team, away_team, match_time, stage, handicap_desc, option_a, option_b, option_c);
    res.redirect('/admin');
  });

  router.get('/matches/:id/edit', requireAdmin, (req, res) => {
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
    if (!match) return res.redirect('/admin');
    res.render('admin/create-match', { title: '编辑比赛', match, error: null });
  });

  router.post('/matches/:id/edit', requireAdmin, (req, res) => {
    const { home_team, away_team, match_time, stage, handicap_desc, option_a, option_b, option_c } = req.body;
    db.prepare(`
      UPDATE matches SET home_team=?, away_team=?, match_time=?, stage=?, handicap_desc=?, option_a=?, option_b=?, option_c=?
      WHERE id=?
    `).run(home_team, away_team, match_time, stage, handicap_desc, option_a, option_b, option_c, req.params.id);
    res.redirect('/admin');
  });

  router.post('/matches/:id/status', requireAdmin, (req, res) => {
    const { status } = req.body;
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
    if (match && match.status !== 'finished') {
      db.prepare('UPDATE matches SET status = ? WHERE id = ?').run(status, req.params.id);
    }
    res.redirect('/admin');
  });

  router.get('/matches/:id/result', requireAdmin, (req, res) => {
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
    if (!match) return res.redirect('/admin');
    const votes = db.prepare(`
      SELECT v.id, v.user_id, v.match_id, v.choice, v.created_at, u.nickname
      FROM votes v JOIN users u ON v.user_id = u.id WHERE v.match_id = ?
    `).all(match.id);
    res.render('admin/result', { title: '公布结果', match, votes, error: null });
  });

  router.post('/matches/:id/result', requireAdmin, (req, res) => {
    const { result, home_score, away_score } = req.body;
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
    if (!match) return res.redirect('/admin');
    if (match.status === 'finished') return res.redirect('/admin');
    if (!['a', 'b', 'c'].includes(result)) {
      const votes = db.prepare(`SELECT v.*, u.nickname FROM votes v JOIN users u ON v.user_id = u.id WHERE v.match_id = ?`).all(match.id);
      return res.render('admin/result', { title: '公布结果', match, votes, error: '请选择正确答案' });
    }

    const votes = db.prepare('SELECT * FROM votes WHERE match_id = ?').all(match.id);
    const winners = votes.filter(v => v.choice === result);
    const losers = votes.filter(v => v.choice !== result);
    const totalLostPoints = losers.length * 100;
    const pointsPerWinner = winners.length > 0 ? Math.round(totalLostPoints / winners.length) : 0;

    const settle = db.transaction(() => {
      for (const w of winners) {
        db.prepare('UPDATE users SET total_points = total_points + ?, wins = wins + 1 WHERE id = ?').run(pointsPerWinner, w.user_id);
        db.prepare('INSERT INTO point_logs (user_id, match_id, points, description) VALUES (?, ?, ?, ?)').run(w.user_id, match.id, pointsPerWinner, `猜中！获得 ${pointsPerWinner} 分`);
      }
      for (const l of losers) {
        db.prepare('UPDATE users SET total_points = total_points - 100 WHERE id = ?').run(l.user_id);
        db.prepare('INSERT INTO point_logs (user_id, match_id, points, description) VALUES (?, ?, ?, ?)').run(l.user_id, match.id, -100, '未猜中，扣除 100 分');
      }
      const hs = parseInt(home_score);
      const as = parseInt(away_score);
      db.prepare('UPDATE matches SET result=?, status=?, home_score=?, away_score=? WHERE id=?')
        .run(result, 'finished', isNaN(hs) ? null : hs, isNaN(as) ? null : as, match.id);
    });

    settle();
    res.redirect('/admin');
  });

  router.post('/matches/:id/delete', requireAdmin, (req, res) => {
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
    if (match && match.status !== 'finished') {
      db.prepare('DELETE FROM votes WHERE match_id = ?').run(req.params.id);
      db.prepare('DELETE FROM matches WHERE id = ?').run(req.params.id);
    }
    res.redirect('/admin');
  });

  // ===== 用户管理 =====
  router.post('/users/:id/rename', requireAdmin, (req, res) => {
    const { nickname } = req.body;
    if (!nickname || !nickname.trim()) return res.redirect('/admin');
    const clean = nickname.trim().slice(0, 20);
    const existing = db.prepare('SELECT id FROM users WHERE nickname = ? AND id != ?').get(clean, req.params.id);
    if (existing) return res.redirect('/admin?user_error=' + encodeURIComponent('昵称已被占用'));
    db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(clean, req.params.id);
    res.redirect('/admin');
  });

  router.post('/users/:id/delete', requireAdmin, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.redirect('/admin');
    db.transaction(() => {
      // 删除该用户的投票，并退还已扣分给猜错但对方已删除的情况（简单处理：仅删记录）
      db.prepare('DELETE FROM votes WHERE user_id = ?').run(req.params.id);
      db.prepare('DELETE FROM point_logs WHERE user_id = ?').run(req.params.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    })();
    res.redirect('/admin');
  });

  router.post('/users/:id/reset-points', requireAdmin, (req, res) => {
    db.prepare('UPDATE users SET total_points = 0, wins = 0, total_votes = 0 WHERE id = ?').run(req.params.id);
    db.prepare('DELETE FROM point_logs WHERE user_id = ?').run(req.params.id);
    res.redirect('/admin');
  });

  // 清空所有测试数据（保留比赛和盘口）
  router.post('/reset-all', requireAdmin, (req, res) => {
    db.transaction(() => {
      db.prepare('DELETE FROM point_logs').run();
      db.prepare('DELETE FROM votes').run();
      db.prepare('DELETE FROM users').run();
      // 重置所有比赛状态为 upcoming，清除结果
      db.prepare("UPDATE matches SET result=NULL, status='upcoming'").run();
    })();
    res.redirect('/admin');
  });

  return router;
};
