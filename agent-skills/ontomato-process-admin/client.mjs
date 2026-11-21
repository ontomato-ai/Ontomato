#!/usr/bin/env node
/**
 * Ontomato 流程管理员客户端。
 *
 * 一个域管理员用它完成：组织架构、成员、角色、角色权限（岗位 API/菜单）、
 * Action、Workflow、Trigger、激活授权与可用性检查。
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
 *
 * 所有写命令都支持 --dry-run：只在本地打印方法/路径/请求体，不登录、不访问服务端、不落库。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const BASE = (process.env.OA_BASE || process.env.ONTOMATO_ONTOLOGY_URL || 'http://localhost:8080/api/data-query').replace(/\/+$/, '');
const AUTH = process.env.OA_AUTH || 'http://localhost:8080/api/auth';
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

const page = { pageNum: 1, pageSize: 200, cdt: '' };

async function importActions(jsonArg) {
  const list = readJsonArg(jsonArg);
  const arr = Array.isArray(list) ? list : [list];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-import-'));
  const inner = path.join(dir, 'actions.json');
  const zipPath = path.join(dir, 'actions.zip');
  fs.writeFileSync(inner, JSON.stringify(arr));
  execFileSync('zip', ['-j', '-q', zipPath, inner]);
  if (DRY) {
    console.log(JSON.stringify({ dryRun: true, method: 'POST', path: '/action/import', actions: arr.map((a) => a.id || a.name) }, null, 2));
    return { dryRun: true };
  }
  const tk = await login();
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(zipPath)]), 'actions.zip');
  const r = await fetch(`${BASE}/action/import?allowMissingExplanation=true`, {
    method: 'POST',
    headers: { tk, 'Accept-Language': 'zh-CN' },
    body: fd,
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    die(`/action/import 返回非 JSON（HTTP ${r.status}）`, text.slice(0, 500));
  }
  return json;
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
  const u = await get('/user/getCur');
  console.log(JSON.stringify({ id: u.id, loginCode: u.loginCode, userName: u.userName, domainId: u.domainId, domainName: u.domainName, roles: u.roles, isAdmin: u.isAdmin }, null, 2));
} else if (cmd === 'me-full') {
  console.log(JSON.stringify(await get('/user/getCur'), null, 2));
} else if (cmd === 'ping') {
  const data = await post('/workflow/query', {});
  console.log(JSON.stringify({ ok: true, workflows: Array.isArray(data) ? data.length : undefined }, null, 2));
} else if (cmd === 'domains') {
  console.log(JSON.stringify(await post('/domain/list', {}), null, 2));
} else if (cmd === 'domain-create') {
  const body = readJsonArg(requireArg(args, 0, 'domain-create <json>{domainName,domainDesc,adminLoginCode}'));
  const data = await post('/domain/create', body);
  console.log(JSON.stringify({ ...data, note: '域管理员初始密码由平台设为 admin' }, null, 2));
} else if (cmd === 'subjects') {
  console.log(JSON.stringify(await post('/workflow/subjects', {}), null, 2));
} else if (cmd === 'roles') {
  const data = await post('/role/getRoleInfoPage', page);
  console.log(JSON.stringify(rowsOf(data).map((r) => ({ id: r.id, roleName: r.roleName, roleType: r.roleType, roleDesc: r.roleDesc })), null, 2));
} else if (cmd === 'role-save') {
  const body = readJsonArg(requireArg(args, 0, 'role-save <json>{id?,roleName,roleDesc,roleType?}'));
  if (!body.roleDesc) {
    body.roleDesc = body.roleName ? `${body.roleName}（业务流程角色）` : '';
    console.error(`! 未提供 roleDesc，已补为「${body.roleDesc}」`);
  }
  const id = await post('/role/saveOrUpdate', body);
  console.log(JSON.stringify({ roleId: id }, null, 2));
} else if (cmd === 'role-members') {
  const roleId = requireArg(args, 0, 'role-members <roleId> [userIds逗号分隔]');
  if (DRY) {
    console.log(JSON.stringify({ dryRun: true, note: '实际会先读当前成员再取并集', path: '/role/addRoleUserRlt', body: { roleId, userIds: args[1] ? args[1].split(',').filter(Boolean) : [] } }, null, 2));
  } else {
    const current = rowsOf(await post('/role/getRoleUsers', { id: roleId })).map((r) => r.userId).filter(Boolean);
    if (!args[1]) {
      console.log(JSON.stringify({ roleId, members: current }, null, 2));
    } else {
      const wanted = args[1].split(',').map((s) => s.trim()).filter(Boolean);
      const merged = [...new Set([...current, ...wanted])];
      await post('/role/addRoleUserRlt', { roleId, userIds: merged });
      console.log(JSON.stringify({ roleId, before: current, now: merged, note: 'replace 语义，已保留原成员' }, null, 2));
    }
  }
} else if (cmd === 'role-posts') {
  const roleId = requireArg(args, 0, 'role-posts <roleId> [postIds逗号分隔]');
  if (DRY) {
    console.log(JSON.stringify({ dryRun: true, path: '/role/addRolePostRlt', body: { roleId, postIds: args[1] ? args[1].split(',').filter(Boolean) : [] } }, null, 2));
  } else {
    const current = rowsOf(await post('/role/getRolePosts', { id: roleId })).map((r) => r.postId).filter(Boolean);
    if (!args[1]) {
      console.log(JSON.stringify({ roleId, postIds: current }, null, 2));
    } else {
      const wanted = args[1].split(',').map((s) => s.trim()).filter(Boolean);
      const merged = [...new Set([...current, ...wanted])];
      await post('/role/addRolePostRlt', { roleId, postIds: merged });
      console.log(JSON.stringify({ roleId, before: current, now: merged }, null, 2));
    }
  }
} else if (cmd === 'role-posts-set') {
  const roleId = requireArg(args, 0, 'role-posts-set <roleId> <postIds逗号分隔>');
  const postIds = args[1] ? args[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
  await post('/role/addRolePostRlt', { roleId, postIds });
  console.log(JSON.stringify({ roleId, postIds, note: 'exact replace；不保留旧岗位' }, null, 2));
} else if (cmd === 'post-delete') {
  const id = requireArg(args, 0, 'post-delete <postId>');
  await post('/post/deleteById', { id });
  console.log(JSON.stringify({ ok: true, postId: id }, null, 2));
} else if (cmd === 'users') {
  const data = await post('/user/getUserInfoPage', page);
  console.log(JSON.stringify(rowsOf(data), null, 2));
} else if (cmd === 'user-save') {
  const body = readJsonArg(requireArg(args, 0, 'user-save <json>{id?,loginCode,userName,loginPasswd?,roles?,permissionAttributes?}'));
  if (!body.id && !body.loginPasswd) die('新建用户必须提供 loginPasswd');
  // 平台在 UserSvcImpl.pwd 里用私钥 decrypt，所以这里必须是 RSA 加密后的密文，不是明文。
  if (body.loginPasswd && !body.loginPasswdEncrypted) body.loginPasswd = enc(body.loginPasswd);
  delete body.loginPasswdEncrypted;
  console.log(JSON.stringify(await post('/user/saveOrUpdate', body), null, 2));
} else if (cmd === 'user-delete') {
  const ids = requireArg(args, 0, 'user-delete <userId1,userId2>').split(',').map((s) => s.trim()).filter(Boolean);
  await post('/user/deleteByIds', ids);
  console.log(JSON.stringify({ ok: true, userIds: ids }, null, 2));
} else if (cmd === 'user-apikey') {
  const userId = requireArg(args, 0, 'user-apikey <userId>');
  const apiKey = await post('/user/generateApiKey', { userId });
  console.log(JSON.stringify({ userId, apiKey, note: '明文只返回一次' }, null, 2));
} else if (cmd === 'business-config') {
  console.log(JSON.stringify(await get('/businessConfig/getConfig'), null, 2));
} else if (cmd === 'datasource-multi') {
  const body = readJsonArg(requireArg(args, 0, 'datasource-multi <json>{dataSources,classes,relationships}'));
  await post('/businessConfig/useMultiDataSource', body);
  console.log(JSON.stringify({ ok: true, note: 'multiSource 已保存；运行中的数据引擎可能需要重启才会换连接' }, null, 2));
} else if (cmd === 'org-tree') {
  console.log(JSON.stringify(await get('/organization/snapshot'), null, 2));
} else if (cmd === 'org-unit-save') {
  const body = readJsonArg(requireArg(args, 0, 'org-unit-save <json>{id?,parentId?,name,code?,description?,sort?}'));
  const id = await post('/organization/unit/save', body);
  console.log(JSON.stringify({ orgId: id, note: '每个域只允许一个根；code 缺省时由平台生成 org-<uuid>' }, null, 2));
} else if (cmd === 'org-unit-delete') {
  const id = requireArg(args, 0, 'org-unit-delete <orgId>');
  await post('/organization/unit/delete', { id });
  console.log(JSON.stringify({ ok: true, orgId: id }, null, 2));
} else if (cmd === 'member-save') {
  const userId = requireArg(args, 0, 'member-save <userId> <orgId>');
  const orgId = requireArg(args, 1, 'member-save <userId> <orgId>');
  await post('/organization/membership/save', { userId, orgId });
  console.log(JSON.stringify({ ok: true, userId, orgId }, null, 2));
} else if (cmd === 'member-remove') {
  const userId = requireArg(args, 0, 'member-remove <userId> <orgId>');
  const orgId = requireArg(args, 1, 'member-remove <userId> <orgId>');
  await post('/organization/membership/remove', { userId, orgId });
  console.log(JSON.stringify({ ok: true, userId, orgId }, null, 2));
} else if (cmd === 'member-lock') {
  const userId = requireArg(args, 0, 'member-lock <userId> <orgId> true|false');
  const orgId = requireArg(args, 1, 'member-lock <userId> <orgId> true|false');
  const locked = args[2] === 'true';
  await post('/organization/membership/lock', { userId, orgId, locked });
  console.log(JSON.stringify({ ok: true, userId, orgId, locked }, null, 2));
} else if (cmd === 'position-save') {
  const body = readJsonArg(requireArg(args, 0, 'position-save <json>{id?,orgId,name,description?,assigneeIds:[]}'));
  if (!Array.isArray(body.assigneeIds)) die('position-save 必须提供 assigneeIds 数组（空数组表示清空）');
  const id = await post('/organization/position/state/save', body);
  console.log(JSON.stringify({ positionId: id }, null, 2));
} else if (cmd === 'position-delete') {
  const id = requireArg(args, 0, 'position-delete <positionId>');
  await post('/organization/position/delete', { id });
  console.log(JSON.stringify({ ok: true, positionId: id }, null, 2));
} else if (cmd === 'grant-save') {
  const body = readJsonArg(requireArg(args, 0, 'grant-save <json>{original?,recipient:{grantType,sourceId},roleIds:[],scopes:[]}'));
  await post('/organization/grant/save', body);
  console.log(JSON.stringify({ ok: true, note: 'grantType: organization|subtree|position；scopeType 另见 SKILL.md' }, null, 2));
} else if (cmd === 'grant-delete') {
  const body = readJsonArg(requireArg(args, 0, 'grant-delete <json>{grantType,sourceId}'));
  await post('/organization/grant/delete', body);
  console.log(JSON.stringify({ ok: true }, null, 2));
} else if (cmd === 'posts') {
  const data = await post('/post/getPostInfoPage', page);
  console.log(JSON.stringify(rowsOf(data), null, 2));
} else if (cmd === 'post-save') {
  const body = readJsonArg(requireArg(args, 0, 'post-save <json>{id?,postName,postType,fullData,postDesc,sort,parentId}'));
  const id = await post('/post/saveOrUpdate', body);
  console.log(JSON.stringify({ postId: id }, null, 2));
} else if (cmd === 'api-list') {
  console.log(JSON.stringify(await get('/sysop/getAllApiPermission'), null, 2));
} else if (cmd === 'menu-list') {
  console.log(JSON.stringify(await get('/sysop/getAllMenus'), null, 2));
} else if (cmd === 'post-api') {
  const postId = requireArg(args, 0, 'post-api <postId> [apiIds逗号分隔]');
  if (!args[1]) {
    console.log(JSON.stringify(await post('/sysop/getAllApiPermissionByPostId', { id: postId }), null, 2));
  } else {
    const ids = args[1].split(',').map((s) => s.trim()).filter(Boolean);
    await post('/post/replacePostApiPermission', { postId, ids });
    console.log(JSON.stringify({ ok: true, postId, ids, note: 'replace 语义' }, null, 2));
  }
} else if (cmd === 'post-menu') {
  const postId = requireArg(args, 0, 'post-menu <postId> [menuIds逗号分隔]');
  if (!args[1]) {
    console.log(JSON.stringify(await post('/sysop/getAllMenuPermissionByPostId', { id: postId }), null, 2));
  } else {
    const menuIds = args[1].split(',').map((s) => s.trim()).filter(Boolean);
    await post('/sysop/replacePostMenuPermission', { postId, menuIds });
    console.log(JSON.stringify({ ok: true, postId, menuIds, note: 'replace 语义' }, null, 2));
  }
} else if (cmd === 'post-data') {
  const postId = requireArg(args, 0, 'post-data <postId>');
  console.log(JSON.stringify(await post('/sysop/getAllDataPermissionByPostId', { id: postId }), null, 2));
} else if (cmd === 'data-permission-save') {
  const body = readJsonArg(requireArg(args, 0, 'data-permission-save <json>{id?,postId,dataType,className,permission}'));
  const id = await post('/sysop/saveOrUpdateDataPermission', body);
  console.log(JSON.stringify({ id }, null, 2));
} else if (cmd === 'data-permission-delete') {
  const id = requireArg(args, 0, 'data-permission-delete <id>');
  await post('/sysop/deleteDataPermissionById', { id });
  console.log(JSON.stringify({ ok: true, id }, null, 2));
} else if (cmd === 'actions') {
  const data = await post('/action/queryList', { status: args[0] || null });
  console.log(JSON.stringify(rowsOf(data).map((a) => ({ id: a.id, name: a.name, status: a.status, approvalMode: a.approvalMode, operation: a.function && a.function.operation })), null, 2));
} else if (cmd === 'action-get') {
  console.log(JSON.stringify(await post('/action/queryById', { id: requireArg(args, 0, 'action-get <actionId>') }), null, 2));
} else if (cmd === 'action-import') {
  const j = await importActions(requireArg(args, 0, 'action-import <json|@json>'));
  console.log(JSON.stringify(j, null, 2));
  if (j.success === false) process.exit(1);
} else if (cmd === 'action-reexplain') {
  const body = readJsonArg(requireArg(args, 0, 'action-reexplain <json>{ids:[...]}'));
  console.log(JSON.stringify(await post('/action/re-explain', { ...body, missingOnly: body.missingOnly ?? false }), null, 2));
} else if (cmd === 'action-publish') {
  const id = requireArg(args, 0, 'action-publish <actionId>');
  const action = await post('/action/queryById', { id });
  action.status = 'PUBLISHED';
  const saved = await post('/action/save', action);
  console.log(JSON.stringify({ id: saved.id, status: saved.status, codeHash: saved.codeHash }, null, 2));
} else if (cmd === 'action-retire') {
  const id = requireArg(args, 0, 'action-retire <actionId>');
  const action = await post('/action/queryById', { id });
  action.status = 'UNUSED';
  const saved = await post('/action/save', action);
  console.log(JSON.stringify({ id: saved.id, status: saved.status }, null, 2));
} else if (cmd === 'wf-save') {
  const body = readJsonArg(requireArg(args, 0, 'wf-save <json>{name,steps,runClassName,runContract,temporary,caseFormSchema}'));
  const data = await post('/workflow/save', body);
  console.log(JSON.stringify({ id: data.id, name: data.name, status: data.status, version: data.version }, null, 2));
} else if (cmd === 'wf-query') {
  console.log(JSON.stringify(await post('/workflow/query', args[0] ? { id: args[0] } : {}), null, 2));
} else if (cmd === 'wf-activate') {
  const data = await post('/workflow/activate', { id: requireArg(args, 0, 'wf-activate <workflowId>') });
  console.log(JSON.stringify({ id: data.id, status: data.status, version: data.version, activationNotes: data.activationNotes }, null, 2));
} else if (cmd === 'wf-deactivate') {
  const data = await post('/workflow/deactivate', { id: requireArg(args, 0, 'wf-deactivate <workflowId>') });
  console.log(JSON.stringify({ id: data.id, status: data.status, version: data.version }, null, 2));
} else if (cmd === 'wf-delete') {
  await post('/workflow/delete', { id: requireArg(args, 0, 'wf-delete <workflowId>') });
  console.log(JSON.stringify({ ok: true }));
} else if (cmd === 'wf-grants') {
  console.log(JSON.stringify(await post('/workflow/grants', {}), null, 2));
} else if (cmd === 'wf-access') {
  console.log(JSON.stringify(await post('/workflow/platform-access', {}), null, 2));
} else if (cmd === 'trigger-save') {
  const body = readJsonArg(requireArg(args, 0, 'trigger-save <json>{name,conditionKind,condition,effectKind,effect,executor,enabled}'));
  const data = await post('/trigger/save', body);
  console.log(JSON.stringify({ trigger: data, note: '只有 time 条件与 action/workflow 效果可保存' }, null, 2));
} else if (cmd === 'trigger-list') {
  console.log(JSON.stringify(await post('/trigger/queryList', { status: args[0] || null }), null, 2));
} else if (cmd === 'trigger-get') {
  console.log(JSON.stringify(await post('/trigger/queryById', { id: requireArg(args, 0, 'trigger-get <id>') }), null, 2));
} else if (cmd === 'trigger-status') {
  const id = requireArg(args, 0, 'trigger-status <id> <PUBLISHED|UNUSED|PENDING_REVIEW> [enabled]');
  const status = requireArg(args, 1, 'trigger-status <id> <PUBLISHED|UNUSED|PENDING_REVIEW> [enabled]');
  const body = { id, status, enabled: args[2] === undefined ? status === 'PUBLISHED' : args[2] === 'true' };
  console.log(JSON.stringify(await post('/trigger/status', body), null, 2));
} else if (cmd === 'trigger-run') {
  console.log(JSON.stringify(await post('/trigger/run', { id: requireArg(args, 0, 'trigger-run <id>') }), null, 2));
} else if (cmd === 'trigger-delete') {
  await post('/trigger/delete', { id: requireArg(args, 0, 'trigger-delete <id>') });
  console.log(JSON.stringify({ ok: true }));
} else if (cmd === 'verify') {
  const workflowId = requireArg(args, 0, 'verify <workflowId>');
  const [workflow, grants, subjects, roles] = await Promise.all([
    post('/workflow/query', { id: workflowId, status: 'ACTIVE' }),
    post('/workflow/grants', {}),
    post('/workflow/subjects', {}),
    post('/role/getRoleInfoPage', page),
  ]);
  const roleIdsByCode = new Map();
  for (const role of rowsOf(roles)) {
    const code = String(role.roleName || '').toUpperCase();
    if (!code || !role.id) continue;
    if (!roleIdsByCode.has(code)) roleIdsByCode.set(code, new Set());
    roleIdsByCode.get(code).add(role.id);
  }
  const subjectRoleIds = new Set((subjects || []).flatMap((s) => s.roleIds || []));
  const inForceRoleCodes = new Set(
    (grants || []).filter((grant) => grant.inForce).map((grant) => String(grant.roleCode || '').toUpperCase()).filter(Boolean)
  );
  const checks = [];
  checks.push({ check: 'status=ACTIVE', ok: workflow?.status === 'ACTIVE', value: workflow?.status });
  checks.push({ check: 'version>=1', ok: Number(workflow?.version) >= 1, value: workflow?.version });
  checks.push({ check: 'activationNotes empty', ok: !(workflow?.activationNotes || []).length, value: workflow?.activationNotes });
  checks.push({ check: 'runContract or temporary declared', ok: Boolean(workflow?.runContract) || workflow?.temporary === true, value: workflow?.runContract || workflow?.temporary });
  for (const step of workflow?.steps || []) {
    const code = String(step.roleCode || '').toUpperCase();
    const roleIds = roleIdsByCode.get(code) || new Set();
    const members = [...subjectRoleIds].filter((id) => roleIds.has(id)).length;
    checks.push({ check: `step ${step.stepNo} role ${step.roleCode} has members`, ok: Boolean(code) && members > 0, value: members });
    checks.push({ check: `step ${step.stepNo} actionId`, ok: Boolean(step.actionId), value: step.actionId });
    const invocation = step.invocationMode || 'manual';
    checks.push({
      check: `step ${step.stepNo} invocationMode`,
      ok: invocation === 'manual',
      value: invocation === 'automatic' ? 'automatic is reserved and not implemented yet' : invocation,
    });
    const policy = step.actorPolicy || { mode: 'none' };
    const policyMode = policy.mode || 'none';
    checks.push({ check: `step ${step.stepNo} actorPolicy mode`, ok: ['none', 'rule', 'agent'].includes(policyMode), value: policyMode });
    if (policyMode === 'rule') {
      checks.push({
        check: `step ${step.stepNo} rule MetricView`,
        ok: Boolean(policy.metricViewId && policy.metricRevision),
        value: { metricViewId: policy.metricViewId, metricRevision: policy.metricRevision },
      });
    }
    if (policyMode === 'agent') {
      checks.push({ check: `step ${step.stepNo} agentId`, ok: Boolean(policy.agentId), value: policy.agentId });
    }
    if (step.caseScoped === true && (policyMode === 'rule' || policyMode === 'agent')) {
      checks.push({
        check: `step ${step.stepNo} role ${step.roleCode} has in-force grant for actor resolution`,
        ok: inForceRoleCodes.has(code),
        value: inForceRoleCodes.has(code) ? 'resolvable' : 'caseScoped steps write no grant; add an in-force ordinary grant for this role',
      });
    }
  }
  console.log(JSON.stringify({ workflowId, hasDraft: workflow?.hasDraft ?? false, ok: checks.every((c) => c.ok), checks }, null, 2));
} else {
  console.log(`Ontomato 流程管理员客户端

认证（三选一，无默认账号）：
  OA_CODE / OA_PASS / OA_DOMAIN   用户名+密码
  ONTOMATO_TK / OA_TOKEN          平台 token
  ONTOMATO_API_KEY / OA_API_KEY   Ontomato API Key
  优先级：--token > --api-key > 用户名+密码；也可用 --user/--password/--domain。

环境变量：ONTOMATO_ONTOLOGY_URL 或 OA_BASE / OA_AUTH
写命令都支持 --dry-run（纯本地，不登录、不访问服务端、不落库）。

身份与环境
  login [--token <tk> | --api-key <key> | <code> <pass> [domainId]]
                                   验证当前认证
  me                               当前账号（简要）
  me-full                          当前账号完整信息（含 API/菜单权限）
  ping                             workflow 接口是否可达
  domains / domain-create <json>   域列表 / 建域（superAdmin）

主体与组织
  subjects                         域内主体及有效角色
  users                            用户分页
  user-save <json>                 新建/修改用户（新建必须有 loginPasswd）
  user-delete <id1,id2>            删除用户
  user-apikey <userId>             生成 Ontomato API Key（明文只返回一次）
  business-config                  当前业务配置
  datasource-multi <json>          配置 multiSource（业务 + 账本）
  org-tree                         组织快照（单位/岗位/成员/授权）
  org-unit-save <json>             建/改组织单位
  org-unit-delete <id>             删组织单位
  member-save <userId> <orgId>     加成员
  member-remove <userId> <orgId>   移除成员
  member-lock <userId> <orgId> <true|false>
  position-save <json>             岗位（assigneeIds 必填）
  position-delete <id>
  grant-save <json>                组织授权（recipient + roleIds + scopes）
  grant-delete <json>              {grantType,sourceId}

角色与权限
  roles / role-save <json>         角色列表 / 新建或改名
  role-members <roleId> [ids]      看/合并角色成员
  role-posts <roleId> [postIds]    看/合并角色岗位
  role-posts-set <roleId> <postIds> 精确替换角色岗位（不保留旧值）
  posts / post-save <json>         岗位列表 / 新建或改名
  post-delete <id>                 删除岗位
  api-list / menu-list             全部 API / 菜单权限项
  post-api <postId> [apiIds]       看/替换岗位 API 权限
  post-menu <postId> [menuIds]     看/替换岗位菜单权限
  post-data <postId>               看岗位数据权限
  data-permission-save <json>      建/改数据权限（dataType 1 行 / 2 字段）
  data-permission-delete <id>      删数据权限

能力与流程
  actions [status]                 动作列表
  action-get <id>                  动作详情
  action-import <json|@json>       导入动作（zip 内部完成）
  action-reexplain <json>          刷新动作解释
  action-publish <id>              解释生成后把动作置为 PUBLISHED
  action-retire <id>               把动作置为 UNUSED（退休，不删）
  wf-save <json>                   存流程草稿
  wf-query [id]                    查流程
  wf-activate <id>                 激活：冻结版本 + 落授权
  wf-deactivate <id>               失效：回收该版本授权
  wf-delete <id>                   删除草稿/已失效流程
  wf-grants / wf-access            生效授权 / 角色平台操作
  trigger-save <json>              建/改触发器（time + action/workflow）
  trigger-list / trigger-get <id>
  trigger-status <id> <status> [enabled]
  trigger-run <id> / trigger-delete <id>
  verify <workflowId>              检查激活状态、授权、每步角色成员、runContract
`);
}
