package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** The single class/field decision used by query metadata, DSL and program output. */
public final class QueryPermissions {
  private QueryPermissions() {}
  public enum Use { DETAIL, GROUP, AGGREGATE }
  public record Source(String className, String attrName, Use use) {}

  public static Map<String, Object> visibleRule(Map<String, Object> original, UserDataPermission permission, List<String> scope) {
    Map<String, Object> result = new LinkedHashMap<>(original);
    List<Map<String, Object>> visible = new ArrayList<>();
    Set<String> names = new HashSet<>();
    for (Object value : (List<?>) original.get("classDef")) {
      var definition = JSONObject.from(value);
      String name = definition.getString("className");
      if (!QueryPermissions.classAllowed(permission, name) || scope != null && !scope.isEmpty() && !scope.contains(name)) continue;
      var copy = new JSONObject(definition);
      copy.put("attrs", definition.getJSONArray("attrs").stream().map(JSONObject::from)
          .filter(a -> !Boolean.FALSE.equals(a.getBoolean("enable")) && QueryPermissions.fieldAvailable(permission, name, a.getString("name"))).toList());
      if (copy.getJSONArray("attrs").isEmpty() && !permission.isFullData()) continue;
      visible.add(copy); names.add(name);
    }
    result.put("classDef", visible);
    Map<String, Object> relationships = new LinkedHashMap<>();
    if (original.get("relationship_rule") instanceof Map<?, ?> map)
      map.forEach((key, value) -> { var relation = JSONObject.from(value);
        if (names.contains(relation.getString("fromclass")) && names.contains(relation.getString("toclass"))) relationships.put(key.toString(), relation);
      });
    result.put("relationship_rule", relationships);
    return result;
  }

  public static boolean classAllowed(UserDataPermission permission, String name) {
    var fields = permission.getFieldPermissionByClassName(name);
    return permission.isFullData() || fields != null && !fields.isEmpty();
  }

  public static boolean allowed(UserDataPermission permission, String name, String field, Use use) {
    if (permission.isFullData()) return true;
    var fields = permission.getFieldPermissionByClassName(name);
    if (fields == null) return false;
    return fields.getVisibleFields().contains(field) ||
        use != Use.DETAIL && fields.getGroupableColumns().contains(field);
  }

  public static boolean fieldAvailable(UserDataPermission permission, String name, String field) {
    if (allowed(permission, name, field, Use.GROUP)) return true;
    var fields = permission.getFieldPermissionByClassName(name);
    return fields != null && java.util.stream.Stream.concat(fields.getVisibleFields().stream(), fields.getGroupableColumns().stream())
        .anyMatch(value -> value.startsWith(field + "."));
  }

  public static void requireClass(UserDataPermission permission, String name) {
    if (!classAllowed(permission, name)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Class is outside the authorized scope");
  }

  public static void requireField(UserDataPermission permission, String name, String field, Use use) {
    if (!allowed(permission, name, field, use)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Field is outside the authorized scope");
  }

  public static void restrictRelations(JSONObject dsl, Map<String, Object> rule, UserDataPermission permission) {
    Set<String> allowed = new LinkedHashSet<>();
    if (rule.get("relationship_rule") instanceof Map<?, ?> relationships)
      relationships.forEach((key, value) -> { var relation = JSONObject.from(value);
        if (classAllowed(permission, relation.getString("fromclass")) && classAllowed(permission, relation.getString("toclass"))) allowed.add(key.toString());
      });
    for (Object value : dsl.getJSONObject("answer").getJSONArray("steps"))
      for (Object patternValue : JSONObject.from(value).getJSONObject("graph").getJSONArray("patterns")) {
        var relations = JSONObject.from(patternValue).getJSONArray("relationship");
        if (relations == null) continue;
        for (Object relationValue : relations) {
          var relation = (JSONObject) relationValue;
          List<String> names = relation.getList("type", String.class);
          if (names == null || names.isEmpty()) throw new IllegalArgumentException("Relationship types are required");
          if (names.contains("*")) {
            if (allowed.isEmpty()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "No authorized relationships");
            relation.put("type", new ArrayList<>(allowed));
          } else if (!allowed.containsAll(names)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Relationship is outside the authorized scope");
        }
      }
  }

  public static Map<String, Set<Source>> sources(JSONObject graph) {
    QuerySubgraphContract.validate(graph);
    Map<String, JSONObject> nodes = new LinkedHashMap<>();
    Map<String, List<JSONObject>> incoming = new HashMap<>();
    for (Object item : graph.getJSONArray("nodes")) {
      var n = JSONObject.from(item); nodes.put(n.getString("id"), n);
    }
    for (Object item : graph.getJSONArray("edges")) {
      var e = JSONObject.from(item);
      incoming.computeIfAbsent(e.getString("target"), ignored -> new ArrayList<>()).add(e);
    }
    Map<String, Set<Source>> result = new LinkedHashMap<>();
    for (var node : nodes.values()) if ("output".equals(node.getString("kind"))) {
      Set<Source> dependencies = new LinkedHashSet<>();
      collect(node.getString("id"), Use.DETAIL, nodes, incoming, dependencies);
      result.put(node.getString("key"), dependencies);
    }
    return result;
  }

  public static void authorizeInputs(JSONObject graph, UserDataPermission permission, List<Map<String, Object>> definitions) {
    QuerySubgraphContract.validate(graph);
    Map<String, JSONObject> nodes = new HashMap<>(), metadata = new HashMap<>();
    definitions.forEach(d -> metadata.put((String) d.get("className"), JSONObject.from(d)));
    for (Object value : graph.getJSONArray("nodes")) {
      var node = JSONObject.from(value); nodes.put(node.getString("id"), node);
      if ("class".equals(node.getString("kind"))) {
        String name = node.getString("className");
        requireClass(permission, name);
        if (!metadata.containsKey(name)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Source class is outside the task scope");
      }
    }
    for (Object value : graph.getJSONArray("edges")) {
      var edge = JSONObject.from(value);
      if (!"contains".equals(edge.getString("kind"))) continue;
      String name = nodes.get(edge.getString("source")).getString("className");
      String attribute = nodes.get(edge.getString("target")).getString("attrName");
      if (!fieldAvailable(permission, name, attribute))
        throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Field is outside the authorized scope");
      if (metadata.get(name).getJSONArray("attrs").stream().map(JSONObject::from)
          .noneMatch(a -> attribute.equals(a.getString("name")) && !Boolean.FALSE.equals(a.getBoolean("enable"))))
        throw new IllegalArgumentException("Unknown source attribute");
    }
  }

  public static JSONObject response(Map<String, Object> result, JSONObject graph, UserDataPermission permission, boolean internal) {
    JSONObject answer = JSON.parseObject(JSON.toJSONString(result, JSONWriter.Feature.WriteMapNullValue));
    if (!internal) {
      if (answer.get("error") != null) return JSONObject.of("error", "Query execution failed", "sourceAnalysis", graph);
      JSONArray data = new JSONArray();
      if (answer.getJSONArray("data") != null) for (Object value : answer.getJSONArray("data")) {
        var datum = JSONObject.from(value);
        var visible = JSONObject.of("answer", mask(datum.getJSONArray("answer"), graph, permission));
        for (String key : List.of("truncated", "rowLimit", "truncationHint"))
          if (datum.containsKey(key)) visible.put(key, datum.get(key));
        data.add(visible);
      }
      answer = JSONObject.of("data", data);
    }
    answer.put("sourceAnalysis", graph);
    return answer;
  }

  private static void collect(String id, Use use, Map<String, JSONObject> nodes,
      Map<String, List<JSONObject>> incoming, Set<Source> sources) {
    var node = nodes.get(id);
    if ("field".equals(node.getString("kind"))) {
      var owner = incoming.get(id).stream().filter(e -> "contains".equals(e.getString("kind"))).findFirst().orElseThrow();
      sources.add(new Source(nodes.get(owner.getString("source")).getString("className"), node.getString("attrName"), use));
      return;
    }
    String operation = node.getString("operation");
    if ("unknown".equals(operation)) throw new IllegalArgumentException("Output has unresolved field sources");
    if ("aggregate".equals(operation)) use = Use.AGGREGATE;
    if ("group".equals(operation)) use = Use.GROUP;
    for (var edge : incoming.getOrDefault(id, List.of())) {
      if (!"dependency".equals(edge.getString("kind"))) continue;
      String role = edge.getString("role");
      // Predicate/join fields are checked when the query is admitted; they are not displayed values.
      if ("filter".equals(role) || "join".equals(role)) continue;
      collect(edge.getString("source"), "group".equals(role) ? Use.GROUP : use, nodes, incoming, sources);
    }
  }

  public static JSONArray mask(JSONArray rows, JSONObject graph, UserDataPermission permission) {
    var sources = sources(graph);
    Set<String> denied = new HashSet<>();
    sources.forEach((key, values) -> {
      if (values.stream().anyMatch(s -> !allowed(permission, s.className(), s.attrName(), s.use()))) denied.add(key);
    });
    JSONArray visible = new JSONArray();
    for (Object value : rows) {
      JSONObject row = JSON.parseObject(JSON.toJSONString(value, JSONWriter.Feature.WriteMapNullValue));
      if (!row.keySet().equals(sources.keySet())) throw new IllegalArgumentException("Result columns do not match source analysis");
      for (String key : denied) {
        var dependencies = sources.get(key);
        Object cellValue = row.get(key);
        if (dependencies.size() == 1 && cellValue instanceof List<?> cells) {
          Source source = dependencies.iterator().next();
          var fields = permission.getFieldPermissionByClassName(source.className());
          boolean partial = fields != null && java.util.stream.Stream.concat(fields.getVisibleFields().stream(),
              source.use() == Use.DETAIL ? java.util.stream.Stream.<String>empty() : fields.getGroupableColumns().stream())
              .anyMatch(field -> field.startsWith(source.attrName() + "."));
          if (!partial) { row.put(key, "****"); continue; }
          JSONArray masked = new JSONArray();
          for (Object cell : cells) {
            if (cell instanceof List<?> bucket && bucket.size() >= 3) {
              JSONArray copy = JSONArray.from(bucket);
              if (!allowed(permission, source.className(), source.attrName() + "." + bucket.get(1), source.use()))
                for (int i = 0; i < copy.size(); i++) if (i != 1) copy.set(i, "****");
              masked.add(copy);
            } else masked.add("****");
          }
          row.put(key, masked);
        } else row.put(key, "****");
      }
      visible.add(row);
    }
    return visible;
  }
}
