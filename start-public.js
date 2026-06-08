// 一键启动服务器 + 公网隧道
const { execSync } = require('child_process');
const lt = require('localtunnel');

// 先启动 server.js（子进程）
const { spawn } = require('child_process');
const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env },
  stdio: 'inherit',
});

// 等待服务器启动
setTimeout(async () => {
  try {
    const tunnel = await lt({ port: parseInt(process.env.PORT || 3000) });
    console.log('\n' + '='.repeat(50));
    console.log('🌍 公网访问地址（分享给朋友）:');
    console.log('   ' + tunnel.url);
    console.log('='.repeat(50));
    console.log('⚠️  首次访问需点击页面上的"Click to Continue"按钮');
    console.log('   管理员后台: ' + tunnel.url + '/admin');
    console.log('   管理员密码: ' + (process.env.ADMIN_PASSWORD || 'admin2026'));
    console.log('='.repeat(50) + '\n');

    tunnel.on('close', () => {
      console.log('隧道已关闭，重启中...');
    });
    tunnel.on('error', err => {
      console.error('隧道错误:', err.message);
    });
  } catch(e) {
    console.error('隧道启动失败:', e.message);
  }
}, 3000);

process.on('SIGINT', () => { server.kill(); process.exit(); });
process.on('SIGTERM', () => { server.kill(); process.exit(); });
