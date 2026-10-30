package io.ontomato.dataengine.service.impl;

import static io.ontomato.dataengine.service.agent.OntologyAgentStore.Owner;
import static io.ontomato.dataengine.service.agent.OntologyAgentStore.uuid;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.agent.ActionCreationService;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.agent.AgentJson;
import io.ontomato.dataengine.service.agent.AgentRuntimeClient;
import io.ontomato.dataengine.service.agent.OntologyAgentStore;
import io.ontomato.dataengine.util.CodeHashUtil;
import io.ontomato.dataengine.util.DBSchemaUtil;
import jakarta.annotation.PostConstruct;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Turns the last files of a conversational action-creation run into a draft, and saves that
 * draft without asking the explain agent again. The draft is the "last version snapshot" of the
 * harness workspace: program, parameters, return definition, raw result and the explanation.
 */
@Service
public class ActionDraftService {
  private static final long TTL_HOURS = 12;

  private final OntologyAgentStore store;
  private final AgentRuntimeClient runtime;
  private final AdminService admin;
  private final ActionServiceImpl actions;
  private final LangService langService;
  private final IdentityService identity;
  private final FunctionDao functionDao;
  private final ActionDao actionDao;

  public ActionDraftService(
      OntologyAgentStore store,
      AgentRuntimeClient runtime,
      AdminService admin,
      ActionServiceImpl actions,
      LangService langService,
      IdentityService identity,
      FunctionDao functionDao,
      ActionDao actionDao) {
    this.store = store;
    this.runtime = runtime;
    this.admin = admin;
    this.actions = actions;
    this.langService = langService;
    this.identity = identity;
    this.functionDao = functionDao;
    this.actionDao = actionDao;
  }

  @PostConstruct
  public void initialize() {
    store.update(
        """
        CREATE TABLE IF NOT EXISTS action_drafts (
          id uuid PRIMARY KEY,
          domain_id text NOT NULL,
          owner_id text NOT NULL,
          session_id uuid,
          run_id uuid,
          code_hash text NOT NULL,
          program text NOT NULL,
          parameters jsonb NOT NULL,
          return_def jsonb NOT NULL,
          result jsonb NOT NULL,
          action jsonb NOT NULL,
          definition jsonb NOT NULL,
          explanation_missing boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL,
          consumed_at timestamptz);
        CREATE INDEX IF NOT EXISTS action_drafts_owner ON action_drafts(domain_id,owner_id,created_at DESC);
        """);
  }

  private Owner owner() {
    User user = identity.getCurrentUser();
    if (user == null || user.getDomainId() == null || user.getDomainId().isBlank())
      throw new AgentHttpException(401, "UNAUTHENTICATED", "A current domain credential is required");
    return new Owner(user.getId(), user.getDomainId());
  }

  public JSONObject create(String sessionId, String runId, String lang) throws Exception {
    Owner owner = owner();
    store.run(sessionId, runId, owner);
    store.one(
        "SELECT run_id FROM ontology_generations WHERE run_id=? AND kind='action'", uuid(runId));
    var snapshot = runtime.run(owner.domainId(), runId);
    if ("running".equals(snapshot.getJSONObject("run").getString("status")))
      throw new AgentHttpException(409, "RUN_STILL_RUNNING", "The action creation run is still running");

    String resultText = fileOrNull(owner.domainId(), sessionId, runId, "outputs/result.json");
    // A conversational turn may only answer a question; it does not replace the current draft.
    if (resultText == null) return JSONObject.of("draftId", null, "noDraft", true);
    JSONObject result = parse(resultText);
    String sourcePath = result.getString("sourcePath");
    if (sourcePath == null || !sourcePath.startsWith("outputs/") || !sourcePath.endsWith(".py"))
      throw new AgentHttpException(422, "INVALID_RESULT",
          "result.json sourcePath must name a tested program under outputs/");
    String code = file(owner.domainId(), sessionId, runId, sourcePath);
    String name = result.getString("name");
    String logic = result.getString("logic");
    JSONArray classNames = result.getJSONArray("classNames");
    JSONArray parameterDefs = result.getJSONArray("parameterDefs");
    if (name == null || name.isBlank() || logic == null || classNames == null || classNames.isEmpty())
      throw new AgentHttpException(422, "INVALID_RESULT",
          "result.json must contain name, logic and a non-empty classNames array");
    if (parameterDefs == null)
      throw new AgentHttpException(422, "INVALID_RESULT", "result.json must contain parameterDefs");

    List<Map<String, Object>> classDefs =
        (List<Map<String, Object>>) admin.getJSONRule(owner.domainId()).get("classDef");
    List<Parameter> parameters = DBSchemaUtil.buildParameters(parameterDefs.toList(Map.class), classDefs);
    Function function = new Function();
    function.setOrigin(Function.ORIGIN_USER);
    function.setOperation(Function.OPERATION_WRITE);
    function.setDomainId(owner.domainId());
    function.setName(name);
    function.setParameters(parameters);
    function.setCode(code);
    function.setLogic(logic);
    ReturnDef returnDef = new ReturnDef();
    returnDef.setIsVoid(true);
    returnDef.setClassNames(classNames.toList(String.class));
    function.setReturnDef(returnDef);

    Action action = new Action();
    action.setName(name);
    action.setOrigin(Action.ORIGIN_USER);
    action.setFunction(function);
    action.setStatus(Action.STATUS_PUBLISHED);
    action.setDomainId(owner.domainId());
    action.setSubmissionCriteria(result.getJSONObject("submissionCriteria"));
    boolean explanationMissing = false;
    try {
      actions.explainForDraft(action, lang);
    } catch (Exception error) {
      explanationMissing = true;
    }
    String codeHash = CodeHashUtil.sha256(code);
    action.setCodeHash(codeHash);
    action.setExplanationVersion(Action.EXPLANATION_VERSION);
    action.setDefinition(ActionDefinitionProjector.project(action));

    String draftId = UUID.randomUUID().toString();
    store.update(
        "INSERT INTO action_drafts(id,domain_id,owner_id,session_id,run_id,code_hash,program,"
            + "parameters,return_def,result,action,definition,explanation_missing,expires_at)"
            + " VALUES(?,?,?,?,?,?,?,?::jsonb,?::jsonb,?::jsonb,?::jsonb,?::jsonb,?,now()+?::interval)",
        uuid(draftId),
        owner.domainId(),
        owner.userId(),
        uuid(sessionId),
        uuid(runId),
        codeHash,
        code,
        AgentJson.json(parameters),
        AgentJson.json(returnDef),
        AgentJson.json(result),
        AgentJson.json(action),
        AgentJson.json(action.getDefinition()),
        explanationMissing,
        TTL_HOURS + " hours");
    JSONObject view = JSONObject.of(
        "draftId", draftId,
        "action", action,
        "definition", action.getDefinition(),
        "explanationMissing", explanationMissing);
    return view;
  }

  public Action save(String draftId, String lang) throws Exception {
    Owner owner = owner();
    var row =
        store.one(
            "SELECT * FROM action_drafts WHERE id=? AND owner_id=? AND domain_id=?",
            uuid(draftId),
            owner.userId(),
            owner.domainId());
    if (row.get("consumed_at") != null)
      throw new AgentHttpException(409, "DRAFT_CONSUMED", "This draft has already been saved");
    if (Instant.parse(row.getString("expires_at")).toEpochMilli() <= System.currentTimeMillis())
      throw new AgentHttpException(410, "DRAFT_EXPIRED", "This draft has expired");

    Action action = JSON.parseObject(row.getString("action"), Action.class);
    String program = row.getString("program");
    String codeHash = CodeHashUtil.sha256(program);
    Function function = action.getFunction();
    if (function == null)
      throw new AgentHttpException(422, "INVALID_DRAFT", "The draft has no function");
    if (!program.equals(function.getCode())
        || action.getCodeHash() == null
        || !action.getCodeHash().equals(codeHash)
        || !codeHash.equals(row.getString("code_hash")))
      throw new AgentHttpException(409, "DRAFT_CHANGED", "The draft no longer matches its code");
    function.setDomainId(owner.domainId());
    action.setDomainId(owner.domainId());
    action.setExplanationVersion(Action.EXPLANATION_VERSION);
    action.setDefinition(ActionDefinitionProjector.project(action));
    action.setFunction(functionDao.save(function));
    Action saved = actionDao.save(action);
    store.update("UPDATE action_drafts SET consumed_at=now() WHERE id=?", uuid(draftId));
    return saved;
  }

  /** Expired and consumed drafts are kept for a day so a late save gets a clear answer. */
  @Scheduled(fixedDelay = 3_600_000L)
  public void cleanup() {
    store.update("DELETE FROM action_drafts WHERE expires_at < now() - interval '1 day'");
  }

  private JSONObject parse(String text) {
    try {
      return JSON.parseObject(text);
    } catch (Exception error) {
      throw new AgentHttpException(422, "INVALID_RESULT", "The agent result is not valid JSON");
    }
  }

  private String file(String domain, String session, String run, String path) throws Exception {
    String value = fileOrNull(domain, session, run, path);
    if (value == null)
      throw new AgentHttpException(422, "MISSING_RESULT", "Missing generation file: " + path);
    return value;
  }

  private String fileOrNull(String domain, String session, String run, String path) throws Exception {
    if (path == null || path.startsWith("/") || Arrays.asList(path.split("/", -1)).contains(".."))
      throw new AgentHttpException(422, "INVALID_RESULT_PATH", "Invalid result path");
    var artifacts =
        runtime
            .json(
                domain,
                run,
                "/v1/runs/"
                    + run
                    + "/artifacts?path="
                    + URLEncoder.encode(path, StandardCharsets.UTF_8),
                "GET",
                null,
                null)
            .getJSONArray("artifacts");
    if (artifacts == null || artifacts.isEmpty()) return null;
    var artifact = artifacts.getJSONObject(artifacts.size() - 1);
    if (!run.equals(artifact.getString("runId")) || !session.equals(artifact.getString("sessionId")))
      throw new AgentHttpException(422, "INVALID_RESULT", "Inherited files are not run results");
    return new String(
        runtime.bytes(domain, run, "/v1/artifacts/" + artifact.getString("id") + "/content"),
        StandardCharsets.UTF_8);
  }
}
