# 世界杯竞猜 2026 (wc2026-quiz)

> **项目状态：已结束（归档）。** 赛事已完赛，不再开发新功能、不再部署。
> 本仓库仅作代码留存，数据以 `scripts/export-archive.js` 导出的存档为准。
> 如需改动，请先确认这不是应该开在其他项目里的工作。

## 项目边界

本仓库是一个**独立项目**，与 `wiseinsur`、`archery`、`金融分析网页` 是**四个平行项目，互不隶属、互不依赖**。

在本仓库的会话中：

- 只读写本仓库目录内的文件。需要看别的项目，请**另开一个会话**，并在那个项目的根目录下启动（`cd <该项目根目录> && claude`）。
- 不要把其他项目的路径、端口、依赖、测试命令写进本仓库的任何文件（包括 `.claude/` 下的配置）。
- 不要在本仓库里引用 `/Users/<user>/insurtech-platform`、`archery`、金融分析等兄弟项目的绝对路径。

> 会话的"项目身份"由**启动时的工作目录**决定。在竞猜目录下启动会话再去改别的项目，会把那个项目的权限、历史和上下文全部记到竞猜名下——这正是四个项目互相纠缠的原因。

## 技术栈

- Node.js >= 18，Express 4 + EJS 模板，无构建步骤
- 数据库：`sql.js`（SQLite 编译成 wasm），持久化文件 `worldcup.db.bin`（已 gitignore）
- 部署：Railway (`railway.json`) / Render (`render.yaml`)

## 目录

| 路径 | 职责 |
|------|------|
| `server.js` | 应用入口、中间件、图表数据接口 |
| `database.js` | 全部 SQL 与数据访问层 |
| `routes/` | `admin` `auth` `matches` `votes` 四组路由 |
| `lib/` | `settle`(结算) `geoip` `gist-backup` `init-db` `helpers` |
| `scripts/` | `update-odds` `update-scores` `import-matches` 三个离线脚本 |
| `views/` | EJS 模板 |

## 常用命令

归档后唯一还需要用到的命令：

```bash
npm install
node scripts/export-archive.js   # 导出全部数据到 archive/（只读，不改数据库）
```

以下为项目运行期命令，已停用，仅供追溯：

```bash
npm start                      # http://localhost:3000
npm run dev                    # nodemon 热重载
node scripts/update-odds.js    # 拉取盘口，需 ODDS_API_KEY
node scripts/update-scores.js  # 拉取赛果，需 ODDS_API_KEY
```

## 数据存档

数据库文件 `worldcup.db.bin` **不在仓库内**（已 gitignore），只存在于本机与线上实例。
项目下线前必须跑一次 `node scripts/export-archive.js`，产出：

- `archive/*.csv` — 每表一个，Excel 可直接打开
- `archive/all-tables.json` — 全量 JSON
- `archive/worldcup.sqlite` — SQLite 文件，任意工具可读

`users.pin` 在三种格式中均已脱敏；`login_logs` 含参与者 IP，属个人信息。
`archive/` 已 gitignore，**不要提交**，请另行妥善保存。

## 环境变量

| 变量 | 用途 |
|------|------|
| `ADMIN_PASSWORD` | 管理后台密码，默认 `admin2026` |
| `ODDS_API_KEY` | the-odds-api.com 的 key，用于盘口/赛果抓取 |
| `PORT` | 监听端口，默认 3000 |

**绝不把上述任何值写进仓库文件**（`.env` 已 gitignore；`.claude/settings.local.json` 也已 gitignore）。

## 约定

- 提交信息用中文，`feat:` / `fix:` 前缀。
- 积分规则改动必须同步 `lib/settle.js` 与 `README.md`，两边口径要一致。
