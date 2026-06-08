// 实时投票同步（SSE）
if (typeof MATCH_ID === 'undefined') return;

const source = new EventSource('/events');

source.addEventListener('vote', e => {
  const data = JSON.parse(e.data);
  if (data.match_id !== MATCH_ID) return;
  if (IS_FINISHED) return; // 已结束的比赛不需要实时更新

  // 只有已投票或已结束才显示投票情况
  if (!HAS_VOTED && !IS_FINISHED) return;

  const votes = data.votes; // [{choice, nickname}, ...]
  const counts = { a: 0, b: 0, c: 0 };
  votes.forEach(v => counts[v.choice]++);
  const total = votes.length;

  // 更新统计条
  const panel = document.getElementById('votes-panel');
  if (!panel) return;

  // 更新总人数
  const totalEl = panel.querySelector('#vote-total');
  if (totalEl) totalEl.textContent = total;

  // 更新每个选项
  ['a','b','c'].forEach(k => {
    const row = panel.querySelector(`.vote-stat-row[data-opt="${k}"]`);
    if (!row) return;
    const pct = total > 0 ? Math.round(counts[k] / total * 100) : 0;
    const bar = row.querySelector('.vsr-bar');
    const cntEl = row.querySelector('.cnt');
    const pctEl = row.querySelector('.pct');
    if (bar) { bar.style.width = pct + '%'; bar.dataset.count = counts[k]; }
    if (cntEl) cntEl.textContent = counts[k];
    if (pctEl) pctEl.textContent = pct;
  });

  // 更新投票人名单
  const voterList = panel.querySelector('#voter-list');
  if (!voterList) return;

  const groups = { a: [], b: [], c: [] };
  votes.forEach(v => groups[v.choice].push(v.nickname));

  ['a','b','c'].forEach(k => {
    let grp = voterList.querySelector(`.voter-group[data-opt="${k}"]`);
    if (groups[k].length === 0) {
      if (grp) grp.remove();
      return;
    }
    if (!grp) {
      grp = document.createElement('div');
      grp.className = 'voter-group';
      grp.dataset.opt = k;
      grp.innerHTML = `
        <div class="voter-group-header">
          <span class="vote-opt-letter vote-opt-letter-sm">${k.toUpperCase()}</span>
          ${OPT[k]} · <span class="group-cnt">0</span> 人
        </div>
        <div class="voter-chips"></div>`;
      voterList.appendChild(grp);
    }
    grp.querySelector('.group-cnt').textContent = groups[k].length;
    const chips = grp.querySelector('.voter-chips');
    chips.innerHTML = groups[k].map(n => `<span class="voter-chip">${n}</span>`).join('');
  });

  // 闪烁提示有新投票
  panel.classList.add('vote-flash');
  setTimeout(() => panel.classList.remove('vote-flash'), 600);
});

source.onerror = () => {
  // 连接断开后 EventSource 会自动重连（retry: 3000ms）
};
