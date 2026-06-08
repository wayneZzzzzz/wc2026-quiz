#!/bin/bash
# 世界杯竞猜系统启动脚本
#
# 盘口数据每小时自动更新，需要设置免费 API Key:
#   1. 访问 https://the-odds-api.com/ 注册，获取免费 API Key（500次/月）
#   2. 把下面这行的 # 去掉，填入你的 key:
export ODDS_API_KEY="4f41f49d9af2f7aa3f46183ec571d452"
#
# 管理员密码（默认 admin2026，可修改）:
# export ADMIN_PASSWORD="你的密码"

NODE_BASE="/Users/weizhang/Library/Application Support/Logi/LogiPluginService/PluginHosts/node22/node"
cd "$(dirname "$0")"
PATH="$NODE_BASE/bin:$PATH" "$NODE_BASE/bin/node" server.js
