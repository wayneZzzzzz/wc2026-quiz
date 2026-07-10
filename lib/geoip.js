// 免费IP地理位置查询（ip-api.com，无需Key，45次/分钟限额）
// 仅用于登录提示"上次登录地点"，查询失败或超时时静默降级，不影响登录流程
const http = require('http');

function lookupGeo(ip) {
  return new Promise((resolve) => {
    if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
      return resolve(null); // 本地/内网地址无法查询
    }
    const req = http.get(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,city`,
      { timeout: 2000 },
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.status === 'success') {
              const parts = [parsed.country, parsed.city].filter(Boolean);
              resolve(parts.length ? parts.join(' ') : null);
            } else {
              resolve(null);
            }
          } catch (e) {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

module.exports = { lookupGeo };
