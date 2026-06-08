const fs = require('fs');
const path = require('path');

// Railway/Render 挂载磁盘后设置 DB_DIR 环境变量指向持久化目录
const DB_DIR = process.env.DB_DIR || __dirname;
const DB_PATH = path.join(DB_DIR, 'worldcup.db.bin');

let SQL, sqlDb;

function save() {
  const data = sqlDb.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Synchronous-looking wrapper matching better-sqlite3 API
function createWrapper() {
  return {
    prepare(sql) {
      return {
        all(...params) {
          const flat = params.flat();
          const stmt = sqlDb.prepare(sql);
          stmt.bind(flat.length ? flat : []);
          const cols = stmt.getColumnNames();
          const rows = [];
          while (stmt.step()) {
            const row = stmt.getAsObject();
            rows.push(row);
          }
          stmt.free();
          return rows;
        },
        get(...params) {
          const flat = params.flat();
          const stmt = sqlDb.prepare(sql);
          stmt.bind(flat.length ? flat : []);
          const cols = stmt.getColumnNames();
          let row = null;
          if (stmt.step()) row = stmt.getAsObject();
          stmt.free();
          return row;
        },
        run(...params) {
          const flat = params.flat();
          sqlDb.run(sql, flat.length ? flat : []);
          const idRows = sqlDb.exec('SELECT last_insert_rowid() as id');
          const chRows = sqlDb.exec('SELECT changes() as c');
          save();
          return {
            lastInsertRowid: idRows[0] ? idRows[0].values[0][0] : null,
            changes: chRows[0] ? chRows[0].values[0][0] : 0
          };
        }
      };
    },
    exec(sql) {
      sqlDb.run(sql);
      save();
    },
    transaction(fn) {
      return function(...args) {
        sqlDb.run('BEGIN');
        try {
          const result = fn(...args);
          sqlDb.run('COMMIT');
          save();
          return result;
        } catch (e) {
          sqlDb.run('ROLLBACK');
          throw e;
        }
      };
    }
  };
}

function initDb(SqlLib) {
  SQL = SqlLib;
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    sqlDb = new SQL.Database(buf);
  } else {
    sqlDb = new SQL.Database();
  }

  sqlDb.run(`PRAGMA foreign_keys = ON`);
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT UNIQUE NOT NULL,
      total_points INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      total_votes INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      match_time DATETIME NOT NULL,
      stage TEXT NOT NULL,
      handicap_desc TEXT NOT NULL,
      option_a TEXT NOT NULL,
      option_b TEXT NOT NULL,
      option_c TEXT NOT NULL,
      result TEXT,
      status TEXT DEFAULT 'upcoming',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      match_id INTEGER NOT NULL,
      choice TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, match_id)
    )
  `);
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS point_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      match_id INTEGER NOT NULL,
      points INTEGER NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  save();
}

module.exports = { createWrapper, initDb };
