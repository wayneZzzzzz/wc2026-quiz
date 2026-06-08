// 用 GitHub Gist 持久化数据库文件
// 环境变量：GIST_TOKEN（GitHub Personal Access Token，需要 gist 权限）
//           GIST_ID（第一次运行后自动写入，或手动创建后填入）

const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GIST_TOKEN;
const FILENAME = 'worldcup.db.b64';

let gistId = process.env.GIST_ID || null;

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': `token ${TOKEN}`,
        'User-Agent': 'wc2026-quiz',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Gist 请求超时')); });
    if (data) req.write(data);
    req.end();
  });
}

// 从 Gist 下载数据库，返回 Buffer 或 null
async function download() {
  if (!TOKEN || !gistId) return null;
  try {
    const res = await request('GET', `/gists/${gistId}`);
    if (res.status !== 200) return null;
    const content = res.body?.files?.[FILENAME]?.content;
    if (!content) return null;
    return Buffer.from(content, 'base64');
  } catch (e) {
    console.warn('[Gist] 下载失败:', e.message);
    return null;
  }
}

// 上传数据库到 Gist
async function upload(dbBuffer) {
  if (!TOKEN) return;
  const content = dbBuffer.toString('base64');
  try {
    if (gistId) {
      // 更新已有 Gist
      const res = await request('PATCH', `/gists/${gistId}`, {
        files: { [FILENAME]: { content } },
      });
      if (res.status === 200) {
        process.stdout.write('[Gist] ✓ 数据已备份\n');
      } else {
        console.warn('[Gist] 更新失败:', res.status);
      }
    } else {
      // 首次：创建私有 Gist
      const res = await request('POST', '/gists', {
        description: 'wc2026-quiz database backup',
        public: false,
        files: { [FILENAME]: { content } },
      });
      if (res.status === 201) {
        gistId = res.body.id;
        // 把 GIST_ID 写到本地文件备用
        const cfgPath = path.join(__dirname, '..', '.gist_id');
        fs.writeFileSync(cfgPath, gistId);
        console.log(`[Gist] ✅ 已创建数据库备份 Gist，ID: ${gistId}`);
        console.log(`[Gist] 请将 GIST_ID=${gistId} 添加到 Render 环境变量，防止重启后重新创建`);
      }
    }
  } catch (e) {
    console.warn('[Gist] 上传失败:', e.message);
  }
}

// 从本地文件读取 gistId（首次运行后自动记录）
function loadLocalGistId() {
  if (gistId) return;
  const cfgPath = path.join(__dirname, '..', '.gist_id');
  if (fs.existsSync(cfgPath)) {
    gistId = fs.readFileSync(cfgPath, 'utf8').trim();
  }
}

module.exports = { download, upload, loadLocalGistId, isEnabled: () => !!TOKEN };
