package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.*;
import com.alibaba.fastjson2.schema.JSONSchema;
import java.util.*;

/** Dataset sourceAnalysis boundary; structural schema is generated from the shared TS contract. */
public final class QuerySubgraphContract {
  private QuerySubgraphContract() {}

  private static final JSONSchema SHAPE;
  static {
    try (var input = QuerySubgraphContract.class.getResourceAsStream("/ontology-contracts/query-subgraph.schema.json")) {
      if (input == null) throw new IllegalStateException("Missing query subgraph contract");
      SHAPE = JSONSchema.of(JSON.parseObject(input.readAllBytes()));
    } catch (Exception error) {
      throw new ExceptionInInitializerError(error);
    }
  }

  public static JSONObject validate(JSONObject graph) {
    var validation = SHAPE.validate(graph);
    if (!validation.isSuccess()) throw new IllegalArgumentException("Invalid query subgraph: " + validation.getMessage());
    List<String> issues = issues(graph);
    if (!issues.isEmpty()) throw new IllegalArgumentException(String.join("; ", issues));
    return graph;
  }

  /** The same reference and path rules as querySubgraphIssues in packages/contracts. */
  private static List<String> issues(JSONObject graph) {
    var issues = new ArrayList<String>();
    var ids = new HashSet<String>();
    var queries = new HashSet<String>();
    var nodes = new LinkedHashMap<String, JSONObject>();
    var incoming = new HashMap<String, List<JSONObject>>();
    var keys = new HashSet<String>();
    for (Object item : graph.getJSONArray("queries")) {
      var query = JSONObject.from(item);
      add(ids, query.getString("id"), issues);
      queries.add(query.getString("id"));
    }
    for (Object item : graph.getJSONArray("nodes")) {
      var node = JSONObject.from(item);
      String id = node.getString("id"), kind = node.getString("kind"), query = node.getString("queryId");
      add(ids, id, issues);
      nodes.put(id, node);
      if ((kind.equals("class") || kind.equals("operation")) && query != null && !queries.contains(query))
        issues.add("Unknown query: " + query);
      if (kind.equals("output") && !keys.add(node.getString("key")))
        issues.add("Duplicate output key: " + node.getString("key"));
    }
    for (Object item : graph.getJSONArray("edges")) {
      var edge = JSONObject.from(item);
      String id = edge.getString("id"), kind = edge.getString("kind");
      add(ids, id, issues);
      var from = nodes.get(edge.getString("source"));
      var to = nodes.get(edge.getString("target"));
      incoming.computeIfAbsent(edge.getString("target"), ignored -> new ArrayList<>()).add(edge);
      if (from == null || to == null) { issues.add("Unknown edge endpoint: " + id); continue; }
      String fk = from.getString("kind"), tk = to.getString("kind");
      if (kind.equals("contains") && !(fk.equals("class") && tk.equals("field")))
        issues.add("Invalid field ownership: " + id);
      if (kind.equals("relation")) {
        if (!(fk.equals("class") && tk.equals("class") && Objects.equals(from.getString("queryId"), to.getString("queryId"))))
          issues.add("Invalid ontology relation: " + id);
        var hops = edge.getJSONObject("hops");
        if (hops.getInteger("max") != null && hops.getIntValue("max") < hops.getIntValue("min"))
          issues.add("Invalid hop range: " + id);
      }
      if (kind.equals("dependency") &&
          (!(fk.equals("field") || fk.equals("operation")) || !(tk.equals("operation") || tk.equals("output")) ||
            (tk.equals("output") && !"value".equals(edge.getString("role")))))
        issues.add("Invalid dependency: " + id);
    }
    for (var node : nodes.values()) {
      String id = node.getString("id"), kind = node.getString("kind");
      var edges = incoming.getOrDefault(id, List.of());
      long values = edges.stream().filter(e -> "dependency".equals(e.getString("kind"))).count();
      if (kind.equals("field") && edges.stream().filter(e -> "contains".equals(e.getString("kind"))).count() != 1)
        issues.add("Field requires one owner: " + id);
      if (kind.equals("output") && values != 1) issues.add("Output requires one value: " + id);
      if (kind.equals("operation")) {
        String operation = node.getString("operation");
        if ((operation.equals("constant") && values != 0) ||
            (!operation.equals("constant") && !operation.equals("unknown") && values == 0))
          issues.add("Invalid operation inputs: " + id);
      }
    }
    for (Object item : graph.getJSONArray("filters")) {
      var filter = JSONObject.from(item);
      add(ids, filter.getString("id"), issues);
      if (!queries.contains(filter.getString("queryId")) ||
          filter.getList("targetIds", String.class).stream().anyMatch(id -> !nodes.containsKey(id)))
        issues.add("Invalid filter targets: " + filter.getString("id"));
    }
    var done = new HashSet<String>();
    var active = new HashSet<String>();
    for (String id : nodes.keySet()) visit(id, incoming, done, active, issues);
    return issues;
  }

  private static void add(Set<String> ids, String id, List<String> issues) {
    if (!ids.add(id)) issues.add("Duplicate graph id: " + id);
  }

  private static void visit(String id, Map<String, List<JSONObject>> incoming, Set<String> done,
      Set<String> active, List<String> issues) {
    if (active.contains(id)) { issues.add("Dependency cycle: " + id); return; }
    if (done.contains(id)) return;
    active.add(id);
    for (var edge : incoming.getOrDefault(id, List.of()))
      if ("dependency".equals(edge.getString("kind"))) visit(edge.getString("source"), incoming, done, active, issues);
    active.remove(id);
    done.add(id);
  }
}
