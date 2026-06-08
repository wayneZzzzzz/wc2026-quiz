const express = require('express');
const { getEffectiveStatus } = require('./matches');

module.exports = function(db, broadcast) {
  const router = express.Router();

  router.post('/', (req, res) => {
    const user = req.session.user;
    if (!user) return res.redirect('/login');

    const { match_id, choice } = req.body;
    if (!match_id || !['a', 'b', 'c'].includes(choice)) {
      return res.redirect('/matches/' + match_id);
    }

    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(match_id);
    if (!match) return res.redirect('/matches');
    if (getEffectiveStatus(match) !== 'voting') return res.redirect('/matches/' + match_id);

    const existing = db.prepare('SELECT id FROM votes WHERE user_id = ? AND match_id = ?').get(user.id, match_id);
    if (existing) return res.redirect('/matches/' + match_id);

    db.prepare('INSERT INTO votes (user_id, match_id, choice) VALUES (?, ?, ?)').run(user.id, match_id, choice);
    db.prepare('UPDATE users SET total_votes = total_votes + 1 WHERE id = ?').run(user.id);

    // 广播最新投票数据给所有在线客户端
    const votes = db.prepare(`
      SELECT v.choice, u.nickname FROM votes v
      JOIN users u ON v.user_id = u.id
      WHERE v.match_id = ? ORDER BY v.created_at ASC
    `).all(match_id);
    broadcast('vote', { match_id: parseInt(match_id), votes });

    res.redirect('/matches/' + match_id);
  });

  return router;
};
