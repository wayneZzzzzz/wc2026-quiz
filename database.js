const fs = require('fs');
const path = require('path');

const DB_DIR = process.env.DB_DIR || __dirname;
const DB_PATH = path.join(DB_DIR, 'worldcup.db.bin');

let SQL, sqlDb;
let inTransaction = false; // 防止事务内 save() 触发隐式提交

function save() {
  if (inTransaction) return; // 事务进行中不落盘，等 COMMIT 后再存
  const data = sqlDb.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
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
          save(); // 事务中时此调用是 no-op
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
          save(); // 提交后统一落盘
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

function initDb(SqlLib) {
  SQL = SqlLib;
  if (fs.existsSync(DB_PATH)) {
    sqlDb = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    sqlDb = new SQL.Database();
  }

  sqlDb.run(`PRAGMA foreign_keys = ON`);
  // 迁移：为旧库加比分字段
  try { sqlDb.run('ALTER TABLE matches ADD COLUMN home_score INTEGER'); } catch(e) {}
  try { sqlDb.run('ALTER TABLE matches ADD COLUMN away_score INTEGER'); } catch(e) {}

  sqlDb.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT UNIQUE NOT NULL,
    total_points INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    total_votes INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
