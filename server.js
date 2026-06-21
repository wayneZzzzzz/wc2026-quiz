const express = require('express');
const session = require('express-session');
const path = require('path');
const initSqlJs = require('sql.js');
const { createWrapper, initDb } = require('./database');
const getDb = require('./lib/init-db');
const { FLAGS, OPTION_TIPS, fmtBJ, fmtET, resolveLabel } = require('./lib/helpers');
const ALL_TEAMS = Object.keys(FLAGS); // 48支参赛队
const importMatches = require('./scripts/import-matches');
const updateOdds    = require('./scripts/update-odds');
const updateScores  = require('./scripts/update-scores');

const app = express();
const PORT = process.env.PORT || 3000;
const ODDS_UPDATE_INTERVAL = 2 * 24 * 60 * 60 * 1000; // 每2天更新一次，节省API额度

// SSE 广播
const sseClients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) {
    try { c.write(msg); } catch {}
  }
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'wc2026-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// 全局模板变量
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.isAdmin = req.session.isAdmin || false;
  res.locals.flag = name => FLAGS[name] || '';
  res.locals.tip = label => OPTION_TIPS[label] || '';
  res.locals.fmtBJ = fmtBJ;
  res.locals.fmtET = fmtET;
  // 将通用标签（强队/弱队）替换为实际队名
  res.locals.rl = (label, match) =>
    resolveLabel(label, match.home_team, match.away_team, match.handicap_desc);
  next();
});

// SSE 端点
app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

initSqlJs().then(async SQL => {
  await initDb(SQL);
  const db = createWrapper();
  getDb.setDb(db);

  app.use('/', require('./routes/auth')(db));
  app.use('/matches', require('./routes/matches')(db));
  app.use('/votes', require('./routes/votes')(db, broadcast));
  app.use('/admin', require('./routes/admin')(db));

  app.get('/leaderboard', (req, res) => {
    const users = db.prepare('SELECT * FROM users ORDER BY total_points DESC, wins DESC').all();
    const eliminated = db.prepare('SELECT team FROM eliminated_teams').all().map(r => r.team);
    res.render('leaderboard', { title: '排行榜', users, eliminated });
  });

  // 积分走势图数据：按比赛时间排序，每个用户的累积积分
  app.get('/leaderboard/chart-data', (req, res) => {
    const users = db.prepare('SELECT id, nickname, predicted_champion FROM users').all();
    // 按比赛时间排序的积分记录（用 match_time 而非 created_at，更贴近赛事进度）
    const logs = db.prepare(`
      SELECT pl.user_id, pl.points, m.match_time, m.home_team, m.away_team
      FROM point_logs pl
      JOIN matches m ON pl.match_id = m.id
      ORDER BY m.match_time ASC, pl.user_id ASC
    `).all();

    if (logs.length === 0) return res.json({ labels: [], datasets: [] });

    // 收集所有出现的比赛时间点（去重，保持排序）
    const timeSet = [];
    const seen = new Set();
    for (const l of logs) {
      const key = l.match_time;
      if (!seen.has(key)) { seen.add(key); timeSet.push(key); }
    }

    // FT 风格配色（参考 Financial Times 图表色板）
    const COLORS = [
      '#990F3D','#0F5499','#00994D','#F4AF0D','#593380',
      '#FF7FAB','#00A0DD','#00BAD2','#FF8833','#006D9C',
      '#007B5E','#C3120C','#7B4F00','#0C6F5A','#8B1ACA',
    ];

    const { FLAGS: FT_FLAGS } = require('./lib/helpers');

    const datasets = users.map((u, i) => {
      const userLogs = logs.filter(l => l.user_id === u.id);
      if (userLogs.length === 0) return null;

      let running = 0;
      const logByTime = {};
      for (const l of userLogs) logByTime[l.match_time] = (logByTime[l.match_time] || 0) + l.points;

      const data = [];
      for (const t of timeSet) {
        if (logByTime[t] !== undefined) running += logByTime[t];
        data.push(running);
      }

      const color = COLORS[i % COLORS.length];
      const flag = u.predicted_champion ? (FT_FLAGS[u.predicted_champion] || '') : '';
      const isCurrentUser = req.session.user ? req.session.user.id === u.id : false;
      return { label: u.nickname, flag, isCurrentUser, data,
               borderColor: color, backgroundColor: color + '18',
               tension: 0.3, pointRadius: 0, pointHoverRadius: 4, borderWidth: 2 };
    }).filter(Boolean);

    const labels = timeSet.map(t => {
      const d = new Date(t.replace(' ', 'T') + ':00Z');
      const date = d.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' });
      const time = d.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false });
      return `${date} ${time}`;
    });

    res.json({ labels, datasets });
  });

  // 冠军预测选择页
  app.get('/pick-champion', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.render('pick-champion', { title: '预测冠军', teams: ALL_TEAMS });
  });

  app.post('/pick-champion', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const { champion } = req.body;
    if (champion && champion.trim()) {
      db.prepare('UPDATE users SET predicted_champion=? WHERE id=?').run(champion.trim(), req.session.user.id);
      // 立即强制同步 Gist，不等防抖（冠军选择是关键数据）
      const gist = require('./lib/gist-backup');
      if (gist.isEnabled()) {
        const { sqlDb } = require('./database');
        if (sqlDb) {
          try { await gist.upload(Buffer.from(sqlDb.export())); }
          catch(e) { console.warn('[冠军] Gist 同步失败:', e.message); }
        }
      }
    }
    res.redirect('/');
  });

  // 管理员：标记/取消淘汰队伍
  app.post('/admin/eliminate', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/admin/login');
    const { team, action } = req.body;
    if (action === 'add') {
      db.prepare('INSERT OR IGNORE INTO eliminated_teams (team) VALUES (?)').run(team);
    } else {
      db.prepare('DELETE FROM eliminated_teams WHERE team=?').run(team);
    }
    res.redirect('/admin');
  });

  app.listen(PORT, async () => {
    console.log(`\n⚽ 世界杯竞猜系统已启动！`);
    console.log(`🌐 本地地址: http://localhost:${PORT}`);
    console.log(`🔑 管理员密码: ${process.env.ADMIN_PASSWORD || 'admin2026'}`);
    console.log(`🔄 盘口更新: ${process.env.ODDS_API_KEY ? '每2天自动更新（已投票场次锁定不变）' : '未配置 ODDS_API_KEY'}\n`);

    await importMatches();
    await updateOdds();
    await updateScores();
    // 每2天更新盘口（节省API额度）；每小时检查赛果并自动结算（兜底）
    setInterval(updateOdds,   ODDS_UPDATE_INTERVAL);
    setInterval(updateScores, 60 * 60 * 1000);

    // 比赛结束后尽快抓取赛果：预估比赛耗时135分钟后开始检查，
    // 1分钟后首次尝试，若该场仍未结算则每2分钟重试，最多重试5次（约10分钟）
    function scheduleMatchScoreCheck(match) {
      const matchTime = new Date(match.match_time.replace(' ', 'T') + ':00Z');
      const estimatedEnd = matchTime.getTime() + 135 * 60 * 1000; // 预估135分钟结束
      const firstCheckAt = estimatedEnd + 1 * 60 * 1000; // 结束后1分钟
      const delay = firstCheckAt - Date.now();

      const attempt = (waitMs, retriesLeft) => {
        setTimeout(async () => {
          await updateScores();
          const m = db.prepare('SELECT status FROM matches WHERE id=?').get(match.id);
          if (m && m.status !== 'finished' && retriesLeft > 0) {
            attempt(2 * 60 * 1000, retriesLeft - 1);
          }
        }, Math.max(waitMs, 0));
      };
      attempt(delay, 5);
    }

    const pendingMatches = db.prepare(
      `SELECT id, match_time FROM matches WHERE status != 'finished'`
    ).all();
    pendingMatches.forEach(scheduleMatchScoreCheck);

    // Render 免费版防休眠：每 14 分钟 ping 自己
    if (process.env.RENDER_EXTERNAL_URL) {
      const https = require('https');
      setInterval(() => {
        https.get(process.env.RENDER_EXTERNAL_URL, r =>
          console.log(`[保活] ping ${r.statusCode}`)
        ).on('error', () => {});
      }, 14 * 60 * 1000);
      console.log(`🏓 Render 保活已启动: ${process.env.RENDER_EXTERNAL_URL}`);
    }
  });
}).catch(err => {
  console.error('初始化失败:', err);
  process.exit(1);
});

module.exports = { broadcast };
