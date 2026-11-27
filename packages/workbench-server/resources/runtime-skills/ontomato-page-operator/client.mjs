#!/usr/bin/env node
/**
 * Page discovery client for an Ontomato agent run.
 *
 * Uses the per-run callback boundary injected by the platform:
 *   ONTOMATO_PANEL_OPERATIONS_URL
 *   ONTOMATO_EXECUTION_CALLBACK
 *   ONTOMATO_RUN_ID
 * No platform token, curl command, host, or credential has to be assembled by the agent.
 */
import fs from 'node:fs';

const root = (process.env.ONTOMATO_PANEL_OPERATIONS_URL || '').replace(/\/+$/, '');
const credential = process.env.ONTOMATO_EXECUTION_CALLBACK || '';
const runId = process.env.ONTOMATO_RUN_ID || '';

function die(message, extra) {
  console.error(`✗ ${message}`);
  if (extra !== undefined) console.error(typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2));
  process.exit(1);
}

function readJsonArg(arg, usage) {
  if (!arg) die(usage);
  const text = arg.trim().startsWith('{') ? arg : fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg.startsWith('@') ? arg.slice(1) : null;
  if (text === null) die(`不是 JSON 对象、JSON 文件路径或 @内联 JSON: ${arg}`);
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) die('参数必须是 JSON 对象');
    return value;
  } catch (error) {
    die(`不是合法 JSON: ${error.message}`);
  }
}

async function post(path, body) {
  if (!root || !credential || !runId) die('缺少运行环境：ONTOMATO_PANEL_OPERATIONS_URL / ONTOMATO_EXECUTION_CALLBACK / ONTOMATO_RUN_ID');
  const response = await fetch(`${root}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.ONTOMATO_LANGUAGE ? { 'Accept-Language': process.env.ONTOMATO_LANGUAGE } : {}),
      'X-Ontomato-Callback-Credential': credential,
      'X-Ontomato-Run-Id': runId,
    },
    body: JSON.stringify(body ?? {}),
  }).catch(error => die(`连不上本轮页面边界（${error.cause?.code || error.message}）`));
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    die(`${path} 返回非 JSON（HTTP ${response.status}）`, text.slice(0, 500));
  }
  if (!response.ok) die(`${path} 失败（HTTP ${response.status}）`, json);
  return json;
}

const [command, ...args] = process.argv.slice(2);
let result;
if (command === 'catalog') {
  result = await post('/catalog', args[0] ? { applicationId: args[0] } : {});
} else if (command === 'search') {
  if (!args[0]) die('用法：node client.mjs search <检索词>');
  result = await post('/search', { query: args.join(' ') });
} else if (command === 'description') {
  const [applicationId, entryKey, pageKey] = args;
  if (!applicationId || !entryKey || !pageKey) die('用法：node client.mjs description <applicationId> <entryKey> <pageKey>');
  result = await post('/description', { applicationId, entryKey, pageKey });
} else if (command === 'read') {
  const request = readJsonArg(args[0], '用法：node client.mjs read <read请求JSON文件|@内联JSON|{...}>');
  if (request.inputs === undefined) request.inputs = {};
  result = await post('/read', request);
} else {
  die('用法：node client.mjs catalog [applicationId] | search <检索词> | description <applicationId> <entryKey> <pageKey> | read <read请求JSON>');
}
console.log(JSON.stringify(result, null, 2));
