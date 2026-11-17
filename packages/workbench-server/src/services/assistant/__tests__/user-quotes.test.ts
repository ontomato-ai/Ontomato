import { describe, expect, it } from "vitest";
import type { RuntimeMessageRecord } from "@ontomato/contracts/agent-runtime";
import { recentUserMessages } from "../user-quotes";
const user=(seq:number,text:string):RuntimeMessageRecord=>({id:String(seq),runId:"current-run",messageSeq:seq,contextSeq:seq,message:{role:"user",content:text,timestamp:seq}});

describe("host user quotes",()=>{
  it("keeps the last ten user messages through this input, including earlier inputs in the same run",()=>{
    const messages=Array.from({length:14},(_,index)=>user(index+1,`user-${index+1}`));
    expect(recentUserMessages(messages,"13")).toEqual(Array.from({length:10},(_,index)=>`user-${index+4}`));
  });
  it("keeps text parts from structured user content",()=>{
    const first=user(1,"");first.message={role:"user",content:[{type:"text",text:"first line"},{type:"text",text:"second line"},{type:"image",data:"a",mimeType:"image/png"}],timestamp:1};
    expect(recentUserMessages([first,user(2,"current")],"2")).toEqual(["first line\nsecond line","current"]);
  });
  it("keeps genuine user answers but excludes agent answers and later inputs",()=>{
    const answer=(seq:number,source:{kind:"user"|"external"}|{session:{providerId:string;sessionId:string};runId:string},content:string):RuntimeMessageRecord=>({...user(seq,""),message:{role:"notification",kind:"agent-answer",source,replyTo:"question",content,timestamp:seq}});
    const messages=[user(1,"Original question"),answer(2,{session:{providerId:"workbench",sessionId:"agent"},runId:"agent-run"},"Agent assumption"),answer(3,{kind:"user"},"User choice"),user(4,"Later")];
    expect(recentUserMessages(messages,"3")).toEqual(["Original question","User choice"]);
  });
  it("uses input identity without duplicating pending input or collapsing equal user text",()=>{
    const messages=[user(1,"Use this period"),{...user(2,"Use this period"),runId:null,contextSeq:null}];
    expect(recentUserMessages(messages,"2")).toEqual(["Use this period","Use this period"]);
  });
});
