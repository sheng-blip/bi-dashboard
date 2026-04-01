/**
 * common.js — 业务逻辑层、存储、UI 工具
 * 依赖：parser.js（须先加载）
 */

// ─── 指标计算 ─────────────────────────────────────────────────────────────────

/**
 * 对行数组计算全量汇总指标
 * 所有字段均容错：缺失时用 0 / '' 默认值
 */
function calcSummary(rows) {
  const total        = rows.length;
  const passed       = rows.filter(r => r.status?.review === '通过').length;
  const failed       = total - passed;
  const videos       = rows.filter(r => r.type === '视频').length;
  const images       = rows.filter(r => r.type === '图片').length;
  const texts        = rows.filter(r => r.type === '文字').length;
  const totComments  = rows.reduce((s, r) => s + (r.attr?.comments  || 0), 0);
  const totLikes     = rows.reduce((s, r) => s + (r.attr?.likes     || 0), 0);
  const totViews     = rows.reduce((s, r) => s + (r.attr?.views     || 0), 0);
  const totTipCnt    = rows.reduce((s, r) => s + (r.status?.tipCount   || 0), 0);
  const totTipEarn   = rows.reduce((s, r) => s + (r.status?.tipEarnings|| 0), 0);
  const totBalance   = rows.reduce((s, r) => s + (r.user?.balance   || 0), 0);
  const totEarnings  = rows.reduce((s, r) => s + (r.user?.earnings  || 0), 0);
  const uniqueUsers  = new Set(rows.map(r => r.user?.aff).filter(Boolean)).size;
  const certified    = rows.filter(r => r.user?.certified === '是').length;
  const withComments = rows.filter(r => (r.attr?.comments || 0) > 0).length;
  const passRate     = total > 0 ? +(passed / total * 100).toFixed(1) : 0;

  // 按审核员汇总
  const byMod = {};
  rows.forEach(r => {
    const k = r.moderator?.name || '未知';
    if (!byMod[k]) byMod[k] = { total:0, passed:0 };
    byMod[k].total++;
    if (r.status?.review === '通过') byMod[k].passed++;
  });

  return {
    total, passed, failed, videos, images, texts,
    totComments, totLikes, totViews, totTipCnt, totTipEarn,
    totBalance, totEarnings, uniqueUsers, certified, withComments,
    passRate, byMod,
  };
}

// ─── 通用过滤器 ───────────────────────────────────────────────────────────────

/**
 * filterRows(rows, filters) → 过滤后的行数组
 * filters 支持的 key：
 *   moderator  审核员名
 *   type       内容类型
 *   review     审核结果
 *   idMin/idMax  ID 范围
 *   aff        Aff ID
 *   name       用户名关键词（模糊）
 *   certified  认证状态
 *   balMin     最低余额
 *   hasComment 仅含评论
 */
function filterRows(rows, filters = {}) {
  return rows.filter(r => {
    if (filters.moderator  && r.moderator?.name !== filters.moderator)          return false;
    if (filters.type       && r.type !== filters.type)                          return false;
    if (filters.review     && r.status?.review !== filters.review)              return false;
    if (filters.idMin      && r.id < filters.idMin)                             return false;
    if (filters.idMax      && r.id > filters.idMax)                             return false;
    if (filters.aff        && r.user?.aff !== filters.aff)                      return false;
    if (filters.name       && !r.user?.name.toLowerCase().includes(
                                 filters.name.toLowerCase()))                   return false;
    if (filters.certified  && r.user?.certified !== filters.certified)          return false;
    if (filters.balMin     && (r.user?.balance || 0) < filters.balMin)          return false;
    if (filters.hasComment && (r.attr?.comments || 0) === 0)                    return false;
    return true;
  });
}

// ─── 环比计算 ─────────────────────────────────────────────────────────────────

function calcChange(cur, prev) {
  if (prev == null || prev === 0) return null;
  return +((cur - prev) / prev * 100).toFixed(1);
}

function fmtChange(ch) {
  if (ch === null) return '<span class="neutral">vs昨日 --</span>';
  if (ch > 0)     return `<span class="up">↑ ${ch}%</span>`;
  if (ch < 0)     return `<span class="down">↓ ${Math.abs(ch)}%</span>`;
  return '<span class="neutral">= 0%</span>';
}

// ─── 格式化工具 ───────────────────────────────────────────────────────────────

function fmtNum(n) {
  n = parseFloat(n) || 0;
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
  return n.toLocaleString('zh-CN');
}

function fmtPct(n, total) {
  if (!total) return '0%';
  return (n / total * 100).toFixed(1) + '%';
}

// ─── 话题分布 ─────────────────────────────────────────────────────────────────
/**
 * getTopics(rows, limit) → [{ topic, count }]
 * 从 row.topics（parser 已提取的 hashtag 数组）统计每个话题的出现次数
 */
function getTopics(rows, limit = 15) {
  const map = {};
  rows.forEach(r => {
    (r.topics || []).forEach(t => { map[t] = (map[t] || 0) + 1; });
  });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([topic, count]) => ({ topic, count }));
}

// ─── 小时分布 ─────────────────────────────────────────────────────────────────
/**
 * getHourlyDist(rows) → { labels:[0..23], counts:[n,...], hasDates }
 * 需要 row.date 为 Date 对象；无时间数据时 hasDates=false
 */
function getHourlyDist(rows) {
  const counts = new Array(24).fill(0);
  let hasDates = false;
  rows.forEach(r => {
    if (!(r.date instanceof Date)) return;
    hasDates = true;
    counts[r.date.getHours()]++;
  });
  return { labels: Array.from({length:24}, (_,i) => `${i}时`), counts, hasDates };
}

// ─── 日期 / ID 趋势 ───────────────────────────────────────────────────────────
/**
 * getTrend(rows, buckets) → { labels, total, passed, failed, hasDates }
 * 有日期字段 → 按实际日期分组；无日期 → 按 ID 区间分 buckets 组
 * 避免除零：passed/failed 均直接计数，不做比率计算
 */
function getTrend(rows, buckets = 10) {
  if (!rows.length) return { labels:[], total:[], passed:[], failed:[], hasDates:false };

  const hasDates = rows.some(r => r.date instanceof Date);

  if (hasDates) {
    const map = {};
    rows.forEach(r => {
      if (!(r.date instanceof Date)) return;
      const key = r.date.toLocaleDateString('zh-CN', { month:'2-digit', day:'2-digit' });
      if (!map[key]) map[key] = { total:0, passed:0, failed:0 };
      map[key].total++;
      if (r.status?.review === '通过')  map[key].passed++;
      else                              map[key].failed++;
    });
    const sorted = Object.entries(map).sort(([a],[b]) => a.localeCompare(b));
    return {
      labels: sorted.map(([k]) => k),
      total:  sorted.map(([,v]) => v.total),
      passed: sorted.map(([,v]) => v.passed),
      failed: sorted.map(([,v]) => v.failed),
      hasDates: true,
    };
  }

  // 无日期：按 ID 升序分桶
  const sorted = [...rows].sort((a, b) => a.id - b.id);
  const size   = Math.max(1, Math.ceil(sorted.length / buckets));
  const groups = [];
  for (let i = 0; i < sorted.length; i += size) {
    const chunk  = sorted.slice(i, i + size);
    const minId  = chunk[0].id;
    const maxId  = chunk[chunk.length - 1].id;
    groups.push({
      label:  `${minId}~${maxId}`,
      total:  chunk.length,
      passed: chunk.filter(r => r.status?.review === '通过').length,
      failed: chunk.filter(r => r.status?.review === '未通过').length,
    });
  }
  return {
    labels: groups.map(g => g.label),
    total:  groups.map(g => g.total),
    passed: groups.map(g => g.passed),
    failed: groups.map(g => g.failed),
    hasDates: false,
  };
}

// ─── 用户发帖量 TOP-N ─────────────────────────────────────────────────────────
/**
 * getTopUsers(rows, limit) → [{ name, aff, count }]
 * 按用户 Aff（或用户名）聚合发帖数，取前 N
 */
function getTopUsers(rows, limit = 20) {
  const map = {};
  rows.forEach(r => {
    const key  = r.user?.aff || r.user?.name || '未知';
    const name = r.user?.name || key;
    if (!map[key]) map[key] = { name, aff: r.user?.aff || '', count: 0 };
    map[key].count++;
  });
  return Object.values(map)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ─── 存储层 ───────────────────────────────────────────────────────────────────

const KEY_TODAY = 'bi_today';
const KEY_YEST  = 'bi_yesterday';
const KEY_META  = 'bi_meta';   // 保存列结构等元信息

// ─── Fetch CSV（带随机参数防缓存）────────────────────────────────────────────

/**
 * fetchCSV(path) → Promise<string>
 * 每次请求追加 ?_t=<timestamp> 确保绕过浏览器缓存。
 * 仅在通过 HTTP/HTTPS 访问时有效；file:// 协议会被浏览器拒绝（CORS），
 * 此时 Promise reject，调用方可静默回退到手动文件选择。
 */
function fetchCSV(path) {
  const url = path + (path.includes('?') ? '&' : '?') + '_t=' + Date.now();
  return fetch(url, { cache: 'no-store' }).then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.text();
  });
}

function saveData(rows, meta = {}) {
  try {
    localStorage.setItem(KEY_TODAY, JSON.stringify(rows));
    localStorage.setItem(KEY_META,  JSON.stringify(meta));
  } catch(e) { console.warn('Storage full?', e); }
}

function loadData() {
  try {
    const r = localStorage.getItem(KEY_TODAY);
    return r ? JSON.parse(r) : null;
  } catch(e) { return null; }
}

function loadMeta() {
  try {
    const m = localStorage.getItem(KEY_META);
    return m ? JSON.parse(m) : {};
  } catch(e) { return {}; }
}

function saveAsYesterday(rows) {
  try {
    const s = calcSummary(rows);
    localStorage.setItem(KEY_YEST, JSON.stringify({
      summary: s, ts: new Date().toISOString(), count: rows.length,
    }));
    return true;
  } catch(e) { return false; }
}

function loadYesterday() {
  try {
    const r = localStorage.getItem(KEY_YEST);
    return r ? JSON.parse(r) : null;
  } catch(e) { return null; }
}

// ─── ECharts 基础配置 ─────────────────────────────────────────────────────────

const PALETTE = [
  '#00d4ff','#7c4dff','#00e676','#ff9800','#ff5252',
  '#40c4ff','#e040fb','#69f0ae','#ffab40','#ef5350',
];

function baseOpt() {
  return {
    backgroundColor: 'transparent',
    textStyle:  { color: '#7a8fbb', fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif' },
    legend:     { textStyle: { color: '#8899bb' }, pageIconColor: '#8899bb' },
    tooltip: {
      backgroundColor: 'rgba(5,9,31,.95)',
      borderColor:     'rgba(0,212,255,.3)',
      borderWidth: 1,
      textStyle: { color: '#dde8ff' },
    },
  };
}

/** 横向渐变色（蓝→紫） */
function gradH(c1 = '#00d4ff', c2 = '#7c4dff') {
  return { type:'linear', x:0, y:0, x2:1, y2:0,
    colorStops:[{offset:0,color:c1},{offset:1,color:c2}] };
}

/** 纵向渐变色 */
function gradV(c1, c2) {
  return { type:'linear', x:0, y:0, x2:0, y2:1,
    colorStops:[{offset:0,color:c1},{offset:1,color:c2}] };
}

/** 标准坐标轴样式 */
function axisStyle() {
  return {
    xAxis: { axisLabel:{ color:'#8899bb' }, axisLine:{ lineStyle:{color:'rgba(255,255,255,.1)'} }, splitLine:{ show:false } },
    yAxis: { axisLabel:{ color:'#8899bb' }, splitLine:{ lineStyle:{color:'rgba(255,255,255,.06)'} } },
  };
}

/**
 * 初始化或更新 ECharts 实例
 * @param {Object} registry  { [id]: echartsInstance } 外部持有
 * @param {string} id        DOM 元素 ID
 * @param {Object} opt       ECharts option
 */
function setChart(registry, id, opt) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!registry[id]) {
    registry[id] = echarts.init(el, null, { renderer:'canvas' });
  }
  registry[id].setOption(opt, true);
}

/** 绑定 resize 自适应 */
function bindResize(registry) {
  window.addEventListener('resize', () =>
    Object.values(registry).forEach(c => c && c.resize())
  );
}

// ─── UI 工具 ──────────────────────────────────────────────────────────────────

function toast(msg, type = 'info') {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  const colors = { success:'#00e676', error:'#ff5252', warning:'#ff9800', info:'#00d4ff' };
  el.style.borderColor = colors[type] || colors.info;
  el.style.color       = colors[type] || colors.info;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 3200);
}

/** 构建一个 metric-card 的 HTML */
function metricCardHTML({ icon, label, value, prev, accent = 'var(--cyan)', raw }) {
  const ch = (prev != null) ? calcChange(raw ?? parseFloat(value) ?? 0, prev) : null;
  // 若 value 含 % 等非数值后缀，直接原样显示，否则走 fmtNum 格式化
  const display = (typeof value === 'string' && /[^\d.,]/.test(value)) ? value : fmtNum(value);
  return `<div class="metric-card" style="--accent:${accent}">
    <span class="metric-icon">${icon}</span>
    <div class="metric-label">${label}</div>
    <div class="metric-value">${display}</div>
    <div class="metric-change">${fmtChange(ch)}</div>
  </div>`;
}

/** 填充 <select> 选项（去重排序） */
function populateSelect(selectEl, values, labelFn = v => v) {
  const existing = new Set([...selectEl.options].map(o => o.value));
  [...new Set(values)].filter(Boolean).sort().forEach(v => {
    if (existing.has(v)) return;
    const o = document.createElement('option');
    o.value = v; o.textContent = labelFn(v);
    selectEl.appendChild(o);
  });
}

// ─── 导航高亮 ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const page = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-btn').forEach(a => {
    const href = (a.getAttribute('href') || '').split('/').pop();
    a.classList.toggle('active', href === page || (!page && href === 'index.html'));
  });
});
