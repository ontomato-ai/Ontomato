package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.*;
import jakarta.servlet.http.HttpServletRequest;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class OntologyQueryController {
  private final QueryAccessService authorization;
  private final OntologyQueryService ontology;
  private final QueryOutputService outputs;
  private final QueryJobService jobs;

  public OntologyQueryController(
      QueryAccessService authorization,
      OntologyQueryService ontology,
      QueryOutputService outputs,
      QueryJobService jobs) {
    this.authorization = authorization;
    this.ontology = ontology;
    this.outputs = outputs;
    this.jobs = jobs;
  }

  @org.springframework.beans.factory.annotation.Autowired
  private io.ontomato.dataengine.service.agent.OntologyAgentAccess agentAccess;

  private QueryAccessService.Access access(HttpServletRequest request) {
    var access = authorization.access(request);
    String caller = request.getHeader("X-Ontomato-Retrieval-Caller-Id");
    return access.grant() == null && caller != null ? agentAccess.scopedQuery(access, caller) : access;
  }

  @GetMapping("/ontology/query/overview")
  public Object overview(HttpServletRequest request) {
    return ontology.overview(access(request));
  }

  @PostMapping("/ontology/query/schema")
  public Object schema(@RequestBody JSONObject body, HttpServletRequest request) {
    return ontology.schema(body.getList("classNames", String.class), access(request));
  }

  @PostMapping("/ontology/query/dsl-reference")
  public Object reference(@RequestBody JSONObject body, HttpServletRequest request) {
    return ontology.reference(
        body.getList("classNames", String.class), access(request));
  }

  @PostMapping("/ontology/query/distinct-values")
  public Object distinct(@RequestBody JSONObject body, HttpServletRequest request) {
    return ontology.distinct(body, access(request));
  }

  @PostMapping("/ontology/query/execute-dsl")
  public Object execute(@RequestBody JSONObject body, HttpServletRequest request) {
    if (!body.keySet().equals(java.util.Set.of("dsl")))
      throw new IllegalArgumentException("Only dsl is accepted; identity comes from credentials");
    return ontology.execute(body.getJSONObject("dsl"), access(request));
  }

  @PostMapping("/ontology/query/metrics/search")
  public Object metrics(@RequestBody JSONObject body, HttpServletRequest request) {
    return ontology.metrics(body, access(request));
  }

  @PostMapping("/ontology/query/knowledge/search")
  public Object knowledge(@RequestBody JSONObject body, HttpServletRequest request) {
    return ontology.knowledge(body, access(request));
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
    if (body.containsKey("bindingId")) recipe.put("bindingId", body.getString("bindingId"));
    return outputs.execute(
        UUID.randomUUID().toString(),
        recipe,
        null,
        access(request),
        language(request));
  }

  @PostMapping("/ontology/query/outputs")
  @ResponseStatus(HttpStatus.ACCEPTED)
  public Object output(@RequestBody JSONObject body, HttpServletRequest request) {
    var access = access(request);
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
                body.getJSONObject("sourceAnalysis"),
                access,
                lang));
  }

  @GetMapping("/ontology/query/outputs/{id}")
  public Object outputStatus(@PathVariable String id, HttpServletRequest request) {
    return jobs.get(id, access(request).user(), "output");
  }

  @PostMapping("/ontology/query/outputs/{id}/cancel")
  public Object outputCancel(@PathVariable String id, HttpServletRequest request) throws Exception {
    return jobs.cancel(id, access(request).user(), "output");
  }

  private String language(HttpServletRequest request) {
    String value = request.getHeader("Accept-Language");
    return value == null ? "en" : value;
  }
}
