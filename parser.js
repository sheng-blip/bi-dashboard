/**
 * parser.js — CSV 自动字段识别 + 结构化解析
 * 职责：纯数据层，无 DOM / 无 Storage 依赖
 */

// ─── 帖子 CSV 字段别名映射 ────────────────────────────────────────────────────
const FIELD_ALIASES = {
  id:        ['id', 'ID', '帖子id', '帖子ID', '编号'],
  user:      ['用户', '用户信息', 'user'],
  content:   ['内容', 'content', '帖子内容'],
  attr:      ['属性', '帖子属性', 'attributes', 'attr'],
  status:    ['状态', 'status', '审核状态'],
  ip:        ['IP', 'ip', 'IP地址', 'ip地址'],
  sort:      ['排序', 'sort', '排序值'],
  type:      ['类型', 'type', '内容类型', '帖子类型'],
  moderator: ['审核管理员', '审核员', 'moderator', '管理员'],
  // 时间字段（有则解析，无则 null）
  date:      ['时间', '日期', '创建时间', '发布时间', '审核时间',
               'created_at', 'datetime', 'timestamp', 'date', 'time',
               '帖子时间', '操作时间', '更新时间'],
};

// ─── 用户 CSV 字段别名映射（用于 user.html 加载用户数据.csv）──────────────────
const USER_FIELD_ALIASES = {
  id:        ['用户ID', 'uid', 'user_id', 'userId', 'ID', '编号', 'id'],
  username:  ['用户名', 'username', '昵称', 'name', 'nickname', '用户昵称'],
  aff:       ['aff', 'Aff', 'AFF', 'aff_id', '推广码', '邀请码', '分销码'],
  regTime:   ['注册时间', 'register_time', 'created_at', '创建时间', 'reg_time', '注册日期', '加入时间'],
  balance:   ['余额', 'balance', '金币', 'coin', 'coins', '账户余额'],
  earnings:  ['收益', 'earnings', '收入', 'income', '总收益', '累计收益'],
  certified: ['认证', 'certified', '实名认证', '认证状态', 'auth', 'verified', '是否认证'],
  vip:       ['vip', 'VIP', 'vip_level', '会员', '会员等级', 'membership', '会员状态'],
  city:      ['城市', 'city', '地区', 'region', '省份', 'province', '所在地'],
  status:    ['状态', 'status', '账号状态', 'account_status', '用户状态'],
  lastLogin: ['最近登录', 'last_login', '最后活跃', 'last_active', '最近活跃', '最后登录时间'],
  postCount: ['发帖数', 'post_count', '帖子数', 'posts', '内容数', '发帖量'],
  phone:     ['手机', 'phone', '电话', 'mobile', '手机号'],
};

// ─── 低层：带引号的 CSV 行解析 ────────────────────────────────────────────────
function _splitLine(line) {
  const res = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { res.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  res.push(cur.trim());
  return res;
}

// ─── 字段检测（支持自定义别名表）────────────────────────────────────────────────
function detectColumns(headerLine, aliases = FIELD_ALIASES) {
  const headers  = _splitLine(headerLine).map(h => h.replace(/^"|"$/g, '').trim());
  const colIndex = {};

  headers.forEach((h, i) => {
    for (const [field, list] of Object.entries(aliases)) {
      if (colIndex[field] !== undefined) continue;
      if (list.some(a => a.toLowerCase() === h.toLowerCase())) {
        colIndex[field] = i;
      }
    }
  });

  return { colIndex, detectedHeaders: headers };
}

// ─── 子字段提取工具 ────────────────────────────────────────────────────────────
function _str(s, re, def = '')  { const m = (s||'').match(re); return m ? m[1].trim() : def; }
function _num(s, re, def = 0)   { const m = (s||'').match(re); return m ? parseFloat(m[1]) || 0 : def; }

// ─── 日期解析（兼容多种格式）─────────────────────────────────────────────────
function _parseDate(s) {
  if (!s || !s.trim()) return null;
  // 标准化分隔符
  const norm = s.trim().replace(/[年月]/g, '-').replace(/[日号]/g, '').replace(/\//g, '-');
  const d = new Date(norm);
  return isNaN(d.getTime()) ? null : d;
}

// ─── 话题（hashtag）提取 ──────────────────────────────────────────────────────
/**
 * extractHashtags(content) → string[]
 * 从帖子内容中提取所有 #话题 标签
 */
function extractHashtags(content) {
  if (!content) return [];
  const matches = content.match(/#([\u4e00-\u9fa5a-zA-Z0-9_]+)/g) || [];
  return matches.map(t => t.slice(1));   // 去掉 #
}

// ─── 帖子 CSV 各字段解析器 ────────────────────────────────────────────────────
const fieldParsers = {
  user(s) {
    if (!s) return { aff:'', name:'', vip:'', balance:0, earnings:0, certified:'否' };
    const nameM = s.match(/Aff[：:]\s*\d+\s*[,，]\s*([^\s,，]+)/);
    return {
      aff:      _str(s, /Aff[：:]\s*(\d+)/),
      name:     nameM ? nameM[1].trim() : '',
      vip:      _str(s, /Vip[：:]\s*(\S+)/),
      balance:  _num(s, /余额[：:]\s*([\d.]+)/),
      earnings: _num(s, /收益[：:]\s*([\d.]+)/),
      certified:_str(s, /认证[：:]\s*(\S+)/, '否'),
    };
  },

  attr(s) {
    if (!s) return { images:0, videos:0, likes:0, views:0, fakeLikes:0, fakeViews:0, comments:0, source:'' };
    return {
      images:    _num(s, /图片[：:]\s*(\d+)/),
      videos:    _num(s, /视频[：:]\s*(\d+)/),
      likes:     _num(s, /点赞[：:]\s*(\d+)/),
      views:     _num(s, /浏览[：:]\s*(\d+)/),
      fakeLikes: _num(s, /点赞\(假\)[：:]\s*(\d+)/),
      fakeViews: _num(s, /浏览\(假\)[：:]\s*(\d+)/),
      comments:  _num(s, /评论[：:]\s*(\d+)/),
      source:    _str(s, /来源标识[：:]\s*(.*?)(?:\s{2,}|$)/),
    };
  },

  status(s) {
    if (!s) return { review:'', resource:'', deleted:'', subscription:'', pinned:0, featured:'', tipCount:0, tipEarnings:0 };
    return {
      review:      _str(s, /审核[：:]\s*(\S+)/),
      resource:    _str(s, /资源[：:]\s*(\S+)/),
      deleted:     _str(s, /删除[：:]\s*(\S+)/),
      subscription:_str(s, /订阅[：:]\s*(\S+)/),
      pinned:      _num(s, /置顶[：:]\s*(\d+)/),
      featured:    _str(s, /置精[：:]\s*(\S+)/),
      tipCount:    _num(s, /打赏次数[：:]\s*(\d+)/),
      tipEarnings: _num(s, /打赏收益[：:]\s*([\d.]+)/),
    };
  },

  ip(s) {
    if (!s) return { ip:'', city:'' };
    const full = _str(s, /城市[：:]\s*(.+)$/);
    return {
      ip:   _str(s, /ip[：:]\s*([\d.]+)/),
      city: full.split(/[–\-]/).pop()?.trim() || full,
    };
  },

  moderator(s) {
    if (!s) return { name:'', id:'' };
    return {
      name: _str(s, /^([^(（]+)/),
      id:   _str(s, /id[：:]\s*(\d+)/),
    };
  },
};

// ─── 主解析入口：帖子 CSV ─────────────────────────────────────────────────────
/**
 * parseCSV(text) → { rows, colIndex, detectedHeaders, warnings }
 */
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { rows:[], colIndex:{}, detectedHeaders:[], warnings:[] };

  const { colIndex, detectedHeaders } = detectColumns(lines[0], FIELD_ALIASES);

  const mappedCols = new Set(Object.values(colIndex));
  const warnings   = detectedHeaders
    .map((h, i) => (!mappedCols.has(i) && h ? `未映射列 [${i}]: "${h}"` : null))
    .filter(Boolean);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    try {
      const f = _splitLine(lines[i]);
      if (f.length < 2) continue;

      const get = (field) => {
        const idx = colIndex[field];
        return idx !== undefined ? (f[idx] || '') : '';
      };

      rows.push({
        id:        parseInt(get('id')) || 0,
        user:      fieldParsers.user(get('user')),
        content:   get('content').trim(),
        attr:      fieldParsers.attr(get('attr')),
        status:    fieldParsers.status(get('status')),
        ip:        fieldParsers.ip(get('ip')),
        sort:      parseInt(get('sort')) || 0,
        type:      get('type').trim(),
        moderator: fieldParsers.moderator(get('moderator')),
        date:      _parseDate(get('date')),      // Date | null
        topics:    extractHashtags(get('content').trim()),  // string[]
        _raw:      f,
      });
    } catch(e) { /* 跳过解析失败的行 */ }
  }

  return { rows, colIndex, detectedHeaders, warnings };
}

// ─── 通用 CSV 解析（用户数据等其他格式）──────────────────────────────────────
/**
 * parseCSVGeneric(text, aliases) → { rows, colIndex, detectedHeaders, warnings }
 * rows 中每个字段以原始字符串存储，不做子字段解析
 * 额外做：数字转换、日期解析
 */
function parseCSVGeneric(text, aliases = USER_FIELD_ALIASES) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { rows:[], colIndex:{}, detectedHeaders:[], warnings:[] };

  const { colIndex, detectedHeaders } = detectColumns(lines[0], aliases);

  const mappedCols = new Set(Object.values(colIndex));
  const warnings   = detectedHeaders
    .map((h, i) => (!mappedCols.has(i) && h ? `未映射列 [${i}]: "${h}"` : null))
    .filter(Boolean);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    try {
      const f = _splitLine(lines[i]);
      if (f.length < 2) continue;

      const get = (field) => {
        const idx = colIndex[field];
        return idx !== undefined ? (f[idx] || '') : '';
      };

      const row = { _raw: f };
      for (const field of Object.keys(aliases)) {
        const raw = get(field).trim();
        // 尝试数字转换
        const asNum = parseFloat(raw);
        if (raw !== '' && !isNaN(asNum) && !/[^\d.\-]/.test(raw)) {
          row[field] = asNum;
        } else {
          row[field] = raw || null;
        }
      }
      // 专门的日期字段
      if (row.regTime)   row.regTime   = _parseDate(get('regTime'))   || row.regTime;
      if (row.lastLogin) row.lastLogin = _parseDate(get('lastLogin')) || row.lastLogin;

      rows.push(row);
    } catch(e) { /* skip */ }
  }

  return { rows, colIndex, detectedHeaders, warnings };
}
