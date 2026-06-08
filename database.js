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
  // 迁移：加比分字段
  try { sqlDb.run('ALTER TABLE matches ADD COLUMN home_score INTEGER'); } catch(e) {}
  try { sqlDb.run('ALTER TABLE matches ADD COLUMN away_score INTEGER'); } catch(e) {}

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

module.exports = { createWrapper, initDb };
