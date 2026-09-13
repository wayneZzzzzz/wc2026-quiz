# 世界杯竞猜 2026 (wc2026-quiz)

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

```bash
npm install
npm start                      # http://localhost:3000
npm run dev                    # nodemon 热重载
node scripts/update-odds.js    # 拉取盘口，需 ODDS_API_KEY
node scripts/update-scores.js  # 拉取赛果，需 ODDS_API_KEY
```

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
