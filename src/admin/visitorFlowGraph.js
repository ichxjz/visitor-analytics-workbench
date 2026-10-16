// The graph describes the returned request aggregates, not an inferred WAF history.
export const FLOW_STAGES = [
  { key: 'source', label: '请求来源', short: '来源' },
  { key: 'domain', label: '访问域名', short: '域名' },
  { key: 'path', label: '请求路径', short: '路径' },
  { key: 'rule', label: '最终记录规则', short: '规则' },
  { key: 'status', label: 'HTTP 结果', short: '结果' },
];
export const FLOW_GRAPH_SIZE = { width: 1060, height: 290, nodeWidth: 140, nodeHeight: 40 };
const boundedText = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const recordedNumber = value => ['number', 'string'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const valueKey = value => JSON.stringify(value);

export function finalFlowRule(row) {
  if (row?.ruleSource !== 'logged' || !Array.isArray(row.rules)) return null;
  return row.rules.map(rule => boundedText(typeof rule === 'object' && rule ? rule.id || rule.name : rule)).filter(Boolean).at(-1) || null;
}

export function flowValue(row, key) {
  if (key === 'rule') return finalFlowRule(row);
  if (key === 'status') {
    const value = recordedNumber(row?.status);
    return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
  }
  return boundedText(row?.[key]);
}

// Array values are the exact members of an "other" group, matched as OR.
// null selects missing data; an absent/empty filter selects the full scope.
export function matchesFlowSelection(row, selection) {
  if (!selection || typeof selection !== 'object') return true;
  return [...FLOW_STAGES.map(stage => stage.key), 'region'].every(key => {
    const expected = selection[key];
    if (expected === undefined || expected === '') return true;
    const values = Array.isArray(expected) ? expected : [expected];
    return values.some(value => flowValue(row, key) === (key === 'status' && value !== null ? Number(value) : value));
  });
}

export function flowRuleLabel(value) {
  if (!value) return '规则未记录';
  const names = {
    'guard:hidden-path': '隐藏文件保护', 'guard:private-path': '后台与源码保护',
    'proxy:earth': '地理数据代理', 'proxy:orbits': '卫星轨道代理',
    'redirect:https': 'HTTPS 跳转', 'static:home-entry': '首页入口',
    'static:atlas-entry': '星辰大海入口', 'static:atlas-entry-slash': '星辰大海入口',
    'static:atlas-index': '星辰大海页面', 'static:atlas-config': '星辰大海配置',
    'static:atlas-assets': '星辰大海资源', 'static:atlas-textures': '三维贴图资源',
    'static:build-assets': '网站脚本资源', 'static:uploads': '已上传素材',
    'static:site-files': '网站静态文件', 'static:fonts': '字体文件',
    'static:fonts-immutable': '字体缓存资源', 'static:planets': '行星资源',
    'static:moons': '卫星天体资源', 'static:mission-images': '任务图像',
    'static:music': '背景音乐', 'static:data': '网站数据', 'static:placeholders': '占位图像',
  };
  if (names[value]) return names[value];
  if (value.startsWith('guard:retired')) return '旧地址停用保护';
  if (value.startsWith('server:') && value.endsWith('.www-redirect')) return '主域名跳转';
  if (value.startsWith('server:') && value.endsWith('.default-reject')) return '默认站点保护';
  if (value.startsWith('server:https')) return 'HTTPS 服务节点';
  if (value.startsWith('server:http')) return 'HTTP 服务节点';
  return /[\u3400-\u9fff]/.test(value) ? value : '已记录节点';
}

export function flowNodeLabel(key, value) {
  if (key === 'rule') return flowRuleLabel(value);
  if (value === null) return {source: '来源未记录', domain: '域名未记录', path: '路径未记录', status: '状态未记录'}[key] || '未记录';
  if (key === 'source' && value === '直接访问 / 来源未提供') return '直接访问 / 未提供';
  if (key === 'domain' && value === '未记录访问域名') return '域名未记录';
  if (key === 'path' && value === '/') return '首页 /';
  if (key === 'path' && /^\/KK-Tiong_Pavelio\/?$/.test(value)) return '星辰大海页面';
  if (key === 'status') {
    const names = {200:'请求成功',206:'分段响应',301:'永久跳转',302:'临时跳转',304:'缓存响应',400:'请求无效',401:'需要认证',403:'访问拒绝',404:'未找到',429:'请求过多',500:'服务错误',502:'网关错误',503:'服务不可用',504:'网关超时'};
    return `${value}${names[value] ? ` ${names[value]}` : ''}`;
  }
  return value;
}

function aggregate(target, row, index) {
  target.requests += recordedNumber(row.requests) || 0;
  const bytes = recordedNumber(row.bytesSent);
  if (bytes !== null) target.bytesSent = (target.bytesSent ?? 0) + bytes;
  target.rowIndexes.add(index);
}
const bucket = fields => ({...fields, requests: 0, bytesSent: null, rowIndexes: new Set()});
const byRequests = (a, b) => b.requests - a.requests || (b.bytesSent ?? -1) - (a.bytesSent ?? -1) || a.id.localeCompare(b.id);

export function buildVisitorFlowGraph(input, { top = 4 } = {}) {
  const rows = (Array.isArray(input) ? input : []).filter(row => row && typeof row === 'object' && (recordedNumber(row.requests) || 0) > 0);
  const keep = Math.min(6, Math.max(1, Number.isFinite(top) ? Math.floor(top) : 4));
  const total = bucket({});
  rows.forEach((row, index) => aggregate(total, row, index));
  const columns = FLOW_STAGES.map((stage, stageIndex) => {
    const groups = new Map();
    rows.forEach((row, index) => {
      const value = flowValue(row, stage.key), id = `${stage.key}:${valueKey(value)}`;
      if (!groups.has(id)) groups.set(id, bucket({id, key: stage.key, value, values: [value], label: flowNodeLabel(stage.key, value), other: false, selection: {[stage.key]: value}}));
      aggregate(groups.get(id), row, index);
    });
    const all = [...groups.values()].sort(byRequests);
    const nodes = all.length > keep + 1 ? all.slice(0, keep) : all;
    const rest = all.length > keep + 1 ? all.slice(keep) : [];
    if (rest.length) {
      const values = rest.map(node => node.value), other = bucket({id: `${stage.key}:other`, key: stage.key, value: null, values, label: `其他 ${rest.length} 项`, other: true, selection: {[stage.key]: values}});
      for (const item of rest) {
        other.requests += item.requests;
        if (item.bytesSent !== null) other.bytesSent = (other.bytesSent ?? 0) + item.bytesSent;
        for (const index of item.rowIndexes) other.rowIndexes.add(index);
      }
      nodes.push(other);
    }
    const lookup = new Map();
    nodes.forEach((node, index) => {
      node.stage = stageIndex;
      node.x = stageIndex * FLOW_GRAPH_SIZE.width / FLOW_STAGES.length + (FLOW_GRAPH_SIZE.width / FLOW_STAGES.length - FLOW_GRAPH_SIZE.nodeWidth) / 2;
      node.y = nodes.length === 1 ? 155 : 65 + index * 180 / (nodes.length - 1);
      for (const value of node.values) lookup.set(valueKey(value), node);
    });
    return {...stage, nodes, lookup, omitted: rest.length};
  });
  const links = new Map();
  rows.forEach((row, index) => {
    for (let stage = 0; stage < columns.length - 1; stage++) {
      const source = columns[stage].lookup.get(valueKey(flowValue(row, columns[stage].key))), target = columns[stage + 1].lookup.get(valueKey(flowValue(row, columns[stage + 1].key)));
      const id = JSON.stringify([source.id, target.id]);
      if (!links.has(id)) links.set(id, bucket({id, source, target, stage}));
      aggregate(links.get(id), row, index);
    }
  });
  const sortedLinks = [...links.values()].sort(byRequests), maximum = sortedLinks[0]?.requests || 1;
  sortedLinks.forEach(link => {
    const x1 = link.source.x + FLOW_GRAPH_SIZE.nodeWidth, x2 = link.target.x, middle = (x1 + x2) / 2;
    link.path = `M${x1},${link.source.y} C${middle},${link.source.y} ${middle},${link.target.y} ${x2},${link.target.y}`;
    link.width = 1 + link.requests / maximum * 4;
  });
  return {rows, columns, links: sortedLinks, requests: total.requests, bytesSent: total.bytesSent, maxNodes: keep + 1};
}
