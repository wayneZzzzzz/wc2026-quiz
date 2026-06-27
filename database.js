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
  // 迁移：虚拟投票次数（每人总共6次，不想选某场时使用，不计入积分结算）
  try { sqlDb.run('ALTER TABLE users ADD COLUMN virtual_votes_left INTEGER DEFAULT 6'); } catch(e) {}
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

  // 迁移：导入已确定的32强赛对阵及盘口（仅对已有数据的现有库追加，全新空库由 importMatches() 统一处理，避免误判"已有数据"跳过小组赛导入）
  const existingMatchCount = sqlDb.exec('SELECT COUNT(*) as n FROM matches');
  const hasExistingMatches = existingMatchCount.length > 0 && existingMatchCount[0].values[0][0] > 0;
  const ROUND_OF_32_SEED = hasExistingMatches ? [
    { home:'南非', away:'加拿大', time:'2026-06-28 19:00',
      desc:'加拿大让0.5球', a:'加拿大赢球', b:'平局', c:'南非赢球' },
    { home:'巴西', away:'日本', time:'2026-06-29 17:00',
      desc:'巴西让0.5球', a:'巴西赢球', b:'平局', c:'日本赢球' },
    { home:'德国', away:'巴拉圭', time:'2026-06-29 20:30',
      desc:'德国让1.5球', a:'德国赢2球及以上', b:'德国赢1球', c:'平局或巴拉圭赢球' },
    { home:'荷兰', away:'摩洛哥', time:'2026-06-30 01:00',
      desc:'荷兰让0.5球', a:'荷兰赢球', b:'平局', c:'摩洛哥赢球' },
    { home:'科特迪瓦', away:'挪威', time:'2026-06-30 17:00',
      desc:'挪威让0.5球', a:'挪威赢球', b:'平局', c:'科特迪瓦赢球' },
    { home:'法国', away:'瑞典', time:'2026-06-30 21:00',
      desc:'法国让1.5球', a:'法国赢2球及以上', b:'法国赢1球', c:'平局或瑞典赢球' },
    { home:'美国', away:'波黑', time:'2026-07-02 00:00',
      desc:'美国让1.5球', a:'美国赢2球及以上', b:'美国赢1球', c:'平局或波黑赢球' },
    { home:'阿根廷', away:'佛得角', time:'2026-07-03 22:00',
      desc:'阿根廷让2球', a:'阿根廷赢3球及以上', b:'阿根廷赢2球', c:'阿根廷赢1球以内、平局或佛得角赢球' },
  ] : [];
  for (const m of ROUND_OF_32_SEED) {
    const exists = sqlDb.exec(`SELECT id FROM matches WHERE home_team='${m.home}' AND away_team='${m.away}' AND stage='32强'`);
    if (exists.length === 0 || exists[0].values.length === 0) {
      sqlDb.run(
        `INSERT INTO matches (home_team, away_team, match_time, stage, handicap_desc, option_a, option_b, option_c, status)
         VALUES (?, ?, ?, '32强', ?, ?, ?, ?, 'upcoming')`,
        [m.home, m.away, m.time, m.desc, m.a, m.b, m.c]
      );
    }
  }

  sqlDb.run(`CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, match_id INTEGER NOT NULL,
    choice TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, match_id)
  )`);
  // 迁移：虚拟投票标记（只记录选项，不参与积分结算）
  try { sqlDb.run('ALTER TABLE votes ADD COLUMN is_virtual INTEGER DEFAULT 0'); } catch(e) {}
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
