// 共享单例 DB，支持服务器和独立脚本两种调用方式
const initSqlJs = require('sql.js');
const { createWrapper, initDb } = require('../database');

let cachedDb = null;

module.exports = async function getDb() {
  if (cachedDb) return cachedDb;
  const SQL = await initSqlJs();
  initDb(SQL);
  cachedDb = createWrapper();
  return cachedDb;
};

// 供 server.js 在已初始化后注入，避免重复初始化
module.exports.setDb = function(db) {
  cachedDb = db;
};
