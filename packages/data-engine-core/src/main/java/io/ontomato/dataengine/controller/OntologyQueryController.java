package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessCheck;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgram;
import io.ontomato.dataengine.service.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class OntologyQueryController {
  private final QueryGrantService grants;
  private final OntologyQueryService ontology;
  private final QueryOutputService outputs;
  private final QueryJobService jobs;
  private final CheckServiceV2 checks;
  private final RuntimeCodeClient runtime;

  public OntologyQueryController(
      QueryGrantService grants,
      OntologyQueryService ontology,
      QueryOutputService outputs,
      QueryJobService jobs,
      CheckServiceV2 checks,
      RuntimeCodeClient runtime) {
    this.grants = grants;
    this.ontology = ontology;
    this.outputs = outputs;
    this.jobs = jobs;
    this.checks = checks;
    this.runtime = runtime;
  }

  @PostMapping("/internal/query-grants/exploration")
  public Object grant(@RequestBody JSONObject body, HttpServletRequest request) throws Exception {
    grants.requireWorkbench(request);
    var access = grants.access(request);
    if (!java.util.Set.of(
            "retrievalId", "runtimeSessionId", "runtimeRunId", "expiresAt", "classNames")
        .containsAll(body.keySet()))
      throw new IllegalArgumentException("Unsupported exploration grant fields");
    if (access.grant() != null)
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "A user credential is required");
    UUID.fromString(body.getString("runtimeRunId"));
    UUID.fromString(body.getString("runtimeSessionId"));
    UUID.fromString(body.getString("retrievalId"));
    runtime.registerSkill();
    String token = grants.issueExploration(access, body);
    var claims = grants.verify(token, body.getString("runtimeRunId"), "/ontology/query/overview");
    return Map.of(
        "credential",
        Map.of("kind", "bearer", "value", token),
        "expiresAt",
        java.time.Instant.ofEpochMilli(claims.getLongValue("expiresAt")).toString());
  }

  @PostMapping("/internal/query-grants/revoke")
  public Object revoke(@RequestBody JSONObject body, HttpServletRequest request) {
    grants.requireWorkbench(request);
    var access = grants.access(request);
    grants.revoke(access.user().getDomainId(), body.getString("runtimeRunId"));
    return Map.of("revoked", true);
  }

  @GetMapping("/ontology/query/overview")
  public Object overview(HttpServletRequest request) {
    return ontology.overview(grants.access(request));
  }

  @PostMapping("/ontology/query/schema")
  public Object schema(@RequestBody JSONObject body, HttpServletRequest request) {
    return ontology.schema(body.getList("classNames", String.class), grants.access(request));
  }

  @PostMapping("/ontology/query/dsl-reference")
  public Object reference(@RequestBody JSONObject body, HttpServletRequest request) {
    return ontology.reference(body.getList("classNames", String.class), grants.access(request));
  }

  @PostMapping("/ontology/query/distinct-values")
  public Object distinct(@RequestBody JSONObject body, HttpServletRequest request) {
    return ontology.distinct(body, grants.access(request));
  }

  @PostMapping("/ontology/query/execute-dsl")
  public Object execute(@RequestBody JSONObject body, HttpServletRequest request) {
    if (!body.keySet().equals(java.util.Set.of("dsl")))
      throw new IllegalArgumentException("Only dsl is accepted; identity comes from credentials");
    return ontology.execute(body.getJSONObject("dsl"), grants.access(request));
  }

  @PostMapping("/ontology/query/metrics/search")
  public Object metrics(@RequestBody JSONObject body, HttpServletRequest request) {
    return ontology.metrics(body, grants.access(request));
  }

  @PostMapping("/ontology/query/knowledge/search")
  public Object knowledge(@RequestBody JSONObject body, HttpServletRequest request) {
    return ontology.knowledge(body, grants.access(request));
  }

  @PostMapping("/ontology/query/metrics/execute")
  public Object metric(@RequestBody JSONObject body, HttpServletRequest request) throws Exception {
    JSONObject recipe =
        JSONObject.of(
            "kind",
            "metric",
            "metricId",
            body.getString("id"),
            "revision",
            body.getString("revision"),
            "parameters",
            body.getJSONObject("parameters"));
    return outputs.execute(
        UUID.randomUUID().toString(),
        recipe,
        new JSONArray(),
        grants.access(request),
        language(request));
  }

  @PostMapping("/ontology/query/outputs")
  @ResponseStatus(HttpStatus.ACCEPTED)
  public Object output(@RequestBody JSONObject body, HttpServletRequest request) {
    var access = grants.access(request);
    if (access.grant() != null)
      throw new ResponseStatusException(
          HttpStatus.FORBIDDEN, "Final output requires the end user credential");
    String id = body.getString("submissionId"), lang = language(request);
    return jobs.start(
        id,
        access.user(),
        "output",
        body,
        sessionId ->
            outputs.execute(
                sessionId,
                body.getJSONObject("recipe"),
                body.getJSONArray("outKeyRefs"),
                access,
                lang));
  }

  @GetMapping("/ontology/query/outputs/{id}")
  public Object outputStatus(@PathVariable String id, HttpServletRequest request) {
    return jobs.get(id, grants.access(request).user(), "output");
  }

  @PostMapping("/ontology/query/outputs/{id}/cancel")
  public Object outputCancel(@PathVariable String id, HttpServletRequest request) throws Exception {
    return jobs.cancel(id, grants.access(request).user(), "output");
  }

  @PostMapping("/query-quality-checks")
  @ResponseStatus(HttpStatus.ACCEPTED)
  public Object quality(@RequestBody JSONObject body, HttpServletRequest request) {
    grants.requireWorkbench(request);
    var access = grants.access(request);
    String id = body.getString("id"), lang = language(request);
    return jobs.start(
        id,
        access.user(),
        "quality",
        body,
        sessionId -> {
          ABCHarnessCheck check = new ABCHarnessCheck();
          check.setSessionId(sessionId);
          check.setOriginQuestion(body.getString("question"));
          check.setLang(lang);
          check.setCreateTimestamp(System.currentTimeMillis());
          check.setFinished(false);
          var programs = body.getJSONArray("programs").toJavaList(ABCHarnessProgram.class);
          JSONArray recipes = body.getJSONArray("recipes");
          for (int i = 0; i < programs.size(); i++)
            if (programs.get(i).getCode() == null
                && recipes != null
                && "dsl".equals(recipes.getJSONObject(i).getString("kind")))
              programs
                  .get(i)
                  .setCode(
                      io.ontomato.dataengine.util.DslToPythonCodeUtil.generate(
                          recipes.getJSONObject(i).getJSONObject("dsl"), ""));
          checks.saveCheckTask(check);
          checks.check(
              check,
              programs,
              body.getList("classNames", String.class),
              access.user().getDomainId());
          long deadline = System.currentTimeMillis() + 60000;
          while (!Boolean.TRUE.equals(check.getFinished())) {
            if (System.currentTimeMillis() > deadline)
              throw new IllegalStateException("Quality check timed out");
            if (BackendSessionEntrance.isCancelled(sessionId))
              throw new SessionCancelledException(id);
            Thread.sleep(100);
            check = checks.queryBySessionId(sessionId);
          }
          return check;
        });
  }

  @GetMapping("/query-quality-checks/{id}")
  public Object qualityStatus(@PathVariable String id, HttpServletRequest request) {
    return jobs.get(id, grants.access(request).user(), "quality");
  }

  @PostMapping("/query-quality-checks/{id}/cancel")
  public Object qualityCancel(@PathVariable String id, HttpServletRequest request)
      throws Exception {
    return jobs.cancel(id, grants.access(request).user(), "quality");
  }

  private String language(HttpServletRequest request) {
    String value = request.getHeader("Accept-Language");
    return value == null ? "en" : value;
  }
}
