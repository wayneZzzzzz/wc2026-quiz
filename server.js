const express = require('express');
const session = require('express-session');
const path = require('path');
const initSqlJs = require('sql.js');
const { createWrapper, initDb } = require('./database');
const getDb = require('./lib/init-db');
const { FLAGS, OPTION_TIPS, fmtBJ, fmtET } = require('./lib/helpers');
const importMatches = require('./scripts/import-matches');
const updateOdds = require('./scripts/update-odds');

const app = express();
const PORT = process.env.PORT || 3000;
const ODDS_UPDATE_INTERVAL = 60 * 60 * 1000;

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
  initDb(SQL);
  const db = createWrapper();
  getDb.setDb(db);

  app.use('/', require('./routes/auth')(db));
  app.use('/matches', require('./routes/matches')(db));
  app.use('/votes', require('./routes/votes')(db, broadcast));
  app.use('/admin', require('./routes/admin')(db));

  app.get('/leaderboard', (req, res) => {
    const users = db.prepare('SELECT * FROM users ORDER BY total_points DESC, wins DESC').all();
    res.render('leaderboard', { title: '排行榜', users });
  });

  app.listen(PORT, async () => {
    console.log(`\n⚽ 世界杯竞猜系统已启动！`);
    console.log(`🌐 本地地址: http://localhost:${PORT}`);
    console.log(`🔑 管理员密码: ${process.env.ADMIN_PASSWORD || 'admin2026'}`);
    console.log(`🔄 盘口更新: ${process.env.ODDS_API_KEY ? '每小时自动更新' : '未配置 ODDS_API_KEY'}\n`);

    await importMatches();
    await updateOdds();
    setInterval(updateOdds, ODDS_UPDATE_INTERVAL);
  });
}).catch(err => {
  console.error('初始化失败:', err);
  process.exit(1);
});

module.exports = { broadcast };
