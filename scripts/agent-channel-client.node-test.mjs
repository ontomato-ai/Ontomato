import test from 'node:test';
import assert from 'node:assert/strict';

for (const name of ['ontomato-analyst','ontomato-app-builder','ontomato-ontomap-builder']) {
  const client=await import(`../agent-skills/${name}/client.mjs`);
  test(`${name}: platform conversations use native agent tools while metadata stays available`,async t=>{
    const previous=process.env.ONTOMATO_SKILL_SCENARIO;
    t.after(()=>{if(previous===undefined)delete process.env.ONTOMATO_SKILL_SCENARIO;else process.env.ONTOMATO_SKILL_SCENARIO=previous;});
    process.env.ONTOMATO_SKILL_SCENARIO='platform';
    const fetch=t.mock.method(globalThis,'fetch',async()=>Response.json({classes:[]}));
    t.mock.method(console,'log',()=>{});
    for(const command of ['list','start','send','read','cancel'])
      await assert.rejects(client.agentChannelCommand({},[command]),/原生 agent 工具（agent）.*独立分发包/);
    assert.equal(fetch.mock.callCount(),0);
    await client.analystCommand({ontologyUrl:'http://ontology.test'},['classes'],{});
    assert.equal(fetch.mock.calls[0].arguments[0],'http://ontology.test/ontology/query/overview');
  });
  test(`${name}: standalone distribution retains the external agent protocol`,async t=>{
    const previous=process.env.ONTOMATO_SKILL_SCENARIO;
    delete process.env.ONTOMATO_SKILL_SCENARIO;
    t.after(()=>{if(previous!==undefined)process.env.ONTOMATO_SKILL_SCENARIO=previous;});
    const fetch=t.mock.method(globalThis,'fetch',async()=>Response.json({agents:[]}));
    t.mock.method(console,'log',()=>{});
    await client.agentChannelCommand({ontologyUrl:'http://ontology.test'},['list'],{tk:'external-credential'});
    assert.equal(fetch.mock.calls[0].arguments[0],'http://ontology.test/platform/agent-channel/commands');
    assert.deepEqual(JSON.parse(fetch.mock.calls[0].arguments[1].body),{op:'list'});
  });
}
