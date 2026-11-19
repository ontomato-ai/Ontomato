#!/usr/bin/env node
/**
 * Ontomato 流程使用方客户端。
 *
 * 以当前登录主体身份：
 *   - 按需求找到“我有权限”的动作/流程步骤；
 *   - 走 Ontomato 拉式动作（Action 前置条件判定是否轮到）；
 *   - 走 Praxis 账本：待办、审批、指派、Run 状态；
 *   - 需要一个一次性流程时，建临时 Workflow（保存→激活→运行→停用/删除）。
 *
 * 认证（三选一，没有默认账号）：
 *   1) 用户名+密码：OA_CODE / OA_PASS / OA_DOMAIN
 *   2) 平台 token：ONTOMATO_TK（兼容 OA_TOKEN）
 *   3) Ontomato API Key：ONTOMATO_API_KEY（兼容 OA_API_KEY）
 * 也可用 --token / --api-key / --user / --password / --domain 覆盖。
 * 优先级：--token > --api-key > 用户名+密码。
 *
 * 端点：ONTOMATO_ONTOLOGY_URL（平台注入）或 OA_BASE（默认 http://localhost:8080/api/data-query）
 *       OA_AUTH（用户名+密码模式，默认 http://localhost:8080/api/auth）
 *       PRAXIS_BASE（默认 http://127.0.0.1:18600）
 *
 * 写命令支持 --dry-run：只打印请求体，不登录、不落库。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = (process.env.OA_BASE || process.env.ONTOMATO_ONTOLOGY_URL || 'http://localhost:8080/api/data-query').replace(/\/+$/, '');
const AUTH = process.env.OA_AUTH || 'http://localhost:8080/api/auth';
const PRAXIS = process.env.PRAXIS_BASE || 'http://127.0.0.1:18600';
let DOMAIN = process.env.OA_DOMAIN || '';
let CODE = process.env.OA_CODE || '';
let PASS = process.env.OA_PASS || '';
let TOKEN = process.env.OA_TOKEN || process.env.ONTOMATO_TK || '';
let API_KEY = process.env.OA_API_KEY || process.env.ONTOMATO_API_KEY || '';
const RAW_ARGV = process.argv.slice(2);
const VALUE_FLAGS = new Set(['--token', '--api-key', '--user', '--password', '--domain']);
function flagValue(name) {
  const index = RAW_ARGV.indexOf(name);
  return index >= 0 ? RAW_ARGV[index + 1] : undefined;
}
if (flagValue('--token')) TOKEN = flagValue('--token');
if (flagValue('--api-key')) API_KEY = flagValue('--api-key');
if (flagValue('--user')) CODE = flagValue('--user');
if (flagValue('--password')) PASS = flagValue('--password');
if (flagValue('--domain')) DOMAIN = flagValue('--domain');
const DRY = RAW_ARGV.includes('--dry-run');
const ARGV = [];
for (let index = 0; index < RAW_ARGV.length; index += 1) {
  if (VALUE_FLAGS.has(RAW_ARGV[index])) {
    index += 1;
    continue;
  }
  if (RAW_ARGV[index] === '--dry-run') continue;
  ARGV.push(RAW_ARGV[index]);
}

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCsOA/mrmUxn+DSC3mDclnCTQQXqbbsXJcopSXYjHR4U9BW14/CaKLkezS+AdNLPrtF135Jn4zVhSCzRcVYNruutqzpPZEdgGB4vJw16+LsOjGSG0Np7CLZg1YRP2vfCKYEtyrY5/jfts7DRbPf5FJljhO3w79xxo0dd0Sb1n1fEwIDAQAB
-----END PUBLIC KEY-----`;

function enc(text) {
  return crypto
    .publicEncrypt({ key: PUBLIC_KEY, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(text, 'utf8'))
    .toString('base64');
}

function die(message, extra) {
  console.error(`✗ ${message}`);
  if (extra !== undefined) console.error(typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2));
  process.exit(1);
}

function readJsonArg(arg) {
  if (!arg) die('需要一个 JSON（文件路径、@内联 JSON，或直接给 {…}）');
  const trimmed = arg.trim();
  let text;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) text = trimmed;
  else if (trimmed.startsWith('@')) text = trimmed.slice(1);
  else {
    if (!fs.existsSync(trimmed)) die(`既不是 JSON 也不是存在的文件: ${trimmed}`);
    text = fs.readFileSync(trimmed, 'utf8');
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    die(`不是合法 JSON: ${arg}`, e.message);
  }
}

let cachedToken = null;
let cachedMe = null;
let authMode = null;

function configuredAuthMode() {
  if (TOKEN) return 'token';
  if (API_KEY) return 'apikey';
  if (CODE && PASS) return 'password';
  return null;
}

function authHeaders() {
  if (authMode === 'apikey') return { 'x-api-key': API_KEY, 'Accept-Language': 'zh-CN' };
  return { tk: cachedToken || TOKEN, 'Accept-Language': 'zh-CN' };
}

async function currentUser(headers) {
  const response = await fetch(`${BASE}/user/getCur`, { headers }).catch((e) =>
    die(`连不上后端 ${BASE}（${e.cause ? e.cause.code || e.cause.message : e.message}）`),
  );
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    die(`/user/getCur 返回非 JSON（HTTP ${response.status}）`, text.slice(0, 300));
  }
  if (!response.ok || json.success === false || !json.data?.id) {
    die('认证失败：凭据无效或已过期', json);
  }
  return json.data;
}

async function login() {
  if (cachedToken) return cachedToken;
  const mode = configuredAuthMode();
  if (!mode) {
    die(
      '未配置认证：设置 ONTOMATO_TK / OA_TOKEN、ONTOMATO_API_KEY / OA_API_KEY，或 OA_CODE/OA_PASS/OA_DOMAIN；' +
        '也可用 --token/--api-key/--user/--password/--domain',
    );
  }
  authMode = mode;
  if (mode === 'token' || mode === 'apikey') {
    cachedToken = mode === 'token' ? TOKEN : API_KEY;
    await currentUser(
      mode === 'token'
        ? { tk: TOKEN, 'Accept-Language': 'zh-CN' }
        : { 'x-api-key': API_KEY, 'Accept-Language': 'zh-CN' },
    );
    return cachedToken;
  }
  if (!DOMAIN) die('用户名+密码模式缺域 id：设置 OA_DOMAIN 或 --domain');
  const r = await fetch(`${AUTH}/doLogin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginCode: enc(CODE), password: enc(PASS), domainId: DOMAIN }),
  }).catch((e) => die(`连不上登录接口 ${AUTH}（${e.cause ? e.cause.code || e.cause.message : e.message}）`));
  const j = await r.json();
  if (!j.success || !j.data || !j.data.tk) die('登录失败（检查 OA_CODE/OA_PASS/OA_DOMAIN）', j);
  cachedToken = j.data.tk;
  return cachedToken;
}

async function me() {
  if (cachedMe) return cachedMe;
  const data = await get('/user/getCur');
  if (!data || !data.id) die('当前凭据没有用户 id');
  cachedMe = data;
  return cachedMe;
}

async function post(backendPath, body) {
  if (DRY) {
    console.log(JSON.stringify({ dryRun: true, method: 'POST', path: backendPath, body }, null, 2));
    return { dryRun: true };
  }
  await login();
  const r = await fetch(`${BASE}${backendPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body === undefined ? {} : body),
  }).catch((e) => die(`连不上后端 ${BASE}（${e.cause ? e.cause.code || e.cause.message : e.message}）`));
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    die(`${backendPath} 返回非 JSON（HTTP ${r.status}）`, text.slice(0, 500));
  }
  if (json.success === false) die(`${backendPath} 失败`, json.message || json);
  return json.data !== undefined ? json.data : json;
}

async function get(backendPath) {
  if (DRY) {
    console.log(JSON.stringify({ dryRun: true, method: 'GET', path: backendPath }, null, 2));
    return { dryRun: true };
  }
  await login();
  const r = await fetch(`${BASE}${backendPath}`, { headers: authHeaders() });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    die(`${backendPath} 返回非 JSON（HTTP ${r.status}）`, text.slice(0, 500));
  }
  if (json.success === false) die(`${backendPath} 失败`, json.message || json);
  return json.data !== undefined ? json.data : json;
}

async function praxis(method, path, body) {
  if (DRY) {
    console.log(JSON.stringify({ dryRun: true, method, praxis: PRAXIS + path, body }, null, 2));
    return { dryRun: true };
  }
  const credential = await login();
  const r = await fetch(`${PRAXIS}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${credential}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch((e) => die(`连不上 Praxis ${PRAXIS}（${e.cause ? e.cause.code || e.cause.message : e.message}）\n  Praxis 没起时，Ontomato 的拉式 Action 仍可用，但账本/待办/审批不可用。`));
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    die(`Praxis ${path} 返回非 JSON（HTTP ${r.status}）`, text.slice(0, 500));
  }
  if (!r.ok) die(`Praxis ${path} 失败（HTTP ${r.status}）`, json.error || json);
  return json;
}

async function executeAction(actionId, param) {
  await login();
  const fd = new FormData();
  fd.append('id', actionId);
  fd.append('param', JSON.stringify(param || {}));
  const r = await fetch(`${BASE}/action/execute`, {
    method: 'POST',
    headers: authHeaders(),
    body: fd,
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    die(`/action/execute 返回非 JSON（HTTP ${r.status}）`, text.slice(0, 500));
  }
  if (!r.ok || json.success !== true) return { ok: false, message: json.message || `HTTP ${r.status}` };
  const data = json.data || {};
  if (data.error) return { ok: false, message: data.error };
  let result = data.result;
  try {
    result = JSON.parse(result);
  } catch {
    /* keep string */
  }
  return { ok: true, result };
}

function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (!data) return [];
  return data.rows || data.data || data.records || data.list || [];
}

function requireArg(args, index, usage) {
  if (!args[index]) die(`用法: ${usage}`);
  return args[index];
}

async function myActions() {
  const user = await me();
  const [subjects, grants, actions] = await Promise.all([
    post('/workflow/subjects', {}),
    post('/workflow/grants', {}),
    post('/action/queryList', {}),
  ]);
  const mine = (subjects || []).find((s) => s.id === user.id || s.loginCode === user.loginCode);
  const roleIds = new Set(mine?.roleIds || []);
  const brief = { id: user.id, loginCode: user.loginCode, userName: user.userName };
  if (!roleIds.size) return { user: brief, roleIds: [], actions: [], reason: 'This subject holds no role in this domain.' };
  const inForce = (grants || []).filter((grant) => grant.inForce && roleIds.has(grant.roleId));
  const known = new Map((actions || []).map((a) => [a.id, a]));
  const rows = inForce
    .map((g) => {
      const a = known.get(g.capabilityId);
      return {
        actionId: g.capabilityId,
        name: a?.name ?? g.capabilityId,
        status: a?.status ?? null,
        approvalMode: a?.approvalMode ?? null,
        role: g.roleCode ?? g.roleId,
        source: g.workflowId ? 'process' : 'direct',
        workflowId: g.workflowId ?? null,
        workflowVersion: g.activatedByWorkflowVersion ?? null,
      };
    })
    .filter((r) => r.status === null || r.status === 'PUBLISHED');
  return { user: brief, roleIds: [...roleIds], actions: rows };
}

// ---------------------------------------------------------------- dispatch
const [cmd, ...args] = ARGV;

if (cmd === 'login') {
  if (args[0]) CODE = args[0];
  if (args[1]) PASS = args[1];
  if (args[2]) DOMAIN = args[2];
  await login();
  const user = await currentUser(authHeaders());
  console.log(JSON.stringify({ ok: true, authMode, loginCode: user.loginCode, domainId: user.domainId, domainName: user.domainName }, null, 2));
} else if (cmd === 'me') {
  const u = await me();
  console.log(JSON.stringify({ id: u.id, loginCode: u.loginCode, userName: u.userName, domainId: u.domainId, domainName: u.domainName, roles: u.roles, isAdmin: u.isAdmin }, null, 2));
} else if (cmd === 'me-full') {
  console.log(JSON.stringify(await me(), null, 2));
} else if (cmd === 'ping') {
  const data = await post('/workflow/query', {});
  console.log(JSON.stringify({ ok: true, workflows: Array.isArray(data) ? data.length : undefined }, null, 2));
} else if (cmd === 'praxis-health') {
  const r = await fetch(`${PRAXIS}/health`).catch((e) => die(`连不上 Praxis ${PRAXIS}: ${e.message}`));
  console.log(JSON.stringify(await r.json(), null, 2));
} else if (cmd === 'org-graph') {
  console.log(JSON.stringify(await post('/org-scope/graph', {}), null, 2));
} else if (cmd === 'subjects') {
  console.log(JSON.stringify(await post('/workflow/subjects', {}), null, 2));
} else if (cmd === 'roles') {
  const data = await post('/role/getRoleInfoPage', { pageNum: 1, pageSize: 200, cdt: '' });
  console.log(JSON.stringify(rowsOf(data).map((r) => ({ id: r.id, roleName: r.roleName, roleDesc: r.roleDesc })), null, 2));
} else if (cmd === 'dsl') {
  const body = readJsonArg(requireArg(args, 0, 'dsl <json|@json>'));
  console.log(JSON.stringify(await post('/dsl/executeV1', body), null, 2));
} else if (cmd === 'my-actions') {
  const result = await myActions();
  console.log(JSON.stringify(result, null, 2));
} else if (cmd === 'action') {
  const actionId = requireArg(args, 0, 'action <actionId>');
  console.log(JSON.stringify(await post('/action/queryById', { id: actionId }), null, 2));
} else if (cmd === 'find') {
  const question = requireArg(args, 0, 'find <需求描述> [className]');
  const className = args[1] || undefined;
  const found = rowsOf(await post('/action/find', { question, className }));
  const mine = await myActions();
  const allowedIds = new Set(mine.actions.map((a) => a.actionId));
  const rows = found.map((a) => ({
    actionId: a.id,
    name: a.name,
    description: a.description,
    status: a.status,
    allowed: allowedIds.has(a.id),
  }));
  console.log(JSON.stringify({ question, className: className ?? null, allowed: rows.filter((r) => r.allowed), denied: rows.filter((r) => !r.allowed) }, null, 2));
} else if (cmd === 'pending') {
  const flow = args.includes('--flow') ? args[args.indexOf('--flow') + 1] : undefined;
  const metrics = [];
  let cursor;
  do {
    const pageOut = await post('/ontology/query/metrics/search', { workflowPurpose: 'pending', limit: 100, cursor });
    const page = pageOut || {};
    for (const item of page.items || []) {
      if (item.workflowSource?.purpose === 'pending' && (!flow || item.workflowSource.workflowId === flow || item.name.includes(flow))) {
        metrics.push(item);
      }
    }
    cursor = page.nextCursor;
  } while (cursor);
  if (!metrics.length) die('没有已发布的待办查询；检查流程是否 ACTIVE、runContract 是否声明、activationNotes 是否为空');
  const limit = Number(args[0] && !args[0].startsWith('--') ? args[0] : 20);
  let remaining = limit;
  const items = [];
  for (const metric of metrics) {
    const output = await post('/ontology/query/metrics/execute', { id: metric.id, revision: metric.revision });
    const rows = (output?.rows || []).slice(0, remaining);
    items.push({ workflowId: metric.workflowSource.workflowId, metric: metric.name, revision: metric.revision, rows });
    remaining -= rows.length;
    if (!remaining) break;
  }
  console.log(JSON.stringify({ count: limit - remaining, items }, null, 2));
} else if (cmd === 'inbox') {
  const user = await me();
  const items = await praxis('GET', `/inbox?assignee=${encodeURIComponent(user.loginCode)}`);
  console.log(JSON.stringify(items, null, 2));
} else if (cmd === 'runs') {
  const status = args[0] && !args[0].startsWith('--') ? `?status=${encodeURIComponent(args[0])}` : '';
  console.log(JSON.stringify(await praxis('GET', `/runs${status}`), null, 2));
} else if (cmd === 'run-status') {
  console.log(JSON.stringify(await praxis('GET', `/runs/${encodeURIComponent(requireArg(args, 0, 'run-status <runId>'))}`), null, 2));
} else if (cmd === 'case') {
  const runId = requireArg(args, 0, 'case <runId>');
  console.log(JSON.stringify(await praxis('GET', `/runs/${encodeURIComponent(runId)}/case`), null, 2));
} else if (cmd === 'case-submit') {
  const runId = requireArg(args, 0, 'case-submit <runId> <json|@json>');
  const payload = readJsonArg(requireArg(args, 1, 'case-submit <runId> <json|@json>'));
  console.log(JSON.stringify(await praxis('POST', `/runs/${encodeURIComponent(runId)}/case/submit`, { payload }), null, 2));
} else if (cmd === 'case-fill') {
  const runId = requireArg(args, 0, 'case-fill <runId> <json|@json>');
  const payload = readJsonArg(requireArg(args, 1, 'case-fill <runId> <json|@json>'));
  console.log(JSON.stringify(await praxis('POST', `/runs/${encodeURIComponent(runId)}/case/fill`, { payload }), null, 2));
} else if (cmd === 'case-close') {
  const runId = requireArg(args, 0, 'case-close <runId>');
  console.log(JSON.stringify(await praxis('POST', `/runs/${encodeURIComponent(runId)}/case/close`, {}), null, 2));
} else if (cmd === 'start') {
  const workflowId = requireArg(args, 0, 'start <workflowId> [inputsJson] [--no-auto]');
  const inputs = args[1] && !args[1].startsWith('--') ? JSON.parse(args[1]) : {};
  const requester = DRY ? CODE : (await me()).loginCode;
  const run = await praxis('POST', '/runs', { workflowId, requester, inputs, auto: !args.includes('--no-auto') });
  console.log(JSON.stringify(run, null, 2));
} else if (cmd === 'bind') {
  const runId = requireArg(args, 0, 'bind <runId> <targetClass> <targetId>');
  const targetClass = requireArg(args, 1, 'bind <runId> <targetClass> <targetId>');
  const targetId = requireArg(args, 2, 'bind <runId> <targetClass> <targetId>');
  console.log(JSON.stringify(await praxis('POST', `/runs/${encodeURIComponent(runId)}/acts-on`, { targetClass, targetId }), null, 2));
} else if (cmd === 'template') {
  console.log(JSON.stringify(await praxis('GET', `/workflows/${encodeURIComponent(requireArg(args, 0, 'template <workflowId>'))}/template`), null, 2));
} else if (cmd === 'tick') {
  console.log(JSON.stringify(await praxis('POST', `/runs/${encodeURIComponent(requireArg(args, 0, 'tick <runId>'))}/tick`, {}), null, 2));
} else if (cmd === 'run') {
  const actionId = requireArg(args, 0, 'run <actionId> <paramJson>');
  const param = args[1] ? JSON.parse(args[1]) : {};
  const out = await executeAction(actionId, param);
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) process.exit(2);
} else if (cmd === 'decide') {
  const stepId = requireArg(args, 0, 'decide <stepId> <approve|reject> [comment]');
  const verdict = requireArg(args, 1, 'decide <stepId> <approve|reject> [comment]');
  if (!['approve', 'reject'].includes(verdict)) die('verdict 只能是 approve 或 reject');
  const decider = DRY ? CODE : (await me()).loginCode;
  const body = { verdict, decider, comment: args[2] ?? null };
  console.log(JSON.stringify(await praxis('POST', `/steps/${encodeURIComponent(stepId)}/decide`, body), null, 2));
} else if (cmd === 'assign') {
  const stepId = requireArg(args, 0, 'assign <stepId> <principal|--clear>');
  const principal = args[1] === '--clear' ? null : requireArg(args, 1, 'assign <stepId> <principal|--clear>');
  const assignedBy = DRY ? CODE : (await me()).loginCode;
  console.log(JSON.stringify(await praxis('POST', `/steps/${encodeURIComponent(stepId)}/assign`, { principal, assignedBy }), null, 2));
} else if (cmd === 'candidates') {
  const stepId = requireArg(args, 0, 'candidates <stepId>');
  console.log(JSON.stringify(await praxis('GET', `/steps/${encodeURIComponent(stepId)}/candidates`), null, 2));
} else if (cmd === 'temp-save') {
  const body = readJsonArg(requireArg(args, 0, 'temp-save <json>{name?,steps,runClassName,runContract?} [--draft] [--run <inputsJson>] [--no-auto]'));
  const draft = args.includes('--draft');
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  body.name = body.name || `TMP-${stamp}`;
  body.description = `[temporary] ${body.description || body.name}`;
  const saved = await post('/workflow/save', body);
  const workflowId = saved.id;
  const out = { workflowId, name: saved.name, status: saved.status, version: saved.version, activated: false, runId: null };
  if (!draft && !DRY) {
    const activated = await post('/workflow/activate', { id: workflowId });
    out.status = activated.status;
    out.version = activated.version;
    out.activated = true;
    out.activationNotes = activated.activationNotes;
    const runIndex = args.indexOf('--run');
    if (runIndex >= 0) {
      const inputs = readJsonArg(args[runIndex + 1]);
      const requester = DRY ? CODE : (await me()).loginCode;
      const run = await praxis('POST', '/runs', {
        workflowId,
        requester,
        inputs,
        auto: !args.includes('--no-auto'),
      });
      out.runId = run.id;
      out.runStatus = run.status;
    }
  }
  out.note = '这是“临时流程”的生命周期实现：DRAFT→ACTIVE→可选 Run；结束后用 temp-clean 停用并删除。';
  console.log(JSON.stringify(out, null, 2));
} else if (cmd === 'temp-clean') {
  const workflowId = requireArg(args, 0, 'temp-clean <workflowId>');
  let deactivated = false;
  try {
    await post('/workflow/deactivate', { id: workflowId });
    deactivated = true;
  } catch (e) {
    console.error(`! 停用失败（可能本来就不是 ACTIVE）：${e.message}`);
  }
  await post('/workflow/delete', { id: workflowId });
  console.log(JSON.stringify({ ok: true, workflowId, deactivated, deleted: true, note: '已冻结的 Run 模板仍留在 Praxis 账本，不受影响' }, null, 2));
} else {
  console.log(`Ontomato 流程使用方客户端

认证（三选一，无默认账号）：
  OA_CODE / OA_PASS / OA_DOMAIN   用户名+密码
  ONTOMATO_TK / OA_TOKEN          平台 token
  ONTOMATO_API_KEY / OA_API_KEY   Ontomato API Key
  优先级：--token > --api-key > 用户名+密码；也可用 --user/--password/--domain。

端点：ONTOMATO_ONTOLOGY_URL 或 OA_BASE / OA_AUTH / PRAXIS_BASE
写命令支持 --dry-run。

身份与发现
  login [--token <tk> | --api-key <key> | <code> <pass> [domainId]]
                                   验证当前认证
  me / ping                        当前账号（简要）/ 平台可达
  me-full                          当前账号完整信息（含 API/菜单权限）
  praxis-health                    Praxis 健康
  org-graph                        我的组织子树：下级组织、成员、角色、可执行能力
  subjects / roles                 主体 / 角色
  my-actions                       我的有效角色能执行的动作（含来源流程/手工授权）
  action <actionId>                看动作完整参数（类型/枚举/返回）
  find <需求> [className]          语义找动作，并标记我是否有权限
  dsl <json|@json>                 直接执行 DSL（用于读自己的数据/验证行权限）
  pending [limit] [--flow <id>]    平台生成的“我的待办”查询

执行（两条路径）
  run <actionId> <paramJson>       Ontomato 拉式执行动作；前置条件判定是否轮到
  inbox                            Praxis 待办（按我的 loginCode）
  runs [status] / run-status <id>  账本列表 / 单个 Run
  start <workflowId> [inputsJson] [--no-auto]  以我的身份创建 Run
  bind <runId> <targetClass> <targetId>        绑定业务对象（审批动作的 run_id）
  template <workflowId>            看冻结模板
  case <runId>                     读临时流程单（Case）
  case-submit <runId> <json>       发起人按 form_schema 写 Case
  case-fill <runId> <json>         当前办理人补写 Case
  case-close <runId>               结案（之后 Case 不可再写）
  tick <runId>                     手动推进
  decide <stepId> approve|reject [comment]   Praxis 审批；引擎执行审批动作
  assign <stepId> <principal|--clear>        补钉/清钉
  candidates <stepId>              谁可以决定这一步

临时流程
  temp-save <json> [--draft] [--run <inputsJson>] [--no-auto]
                                   保存临时 Workflow；默认激活；可立即起 Run
  temp-clean <workflowId>          停用并删除临时 Workflow

注意：
- Ontomato 的“流转”是拉式的：run 只是显式执行一个动作，是否允许由动作自己的
  submissionCriteria 和角色授权决定。
- Praxis 的 run 是账本：inbox 找 waiting 步，decide 让引擎以决定人身份执行审批动作。
  同一件事不要既 run 又 decide，会重复执行。
- 临时 Workflow 不是平台原生概念，是“唯一命名的 DRAFT→ACTIVE→运行→停用/删除”生命周期。
  它需要当前账号有 workflow 保存/激活权限；没有就先用 ontomato-process-admin。
`);
}
