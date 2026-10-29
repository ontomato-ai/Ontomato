package io.ontomato.dataengine.service.agent;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.*;

import com.alibaba.fastjson2.*;
import com.alibaba.fastjson2.schema.JSONSchema;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.KnowledgeService;
import io.ontomato.dataengine.service.QueryGrantService;
import jakarta.annotation.PostConstruct;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.function.Consumer;
import org.springframework.context.annotation.DependsOn;
import org.springframework.stereotype.Service;

/** Owns governance work and its write eligibility; execution and history belong to the runtime. */
@Service
@DependsOn("ontologyAgentStore")
public class KnowledgeGovernanceService {
  public static final String AGENT = "56a15178-ae22-4e6f-9974-ababeb42a676";
  private final OntologyAgentStore store;
  private final AgentRuntimeClient runtime;
  private final OntologyAgentDefinitions definitions;
  private final QueryGrantService grants;
  private final KnowledgeService knowledge;
  private final AdminService admin;
  private final Map<String,JSONSchema> schemas = new HashMap<>();

  public KnowledgeGovernanceService(OntologyAgentStore store, AgentRuntimeClient runtime,
      OntologyAgentDefinitions definitions, QueryGrantService grants, KnowledgeService knowledge,
      AdminService admin) {
    this.store=store; this.runtime=runtime; this.definitions=definitions;
    this.grants=grants; this.knowledge=knowledge; this.admin=admin;
  }

  @PostConstruct
  public void initialize() {
    store.update("""
      CREATE TABLE IF NOT EXISTS ontology_governance_sessions (
        id uuid PRIMARY KEY REFERENCES ontology_agent_sessions(id), latest_run_id uuid,
        revision bigint NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS ontology_governance_work (
        run_id uuid PRIMARY KEY REFERENCES ontology_agent_runs(id),
        work jsonb NOT NULL, revision bigint NOT NULL DEFAULT 0);
      """);
    var input = JSON.parseObject(definitions.resource("ontology-skills/knowledge-governance/references/inputs.json"));
    for (String key : input.keySet()) schemas.put(key,JSONSchema.of(input.getJSONObject(key)));
  }

  private static JSONObject emptyWork() {
    return JSONObject.of("summary","","notes","","reviewedKnowledgeIds",new JSONArray(),
      "knowledgeTotal",null,"issues",new JSONArray(),"sources",new JSONArray());
  }
  private JSONObject session(String id, Owner owner) {
    var row=store.session(id,owner);
    if (!AGENT.equals(row.getString("agent_id"))) throw AgentHttpException.missing();
    return row;
  }
  private JSONObject state(String id, Owner owner, boolean lock) {
    session(id,owner);
    return store.one("SELECT * FROM ontology_governance_sessions WHERE id=?" + (lock?" FOR UPDATE":""),uuid(id));
  }
  public boolean create(String id, Owner owner, boolean external) throws Exception {
    boolean replayed=store.transaction(() -> {
      boolean existed=store.createSession(id,owner,AGENT,!external);
      store.update("INSERT INTO ontology_governance_sessions(id) VALUES(?) ON CONFLICT DO NOTHING",uuid(id));
      return existed;
    });
    if (!external) runtime.json(owner.domainId(),id,"/v1/sessions","POST",Map.of(),id);
    return replayed;
  }
  public JSONObject work(String id, Owner owner) {
    var state=state(id,owner,false);
    String run=state.getString("latest_run_id");
    return JSONObject.of("revision",state.getLongValue("revision"),"work",run==null?emptyWork():
      store.one("SELECT work FROM ontology_governance_work WHERE run_id=?",uuid(run)).getJSONObject("work"));
  }

  private record Admission(JSONObject row, boolean replayed) {}
  private Admission admit(String id,String run,JSONObject input,OntologyAgentAccess.Context context,boolean external) {
    Owner owner=context.owner();
    return store.transaction(() -> {
      var state=state(id,owner,true);
      if (session(id,owner).getBooleanValue("runtime_owned")==external)
        throw conflict("Execution owner changed");
      var previous=store.rows("SELECT * FROM ontology_agent_runs WHERE id=?",uuid(run));
      if (!previous.isEmpty()) {
        var row=previous.get(0);
        if (!id.equals(row.getString("session_id")) || !AgentJson.hash(input).equals(row.getString("input_hash")))
          throw conflict("Run input changed");
        return new Admission(row,true);
      }
      String latest=state.getString("latest_run_id");
      JSONObject work=emptyWork();
      if (latest!=null) {
        var old=store.one("SELECT * FROM ontology_agent_runs WHERE id=? FOR UPDATE",uuid(latest));
        if (!external && old.getBooleanValue("open"))
          throw new AgentHttpException(409,"SESSION_BUSY","A governance run is active");
        store.update("UPDATE ontology_agent_runs SET open=false WHERE id=?",uuid(latest));
        work=store.one("SELECT work FROM ontology_governance_work WHERE run_id=?",uuid(latest)).getJSONObject("work");
      }
      long deadline=System.currentTimeMillis()+600_000;
      if (context.expiresAt()!=null) deadline=Math.min(deadline,context.expiresAt());
      if (deadline<=System.currentTimeMillis()) throw closed();
      store.update("INSERT INTO ontology_agent_runs(id,session_id,input_hash,request,open,deadline,external,decision_revision) VALUES(?,?,?,?::jsonb,true,?::timestamptz,?,0)",
        uuid(run),uuid(id),AgentJson.hash(input),AgentJson.json(input),Instant.ofEpochMilli(deadline).toString(),external);
      store.update("INSERT INTO ontology_governance_work(run_id,work) VALUES(?,?::jsonb)",uuid(run),AgentJson.json(work));
      store.update("UPDATE ontology_governance_sessions SET latest_run_id=?,revision=revision+1 WHERE id=?",uuid(run),uuid(id));
      store.update("UPDATE ontology_agent_sessions SET title=CASE WHEN title='' THEN ? ELSE title END,updated_at=now() WHERE id=?",input.getString("message"),uuid(id));
      return new Admission(store.run(id,run,owner),false);
    });
  }

  public boolean start(String id,String run,String message,OntologyAgentAccess.Context context) throws Exception {
    if (message==null || message.isBlank() || message.length()>20_000)
      throw AgentHttpException.invalid("A message of 1 to 20000 characters is required");
    session(id,context.owner());
    var snapshot=runtime.json(context.owner().domainId(),id,"/v1/sessions/"+id,"GET",null,null);
    var latest=snapshot.getJSONObject("latestRun");
    if (latest!=null && !"running".equals(latest.getJSONObject("run").getString("status")))
      settle(latest.getJSONObject("run").getString("id"));
    var admission=admit(id,run,JSONObject.of("message",message),context,false);
    if (admission.replayed()) return true;
    var row=admission.row();
    long deadline=Instant.parse(row.getString("deadline")).toEpochMilli();
    try {
      definitions.publishGovernance();
      var token=grants.issue(context.owner().userId(),context.owner().domainId(),"knowledge-governance",run,deadline,List.of(),null);
      store.transaction(() -> gate(id,run,context.owner()));
      runtime.json(context.owner().domainId(),run,"/v1/sessions/"+id+"/runs","POST",JSONObject.of(
        "language",context.language(),
        "definition",definitions.governance(context.language(),deadline-System.currentTimeMillis()),
        "input",JSONObject.of("role","user","content",message,"timestamp",Instant.parse(row.getString("created_at")).toEpochMilli()),
        "environment",JSONObject.of("values",JSONObject.of("ONTOMATO_ONTOLOGY_URL",runtime.ontologyUrl(),"ONTOMATO_GOVERNANCE_ID",id),
          "secrets",JSONObject.of("ONTOMATO_GOVERNANCE_TK",token))),run);
    } catch (Exception error) {
      // Seal this intent even if the runtime accepted it before the transport failed.
      cancel(id,run,context.owner());
      throw error;
    }
    return false;
  }

  public JSONObject begin(String key,JSONObject input,OntologyAgentAccess.Context context) throws Exception {
    validate("begin",input);
    String id=input.containsKey("id")?AgentJson.id(input.getString("id")):key;
    if (!input.containsKey("id")) create(id,context.owner(),true);
    var admission=admit(id,key,input,context,true);
    return JSONObject.of("id",id,"sessionId",id,"runId",key,"expiresAt",Instant.parse(admission.row().getString("deadline")).toString());
  }
  public void settle(String run) {
    store.update("UPDATE ontology_agent_runs SET open=false WHERE id=?",uuid(run));
  }
  public void cancel(String id,String run,Owner owner) throws Exception {
    session(id,owner);
    store.closeRun(id,run,owner);
    var row=store.run(id,run,owner);
    if (!row.getBooleanValue("external"))
      runtime.json(owner.domainId(),run,"/v1/sessions/"+id+"/run-intents/"+run+"/cancel","POST",Map.of(),null);
  }
  public void delete(String id,Owner owner) throws Exception {
    var row=session(id,owner);
    for (var run:store.rows("SELECT id FROM ontology_agent_runs WHERE session_id=?",uuid(id)))
      cancel(id,run.getString("id"),owner);
    if (row.getBooleanValue("runtime_owned")) runtime.json(owner.domainId(),id,"/v1/sessions/"+id,"DELETE",null,null);
    store.transaction(() -> {
      state(id,owner,true);
      store.update("DELETE FROM ontology_governance_work WHERE run_id IN (SELECT id FROM ontology_agent_runs WHERE session_id=?)",uuid(id));
      store.update("DELETE FROM ontology_governance_sessions WHERE id=?",uuid(id));
      store.update("DELETE FROM ontology_agent_runs WHERE session_id=?",uuid(id));
      store.update("DELETE FROM ontology_agent_sessions WHERE id=?",uuid(id));
      return null;
    });
  }

  public void deleteByUser(String userId) throws Exception {
    for (var row:store.rows("SELECT id,domain_id FROM ontology_agent_sessions WHERE user_id=? AND agent_id=?",userId,uuid(AGENT)))
      delete(row.getString("id"),new Owner(userId,row.getString("domain_id")));
  }

  private static AgentHttpException closed() {
    return new AgentHttpException(409,"GOVERNANCE_RUN_CLOSED","Governance run is closed");
  }
  private JSONObject gate(String id,String run,Owner owner) {
    var state=state(id,owner,true);
    var row=store.one("SELECT * FROM ontology_agent_runs WHERE id=? AND session_id=? FOR UPDATE",uuid(run),uuid(id));
    if (!run.equals(state.getString("latest_run_id")) || !row.getBooleanValue("open")
        || Instant.parse(row.getString("deadline")).toEpochMilli()<=System.currentTimeMillis()) throw closed();
    return row;
  }
  public void requireRun(String id,String run,Owner owner) throws Exception {
    session(id,owner);
    var row=store.run(id,run,owner);
    if (!row.getBooleanValue("external")) {
      var snapshot=runtime.run(owner.domainId(),run);
      if (!"running".equals(snapshot.getJSONObject("run").getString("status"))) settle(run);
    }
    store.transaction(() -> gate(id,run,owner));
  }
  private JSONObject mutate(String id,String run,Owner owner,Consumer<JSONObject> change) {
    return store.transaction(() -> {
      gate(id,run,owner);
      var work=store.one("SELECT work FROM ontology_governance_work WHERE run_id=?",uuid(run)).getJSONObject("work");
      change.accept(work);
      store.update("UPDATE ontology_governance_work SET work=?::jsonb,revision=revision+1 WHERE run_id=?",AgentJson.json(work),uuid(run));
      store.update("UPDATE ontology_governance_sessions SET revision=revision+1 WHERE id=?",uuid(id));
      store.update("UPDATE ontology_agent_sessions SET updated_at=now() WHERE id=?",uuid(id));
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

  public Object action(String id,String run,String action,JSONObject input,Owner owner) throws Exception {
    validate(action,input);
    requireRun(id,run,owner);
    if (action.equals("search_history")) {
      var params=new ArrayList<String>();
      for (String key:input.keySet()) params.add(enc(key)+"="+enc(input.getString(key)));
      return runtime.json(owner.domainId(),run,"/v1/history?"+String.join("&",params),"GET",null,null);
    }
    if (action.equals("read_work_record"))
      return page(List.of(material(id,"Work record",work(id,owner).getJSONObject("work"))),input);
    if (action.equals("read_knowledge") || action.equals("read_ontology")) {
      String kind=action.equals("read_knowledge")?"knowledge":"ontology";
      var values=originals(kind,owner.domainId());var result=page(values,input);var sources=new ArrayList<JSONObject>();
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
    if (kind.equals("artifact")) return JSONObject.of("source",source,"page",null);
    String target=source.getString("target");
    var values=kind.equals("history")?List.of(material(target,source.getString("title"),history(JSON.parseObject(target),owner))):originals(kind,owner.domainId());
    return JSONObject.of("source",source,"page",page(values,JSONObject.of("id",target,"offset",offset)));
  }
}
