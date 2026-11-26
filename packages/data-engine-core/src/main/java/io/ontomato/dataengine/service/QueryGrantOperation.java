package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONObject;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.server.PathContainer;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;

/** HTTP bindings for the stable operations understood by the query grant issuer. */
public enum QueryGrantOperation {
  DATA_OVERVIEW("GET", "/ontology/query/overview"),
  DATA_SCHEMA("/ontology/query/schema"),
  DATA_DSL_REFERENCE("/ontology/query/dsl-reference"),
  DATA_QUERY("/ontology/query/execute-dsl"),
  DATA_DISTINCT("/ontology/query/distinct-values"),
  METRIC_RECALL("/ontology/query/metrics/recall"),
  METRIC_SEARCH("/ontology/query/metrics/search"),
  METRIC_DESCRIBE("/ontology/query/metrics/describe"),
  METRIC_FORM("/ontology/query/metrics/parameter-form"),
  METRIC_PARSE("/ontology/query/metrics/parse-parameters"),
  METRIC_EXECUTE("/ontology/query/metrics/execute"),
  KNOWLEDGE_SEARCH("/ontology/query/knowledge/search"),
  RETRIEVAL_CONTEXT("GET", "/ontology/retrievals/runtime-context"),
  RETRIEVAL_OUTPUT_CREATE("/ontology/retrievals/{retrievalId}/runs/{runId}/outputs"),
  RETRIEVAL_OUTPUT_READ("GET", "/ontology/retrievals/{retrievalId}/runs/{runId}/outputs/{output}"),
  RETRIEVAL_OUTPUT_CONTENT("GET", "/ontology/retrievals/{retrievalId}/runs/{runId}/outputs/{output}/content"),
  GENERATION_CONTEXT("GET", "/ontology/ai/generation/runtime-context"),
  GENERATION_SOURCE("GET", "/ontology/ai/generation/{runId}/source"),
  GENERATION_HELPERS("GET", "/ontology/ai/generation/{runId}/helpers"),
  GENERATION_EXPLAIN("/ontology/ai/generation/{runId}/explainDraft"),
  GENERATION_TEST("/ontology/ai/generation/{runId}/test"),
  GENERATION_PREPARE("/ontology/ai/generation/{runId}/prepare"),
  GENERATION_RESET("/ontology/ai/generation/{runId}/reset"),
  GENERATION_QUERY("/ontology/ai/generation/{runId}/query"),
  GENERATION_CLOSE("/ontology/ai/generation/{runId}/close"),
  GOVERNANCE_ACTION("/ontology/ai/knowledge-governance/{recordId}/runs/{runId}/actions/{action}"),
  WRITE_INSERT("/writeFunctionOperation/insert"),
  WRITE_UPDATE("/writeFunctionOperation/update"),
  WRITE_DELETE("/writeFunctionOperation/delete"),
  WRITE_EDGE_CREATE("/writeFunctionOperation/createEdge"),
  WRITE_EDGE_DELETE("/writeFunctionOperation/deleteEdge"),
  WRITE_QUERY("/writeFunctionOperation/query"),
  WRITE_VECTOR_APPEND("/writeFunctionOperation/appendVector"),
  WRITE_VECTOR_UPDATE("/writeFunctionOperation/updateVector"),
  WRITE_VECTOR_DELETE("/writeFunctionOperation/deleteVector"),
  ATTACH_VECTOR_RESOURCE("/vectorResource/upload"),
  DETACH_VECTOR_RESOURCE("/vectorResource/delete");

  static final Set<QueryGrantOperation> QUERY = Set.of(DATA_OVERVIEW, DATA_SCHEMA, DATA_DSL_REFERENCE,
      DATA_QUERY, DATA_DISTINCT, METRIC_RECALL, METRIC_SEARCH, METRIC_DESCRIBE, METRIC_FORM,
      METRIC_PARSE, METRIC_EXECUTE, KNOWLEDGE_SEARCH);
  static final Set<QueryGrantOperation> GENERATION = Set.of(GENERATION_CONTEXT, GENERATION_SOURCE,
      GENERATION_HELPERS, GENERATION_EXPLAIN, GENERATION_TEST, GENERATION_PREPARE, GENERATION_RESET,
      GENERATION_QUERY, GENERATION_CLOSE);
  static final Set<QueryGrantOperation> RETRIEVAL = Set.of(RETRIEVAL_CONTEXT, RETRIEVAL_OUTPUT_CREATE,
      RETRIEVAL_OUTPUT_READ, RETRIEVAL_OUTPUT_CONTENT);
  static final Set<QueryGrantOperation> WRITE = Set.of(WRITE_INSERT, WRITE_UPDATE, WRITE_DELETE,
      WRITE_EDGE_CREATE, WRITE_EDGE_DELETE, WRITE_QUERY, WRITE_VECTOR_APPEND, WRITE_VECTOR_UPDATE,
      WRITE_VECTOR_DELETE);

  static final Set<QueryGrantOperation> SANDBOX = Set.of(
      DATA_OVERVIEW, DATA_SCHEMA, DATA_DSL_REFERENCE, DATA_QUERY, DATA_DISTINCT, METRIC_RECALL,
      METRIC_SEARCH, METRIC_DESCRIBE, METRIC_FORM, METRIC_PARSE, KNOWLEDGE_SEARCH,
      RETRIEVAL_CONTEXT, GENERATION_CONTEXT, GENERATION_SOURCE, GENERATION_HELPERS,
      WRITE_INSERT, WRITE_UPDATE, WRITE_DELETE, WRITE_EDGE_CREATE, WRITE_EDGE_DELETE,
      WRITE_QUERY, WRITE_VECTOR_APPEND, WRITE_VECTOR_UPDATE, WRITE_VECTOR_DELETE);

  private final String method;
  private final PathPattern route;

  QueryGrantOperation(String path) {
    this("POST", path);
  }

  QueryGrantOperation(String method, String path) {
    this.method = method;
    this.route = new PathPatternParser().parse(path);
  }

  public record Call(QueryGrantOperation operation, Map<String, String> bindings) {
    boolean matches(JSONObject claims) {
      return List.of("runId", "retrievalId", "recordId").stream().allMatch(key ->
          !bindings.containsKey(key) || bindings.get(key).equals(claims.getString(key)));
    }

    public boolean requiresGrant() {
      return WRITE.contains(operation);
    }
  }

  public static Call resolve(String method, String path) {
    var request = PathContainer.parsePath(path);
    for (var operation : values()) {
      if (!operation.method.equals(method)) continue;
      var match = operation.route.matchAndExtract(request);
      if (match != null) return new Call(operation, match.getUriVariables());
    }
    return null;
  }
}
