#!/usr/bin/env node
// 存档导出：把 worldcup.db.bin 里的全部数据导成 CSV + JSON，供项目结束后长期备查。
// 只读，不修改数据库。
//
//   node scripts/export-archive.js [数据库路径] [输出目录]
//   默认： ./worldcup.db.bin  →  ./archive/
//
// 线上（Render free plan）磁盘是临时的，权威数据在 GitHub Gist 备份里，
// 本机的 worldcup.db.bin 可能是旧的。从 Gist 取最新的一份：
//
//   GIST_TOKEN=xxx GIST_ID=xxx node scripts/export-archive.js --from-gist
//   （GIST_ID 也可放在仓库根目录的 .gist_id 文件里）

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const args = process.argv.slice(2);
const FROM_GIST = args.includes('--from-gist');
const positional = args.filter(a => !a.startsWith('--'));
const DB_PATH = positional[0] || path.join(__dirname, '..', 'worldcup.db.bin');
const OUT_DIR = positional[1] || path.join(__dirname, '..', 'archive');

// 敏感字段：导出时脱敏，存档不需要它们的原值
const MASK = { users: ['pin'] };

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// 取出数据库字节：优先 Gist（线上权威副本），否则读本地文件
async function loadBuffer() {
  if (FROM_GIST) {
    const gist = require('../lib/gist-backup');
    gist.loadLocalGistId();
    if (!gist.isEnabled()) {
      console.error('未设置 GIST_TOKEN，无法从 Gist 拉取。');
      process.exit(1);
    }
    const buf = await gist.download();
    if (!buf) {
      console.error('从 Gist 拉取失败：检查 GIST_TOKEN 权限与 GIST_ID（或根目录 .gist_id）是否正确。');
      process.exit(1);
    }
    console.log(`已从 Gist 取得数据库（${(buf.length / 1024).toFixed(1)} KB）`);
    return buf;
  }
  if (!fs.existsSync(DB_PATH)) {
    console.error(`找不到数据库文件：${DB_PATH}`);
    console.error('线上 Render free plan 磁盘为临时存储，权威数据在 Gist 备份中，改用：');
    console.error('  GIST_TOKEN=xxx GIST_ID=xxx node scripts/export-archive.js --from-gist');
    process.exit(1);
  }
  return fs.readFileSync(DB_PATH);
}

(async () => {
  const buffer = await loadBuffer();
  const SQL = await initSqlJs();
  const db = new SQL.Database(buffer);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const tables = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )[0]?.values.map(r => r[0]) || [];

  const all = {};
  const summary = [];

  for (const t of tables) {
    const res = db.exec(`SELECT * FROM "${t}"`)[0];
    const cols = res ? res.columns : [];
    const rows = res ? res.values : [];
    const masked = MASK[t] || [];
    const maskIdx = masked.map(c => cols.indexOf(c)).filter(i => i >= 0);

    const clean = rows.map(r =>
      r.map((v, i) => (maskIdx.includes(i) ? (v ? '***' : '') : v))
    );

    // CSV（带 BOM，Excel 直接打开中文不乱码）
    const csv = [cols.map(csvCell).join(','), ...clean.map(r => r.map(csvCell).join(','))].join('\n');
    fs.writeFileSync(path.join(OUT_DIR, `${t}.csv`), '﻿' + csv);

    all[t] = clean.map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
    summary.push({ table: t, rows: rows.length, masked });
  }

  fs.writeFileSync(path.join(OUT_DIR, 'all-tables.json'), JSON.stringify(all, null, 2));

  // SQLite 副本：与 CSV/JSON 口径一致，同样脱敏后再写出
  for (const [t, cols] of Object.entries(MASK)) {
    if (!tables.includes(t)) continue;
    for (const c of cols) {
      try { db.run(`UPDATE "${t}" SET "${c}" = '***' WHERE "${c}" IS NOT NULL AND "${c}" != ''`); } catch (_) {}
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'worldcup.sqlite'), Buffer.from(db.export()));

  fs.writeFileSync(path.join(OUT_DIR, 'README.md'),
`# 世界杯竞猜 2026 — 数据存档

导出时间：${new Date().toISOString()}
数据来源：${FROM_GIST ? 'GitHub Gist 线上备份（权威副本）' : path.resolve(DB_PATH) + '（本机文件，可能非最新）'}

| 表 | 行数 | 说明 |
|----|------|------|
${summary.map(s => `| ${s.table} | ${s.rows} | ${
  { users:'参与者与总积分', matches:'赛程、盘口与赛果', votes:'每人每场的投注',
    point_logs:'逐场积分流水', login_logs:'登录记录（含 IP / UA）',
    login_conflict_logs:'账号冲突提醒记录', eliminated_teams:'已淘汰球队' }[s.table] || ''
}${s.masked.length ? `（${s.masked.join('/')} 已脱敏）` : ''} |`).join('\n')}

## 文件

- \`*.csv\` — 每张表一个，UTF-8 带 BOM，Excel / Numbers 可直接打开
- \`all-tables.json\` — 全部数据的单一 JSON
- \`worldcup.sqlite\` — 原始 SQLite 文件，可用 DB Browser for SQLite 或 \`sqlite3\` 打开

## 注意

- \`users.pin\` 已脱敏为 \`***\`（存档不需要口令原值）。
- \`login_logs\` 含参与者 IP 与浏览器标识，属个人信息，请勿公开分享。
`);

  console.log(`存档已写入 ${path.resolve(OUT_DIR)}`);
  for (const s of summary) {
    console.log(`  ${s.table.padEnd(22)} ${String(s.rows).padStart(6)} 行${s.masked.length ? '  (已脱敏: ' + s.masked.join(',') + ')' : ''}`);
  }
  db.close();
})().catch(e => { console.error('导出失败：', e.message); process.exit(1); });
