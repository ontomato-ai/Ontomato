import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { analystCommand } from "../agent-skills/ontomato-analyst/client.mjs";

test("the shared channel preserves references, streams snapshots and downloads original bytes", async () => {
  const received=[],logs=[],taskId=randomUUID(),sessionId=randomUUID(),questionId=randomUUID(),fileId=randomUUID();
  const bytes='{"rows":[{"value":null,"zero":0,"valid":false,"large":9007199254740993}]}';
  const snapshot={taskId,sessionRef:{providerId:"ontology",sessionId},status:"running",questions:[{id:questionId,answered:false}],files:[]};
  const done={...snapshot,status:"completed",questions:[],files:[{id:fileId,name:"sales.dataset.json",mediaType:"application/json",href:`/platform/agent-channel/tasks/${taskId}/files/${fileId}`}]};
  const server=createServer(async(req,res)=>{
    let text="";for await(const part of req) text+=part;
    const body=text?JSON.parse(text):undefined;received.push({url:req.url,body,headers:req.headers});
    if(req.url===`/platform/agent-channel/tasks/${taskId}/events`) {
      res.writeHead(200,{"content-type":"text/event-stream"});
      res.end(`data: ${JSON.stringify({type:"task_snapshot",task:{...snapshot,questions:[]}})}\n\ndata: ${JSON.stringify({type:"task_snapshot",task:done})}\n\n`);
    } else if(req.url===done.files[0].href) {res.end(bytes);}
    else if(req.url==="/platform/agent-channel/commands") {
      res.setHeader("content-type","application/json");
      res.end(JSON.stringify(body.op==="list"?{agents:[]}:body.op==="read"?snapshot:{taskId,sessionRef:snapshot.sessionRef,status:"starting"}));
    } else {res.statusCode=404;res.end('{"error":"Unexpected request"}');}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const directory=await mkdtemp(path.join(os.tmpdir(),"ontology-channel-"));
  const cfg={ontologyUrl:`http://127.0.0.1:${server.address().port}`,envUrl:"http://unused-workbench.invalid"};
  const print=console.log,oldOutput=process.env.ONTOMATO_OUTPUT_DIR;
  process.env.ONTOMATO_OUTPUT_DIR=directory;console.log=(...args)=>logs.push(args.join(" "));
  try {
    const headers={tk:"fixture-user"};
    await analystCommand(cfg,["agent","list"],headers);
    await analystCommand(cfg,["agent","start","--agent","ontology/retrieval","--message","Sales"],headers);
    await analystCommand(cfg,["agent","read",taskId],headers);
    await analystCommand(cfg,["agent","send","--session",`ontology/${sessionId}`,"--message","Current period","--reply-to",questionId],headers);
    await analystCommand(cfg,["agent","read",taskId,"--follow","--files"],headers);
    assert.equal(await readFile(JSON.parse(logs.at(-1)).downloaded[0].path,"utf8"),bytes);
    await analystCommand(cfg,["agent","cancel",taskId],headers);
    const commands=received.filter(r=>r.body).map(r=>r.body);
    assert.deepEqual(commands.map(c=>c.op),["list","start","read","send","cancel"]);
    assert.deepEqual(commands[3],{op:"send",session:snapshot.sessionRef,message:"Current period",replyTo:questionId});
    assert.ok(received.every(r=>r.headers.tk==="fixture-user"));
    assert.ok(received.every(r=>r.url.startsWith("/platform/agent-channel/")));
    await assert.rejects(analystCommand(cfg,["agent","send","--session",`ontology/${sessionId}`,"--message","Question?","--needs-input"]),/default-assumption/);
    await assert.rejects(analystCommand(cfg,["ask","Sales"]),/Commands:/);
  } finally {
    console.log=print;
    if(oldOutput===undefined) delete process.env.ONTOMATO_OUTPUT_DIR;else process.env.ONTOMATO_OUTPUT_DIR=oldOutput;
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});
  }
});

test("skill packages bundle the one analyst transport source", async () => {
  const { readFile } = await import("node:fs/promises");
  const read = (root) =>
    readFile(new URL(root + "client.mjs", import.meta.url), "utf8");
  const source = await read("../agent-skills/ontomato-analyst/");
  for (const root of [
    "../agent-skills/ontomato-app-builder/",
    "../agent-skills/ontomato-ontomap-builder/",
  ])
    assert.equal(await read(root), source);
});

test("pending selects generated revisions and never substitutes a DSL for missing or failed grants", async () => {
  const calls = [], logs = [];
  let phase = "found";
  const server = createServer(async (req, res) => {
    let data = ""; for await (const chunk of req) data += chunk;
    const body = JSON.parse(data); calls.push([req.url, body]); res.setHeader("content-type", "application/json");
    const owned = { id: "metric", name: "Renamed workflow", revision: "rev", workflowSource: {workflowId:"wf",purpose:"pending"} };
    if (req.url.endsWith("/search")) res.end(JSON.stringify({ items: phase === "missing" ? [] :
      [{id:"manual", name:"我的待办 · Renamed workflow"}, owned], nextCursor:null }));
    else if (req.url.endsWith("/execute") && phase === "error") { res.statusCode = 403; res.end('{"error":"grant lookup refused"}'); }
    else if (req.url.endsWith("/execute")) res.end('{"rows":[{"id":"a"}]}');
    else { res.statusCode = 404; res.end('{"error":"Unexpected request"}'); }
  });
  await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
  const cfg = { ontologyUrl: `http://127.0.0.1:${server.address().port}` };
  const print = console.log;
  try {
    console.log = s => logs.push(JSON.parse(s));
    await analystCommand(cfg, ["pending","--flow","wf"]);
    assert.deepEqual(calls[1][1], {id:"metric",revision:"rev"}); assert.equal(logs[0].rows[0].id, "a");
    phase = "missing"; await assert.rejects(analystCommand(cfg, ["pending"]), /No published pending-items query/);
    phase = "error"; await assert.rejects(analystCommand(cfg, ["pending"]), /grant lookup refused/);
    assert.ok(calls.every(([url]) => url.startsWith("/ontology/query/metrics/")));
  } finally { console.log = print; await new Promise(resolve => server.close(resolve)); }
});

test("run reports missing legacy permission, grant scope, and authentication refused by the server", async () => {
  const cases = [
    [200, {success:false,code:403,message:"Operation permission is required: /action/execute"}, /no capability grants/],
    [200, {success:false,message:"No role grants this action to the current subject"}, /No current role grant/],
    [200, {success:false,message:"Target is not readable or is outside the granted scope"}, /outside the scope granted/],
    [200, {success:false,message:"Action preconditions are not met: status is closed"}, /Business precondition failed: status is closed/],
    [401, {code:401,msg:"Authentication required"}, /Authentication required/],
  ];
  let response;
  const server = createServer((req, res) => {
    res.writeHead(response[0], {"content-type":"application/json"}); res.end(JSON.stringify(response[1]));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const print = console.log; console.log = () => {};
  try {
    for (response of cases) await assert.rejects(
      analystCommand({ontologyUrl:`http://127.0.0.1:${server.address().port}`}, ["run","fixture"]), response[2]);
  } finally { console.log = print; await new Promise(resolve => server.close(resolve)); }
});
