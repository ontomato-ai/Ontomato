package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;

import com.alibaba.fastjson2.*;
import com.alibaba.fastjson2.schema.JSONSchema;
import io.ontomato.dataengine.schedules.ScheduleIdentity;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.KnowledgeService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.QueryGrantService;
import jakarta.annotation.PostConstruct;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.function.Consumer;
import org.springframework.context.annotation.DependsOn;
import org.springframework.stereotype.Service;

/** Owns governance records and write windows, independently of conversational hosts. */
@Service
@DependsOn("ontologyAgentStore")
public class KnowledgeGovernanceService {
  private final OntologyAgentStore store;
  private final AgentRuntimeClient runtime;
  private final GovernanceRuntimeClient platform;
  private final OntologyAgentDefinitions definitions;
  private final QueryGrantService grants;
  private final KnowledgeService knowledge;
  private final AdminService admin;
  private final AgentExecutionAccess executions;
  private final ScheduleIdentity identities;
  private final LangService language;
  private static final Set<String> BUSINESS_ACTIONS=Set.of("read_knowledge","read_ontology","import_knowledge");
  public static boolean businessAction(String action) {return BUSINESS_ACTIONS.contains(action);}
  @org.springframework.beans.factory.annotation.Autowired
  private io.ontomato.dataengine.service.IdentityService identityService;
  private final Map<String,JSONSchema> schemas = new HashMap<>();

  public KnowledgeGovernanceService(OntologyAgentStore store, AgentRuntimeClient runtime,
      GovernanceRuntimeClient platform, OntologyAgentDefinitions definitions, QueryGrantService grants,
      KnowledgeService knowledge, AdminService admin, AgentExecutionAccess executions, ScheduleIdentity identities,
      LangService language) {
    this.store=store; this.runtime=runtime; this.platform=platform; this.definitions=definitions;
    this.grants=grants; this.knowledge=knowledge; this.admin=admin;this.executions=executions;this.identities=identities;
    this.language=language;
  }

  @PostConstruct
  public void initialize() {
    store.update("""
      CREATE TABLE IF NOT EXISTS ontology_governance_records (
        id uuid PRIMARY KEY, owner_id text NOT NULL, domain_id text NOT NULL,
        latest_run_id uuid, revision bigint NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS ontology_governance_records_owner ON ontology_governance_records(domain_id,owner_id);
      CREATE TABLE IF NOT EXISTS ontology_governance_windows (
        run_id uuid PRIMARY KEY, record_id uuid NOT NULL REFERENCES ontology_governance_records(id),
        external boolean NOT NULL, runtime_host_id text, session_id uuid,
        expires_at timestamptz NOT NULL, closed boolean NOT NULL DEFAULT false, input_message text);
      CREATE INDEX IF NOT EXISTS ontology_governance_windows_record ON ontology_governance_windows(record_id);
      CREATE TABLE IF NOT EXISTS ontology_governance_work (
        run_id uuid PRIMARY KEY, work jsonb NOT NULL, revision bigint NOT NULL DEFAULT 0);
      ALTER TABLE ontology_governance_work DROP CONSTRAINT IF EXISTS ontology_governance_work_run_id_fkey;
      """);
    var input = JSON.parseObject(definitions.resource("ontology-skills/knowledge-governance/references/inputs.json"));
    for (String key : input.keySet()) schemas.put(key,JSONSchema.of(input.getJSONObject(key)));
  }

  public AgentRuntimeClient.SkillVersion publishSkill() throws Exception {
    var files=new ArrayList<Map<String,String>>();
    for (String path:List.of("SKILL.md","scripts/governance.mjs","references/commands.md","references/extraction.md"))
      files.add(Map.of("path",path,"content",definitions.resource("ontology-skills/knowledge-governance/"+path)));
    return runtime.publishSkill("governance-skill",Map.of(
      "namespace",Map.of("kind","provider","provider","ontology"),"name","knowledge-governance"),files);
  }

  private static JSONObject emptyWork() {
    return JSONObject.of("summary","","notes","","reviewedKnowledgeIds",new JSONArray(),
      "knowledgeTotal",null,"issues",new JSONArray(),"sources",new JSONArray());
  }
  private JSONObject state(String id, Owner owner, boolean lock) {
    return store.one("SELECT * FROM ontology_governance_records WHERE id=? AND owner_id=? AND domain_id=?" + (lock?" FOR UPDATE":""),
      uuid(id),owner.userId(),owner.domainId());
  }
  public JSONObject work(String id, Owner owner) {
    var record=state(id,owner,false);
    String run=record.getString("latest_run_id");
    return JSONObject.of("revision",record.getLongValue("revision"),"work",run==null?emptyWork():
      store.one("SELECT work FROM ontology_governance_work WHERE run_id=?",uuid(run)).getJSONObject("work"));
  }

  private JSONObject open(String id,String run,Owner owner,boolean external,String host,String session,long deadline,String message) {
    if (deadline<=System.currentTimeMillis()) throw closed();
    return store.transaction(() -> {
      store.update("INSERT INTO ontology_governance_records(id,owner_id,domain_id) VALUES(?,?,?) ON CONFLICT DO NOTHING",uuid(id),owner.userId(),owner.domainId());
      var record=state(id,owner,true);
      var existing=store.rows("SELECT * FROM ontology_governance_windows WHERE run_id=?",uuid(run));
      if (!existing.isEmpty()) {
        var row=existing.getFirst();
        if (!id.equals(row.getString("record_id")) || row.getBooleanValue("external")!=external
            || (external && !Objects.equals(message,row.getString("input_message")))
            || !Objects.equals(host,row.getString("runtime_host_id")) || !Objects.equals(session,row.getString("session_id")))
          throw conflict("Governance window binding changed");
        gate(id,run,owner);
        return window(row,id);
      }
      String latest=record.getString("latest_run_id");
      var work=emptyWork();
      if (latest!=null) {
        store.update("UPDATE ontology_governance_windows SET closed=true WHERE run_id=?",uuid(latest));
        work=store.one("SELECT work FROM ontology_governance_work WHERE run_id=?",uuid(latest)).getJSONObject("work");
      }
      store.update("INSERT INTO ontology_governance_windows(run_id,record_id,external,runtime_host_id,session_id,expires_at,input_message) VALUES(?,?,?,?,?,?::timestamptz,?)",
        uuid(run),uuid(id),external,host,session==null?null:uuid(session),Instant.ofEpochMilli(deadline).toString(),message);
      store.update("INSERT INTO ontology_governance_work(run_id,work) VALUES(?,?::jsonb)",uuid(run),AgentJson.json(work));
      store.update("UPDATE ontology_governance_records SET latest_run_id=?,revision=revision+1 WHERE id=?",uuid(run),uuid(id));
      return window(store.one("SELECT * FROM ontology_governance_windows WHERE run_id=?",uuid(run)),id);
    });
  }
  private JSONObject window(JSONObject row,String id) {
    return JSONObject.of("id",id,"sessionId",row.getBooleanValue("external")?id:row.getString("session_id"),"runId",row.getString("run_id"),"expiresAt",Instant.parse(row.getString("expires_at")).toString());
  }
  public JSONObject begin(String key,JSONObject input,OntologyAgentAccess.Context context) {
    validate("begin",input);
    String id=input.containsKey("id")?AgentJson.id(input.getString("id")):key;
    long deadline=System.currentTimeMillis()+600_000;
    if (context.expiresAt()!=null) deadline=Math.min(deadline,context.expiresAt());
    return open(id,key,context.owner(),true,null,null,deadline,input.getString("message"));
  }
  public JSONObject registerPlatform(JSONObject input,OntologyAgentAccess.Context context) {
    AgentJson.fields(input,"recordId","domainId","ownerId","runtimeHostId","sessionId","runId","expiresAt","executionActor");
    var owner=context.owner();
    if (!owner.domainId().equals(input.getString("domainId")) || !identities.hostOwner(owner.userId()).equals(input.getString("ownerId"))
        || !"workbench".equals(input.getString("runtimeHostId"))) throw AgentHttpException.missing();
    String id=AgentJson.id(input.getString("recordId")),session=AgentJson.id(input.getString("sessionId")),run=AgentJson.id(input.getString("runId"));
    long deadline=Instant.parse(AgentJson.text(input,"expiresAt")).toEpochMilli();
    if (context.expiresAt()!=null) deadline=Math.min(deadline,context.expiresAt());
    var reference=input.getJSONObject("executionActor");
    String selected=null;
    if(reference!=null) {
      AgentJson.fields(reference,"userId","domainId");
      if(!owner.domainId().equals(AgentJson.text(reference,"domainId")))throw new AgentHttpException(403,"CROSS_DOMAIN","Execution user belongs to another domain");
      selected=executions.require(owner.domainId(),AgentJson.text(reference,"userId")).getId();
    }
    String executor=selected==null?owner.userId():selected;
    var result=open(id,run,owner,false,"workbench",session,deadline,null);
    result.put("token",grants.issue(executor,owner.domainId(),"knowledge-governance",run,
      Instant.parse(result.getString("expiresAt")).toEpochMilli(),List.of(),null,
      JSONObject.of("initiatorUserId",owner.userId(),"executionUserId",selected)));
    return result;
  }
  public void closePlatform(String run,String domain) {
    store.update("UPDATE ontology_governance_windows w SET closed=true FROM ontology_governance_records r WHERE w.record_id=r.id AND w.run_id=? AND r.domain_id=? AND NOT w.external",uuid(run),domain);
  }
  public void closeExternal(String id,String run,Owner owner) {
    state(id,owner,false);
    var row=store.one("SELECT external FROM ontology_governance_windows WHERE record_id=? AND run_id=?",uuid(id),uuid(run));
    if (!row.getBooleanValue("external")) throw AgentHttpException.missing();
    store.update("UPDATE ontology_governance_windows SET closed=true WHERE record_id=? AND run_id=?",uuid(id),uuid(run));
  }
  public void deleteByUser(String userId) {
    store.transaction(() -> {
      store.update("DELETE FROM ontology_governance_work WHERE run_id IN (SELECT w.run_id FROM ontology_governance_windows w JOIN ontology_governance_records r ON r.id=w.record_id WHERE r.owner_id=?)",userId);
      store.update("DELETE FROM ontology_governance_windows WHERE record_id IN (SELECT id FROM ontology_governance_records WHERE owner_id=?)",userId);
      store.update("DELETE FROM ontology_governance_records WHERE owner_id=?",userId);
      return null;
    });
  }
  private static AgentHttpException closed() {
    return new AgentHttpException(409,"GOVERNANCE_RUN_CLOSED","Governance run is closed");
  }
  private JSONObject gate(String id,String run,Owner owner) {
    var record=state(id,owner,true);
    var row=store.one("SELECT * FROM ontology_governance_windows WHERE run_id=? AND record_id=? FOR UPDATE",uuid(run),uuid(id));
    if (!run.equals(record.getString("latest_run_id")) || row.getBooleanValue("closed")
        || Instant.parse(row.getString("expires_at")).toEpochMilli()<=System.currentTimeMillis()) throw closed();
    return row;
  }
  private void requireRunning(String domain,String session,String run) {
    if (!"running".equals(platform.status(domain,session,run).getString("status"))) throw closed();
  }
  public void requireRun(String id,String run,Owner owner) {
    state(id,owner,false);
    var row=store.one("SELECT * FROM ontology_governance_windows WHERE run_id=? AND record_id=?",uuid(run),uuid(id));
    if (!row.getBooleanValue("external")) requireRunning(owner.domainId(),row.getString("session_id"),run);
    store.transaction(() -> gate(id,run,owner));
  }
  private JSONObject mutate(String id,String run,Owner owner,Consumer<JSONObject> change) {
    return store.transaction(() -> {
      gate(id,run,owner);
      var work=store.one("SELECT work FROM ontology_governance_work WHERE run_id=?",uuid(run)).getJSONObject("work");
      change.accept(work);
      store.update("UPDATE ontology_governance_work SET work=?::jsonb,revision=revision+1 WHERE run_id=?",AgentJson.json(work),uuid(run));
      store.update("UPDATE ontology_governance_records SET revision=revision+1 WHERE id=?",uuid(id));
      return work;
    });
  }

  private void validate(String action,JSONObject input) {
    var schema=schemas.get(action);
    if (schema==null) throw AgentHttpException.invalid("Unknown governance action");
    var result=schema.validate(input);
    if (!result.isSuccess()) throw AgentHttpException.invalid(result.getMessage());
  }
  private record Material(String id,String title,String text) {}
  private static Material material(String id,String title,Object value) {
    return new Material(id,title,JSON.toJSONString(value,JSONWriter.Feature.PrettyFormat,JSONWriter.Feature.WriteMapNullValue));
  }
  private List<Material> originals(String kind,String domain) {
    var values=new ArrayList<Material>();
    if (kind.equals("knowledge")) {
      for (var item:knowledge.getBussinessKnowledge(domain).values()) {
        var value=JSONObject.from(item);
        values.add(material(value.getString("knowledgeID"),value.getString("knowledgeTitle"),value));
      }
    } else {
      var schema=admin.getPrettyJSONRule(domain);
      for (var item:schema.getJSONArray("classDefs")) {
        var value=JSONObject.from(item); String name=value.getString("name");
        values.add(material("class/"+name,name,value));
      }
      var relations=schema.getJSONObject("relationshipDefs");
      for (String name:relations.keySet()) values.add(material("relationship/"+name,name,relations.get(name)));
      values.add(material("dataset","Dataset",JSONObject.of("datasetDesc",schema.get("datasetDesc"),"classList",schema.get("classList"))));
    }
    values.sort(Comparator.comparing(Material::id));
    return values;
  }
  private static int number(JSONObject input,String field,int fallback) {
    return input.containsKey(field)?input.getIntValue(field):fallback;
  }
  private static String optional(JSONObject input,String field) {
    return input.containsKey(field)?input.getString(field):"";
  }
  private JSONObject page(List<Material> values,JSONObject input) {
    String query=optional(input,"query").toLowerCase(Locale.ROOT),id=input.getString("id");
    var matches=values.stream().filter(v -> (id==null || id.equals(v.id())) &&
      (query.isEmpty() || (v.title()+"\n"+v.text()).toLowerCase(Locale.ROOT).contains(query))).toList();
    int index=number(input,"index",0),offset=number(input,"offset",0),remaining=number(input,"maxChars",12000);
    if (offset>0 && (index>=matches.size() || offset>matches.get(index).text().length()))
      throw AgentHttpException.invalid("Source changed or cursor is out of range; reread from offset 0");
    var items=new JSONArray();
    while (index<matches.size() && remaining>0) {
      var value=matches.get(index);int end=Math.min(value.text().length(),offset+remaining);
      items.add(JSONObject.of("id",value.id(),"title",value.title(),"text",value.text().substring(offset,end),
        "start",offset,"end",end,"totalChars",value.text().length()));
      remaining-=end-offset;
      if (end>=value.text().length()) { index++;offset=0; } else { offset=end;break; }
    }
    return JSONObject.of("items",items,"totalItems",values.size(),"matchedItems",matches.size(),
      "next",index<matches.size()?JSONObject.of("index",index,"offset",offset):null);
  }
  private static JSONObject source(String kind,String target,String title,String excerpt) {
    return JSONObject.of("id",io.ontomato.dataengine.service.QueryOutputService.hash(kind+":"+target).substring(0,20),
      "kind",kind,"target",target,"title",title,"excerpt",excerpt.substring(0,Math.min(1200,excerpt.length())));
  }
  private static void remember(JSONObject work,List<JSONObject> sources) {
    var existing=work.getJSONArray("sources");
    for (var item:sources)
      if (existing.stream().noneMatch(v -> JSONObject.from(v).getString("id").equals(item.getString("id")))) existing.add(item);
  }
  private static String enc(String value) { return URLEncoder.encode(value,StandardCharsets.UTF_8); }
  private String historyPath(JSONObject input) {
    return "/v1/history/"+enc(AgentJson.text(input,"hostId"))+"/"+AgentJson.id(input.getString("runId"));
  }
  private JSONObject history(JSONObject input,Owner owner) throws Exception {
    return runtime.json(owner.domainId(),input.getString("runId"),historyPath(input),"GET",null,null);
  }

  public void requireAccess(Owner owner) {
    if(!identityService.hasKnowledgeGovernanceAccess(owner.userId(),owner.domainId()))
      throw new AgentHttpException(403,"FORBIDDEN","Business knowledge permission is required");
  }
  public Object action(String id,String run,String action,JSONObject input,Owner owner,String locale) throws Exception {
    return action(id,run,action,input,owner,owner,locale);
  }
  public Object action(String id,String run,String action,JSONObject input,Owner owner,Owner executor,String locale) throws Exception {
    validate(action,input);
    requireAccess(owner);
    requireRun(id,run,owner);
    if(action.equals("read_input")) {
      var row=store.one("SELECT * FROM ontology_governance_windows WHERE record_id=? AND run_id=?",uuid(id),uuid(run));
      JSONObject src;
      String text;
      if(row.getBooleanValue("external")) {
        text=row.getString("input_message");
        src=source("input",run,language.get(locale,"KnowledgeGovernance.source.externalMaterial"),text);
      } else {
        var target=JSONObject.of("hostId",row.getString("runtime_host_id"),"runId",run);
        text=history(target,owner).getString("question");
        src=source("history",AgentJson.json(target),language.get(locale,"KnowledgeGovernance.source.currentMessage"),"");
      }
      if(text==null || text.isBlank()) throw AgentHttpException.invalid("The current run has no source message");
      mutate(id,run,owner,w->remember(w,List.of(src)));
      return JSONObject.of("sourceId",src.getString("id"),"text",text);
    }
    if(action.equals("import_knowledge")) {
      return store.transaction(()->{
        gate(id,run,owner);
        return importKnowledge(id,run,input,owner,executor);
      });
    }
    if (action.equals("search_history")) {
      var params=new ArrayList<String>();
      for (String key:input.keySet()) params.add(enc(key)+"="+enc(input.getString(key)));
      return runtime.json(owner.domainId(),run,"/v1/history?"+String.join("&",params),"GET",null,null);
    }
    if (action.equals("read_work_record"))
      return page(List.of(material(id,"Work record",work(id,owner).getJSONObject("work"))),input);
    if (action.equals("read_knowledge") || action.equals("read_ontology")) {
      requireAccess(executor);
      String kind=action.equals("read_knowledge")?"knowledge":"ontology";
      var values=originals(kind,executor.domainId());var result=page(values,input);var sources=new ArrayList<JSONObject>();
      for (var raw:result.getJSONArray("items")) {
        var item=(JSONObject)raw;
        var src=source(kind,item.getString("id"),item.getString("title"),item.getString("text"));
        sources.add(src);item.put("sourceId",src.getString("id"));
      }
      mutate(id,run,owner,w -> { remember(w,sources);if (kind.equals("knowledge")) w.put("knowledgeTotal",values.size()); });
      return result;
    }
    if (Set.of("read_history","read_evidence","collect_turn_artifacts").contains(action)) {
      var record=history(input,owner);String text=AgentJson.json(record);
      String kind=action.equals("read_history")?"history":"artifact";
      var target=JSONObject.of("hostId",input.getString("hostId"),"runId",input.getString("runId"));
      if (input.containsKey("artifactId")) {
        String artifactId=AgentJson.id(input.getString("artifactId"));target.put("artifactId",artifactId);
        JSONObject artifact=null;
        for (var value:record.getJSONArray("artifacts")) {
          var candidate=JSONObject.from(value);if (artifactId.equals(candidate.getString("id"))) artifact=candidate;
        }
        if (artifact==null) throw AgentHttpException.missing();
        String media=artifact.getString("mediaType");
        if (!(media.startsWith("text/") || media.contains("json")))
          throw AgentHttpException.invalid("This artifact is not text; use its metadata");
        text=new String(runtime.bytes(owner.domainId(),run,historyPath(input)+"/artifacts/"+artifactId+"/content"),StandardCharsets.UTF_8);
      }
      var src=source(kind,AgentJson.json(target),record.getString("question"),text);
      mutate(id,run,owner,w -> remember(w,List.of(src)));
      var result=page(List.of(new Material(src.getString("id"),src.getString("title"),text)),input);
      result.put("sourceId",src.getString("id"));return result;
    }
    var saved=mutate(id,run,owner,w -> {
      for (String key:List.of("summary","notes")) if (input.containsKey(key)) w.put(key,input.get(key));
      if (input.containsKey("reviewedKnowledgeIds")) {
        var reviewed=w.getJSONArray("reviewedKnowledgeIds");
        for (var value:input.getJSONArray("reviewedKnowledgeIds")) if (!reviewed.contains(value)) reviewed.add(value);
      }
      if (input.containsKey("issues")) for (var raw:input.getJSONArray("issues")) {
        var issue=JSONObject.from(raw);
        for (var sourceId:issue.getJSONArray("sourceIds"))
          if (w.getJSONArray("sources").stream().noneMatch(v -> sourceId.equals(JSONObject.from(v).getString("id"))))
            throw AgentHttpException.invalid("Read the cited original before referencing its sourceId");
        var issues=w.getJSONArray("issues");
        int position=-1;
        for (int i=0;i<issues.size();i++) if (issue.getString("id").equals(issues.getJSONObject(i).getString("id"))) { position=i;break; }
        if (position<0) issues.add(issue); else issues.set(position,issue);
      }
    });
    return JSONObject.of("saved",true,"reviewed",saved.getJSONArray("reviewedKnowledgeIds").size(),"issues",saved.getJSONArray("issues").size());
  }

  public Object readSource(String id,String sourceId,int offset,Owner owner) throws Exception {
    if (offset<0) throw AgentHttpException.invalid("Invalid source offset");
    JSONObject source=null;
    for (var value:work(id,owner).getJSONObject("work").getJSONArray("sources")) {
      var item=JSONObject.from(value);if (sourceId.equals(item.getString("id"))) source=item;
    }
    if (source==null) throw AgentHttpException.missing();
    String kind=source.getString("kind");
    if(kind.equals("input")){var row=store.one("SELECT input_message FROM ontology_governance_windows WHERE record_id=? AND run_id=?",uuid(id),uuid(source.getString("target")));return JSONObject.of("source",source,"page",page(List.of(material(sourceId,source.getString("title"),row.getString("input_message"))),JSONObject.of("offset",offset)));}
    if (kind.equals("artifact")) return JSONObject.of("source",source,"page",null);
    String target=source.getString("target");
    var values=kind.equals("history")?List.of(material(target,source.getString("title"),history(JSON.parseObject(target),owner))):originals(kind,owner.domainId());
    return JSONObject.of("source",source,"page",page(values,JSONObject.of("id",target,"offset",offset)));
  }
  private Object importKnowledge(String id,String run,JSONObject input,Owner owner,Owner executor) {
    requireAccess(executor);
    var identity=new io.ontomato.dataengine.core.bean.User(){
      public String getId(){return executor.userId();}
      public String getLoginCode(){return executor.userId();}
      public String getUserName(){return executor.userId();}
      public boolean isEnable(){return true;}
      public String getDomainId(){return executor.domainId();}
    };
    var work=work(id,owner).getJSONObject("work");
    var existing=knowledge.getBussinessKnowledge(owner.domainId());
    var records=new ArrayList<JSONObject>();
    var ids=new HashSet<String>();
    for(var raw:input.getJSONArray("items")) {
      var item=JSONObject.from(raw);
      if(!ids.add(item.getString("id")))throw AgentHttpException.invalid("Duplicate knowledge ID in import batch");
      for(var sourceId:item.getJSONArray("sourceIds"))if(work.getJSONArray("sources").stream().noneMatch(value->sourceId.equals(JSONObject.from(value).getString("id"))))throw AgentHttpException.invalid("Read and register every source before importing knowledge");
      var old=existing.get(item.getString("id"));
      if(old!=null&&(!Objects.equals(old.getKnowledgeTitle(),item.getString("title"))||!Objects.equals(old.getKnowledgeText(),item.getString("text"))))throw conflict("Knowledge ID already contains different content");
      records.add(item);
    }
    for(var item:records)if(!existing.containsKey(item.getString("id")))knowledge.addBussinessKnowledge(item.getString("id"),item.getString("title"),item.getString("text"),0,item.containsKey("tags")?item.getList("tags",String.class):List.of(),identity);
    return JSONObject.of("imported",records.stream().map(item->item.getString("id")).toList(),"status","pending");
  }
}
