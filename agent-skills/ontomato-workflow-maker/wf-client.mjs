#!/usr/bin/env node
/**
 * Ontomato 业务流程构建客户端（Workflow / Action / Role）。
 *
 * 只管与平台对话，不含任何业务判断；业务判断在 SKILL.md 里。
 * 全部端点都走网关 data-query 前缀；可用环境变量覆盖：
 *   WF_BASE   默认 http://localhost:8080/api/data-query
 *   WF_AUTH   默认 http://localhost:8080/api/auth
 *   WF_DOMAIN 域 id（必须给，或用 login 子命令的第三参数）
 *   WF_CODE / WF_PASS 登录名与密码（默认 test / admin）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const BASE = process.env.WF_BASE || 'http://localhost:8080/api/data-query';
const AUTH = process.env.WF_AUTH || 'http://localhost:8080/api/auth';
const DOMAIN = process.env.WF_DOMAIN || '';
const CODE = process.env.WF_CODE || 'test';
const PASS = process.env.WF_PASS || 'admin';

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

async function login() {
  if (cachedToken) return cachedToken;
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
  const tk = await login();
  const r = await fetch(`${BASE}${backendPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', tk, 'Accept-Language': 'zh-CN' },
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
  if (json.success === false) die(`${what} 失败`, json.message || json);
  return json.data !== undefined ? json.data : json;
}

async function get(backendPath) {
  const tk = await login();
  const r = await fetch(`${BASE}${backendPath}`, { headers: { tk, 'Accept-Language': 'zh-CN' } });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    die(`${backendPath} 返回非 JSON（HTTP ${r.status}）`, text.slice(0, 500));
  }
}

/** Action 执行是 multipart；参数放 param 字段，且必须整体是字符串。 */
async function executeAction(actionId, param) {
  const tk = await login();
  const fd = new FormData();
  fd.append('id', actionId);
  fd.append('param', JSON.stringify(param || {}));
  const r = await fetch(`${BASE}/action/execute`, {
    method: 'POST',
    headers: { tk, 'Accept-Language': 'zh-CN' },
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

/** 导入要求 zip 里恰好一个 .json；用系统 zip 造包，避免自带 ZIP 实现。 */
async function importActions(jsonFile) {
  const list = readJsonArg(jsonFile);
  const arr = Array.isArray(list) ? list : [list];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-import-'));
  const inner = path.join(dir, 'actions.json');
  const zipPath = path.join(dir, 'actions.zip');
  fs.writeFileSync(inner, JSON.stringify(arr));
  execFileSync('zip', ['-j', '-q', zipPath, inner]);
  const tk = await login();
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(zipPath)]), 'actions.zip');
  const r = await fetch(`${BASE}/action/import?allowMissingExplanation=true`, {
    method: 'POST',
    headers: { tk, 'Accept-Language': 'zh-CN' },
    body: fd,
  });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    die(`/action/import 返回非 JSON（HTTP ${r.status}）`, text.slice(0, 500));
  }
}

// ---------------------------------------------------------------- 子命令
const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'login') {
  if (args[2]) process.env.WF_DOMAIN = args[2];
  const tk = await login();
  console.log(JSON.stringify({ ok: true, tokenPrefix: tk.slice(0, 8), domain: process.env.WF_DOMAIN }));
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
  console.log(JSON.stringify(rows.map((a) => ({ id: a.id, name: a.name, status: a.status, operation: a.function && a.function.operation })), null, 2));
} else if (cmd === 'action-get') {
  const j = await post('/action/queryById', { id: args[0] });
  console.log(JSON.stringify(unwrap(j, 'queryById'), null, 2));
} else if (cmd === 'action-import') {
  const j = await importActions(args[0]);
  console.log(JSON.stringify(j, null, 2));
  if (j.success === false) process.exit(1);
} else if (cmd === 'wf-save') {
  const body = readJsonArg(args[0]);
  const j = await post('/workflow/save', body);
  const data = unwrap(j, 'workflow/save');
  console.log(JSON.stringify({ id: data.id, name: data.name, status: data.status, version: data.version }, null, 2));
} else if (cmd === 'wf-query') {
  const j = await post('/workflow/query', args[0] ? { id: args[0] } : {});
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

环境变量：WF_BASE / WF_AUTH / WF_DOMAIN / WF_CODE / WF_PASS

  login <code> <pass> <domainId>   验证登录与域
  me                               当前账号
  ping                             后端与 workflow 接口是否活着
  roles                            列出域内角色（roleName 就是流程步骤的 roleCode）
  role-members <roleId> [userIds]  看/合并角色成员（内部按 replace 语义保全集）
  role-save <json>                 新建/改名角色 {roleName, roleType, roleDesc}
  role-users <roleId>              某角色下的成员（原始返回）
  subjects                         域内主体及其有效角色（判定"这步有没有人能做"）
  actions [status]                 列出动作
  action-get <actionId>            动作详情（含 function 与 submissionCriteria）
  action-import <json|@json>       导入动作（zip 内部完成）
  wf-save <json>                   存流程草稿（DRAFT）
  wf-query [id]                    查流程定义
  wf-activate <id>                 激活：冻结版本 + 落授权
  wf-deactivate <id>               失效：只回收该版本授权
  wf-delete <id>                   删除草稿/已失效流程
  wf-grants                        当前域实际生效的授权行
  wf-access                        角色可用的平台操作
  run <actionId> <paramJson>       执行动作
  dsl <json|@json>                 跑查询 DSL
`);
}
