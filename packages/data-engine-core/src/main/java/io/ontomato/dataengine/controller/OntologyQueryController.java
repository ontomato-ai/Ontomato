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
  private final QueryGrantService grants;
  private final QueryAccessService authorization;
  private final OntologyQueryService ontology;
  private final QueryOutputService outputs;
  private final QueryJobService jobs;
  private final QueryQualityService quality;

  public OntologyQueryController(
      QueryGrantService grants,
      QueryAccessService authorization,
      OntologyQueryService ontology,
      QueryOutputService outputs,
      QueryJobService jobs,
      QueryQualityService quality) {
    this.grants = grants;
    this.authorization = authorization;
    this.ontology = ontology;
    this.outputs = outputs;
    this.jobs = jobs;
    this.quality = quality;
  }

  @GetMapping("/ontology/query/overview")
  public Object overview(HttpServletRequest request) {
    return ontology.overview(authorization.access(request));
  }

  @PostMapping("/ontology/query/schema")
  public Object schema(@RequestBody JSONObject body, HttpServletRequest request) {
    return ontology.schema(body.getList("classNames", String.class), authorization.access(request));
  }

  @PostMapping("/ontology/query/dsl-reference")
  public Object reference(@RequestBody JSONObject body, HttpServletRequest request) {
    return ontology.reference(
        body.getList("classNames", String.class), authorization.access(request));
  }

  @PostMapping("/ontology/query/distinct-values")
  public Object distinct(@RequestBody JSONObject body, HttpServletRequest request) {
    return ontology.distinct(body, authorization.access(request));
  }

  @PostMapping("/ontology/query/execute-dsl")
  public Object execute(@RequestBody JSONObject body, HttpServletRequest request) {
    if (!body.keySet().equals(java.util.Set.of("dsl")))
      throw new IllegalArgumentException("Only dsl is accepted; identity comes from credentials");
    return ontology.execute(body.getJSONObject("dsl"), authorization.access(request));
  }

  @PostMapping("/ontology/query/metrics/search")
  public Object metrics(@RequestBody JSONObject body, HttpServletRequest request) {
    return ontology.metrics(body, authorization.access(request));
  }

  @PostMapping("/ontology/query/knowledge/search")
  public Object knowledge(@RequestBody JSONObject body, HttpServletRequest request) {
    return ontology.knowledge(body, authorization.access(request));
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
        authorization.access(request),
        language(request));
  }

  @PostMapping("/ontology/query/outputs")
  @ResponseStatus(HttpStatus.ACCEPTED)
  public Object output(@RequestBody JSONObject body, HttpServletRequest request) {
    var access = authorization.access(request);
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
    return jobs.get(id, authorization.access(request).user(), "output");
  }

  @PostMapping("/ontology/query/outputs/{id}/cancel")
  public Object outputCancel(@PathVariable String id, HttpServletRequest request) throws Exception {
    return jobs.cancel(id, authorization.access(request).user(), "output");
  }

  @PostMapping("/query-quality-checks")
  @ResponseStatus(HttpStatus.ACCEPTED)
  public Object quality(@RequestBody JSONObject body, HttpServletRequest request) {
    grants.requireWorkbench(request);
    var access = authorization.access(request);
    String id = body.getString("id"), lang = language(request);
    return quality.start(body, access.user(), lang);
  }

  @GetMapping("/query-quality-checks/{id}")
  public Object qualityStatus(@PathVariable String id, HttpServletRequest request) {
    return jobs.get(id, authorization.access(request).user(), "quality");
  }

  @PostMapping("/query-quality-checks/{id}/cancel")
  public Object qualityCancel(@PathVariable String id, HttpServletRequest request)
      throws Exception {
    return jobs.cancel(id, authorization.access(request).user(), "quality");
  }

  private String language(HttpServletRequest request) {
    String value = request.getHeader("Accept-Language");
    return value == null ? "en" : value;
  }
}
