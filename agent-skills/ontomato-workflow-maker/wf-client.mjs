#!/usr/bin/env node
/**
 * Ontomato 业务流程构建客户端（Workflow / Action / Role）。
 *
 * 只管与平台对话，不含任何业务判断；业务判断在 SKILL.md 里。
 * 全部端点都走网关 data-query 前缀；可用环境变量覆盖：
 *   BASE：WF_BASE 或 ONTOMATO_ONTOLOGY_URL（平台注入），默认 http://localhost:8080/api/data-query
 *   AUTH：WF_AUTH（用户名+密码模式），默认 http://localhost:8080/api/auth
 *
 * 认证优先级：
 *   1) 平台 token：WF_TOKEN / ONTOMATO_TK（发 tk 头，无需 WF_DOMAIN）
 *   2) Ontomato API Key：WF_API_KEY / ONTOMATO_API_KEY（发 x-api-key 头，无需 WF_DOMAIN）
 *   3) 用户名+密码：WF_CODE / WF_PASS（默认 test / admin）+ WF_DOMAIN（或 login 子命令参数）
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const BASE = (process.env.WF_BASE || process.env.ONTOMATO_ONTOLOGY_URL || 'http://localhost:8080/api/data-query').replace(/\/+$/, '');
const AUTH = (process.env.WF_AUTH || 'http://localhost:8080/api/auth').replace(/\/+$/, '');
let DOMAIN = process.env.WF_DOMAIN || '';
let CODE = process.env.WF_CODE || 'test';
let PASS = process.env.WF_PASS || 'admin';
const TOKEN = process.env.WF_TOKEN || process.env.ONTOMATO_TK || '';
const API_KEY = process.env.WF_API_KEY || process.env.ONTOMATO_API_KEY || '';

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
  // 三种写法都收：文件路径 / @内联 / 直接给 JSON 文本。
  // 只认路径会把 `{"a":1}` 当文件名去 readFileSync，报 ENOENT 而看不出是参数形式错。
  const trimmed = arg.trim();
  let text;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    text = trimmed;
  } else if (trimmed.startsWith('@')) {
    text = trimmed.slice(1);
  } else {
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

async function login() {
  if (cachedToken) return cachedToken;
  const mode = configuredAuthMode();
  if (!mode) {
    die('缺少认证：设置 WF_TOKEN / ONTOMATO_TK、WF_API_KEY / ONTOMATO_API_KEY，或 WF_CODE / WF_PASS / WF_DOMAIN');
  }
  authMode = mode;
  if (mode === 'token') {
    cachedToken = TOKEN;
    return cachedToken;
  }
  if (mode === 'apikey') {
    cachedToken = API_KEY;
    return cachedToken;
  }
  if (!DOMAIN) die('缺少域 id：设置 WF_DOMAIN，或改用 `login <code> <password> <domainId>`');
  const r = await fetch(`${AUTH}/doLogin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginCode: enc(CODE), password: enc(PASS), domainId: DOMAIN }),
  }).catch((e) => die(`连不上登录接口 ${AUTH}（${e.cause ? e.cause.code || e.cause.message : e.message}）\n  开发栈没起就跑不了任何步骤；先起栈，不要在这里继续设计流程。`));
  const j = await r.json();
  if (!j.success || !j.data || !j.data.tk) die('登录失败（检查 WF_CODE/WF_PASS/WF_DOMAIN）', j);
  cachedToken = j.data.tk;
  return cachedToken;
}

async function post(backendPath, body) {
  await login();
  const r = await fetch(`${BASE}${backendPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body === undefined ? {} : body),
  }).catch((e) => die(`连不上后端 ${BASE}（${e.cause ? e.cause.code || e.cause.message : e.message}）\n  这是环境问题，不是流程定义问题：先确认开发栈已起（企业版仓根目录 pnpm dev:up），再重试。`));
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    die(`${backendPath} 返回非 JSON（HTTP ${r.status}）`, text.slice(0, 500));
  }
  return json;
}

/** 平台有两套响应外壳：Action/MetricView 用 {success,message}，sys 控制器用 {success,code,data}。统一拆。 */
function unwrap(json, what) {
  if (json.success === false) die(json.code ? `${what} 失败 (${json.code})` : `${what} 失败`, json.message || json);
  return json.data !== undefined ? json.data : json;
}

async function get(backendPath) {
  await login();
  const r = await fetch(`${BASE}${backendPath}`, { headers: authHeaders() });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    die(`${backendPath} 返回非 JSON（HTTP ${r.status}）`, text.slice(0, 500));
  }
}

/** Action 执行是 multipart；参数放 param 字段，且必须整体是字符串。 */
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
  if (!r.ok || json.success !== true) return { ok: false, message: json.message || json.msg || `HTTP ${r.status}` };
  const data = json.data || {};
  if (data.error) return { ok: false, message: data.error };
  let result = data.result;
  try {
    result = JSON.parse(result);
  } catch {
    /* 原样保留 */
  }
  return { ok: true, result };
}

async function saveActions(jsonArg) {
  const input = readJsonArg(jsonArg);
  if (!input || typeof input !== 'object' || (Array.isArray(input) && input.length === 0)) {
    die('action-save 需要一个 Action 对象或非空数组');
  }
  const items = Array.isArray(input) ? input : [input];
  const results = [];
  for (const item of items) {
    const saved = unwrap(await post('/action/save', item), 'action/save');
    results.push({
      id: saved.id,
      name: saved.name,
      status: saved.status,
      function: saved.function ? { id: saved.function.id } : undefined,
      codeHash: saved.codeHash,
    });
  }
  return Array.isArray(input) ? results : results[0];
}

async function trialAction(id, jsonArg) {
  const body = { id };
  if (jsonArg !== undefined) {
    const extra = readJsonArg(jsonArg);
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
      die('action-trial 第二个参数应为 JSON 对象：{"sample"?:{...},"parameters"?:{...}}');
    }
    const unknown = Object.keys(extra).filter((key) => key !== 'sample' && key !== 'parameters');
    if (unknown.length > 0) {
      die(`action-trial 仅接受 sample 和 parameters 字段，发现多余字段: ${unknown.join(', ')}`);
    }
    if (extra.sample !== undefined) body.sample = extra.sample;
    if (extra.parameters !== undefined) body.parameters = extra.parameters;
  }
  const data = unwrap(await post('/action/trial', body), 'action/trial');
  console.log(JSON.stringify(data, null, 2));
  if (data && data.passed === false) process.exit(2);
}

// ---------------------------------------------------------------- 子命令
const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'login') {
  if (args[0]) CODE = args[0];
  if (args[1]) PASS = args[1];
  if (args[2]) DOMAIN = args[2];
  const tk = await login();
  if (authMode === 'password') {
    console.log(JSON.stringify({ ok: true, authMode, tokenPrefix: tk.slice(0, 8), domain: DOMAIN }));
  } else {
    const user = unwrap(await get('/user/getCur'), 'getCur');
    console.log(JSON.stringify({ ok: true, authMode, loginCode: user.loginCode, domainId: user.domainId, domainName: user.domainName }));
  }
} else if (cmd === 'me') {
  const j = await get('/user/getCur');
  console.log(JSON.stringify(unwrap(j, 'getCur'), null, 2));
} else if (cmd === 'ping') {
  const j = await post('/workflow/query', {});
  console.log(JSON.stringify({ ok: j.success !== false, message: j.message }, null, 2));
} else if (cmd === 'roles') {
  const j = await post('/role/getRoleInfoPage', { pageNum: 1, pageSize: 200, cdt: '' });
  const page = unwrap(j, 'getRoleInfoPage');
  // 平台分页返回 Page{pageNum,pageSize,totalRows,totalPages,data}，不是 records/list
  const rows = (page && (page.data || page.records || page.list)) || (Array.isArray(page) ? page : []);
  console.log(JSON.stringify(rows.map((r) => ({ id: r.id, roleName: r.roleName, roleType: r.roleType, roleDesc: r.roleDesc })), null, 2));
} else if (cmd === 'role-save') {
  const body = readJsonArg(args[0]);
  // 服务端直接调 roleDesc.length()，缺字段会 NPE，所以先补空串（并提前告知调用方）
  if (body.roleDesc == null || body.roleDesc === '') {
    body.roleDesc = body.roleName ? `${body.roleName}（业务流程角色）` : '';
    console.error(`! 未提供 roleDesc，已自动补为「${body.roleDesc}」`);
  }
  const j = await post('/role/saveOrUpdate', body);
  console.log(JSON.stringify({ roleId: unwrap(j, 'saveOrUpdate') }, null, 2));
} else if (cmd === 'role-users') {
  const j = await post('/role/getRoleUsers', { id: args[0] });
  console.log(JSON.stringify(unwrap(j, 'getRoleUsers'), null, 2));
} else if (cmd === 'role-members') {
  // addRoleUserRlt 是 replace 语义：必须提交完整集合，漏掉现有成员就是把它们移出该角色。
  const roleId = args[0];
  if (!roleId) die('用法: role-members <roleId> [userIds逗号分隔]；不给 userIds 则只读当前成员');
  const current = unwrap(await post('/role/getRoleUsers', { id: roleId }), 'getRoleUsers') || [];
  const currentIds = current.map((r) => r.userId).filter(Boolean);
  if (!args[1]) {
    console.log(JSON.stringify({ roleId, members: currentIds }, null, 2));
  } else {
    const wanted = args[1].split(',').map((s) => s.trim()).filter(Boolean);
    const merged = [...new Set([...currentIds, ...wanted])];
    unwrap(await post('/role/addRoleUserRlt', { roleId, userIds: merged }), 'addRoleUserRlt');
    console.log(JSON.stringify({ roleId, before: currentIds, now: merged }, null, 2));
  }
} else if (cmd === 'subjects') {
  const j = await post('/workflow/subjects', {});
  console.log(JSON.stringify(unwrap(j, 'subjects'), null, 2));
} else if (cmd === 'actions') {
  const j = await post('/action/queryList', { status: args[0] || null });
  const data = unwrap(j, 'queryList');
  const rows = Array.isArray(data) ? data : (data && (data.records || data.list)) || [];
  console.log(JSON.stringify(rows.map((a) => ({ id: a.id, name: a.name, status: a.status, trialStatus: a.trialStatus, operation: a.function && a.function.operation })), null, 2));
} else if (cmd === 'action-get') {
  const j = await post('/action/queryById', { id: args[0] });
  console.log(JSON.stringify(unwrap(j, 'queryById'), null, 2));
} else if (cmd === 'action-save') {
  console.log(JSON.stringify(await saveActions(args[0]), null, 2));
} else if (cmd === 'action-trial') {
  if (!args[0]) die('用法: action-trial <actionId> [<json|@json>]');
  await trialAction(args[0], args[1]);
} else if (cmd === 'action-reexplain') {
  const body = readJsonArg(args[0]);
  const j = await post('/action/re-explain', { ...body, missingOnly: body.missingOnly ?? false });
  console.log(JSON.stringify(unwrap(j, 'action/re-explain'), null, 2));
} else if (cmd === 'action-publish') {
  const id = args[0];
  if (!id) die('用法: action-publish <actionId>');
  const data = unwrap(await post('/action/setStatus', { ids: [id], status: 'PUBLISHED' }), 'action/setStatus');
  const item = data?.items?.[0];
  if (!item || item.outcome !== 'success') {
    const reason = item?.error?.message || item?.message || item?.code || '未知拒绝原因';
    die(`action PUBLISHED 失败 (${id}): ${reason}`, item);
  }
  const saved = item.data || {};
  const out = { id: saved.id || item.id || id, status: saved.status || 'PUBLISHED' };
  if (saved.codeHash !== undefined) out.codeHash = saved.codeHash;
  console.log(JSON.stringify(out, null, 2));
} else if (cmd === 'wf-save') {
  const body = readJsonArg(args[0]);
  const j = await post('/workflow/save', body);
  const data = unwrap(j, 'workflow/save');
  console.log(JSON.stringify({ id: data.id, name: data.name, status: data.status, version: data.version }, null, 2));
} else if (cmd === 'wf-query') {
  const body = args[0] ? { id: args[0] } : {};
  if (args[1] === '--active') body.status = 'ACTIVE';
  const j = await post('/workflow/query', body);
  console.log(JSON.stringify(unwrap(j, 'workflow/query'), null, 2));
} else if (cmd === 'wf-activate') {
  const j = await post('/workflow/activate', { id: args[0] });
  const data = unwrap(j, 'workflow/activate');
  console.log(JSON.stringify({ id: data.id, status: data.status, version: data.version }, null, 2));
} else if (cmd === 'wf-deactivate') {
  const j = await post('/workflow/deactivate', { id: args[0] });
  const data = unwrap(j, 'workflow/deactivate');
  console.log(JSON.stringify({ id: data.id, status: data.status, version: data.version }, null, 2));
} else if (cmd === 'wf-delete') {
  const j = await post('/workflow/delete', { id: args[0] });
  unwrap(j, 'workflow/delete');
  console.log(JSON.stringify({ ok: true }));
} else if (cmd === 'wf-grants') {
  const j = await post('/workflow/grants', {});
  console.log(JSON.stringify(unwrap(j, 'workflow/grants'), null, 2));
} else if (cmd === 'wf-access') {
  const j = await post('/workflow/platform-access', {});
  console.log(JSON.stringify(unwrap(j, 'platform-access'), null, 2));
} else if (cmd === 'run') {
  const out = await executeAction(args[0], JSON.parse(args[1] || '{}'));
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) process.exit(2);
} else if (cmd === 'dsl') {
  const body = readJsonArg(args[0]);
  const j = await post('/dsl/executeV1', body);
  if (j.error) die('DSL 执行失败', j.error);
  const answer = (j.data && j.data[0] && j.data[0].answer) || [];
  console.log(JSON.stringify(answer, null, 2));
} else {
  console.log(`Ontomato 业务流程构建客户端

环境变量：
  WF_BASE / ONTOMATO_ONTOLOGY_URL   后端基址（默认 http://localhost:8080/api/data-query）
  WF_AUTH                           认证基址（默认 http://localhost:8080/api/auth）
  WF_TOKEN / ONTOMATO_TK            平台 token（优先；无需 WF_DOMAIN）
  WF_API_KEY / ONTOMATO_API_KEY     Ontomato API Key（次优；无需 WF_DOMAIN）
  WF_CODE / WF_PASS / WF_DOMAIN     用户名+密码（默认 test/admin；此模式须给 WF_DOMAIN）

  login [<code> <pass> <domainId>] 验证登录与域
  me                               当前账号
  ping                             后端与 workflow 接口是否活着
  roles                            列出域内角色（roleName 就是流程步骤的 roleCode）
  role-members <roleId> [userIds]  看/合并角色成员（内部按 replace 语义保全集）
  role-save <json>                 新建/改名角色 {roleName, roleType, roleDesc}
  role-users <roleId>              某角色下的成员（原始返回）
  subjects                         域内主体及其有效角色（判定"这步有没有人能做"）
  actions [status]                 列出动作
  action-get <actionId>            动作详情（含 function 与 submissionCriteria）
  action-save <json|@json>         保存动作草稿（新建省略 id，由服务端返回）
  action-trial <id> [json|@json]   沙箱试跑已保存动作（唯一试跑入口，POST /action/trial）
  action-reexplain <json>          刷新动作解释 {ids:[...],missingOnly?}
  action-publish <actionId>        解读就绪且当前版本试跑通过后置为 PUBLISHED（setStatus）
  wf-save <json>                   存流程草稿，保留已激活版本
  wf-query [id] [--active]         查可编辑定义，--active 查生效快照
  wf-activate <id>                 激活：冻结版本 + 落授权
  wf-deactivate <id>               失效：只回收该版本授权
  wf-delete <id>                   删除草稿/已失效流程
  wf-grants                        当前域实际生效的授权行
  wf-access                        角色可用的平台操作
  run <actionId> <paramJson>       执行动作
  dsl <json|@json>                 跑查询 DSL
`);
}
