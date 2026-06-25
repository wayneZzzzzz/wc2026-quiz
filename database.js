const fs = require('fs');
const path = require('path');

const DB_DIR = process.env.DB_DIR || __dirname;
const DB_PATH = path.join(DB_DIR, 'worldcup.db.bin');

let SQL, sqlDb;
let inTransaction = false;

// Gist 备份：有磁盘时仅本地存，没有磁盘时同步到 Gist
const gist = require('./lib/gist-backup');

// 上传防抖：10 秒内多次写入只触发一次上传
let uploadTimer = null;
function scheduleUpload() {
  if (!gist.isEnabled()) return;
  if (uploadTimer) clearTimeout(uploadTimer);
  uploadTimer = setTimeout(async () => {
    try {
      const data = sqlDb.export();
      await gist.upload(Buffer.from(data));
    } catch(e) { console.warn('[Gist] 定时上传失败:', e.message); }
  }, 10 * 1000); // 最后一次写入 10 秒后上传
}

function save() {
  if (inTransaction) return;
  const data = sqlDb.export();
  // 如果有本地磁盘就写本地
  try { fs.writeFileSync(DB_PATH, Buffer.from(data)); } catch(_) {}
  // 无论是否有磁盘，只要配了 Gist 就备份
  scheduleUpload();
}

function createWrapper() {
  return {
    prepare(sql) {
      return {
        all(...params) {
          const flat = params.flat();
          const stmt = sqlDb.prepare(sql);
          if (flat.length) stmt.bind(flat);
          const rows = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          stmt.free();
          return rows;
        },
        get(...params) {
          const flat = params.flat();
          const stmt = sqlDb.prepare(sql);
          if (flat.length) stmt.bind(flat);
          let row = null;
          if (stmt.step()) row = stmt.getAsObject();
          stmt.free();
          return row;
        },
        run(...params) {
          const flat = params.flat();
          sqlDb.run(sql, flat.length ? flat : undefined);
          const idRes = sqlDb.exec('SELECT last_insert_rowid()');
          const chRes = sqlDb.exec('SELECT changes()');
          save();
          return {
            lastInsertRowid: idRes[0]?.values[0][0] ?? null,
            changes: chRes[0]?.values[0][0] ?? 0,
          };
        },
      };
    },
    exec(sql) {
      sqlDb.run(sql);
      save();
    },
    transaction(fn) {
      return function(...args) {
        sqlDb.run('BEGIN');
        inTransaction = true;
        try {
          const result = fn(...args);
          sqlDb.run('COMMIT');
          inTransaction = false;
          save(); // 事务提交后统一落盘 + 触发 Gist 备份
          return result;
        } catch (e) {
          inTransaction = false;
          try { sqlDb.run('ROLLBACK'); } catch (_) {}
          throw e;
        }
      };
    },
  };
}

async function initDb(SqlLib) {
  SQL = SqlLib;
  gist.loadLocalGistId();

  // 启动时恢复数据库：优先本地磁盘 → Gist → 全新
  let dbBuffer = null;
  if (fs.existsSync(DB_PATH)) {
    dbBuffer = fs.readFileSync(DB_PATH);
    console.log(`[DB] 从本地磁盘加载 (${(dbBuffer.length/1024).toFixed(1)} KB)`);
  } else if (gist.isEnabled()) {
    console.log('[DB] 本地无数据，尝试从 Gist 恢复...');
    dbBuffer = await gist.download();
    if (dbBuffer) {
      console.log(`[DB] ✅ 从 Gist 恢复成功 (${(dbBuffer.length/1024).toFixed(1)} KB)`);
      try { fs.writeFileSync(DB_PATH, dbBuffer); } catch(_) {}
    } else {
      console.log('[DB] Gist 无备份，创建新数据库');
    }
  }

  sqlDb = dbBuffer ? new SQL.Database(dbBuffer) : new SQL.Database();

  sqlDb.run(`PRAGMA foreign_keys = ON`);

  sqlDb.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT UNIQUE NOT NULL,
    total_points INTEGER DEFAULT 0, wins INTEGER DEFAULT 0,
    total_votes INTEGER DEFAULT 0,
    predicted_champion TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // 迁移：加冠军预测字段
  try { sqlDb.run('ALTER TABLE users ADD COLUMN predicted_champion TEXT DEFAULT NULL'); } catch(e) {}
  // 迁移：加Pin码字段（防止冒用他人账号）
  try { sqlDb.run('ALTER TABLE users ADD COLUMN pin TEXT DEFAULT NULL'); } catch(e) {}
  // 迁移：淘汰队伍表
  sqlDb.run(`CREATE TABLE IF NOT EXISTS eliminated_teams (
    team TEXT PRIMARY KEY,
    eliminated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  sqlDb.run(`CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    home_team TEXT NOT NULL, away_team TEXT NOT NULL,
    match_time DATETIME NOT NULL, stage TEXT NOT NULL,
    handicap_desc TEXT NOT NULL,
    option_a TEXT NOT NULL, option_b TEXT NOT NULL, option_c TEXT NOT NULL,
    result TEXT, home_score INTEGER, away_score INTEGER,
    status TEXT DEFAULT 'upcoming',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  // 迁移：加比分字段（必须在 CREATE TABLE 之后，ALTER TABLE 对新建表无意义但无害）
  try { sqlDb.run('ALTER TABLE matches ADD COLUMN home_score INTEGER'); } catch(e) {}
  try { sqlDb.run('ALTER TABLE matches ADD COLUMN away_score INTEGER'); } catch(e) {}
  // 迁移：盘口手动调整标记（手动调整过的盘口，自动抓取不再覆盖）
  try { sqlDb.run('ALTER TABLE matches ADD COLUMN manual_odds INTEGER DEFAULT 0'); } catch(e) {}
  // 迁移：修正比赛时间（所有 UPDATE 必须在 CREATE TABLE 之后，否则空库启动时会 crash）
  // 苏格兰vs摩洛哥（原19:00 UTC有误，应为22:00 UTC）
  sqlDb.run(`UPDATE matches SET match_time='2026-06-19 22:00' WHERE home_team='苏格兰' AND away_team='摩洛哥' AND match_time='2026-06-19 19:00'`);
  // 巴西vs海地（原01:00 UTC有误，应为00:30 UTC，官方8:30PM ET，FOX/Yahoo双源确认）
  sqlDb.run(`UPDATE matches SET match_time='2026-06-20 00:30' WHERE home_team='巴西' AND away_team='海地' AND match_time='2026-06-20 01:00'`);
  // 土耳其vs巴拉圭（原04:00 UTC有误，应为03:00 UTC，11PM ET，ESPN/Wikipedia双源确认）
  sqlDb.run(`UPDATE matches SET match_time='2026-06-20 03:00' WHERE home_team='土耳其' AND away_team='巴拉圭' AND match_time='2026-06-20 04:00'`);
  // 各组第3轮共24场（参照ESPN/Yahoo官方ET→UTC重算）
  // A组 (Jun 24 9PM ET = Jun 25 01:00 UTC)
  sqlDb.run(`UPDATE matches SET match_time='2026-06-25 01:00' WHERE home_team='南非' AND away_team='韩国' AND match_time='2026-06-23 00:00'`);
  sqlDb.run(`UPDATE matches SET match_time='2026-06-25 01:00' WHERE home_team='捷克' AND away_team='墨西哥' AND match_time='2026-06-23 00:00'`);
  // B组 (Jun 24 3PM ET = Jun 24 19:00 UTC)
  sqlDb.run(`UPDATE matches SET match_time='2026-06-24 19:00' WHERE home_team='波黑' AND away_team='卡塔尔' AND match_time='2026-06-23 21:00'`);
  sqlDb.run(`UPDATE matches SET match_time='2026-06-24 19:00' WHERE home_team='瑞士' AND away_team='加拿大' AND match_time='2026-06-23 21:00'`);
  // C组 (Jun 24 6PM ET = Jun 24 22:00 UTC)
  sqlDb.run(`UPDATE matches SET match_time='2026-06-24 22:00' WHERE home_team='摩洛哥' AND away_team='海地' AND match_time='2026-06-24 00:00'`);
  sqlDb.run(`UPDATE matches SET match_time='2026-06-24 22:00' WHERE home_team='苏格兰' AND away_team='巴西' AND match_time='2026-06-24 00:00'`);
  // D组 (Jun 25 10PM ET = Jun 26 02:00 UTC)
  sqlDb.run(`UPDATE matches SET match_time='2026-06-26 02:00' WHERE home_team='澳大利亚' AND away_team='巴拉圭' AND match_time='2026-06-24 21:00'`);
  sqlDb.run(`UPDATE matches SET match_time='2026-06-26 02:00' WHERE home_team='土耳其' AND away_team='美国' AND match_time='2026-06-24 21:00'`);
  // E组 (Jun 25 4PM ET = Jun 25 20:00 UTC)
  sqlDb.run(`UPDATE matches SET match_time='2026-06-25 20:00' WHERE home_team='科特迪瓦' AND away_team='库拉索' AND match_time='2026-06-25 00:00'`);
  sqlDb.run(`UPDATE matches SET match_time='2026-06-25 20:00' WHERE home_team='厄瓜多尔' AND away_team='德国' AND match_time='2026-06-25 00:00'`);
  // F组 (Jun 25 7PM ET = Jun 25 23:00 UTC)
  sqlDb.run(`UPDATE matches SET match_time='2026-06-25 23:00' WHERE home_team='日本' AND away_team='瑞典' AND match_time='2026-06-25 03:00'`);
  sqlDb.run(`UPDATE matches SET match_time='2026-06-25 23:00' WHERE home_team='突尼斯' AND away_team='荷兰' AND match_time='2026-06-25 03:00'`);
  // G组 (Jun 26 11PM ET = Jun 27 03:00 UTC)
  sqlDb.run(`UPDATE matches SET match_time='2026-06-27 03:00' WHERE home_team='埃及' AND away_team='伊朗' AND match_time='2026-06-25 22:00'`);
  sqlDb.run(`UPDATE matches SET match_time='2026-06-27 03:00' WHERE home_team='新西兰' AND away_team='比利时' AND match_time='2026-06-25 22:00'`);
  // H组 (Jun 26 8PM ET = Jun 27 00:00 UTC)
  sqlDb.run(`UPDATE matches SET match_time='2026-06-27 00:00' WHERE home_team='佛得角' AND away_team='沙特阿拉伯' AND match_time='2026-06-25 18:00'`);
  sqlDb.run(`UPDATE matches SET match_time='2026-06-27 00:00' WHERE home_team='乌拉圭' AND away_team='西班牙' AND match_time='2026-06-25 18:00'`);
  // I组 (Jun 26 3PM ET = Jun 26 19:00 UTC)
  sqlDb.run(`UPDATE matches SET match_time='2026-06-26 19:00' WHERE home_team='塞内加尔' AND away_team='伊拉克' AND match_time='2026-06-26 21:00'`);
  sqlDb.run(`UPDATE matches SET match_time='2026-06-26 19:00' WHERE home_team='挪威' AND away_team='法国' AND match_time='2026-06-26 21:00'`);
  // J组 (Jun 27 10PM ET = Jun 28 02:00 UTC)
  sqlDb.run(`UPDATE matches SET match_time='2026-06-28 02:00' WHERE home_team='阿尔及利亚' AND away_team='奥地利' AND match_time='2026-06-26 18:00'`);
  sqlDb.run(`UPDATE matches SET match_time='2026-06-28 02:00' WHERE home_team='约旦' AND away_team='阿根廷' AND match_time='2026-06-26 18:00'`);
  // K组 (Jun 27 7:30PM ET = Jun 27 23:30 UTC)
  sqlDb.run(`UPDATE matches SET match_time='2026-06-27 23:30' WHERE home_team='刚果' AND away_team='乌兹别克斯坦' AND match_time='2026-06-27 20:00'`);
  sqlDb.run(`UPDATE matches SET match_time='2026-06-27 23:30' WHERE home_team='哥伦比亚' AND away_team='葡萄牙' AND match_time='2026-06-27 20:00'`);
  // L组 (Jun 27 5PM ET = Jun 27 21:00 UTC)
  sqlDb.run(`UPDATE matches SET match_time='2026-06-27 21:00' WHERE home_team='克罗地亚' AND away_team='加纳' AND match_time='2026-06-27 22:00'`);
  sqlDb.run(`UPDATE matches SET match_time='2026-06-27 21:00' WHERE home_team='巴拿马' AND away_team='英格兰' AND match_time='2026-06-27 22:00'`);

  sqlDb.run(`CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, match_id INTEGER NOT NULL,
    choice TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, match_id)
  )`);
  sqlDb.run(`CREATE TABLE IF NOT EXISTS point_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, match_id INTEGER NOT NULL,
    points INTEGER NOT NULL, description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  save();
}

const getDb = () => sqlDb; // 供外部立即获取当前 db 实例
module.exports = { createWrapper, initDb, get sqlDb() { return sqlDb; } };
