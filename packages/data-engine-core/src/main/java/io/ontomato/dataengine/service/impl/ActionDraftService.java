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
import io.ontomato.dataengine.core.bean.SimpleUser;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.ActionDao;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.ActionFunctionAdmission;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.agent.ActionCreationService;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.agent.AgentJson;
import io.ontomato.dataengine.service.agent.AgentRuntimeClient;
import io.ontomato.dataengine.service.agent.OntologyAgentStore;
import io.ontomato.dataengine.service.agent.OntologyGenerationService;
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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Turns the last files of a conversational action-creation run into a draft, and saves that
 * draft without asking the explain agent again. The draft is the "last version snapshot" of the
 * harness workspace: program, parameters, return definition, raw result and the explanation.
 */
@Service
public class ActionDraftService {
  private static final Logger log = LoggerFactory.getLogger(ActionDraftService.class);
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
          draft_hash text,
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
        ALTER TABLE action_drafts ADD COLUMN IF NOT EXISTS draft_hash text;
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
    // A conversational turn may only answer a question or refresh the explanation. It does not
    // replace the current draft, but the refreshed draft must still reach the right-hand pane.
    if (resultText == null) {
      var latest =
          store.rows(
              "SELECT * FROM action_drafts WHERE session_id=? AND owner_id=? AND domain_id=?"
                  + " AND consumed_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 1",
              uuid(sessionId),
              owner.userId(),
              owner.domainId());
      if (!latest.isEmpty()) return view(latest.get(0));
      return JSONObject.of("draftId", null, "noDraft", true);
    }
    JSONObject result = parse(resultText);
    String sourcePath = result.getString("sourcePath");
    if (sourcePath == null || !sourcePath.startsWith("outputs/") || !sourcePath.endsWith(".py"))
      throw new AgentHttpException(422, "INVALID_RESULT",
          "result.json sourcePath must name a tested program under outputs/");
    String code = file(owner.domainId(), sessionId, runId, sourcePath);
    String codeHash = CodeHashUtil.sha256(code);
    String draftHash = CodeHashUtil.sha256(code + "\n" + AgentJson.canonical(result));
    // A chat turn that only refreshes the explanation leaves the code and result unchanged.
    // Reuse the already explained draft instead of starting another explain run.
    var existing =
        store.rows(
            "SELECT * FROM action_drafts WHERE session_id=? AND owner_id=? AND domain_id=?"
                + " AND draft_hash=? AND consumed_at IS NULL AND expires_at>now()"
                + " ORDER BY created_at DESC LIMIT 1",
            uuid(sessionId),
            owner.userId(),
            owner.domainId(),
            draftHash);
    if (!existing.isEmpty() && !existing.get(0).getBooleanValue("explanation_missing")) {
      return view(existing.get(0));
    }
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
    // A draft is authored and published by the same subject at this point; the snapshot carries it so
    // saving the draft does not have to re-derive who wrote it.
    action.setCreatedBy(owner.userId());
    action.setReviewedBy(owner.userId());
    action.setSubmissionCriteria(result.getJSONObject("submissionCriteria"));
    boolean explanationMissing = false;
    try {
      actions.explainForDraft(action, lang);
    } catch (Exception error) {
      explanationMissing = true;
      log.warn("Draft explanation failed for action run {}: {}", runId, error.getMessage());
    }
    action.setCodeHash(codeHash);
    action.setExplanationVersion(Action.EXPLANATION_VERSION);
    action.setDefinition(ActionDefinitionProjector.project(action));

    String draftId = UUID.randomUUID().toString();
    store.update(
        "INSERT INTO action_drafts(id,domain_id,owner_id,session_id,run_id,code_hash,draft_hash,"
            + "program,parameters,return_def,result,action,definition,explanation_missing,expires_at)"
            + " VALUES(?,?,?,?,?,?,?,?,?::jsonb,?::jsonb,?::jsonb,?::jsonb,?::jsonb,?,now()+?::interval)",
        uuid(draftId),
        owner.domainId(),
        owner.userId(),
        uuid(sessionId),
        uuid(runId),
        codeHash,
        draftHash,
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

  /**
   * Re-runs the explain agent for the newest draft in a conversational action-creation session.
   * The draft keeps its code hash; only its action explanation and derived definition are replaced.
   */
  public JSONObject explainLatest(String sessionId, String lang, Owner owner) throws Exception {
    var rows =
        store.rows(
            "SELECT * FROM action_drafts WHERE session_id=? AND owner_id=? AND domain_id=?"
                + " AND consumed_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 1",
            uuid(sessionId),
            owner.userId(),
            owner.domainId());
    if (rows.isEmpty())
      throw new AgentHttpException(404, "NO_DRAFT", "No draft exists for this session");
    JSONObject row = rows.get(0);
    Action action = JSON.parseObject(row.getString("action"), Action.class);
    if (action.getFunction() == null || action.getFunction().getCode() == null)
      throw new AgentHttpException(422, "INVALID_DRAFT", "The draft has no function code");
    try {
      // The explain tool is called with a generation grant, not a browser session. Set the
      // owner explicitly so the explain run can resolve its domain credential.
      OntologyGenerationService.asOwner(
          new SimpleUser(owner.userId(), null, null, true, owner.domainId()),
          () -> {
            actions.explainForDraft(action, lang);
            return null;
          });
    } catch (Exception error) {
      throw new AgentHttpException(422, "EXPLAIN_FAILED", error.getMessage());
    }
    action.setExplanationVersion(Action.EXPLANATION_VERSION);
    action.setDefinition(ActionDefinitionProjector.project(action));
    String draftHash =
        CodeHashUtil.sha256(
            row.getString("program")
                + "\n"
                + AgentJson.canonical(JSON.parseObject(row.getString("result"))));
    String draftId = row.getString("id");
    store.update(
        "UPDATE action_drafts SET action=?::jsonb, definition=?::jsonb, draft_hash=?,"
            + " explanation_missing=false WHERE id=?",
        AgentJson.json(action),
        AgentJson.json(action.getDefinition()),
        draftHash,
        uuid(draftId));
    return JSONObject.of(
        "draftId", draftId,
        "action", action,
        "definition", action.getDefinition(),
        "explanationMissing", false);
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
    ActionFunctionAdmission.requireSupported(function, langService, lang);
    if (!program.equals(function.getCode())
        || action.getCodeHash() == null
        || !action.getCodeHash().equals(codeHash)
        || !codeHash.equals(row.getString("code_hash")))
      throw new AgentHttpException(409, "DRAFT_CHANGED", "The draft no longer matches its code");
    function.setDomainId(owner.domainId());
    action.setDomainId(owner.domainId());
    if (action.getCreatedBy() == null) action.setCreatedBy(owner.userId());
    action.setReviewedBy(owner.userId());
    action.setExplanationVersion(Action.EXPLANATION_VERSION);
    action.setDefinition(ActionDefinitionProjector.project(action));
    action.setFunction(functionDao.save(function, lang));
    Action saved = actionDao.save(action);
    store.update("UPDATE action_drafts SET consumed_at=now() WHERE id=?", uuid(draftId));
    return saved;
  }

  /** Expired and consumed drafts are kept for a day so a late save gets a clear answer. */
  @Scheduled(fixedDelay = 3_600_000L)
  public void cleanup() {
    store.update("DELETE FROM action_drafts WHERE expires_at < now() - interval '1 day'");
  }

  private JSONObject view(JSONObject row) {
    return JSONObject.of(
        "draftId", row.getString("id"),
        "action", JSON.parseObject(row.getString("action"), Action.class),
        "definition", JSON.parseObject(row.getString("definition")),
        "explanationMissing", row.getBooleanValue("explanation_missing"));
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
    // The session workspace is persistent, so the artifacts endpoint may return a file from an
    // earlier run. It is not a delivery of this run. If only inherited artifacts exist, this run
    // wrote no result; the caller then falls back to the newest draft in the session.
    for (int i = artifacts.size() - 1; i >= 0; i--) {
      var artifact = artifacts.getJSONObject(i);
      if (run.equals(artifact.getString("runId"))
          && session.equals(artifact.getString("sessionId"))) {
        return new String(
            runtime.bytes(domain, run, "/v1/artifacts/" + artifact.getString("id") + "/content"),
            StandardCharsets.UTF_8);
      }
    }
    return null;
  }
}
