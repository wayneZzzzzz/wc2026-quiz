const express = require('express');
const { doSettle } = require('../lib/settle');

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
    const eliminated = db.prepare('SELECT team FROM eliminated_teams').all().map(r => r.team);
    res.render('admin/dashboard', { title: '管理后台', matches, users, query: req.query, eliminated });
  });

  // ===== 手动刷新无投票比赛的盘口数据 =====
  router.post('/refresh-odds', requireAdmin, async (req, res) => {
    try {
      const updateOdds = require('../scripts/update-odds');
      const r = await updateOdds();
      if (r.error) {
        return res.redirect(`/admin?oddsRefreshed=err&oddsErrMsg=${encodeURIComponent(r.error)}`);
      }
      res.redirect(`/admin?oddsRefreshed=${r.updated}`);
    } catch (e) {
      console.error('[手动盘口刷新]', e.message);
      res.redirect(`/admin?oddsRefreshed=err&oddsErrMsg=${encodeURIComponent(e.message)}`);
    }
  });

  // ===== 手动触发赛果抓取与结算（用于排查/补漏）=====
  router.post('/check-scores', requireAdmin, async (req, res) => {
    try {
      const updateScores = require('../scripts/update-scores');
      const updated = await updateScores();
      res.redirect(`/admin?scoresChecked=${updated ?? 0}`);
    } catch (e) {
      console.error('[手动赛果检查]', e.message);
      res.redirect('/admin?scoresChecked=err');
    }
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
    const allUsers = db.prepare('SELECT * FROM users').all();
    const voterIds = new Set(votes.map(v => v.user_id));
    const nonVoters = allUsers.filter(u => !voterIds.has(u.id));
    res.render('admin/result', { title: '公布结果', match, votes, nonVoters, error: null });
  });

  router.post('/matches/:id/result', requireAdmin, (req, res) => {
    const { result, home_score, away_score, penalize_nonvoters } = req.body;
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
    if (!match) return res.redirect('/admin');
    if (match.status === 'finished') return res.redirect('/admin');

    const allVotes = db.prepare(`SELECT v.*, u.nickname FROM votes v JOIN users u ON v.user_id=u.id WHERE v.match_id=?`).all(match.id);
    if (!['a','b','c'].includes(result)) {
      return res.render('admin/result', { title:'公布结果', match, votes: allVotes, error:'请选择正确答案' });
    }

    const votes = db.prepare('SELECT * FROM votes WHERE match_id=?').all(match.id);
    const winners = votes.filter(v => v.choice === result);
    const losers  = votes.filter(v => v.choice !== result);

    // 未投票者：如勾选则纳入亏损池，扣 100 分但不计胜场
    // 处理未投票者（先插票再统一结算）
    const allUsers = db.prepare('SELECT * FROM users').all();
    const voterIds = new Set(votes.map(v => v.user_id));
    const nonVoters = penalize_nonvoters === '1'
      ? allUsers.filter(u => !voterIds.has(u.id)) : [];

    const hs = parseInt(home_score), as2 = parseInt(away_score);
    db.transaction(() => {
      // 先给未投票者插入投票记录（标记为"未投票"的随机错误选项）
      for (const u of nonVoters) {
        const wrongChoice = ['a','b','c'].find(c => c !== result) || 'b';
        db.prepare('INSERT OR IGNORE INTO votes (user_id,match_id,choice) VALUES (?,?,?)').run(u.id, match.id, wrongChoice);
        db.prepare('UPDATE users SET total_votes=total_votes+1 WHERE id=?').run(u.id);
      }
      db.prepare('UPDATE matches SET result=?,status=?,home_score=?,away_score=? WHERE id=?')
        .run(result, 'finished', isNaN(hs)?null:hs, isNaN(as2)?null:as2, match.id);
    })();

    doSettle(db, match.id);
    res.redirect('/admin');
  });

  // ===== 投票管理（添加/修改/删除任意用户的投票，含已完结比赛）=====
  router.get('/matches/:id/votes', requireAdmin, (req, res) => {
    const match = db.prepare('SELECT * FROM matches WHERE id=?').get(req.params.id);
    if (!match) return res.redirect('/admin');
    const allUsers = db.prepare('SELECT * FROM users ORDER BY nickname').all();
    const votes = db.prepare('SELECT * FROM votes WHERE match_id=?').all(match.id);
    const voteMap = {};
    votes.forEach(v => voteMap[v.user_id] = v.choice);
    // 已结算记录（用于显示哪些人已扣过分）
    const logMap = {};
    db.prepare('SELECT * FROM point_logs WHERE match_id=?').all(match.id)
      .forEach(l => logMap[l.user_id] = l.points);
    res.render('admin/votes', { title:'投票管理', match, allUsers, voteMap, logMap });
  });

  router.post('/matches/:id/votes/set', requireAdmin, (req, res) => {
    const { user_id, choice } = req.body;
    const match = db.prepare('SELECT * FROM matches WHERE id=?').get(req.params.id);
    if (!match) return res.redirect('/admin');
    if (!['a','b','c'].includes(choice)) return res.redirect(`/admin/matches/${req.params.id}/votes`);

    const existing = db.prepare('SELECT id FROM votes WHERE user_id=? AND match_id=?').get(user_id, match.id);

    if (match.status === 'finished') {
      // 已完结：只允许对未投票者补录，直接扣 100 分，不重新结算赢家
      if (existing) {
        // 已有投票只更新选项记录，不重新计分
        db.prepare('UPDATE votes SET choice=? WHERE user_id=? AND match_id=?').run(choice, user_id, match.id);
      } else {
        // 新增投票 → 视为猜错，扣 100 分
        db.transaction(() => {
          db.prepare('INSERT INTO votes (user_id,match_id,choice) VALUES (?,?,?)').run(user_id, match.id, choice);
          db.prepare('UPDATE users SET total_votes=total_votes+1, total_points=total_points-100 WHERE id=?').run(user_id);
          db.prepare('INSERT INTO point_logs (user_id,match_id,points,description) VALUES (?,?,?,?)').run(user_id, match.id, -100, '补录未投票，扣除 100 分');
        })();
      }
    } else {
      if (existing) {
        db.prepare('UPDATE votes SET choice=? WHERE user_id=? AND match_id=?').run(choice, user_id, match.id);
      } else {
        db.prepare('INSERT INTO votes (user_id,match_id,choice) VALUES (?,?,?)').run(user_id, match.id, choice);
        db.prepare('UPDATE users SET total_votes=total_votes+1 WHERE id=?').run(user_id);
      }
    }
    res.redirect(`/admin/matches/${req.params.id}/votes`);
  });

  // 按昵称补录（自动注册 + 投票）
  router.post('/matches/:id/votes/add-by-name', requireAdmin, (req, res) => {
    const { nickname, choice } = req.body;
    const match = db.prepare('SELECT * FROM matches WHERE id=?').get(req.params.id);
    if (!match) return res.redirect('/admin');
    if (!nickname?.trim() || !['a','b','c'].includes(choice))
      return res.redirect(`/admin/matches/${req.params.id}/votes`);

    const clean = nickname.trim().slice(0, 20);

    db.transaction(() => {
      // 找或创建用户
      let user = db.prepare('SELECT * FROM users WHERE nickname=?').get(clean);
      if (!user) {
        const r = db.prepare('INSERT INTO users (nickname) VALUES (?)').run(clean);
        user = db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid);
      }

      // 已投过就跳过
      const existing = db.prepare('SELECT id FROM votes WHERE user_id=? AND match_id=?').get(user.id, match.id);
      if (existing) return;

      db.prepare('INSERT INTO votes (user_id,match_id,choice) VALUES (?,?,?)').run(user.id, match.id, choice);
      db.prepare('UPDATE users SET total_votes=total_votes+1 WHERE id=?').run(user.id);

      if (match.status === 'finished') {
        // 已完结：直接扣 100 分
        db.prepare('UPDATE users SET total_points=total_points-100 WHERE id=?').run(user.id);
        db.prepare('INSERT INTO point_logs (user_id,match_id,points,description) VALUES (?,?,?,?)').run(user.id, match.id, -100, '补录未投票，扣除 100 分');
      }
    })();

    res.redirect(`/admin/matches/${req.params.id}/votes`);
  });

  router.post('/matches/:id/votes/delete', requireAdmin, (req, res) => {
    const { user_id } = req.body;
    const match = db.prepare('SELECT * FROM matches WHERE id=?').get(req.params.id);
    if (!match) return res.redirect('/admin');
    const existing = db.prepare('SELECT id FROM votes WHERE user_id=? AND match_id=?').get(user_id, req.params.id);
    if (existing) {
      db.transaction(() => {
        db.prepare('DELETE FROM votes WHERE user_id=? AND match_id=?').run(user_id, req.params.id);
        db.prepare('UPDATE users SET total_votes=MAX(0,total_votes-1) WHERE id=?').run(user_id);
        // 已完结比赛：同步撤销对应的积分记录
        if (match.status === 'finished') {
          const log = db.prepare('SELECT points FROM point_logs WHERE user_id=? AND match_id=?').get(user_id, req.params.id);
          if (log) {
            db.prepare('UPDATE users SET total_points=total_points-? WHERE id=?').run(log.points, user_id);
            if (log.points > 0) db.prepare('UPDATE users SET wins=MAX(0,wins-1) WHERE id=?').run(user_id);
            db.prepare('DELETE FROM point_logs WHERE user_id=? AND match_id=?').run(user_id, req.params.id);
          }
        }
      })();
    }
    res.redirect(`/admin/matches/${req.params.id}/votes`);
  });

  // ===== 重新结算（管理员补录投票后手动触发）=====
  router.post('/matches/:id/re-settle', requireAdmin, (req, res) => {
    const match = db.prepare('SELECT * FROM matches WHERE id=?').get(req.params.id);
    if (!match || match.status !== 'finished') return res.redirect('/admin');
    try {
      doSettle(db, match.id);
    } catch(e) {
      console.error('[重新结算]', e.message);
    }
    res.redirect(`/admin/matches/${req.params.id}/votes`);
  });

  // ===== 修改已完结比赛的比分和结果（管理员纠错窗口）=====
  router.get('/matches/:id/edit-result', requireAdmin, (req, res) => {
    const match = db.prepare('SELECT * FROM matches WHERE id=?').get(req.params.id);
    if (!match || match.status !== 'finished') return res.redirect('/admin');
    const votes = db.prepare(`SELECT v.*, u.nickname FROM votes v JOIN users u ON v.user_id=u.id WHERE v.match_id=?`).all(match.id);
    res.render('admin/edit-result', { title:'修改比赛结果', match, votes, error: null });
  });

  router.post('/matches/:id/edit-result', requireAdmin, (req, res) => {
    const { result, home_score, away_score } = req.body;
    const match = db.prepare('SELECT * FROM matches WHERE id=?').get(req.params.id);
    if (!match || match.status !== 'finished') return res.redirect('/admin');
    if (!['a','b','c'].includes(result)) {
      const votes = db.prepare(`SELECT v.*, u.nickname FROM votes v JOIN users u ON v.user_id=u.id WHERE v.match_id=?`).all(match.id);
      return res.render('admin/edit-result', { title:'修改比赛结果', match, votes, error:'请选择正确答案' });
    }
    const hs = parseInt(home_score), as2 = parseInt(away_score);
    db.prepare('UPDATE matches SET result=?,home_score=?,away_score=? WHERE id=?')
      .run(result, isNaN(hs)?match.home_score:hs, isNaN(as2)?match.away_score:as2, match.id);
    doSettle(db, match.id);
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

  // ===== 重置用户Pin码（用户忘记或需要管理员协助重置）=====
  router.post('/users/:id/reset-pin', requireAdmin, (req, res) => {
    db.prepare('UPDATE users SET pin=NULL WHERE id=?').run(req.params.id);
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
