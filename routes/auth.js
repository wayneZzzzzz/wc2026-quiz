const express = require('express');
const { lookupGeo } = require('../lib/geoip');
const { fmtBJFull } = require('../lib/helpers');

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || '';
}

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
    const eliminated = db.prepare('SELECT team FROM eliminated_teams').all().map(r => r.team);
    res.render('index', { title: '世界杯竞猜', upcomingMatches, finishedMatches, topUsers, eliminated });
  });

  router.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/');
    const existingUsers = db.prepare('SELECT nickname FROM users ORDER BY created_at ASC').all();
    res.render('login', { title: '加入竞猜', error: null, existingUsers });
  });

  // 供登录页在提交前异步检查：这台设备/IP 此前是否登录过其他账号
  // 同时按 IP 和设备cookie两个维度检测，设备cookie不随换网络/VPN变化，弥补纯IP比对的漏洞
  router.get('/login/check-conflict', (req, res) => {
    const nickname = (req.query.nickname || '').trim().slice(0, 20);
    if (!nickname) return res.json({ conflict: false });

    const ip = getClientIp(req);
    const deviceId = req.deviceId;

    const priorByIp = ip ? db.prepare('SELECT DISTINCT user_id FROM login_logs WHERE ip = ?').all(ip).map(r => r.user_id) : [];
    const priorByDevice = deviceId ? db.prepare('SELECT DISTINCT user_id FROM login_logs WHERE device_id = ?').all(deviceId).map(r => r.user_id) : [];
    const priorUserIds = [...new Set([...priorByIp, ...priorByDevice])];
    if (priorUserIds.length === 0) return res.json({ conflict: false });

    const target = db.prepare('SELECT id FROM users WHERE nickname = ?').get(nickname);
    const conflict = target
      ? priorUserIds.some(id => id !== target.id)
      : priorUserIds.length > 0; // 昵称不存在（将新建账号），但该设备/IP之前登录过其他账号

    if (!conflict) return res.json({ conflict: false });

    // 记录本次弹窗提醒，供后台在"活动记录"里查看该用户后续的选择
    const ua = req.headers['user-agent'] || '';
    const result = db.prepare(
      'INSERT INTO login_conflict_logs (nickname, ip, user_agent) VALUES (?, ?, ?)'
    ).run(nickname, ip, ua);

    res.json({ conflict: true, promptId: result.lastInsertRowid });
  });

  // 供登录页在用户对弹窗做出选择后回报结果（确认继续登录 / 取消）
  router.post('/login/check-conflict/:id/resolve', (req, res) => {
    const outcome = req.body.outcome === 'confirmed' ? 'confirmed' : 'cancelled';
    db.prepare('UPDATE login_conflict_logs SET outcome=? WHERE id=?').run(outcome, req.params.id);
    res.json({ ok: true });
  });

  router.post('/login', async (req, res) => {
    const { nickname, pin } = req.body;
    const existingUsers = db.prepare('SELECT nickname FROM users ORDER BY created_at ASC').all();
    if (!nickname || !nickname.trim()) {
      return res.render('login', { title: '加入竞猜', error: '请输入昵称', existingUsers });
    }
    const clean = nickname.trim().slice(0, 20);
    let user = db.prepare('SELECT * FROM users WHERE nickname = ?').get(clean);
    if (!user) {
      // 已停止新用户注册，仅允许现有成员登录
      return res.render('login', { title: '加入竞猜', error: '该昵称不存在，活动已停止新用户注册，仅限已有成员登录', existingUsers });
    }
    if (user.pin) {
      // 已设置Pin码的账号，登录必须验证Pin
      if (!pin || pin !== user.pin) {
        return res.render('login', { title: '加入竞猜', error: 'Pin码错误，请输入正确的4位Pin码', existingUsers });
      }
    }
    req.session.user = { id: user.id, nickname: user.nickname };

    // 取本账号上一次登录记录（用于登录后提示"上次登录时间/地点"），再写入本次登录
    const prevLogin = db.prepare(
      'SELECT * FROM login_logs WHERE user_id=? ORDER BY created_at DESC LIMIT 1'
    ).get(user.id);

    const ip = getClientIp(req);
    const ua = req.headers['user-agent'] || '';
    db.prepare('INSERT INTO login_logs (user_id, ip, user_agent, device_id) VALUES (?, ?, ?, ?)').run(user.id, ip, ua, req.deviceId || null);
    // 防止 server.js 的活动节流中间件在紧接着的跳转请求上重复记录一条几乎同时的日志
    req.session.lastActivityLoggedAt = Date.now();

    if (prevLogin) {
      const location = await lookupGeo(prevLogin.ip);
      req.session.showLastLogin = {
        time: fmtBJFull(prevLogin.created_at),
        location: location || (prevLogin.ip || '未知'),
      };
    }

    // 未设置Pin码 → 每次登录提醒设置；已设置 → 跳过
    if (!user.pin) {
      return res.redirect('/set-pin');
    }
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
