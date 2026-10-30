package io.ontomato.dataengine.service;

import io.ontomato.dataengine.dataAdapter.DslContractViolationException;
import static io.ontomato.dataengine.dataAdapter.DslContractViolationException.Code.INVALID_GRAMMAR;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.bean.abcHarness.ABCHarnessProgramOutKeyRef;
import io.ontomato.dataengine.util.DBSchemaUtil;
import java.util.*;
import java.util.regex.Pattern;

/** Builds the shared subgraph from executed DSL structure or stored declaration boundaries. */
public final class QuerySourceAnalysis {
  private QuerySourceAnalysis() {}
  private static final Pattern REFERENCE = Pattern.compile("([\\p{L}_][\\p{L}\\p{N}_]*)\\.([\\p{L}_][\\p{L}\\p{N}_]*)");
  private static final Pattern LITERAL = Pattern.compile("'(?:''|[^'])*'|[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?|(?i:true|false|null)");
  private static final Set<String> AGGREGATES = Set.of("COUNT", "SUM", "AVG", "AVERAGE", "MIN", "MAX", "MEDIAN", "STDDEV", "VARIANCE", "FIRST", "LAST", "COLLECT", "ARRAY_AGG", "STRING_AGG");

  public static boolean aggregate(String function) {
    return function != null && AGGREGATES.contains(function.trim().toUpperCase(Locale.ROOT));
  }

  public static JSONObject fromDsl(JSONObject dsl, List<Map<String, Object>> definitions) {
    return new DslGraph(definitions).build(dsl);
  }

  /** Read-boundary compatibility for permission evaluation of persisted outKeyRefs.
   * Never writes back or invents display labels; this is not a second editable analysis.
   */
  public static JSONObject fromStoredSources(List<ABCHarnessProgramOutKeyRef> refs) {
    if (refs == null) throw new IllegalArgumentException("Stored program has no source declaration");
    Builder graph = new Builder();
    graph.queries.add(JSONObject.of("id", "stored-query", "label", "Stored program sources"));
    Map<String, String> classes = new HashMap<>();
    for (var ref : refs) {
      if (ref.getClassName() == null || ref.getAttrName() == null || ref.getAsGroupBy() == null || ref.getStatCal() == null)
        throw new IllegalArgumentException("Incomplete stored source declaration");
      String owner = classes.computeIfAbsent(ref.getClassName(), name -> graph.node("class", name,
          "queryId", "stored-query", "className", name, "variable", "stored_" + classes.size()));
      String field = graph.node("field", ref.getAttrName(), "attrName", ref.getAttrName());
      graph.edge("contains", owner, field);
      String value = field;
      if (ref.getAsGroupBy() || ref.getStatCal()) {
        value = graph.operation(ref.getAsGroupBy() ? "group" : "aggregate", "stored-query", ref.getKey(), ref.getKey());
        graph.dependency(field, value, "value");
      }
      graph.output(ref.getKey(), value);
    }
    return QuerySubgraphContract.validate(graph.result());
  }

  public static List<String> outputKeys(JSONObject graph) {
    return graph.getJSONArray("nodes").stream().map(JSONObject::from)
        .filter(n -> "output".equals(n.getString("kind"))).map(n -> n.getString("key")).toList();
  }

  /** Display labels are declared by the agent; Java never guesses or fills them. */
  public static void outputLabels(JSONObject actual, JSONObject declared, String language) {
    if (declared == null) throw new IllegalArgumentException("sourceAnalysis with output labels is required");
    QuerySubgraphContract.validate(declared);
    Map<String, String> labels = new HashMap<>();
    for (Object value : declared.getJSONArray("nodes")) {
      var node = JSONObject.from(value);
      if ("output".equals(node.getString("kind"))) labels.put(node.getString("key"), node.getString("label"));
    }
    if (!labels.keySet().equals(new HashSet<>(outputKeys(actual)))) throw new IllegalArgumentException("Declared output labels do not match the query");
    for (Object value : actual.getJSONArray("nodes")) {
      var node = (JSONObject) value;
      if ("output".equals(node.getString("kind"))) {
        String text = labels.get(node.getString("key"));
        if (text.isBlank()) throw new IllegalArgumentException("Output labels must not be blank");
        node.put("label", text);
      }
    }
  }

  private static String label(Object value, String fallback) { return value == null || value.toString().isBlank() ? fallback : value.toString(); }

  private static class Builder {
    final JSONArray queries = new JSONArray(), nodes = new JSONArray(), edges = new JSONArray(), filters = new JSONArray();
    int sequence;
    String id(String prefix) { return prefix + (++sequence); }
    String node(String kind, String label, Object... values) {
      JSONObject node = JSONObject.of("id", id("node-"), "kind", kind, "label", label);
      for (int i = 0; i < values.length; i += 2) node.put((String) values[i], values[i + 1]);
      nodes.add(node); return node.getString("id");
    }
    void edge(String kind, String source, String target, Object... values) {
      JSONObject edge = JSONObject.of("id", id("edge-"), "kind", kind, "source", source, "target", target);
      for (int i = 0; i < values.length; i += 2) edge.put((String) values[i], values[i + 1]);
      edges.add(edge);
    }
    void dependency(String source, String target, String role) { edge("dependency", source, target, "role", role, "label", ""); }
    String operation(String operation, String query, String expression, String label) {
      return node("operation", label, "queryId", query, "operation", operation, "expression", expression);
    }
    void output(String key, String source) { dependency(source, node("output", key, "key", key), "value"); }
    JSONObject result() { return JSONObject.of("schema", "ontomato.query-subgraph.v1", "queries", queries, "nodes", nodes, "edges", edges, "filters", filters); }
  }

  private static final class DslGraph extends Builder {
    final List<Map<String, Object>> definitions;
    final Map<String, JSONObject> metadata = new HashMap<>();
    final Map<String, Map<String, String>> tables = new HashMap<>();
    final Map<String, String> owners = new HashMap<>(), ownerClasses = new HashMap<>();
    final Map<String, Map<String, String>> variables = new HashMap<>();
    final String query = "dsl-query";

    DslGraph(List<Map<String, Object>> definitions) {
      this.definitions = definitions;
      definitions.forEach(d -> metadata.put((String) d.get("className"), JSONObject.from(d)));
    }

    JSONObject build(JSONObject dsl) {
      String question = dsl.getString("problem");
      queries.add(JSONObject.of("id", query, "label", question == null || question.isBlank() ? "DSL query" : question));
      Map<String, String> lastOutput = Map.of();
      for (Object stepValue : dsl.getJSONObject("answer").getJSONArray("steps")) {
        JSONObject step = JSONObject.from(stepValue);
        owners.clear(); ownerClasses.clear(); variables.clear();
        for (Object patternValue : step.getJSONObject("graph").getJSONArray("patterns")) {
          var pattern = JSONObject.from(patternValue);
          Map<String, String> indices = new HashMap<>();
          for (Object objectValue : pattern.getJSONArray("objects")) {
            var object = JSONObject.from(objectValue);
            String variable = object.getString("variable"), name = object.getString("class");
            if (variable == null || variables.containsKey(variable)) throw new DslContractViolationException(INVALID_GRAMMAR, "answer.steps", "DSL variables must identify one object");
            if (tables.containsKey(name)) variables.put(variable, tables.get(name));
            else {
              name = DBSchemaUtil.normalizeClassName(name, definitions);
              if (!metadata.containsKey(name)) throw new DslContractViolationException(INVALID_GRAMMAR, "answer.steps", "Unknown DSL class: " + name);
              var definition = metadata.get(name);
              String owner = node("class", label(definition.get("classDesc"), name),
                  "queryId", query, "className", name, "variable", variable);
              owners.put(variable, owner); ownerClasses.put(variable, name);
              variables.put(variable, new LinkedHashMap<>());
              indices.put(object.getString("idx"), owner);
            }
            if (object.getJSONObject("conditions") != null) condition(object.getJSONObject("conditions"), variable);
          }
          JSONArray relations = pattern.getJSONArray("relationship");
          if (relations != null) for (Object relationValue : relations) {
            var relation = JSONObject.from(relationValue);
            String from = indices.get(relation.getString("from")), to = indices.get(relation.getString("to"));
            if (from == null || to == null) throw new DslContractViolationException(INVALID_GRAMMAR, "answer.steps", "Relationship endpoints must be ontology objects");
            for (Object type : relation.getJSONArray("type")) {
              String name = type.toString();
              Integer maximum = relation.getInteger("max_hops");
              edge("relation", from, to, "name", name, "relationType", name, "direction", "forward", "label", name,
                  "hops", JSONObject.of("min", relation.getIntValue("min_hops", 1), "max", maximum == null || maximum < 0 ? null : maximum));
            }
          }
        }
        var output = step.getJSONObject("output");
        if (output == null) throw new DslContractViolationException(INVALID_GRAMMAR, "answer.steps", "DSL step output is required");
        Set<String> groups = new LinkedHashSet<>();
        var grouping = output.getJSONObject("group_by");
        if (grouping != null) for (Object item : grouping.getJSONArray("fields")) {
          var group = JSONObject.from(item); groups.add(field(group.getString("variable"), group.getString("field")));
        }
        Map<String, String> fields = new LinkedHashMap<>();
        for (Object value : output.getJSONArray("fields")) {
          var field = JSONObject.from(value);
          String key = field.getString("as");
          if (key == null || fields.containsKey(key)) throw new DslContractViolationException(INVALID_GRAMMAR, "answer.steps", "Unique DSL output aliases are required");
          String expression = field.getString("expr"), source;
          if (expression != null) {
            if (LITERAL.matcher(expression.trim()).matches()) {
              source = operation("constant", query, expression, key);
            } else {
              source = operation("calculate", query, expression, key);
              var matcher = REFERENCE.matcher(expression);
              int count = 0;
              while (matcher.find()) { dependency(field(matcher.group(1), matcher.group(2)), source, "value"); count++; }
              if (count == 0) throw new DslContractViolationException(INVALID_GRAMMAR, "answer.steps", "Calculated DSL output has no field sources");
            }
          } else {
            String attribute = field.getString("field"), function = field.getString("function");
            if ("*".equals(attribute) && "COUNT".equalsIgnoreCase(function))
              source = operation("constant", query, "1", "One per authorized row");
            else source = field(field.getString("variable"), attribute);
            String kind = aggregate(function) ? "aggregate" : groups.contains(source) || Boolean.TRUE.equals(field.getBoolean("distinct")) ? "group" : function != null ? "calculate" : null;
            if (kind != null) {
              String op = operation(kind, query, function == null ? "GROUP BY " + attribute : function + "(" + attribute + ")", key);
              dependency(source, op, "value");
              if (kind.equals("aggregate")) for (String group : groups) dependency(group, op, "group");
              source = op;
            }
          }
          if (field.get("conditions") != null) {
            String predicate = JSON.toJSONString(field.get("conditions"));
            filters.add(JSONObject.of("id", id("filter-"), "queryId", query, "targetIds", List.of(source),
                "label", "Input conditions: " + predicate, "expression", predicate));
          }
          fields.put(key, source);
        }
        if (output.get("having") != null && !fields.isEmpty()) {
          String predicate = JSON.toJSONString(output.get("having"));
          filters.add(JSONObject.of("id", id("filter-"), "queryId", query, "targetIds", new ArrayList<>(fields.values()),
              "label", "HAVING " + predicate, "expression", predicate));
        }
        if (output.getString("save_table") != null) tables.put(output.getString("save_table"), fields);
        lastOutput = fields;
      }
      lastOutput.forEach(this::output);
      return QuerySubgraphContract.validate(result());
    }

    String field(String variable, String attribute) {
      if (variable == null) {
        var matches = variables.keySet().stream().filter(v -> variables.get(v).containsKey(attribute) ||
            ownerClasses.containsKey(v) && metadata.get(ownerClasses.get(v)).getJSONArray("attrs").stream()
              .anyMatch(a -> attribute.equals(JSONObject.from(a).getString("name")))).toList();
        if (matches.size() != 1) throw new DslContractViolationException(INVALID_GRAMMAR, "answer.steps", "Ambiguous DSL field: " + attribute);
        variable = matches.get(0);
      }
      var fields = variables.get(variable);
      if (fields == null || attribute == null) throw new DslContractViolationException(INVALID_GRAMMAR, "answer.steps", "Unknown DSL field reference");
      if (fields.containsKey(attribute)) return fields.get(attribute);
      String owner = owners.get(variable), name = ownerClasses.get(variable);
      if (owner == null) throw new DslContractViolationException(INVALID_GRAMMAR, "answer.steps", "Unknown temporary table field: " + attribute);
      var attr = metadata.get(name).getJSONArray("attrs").stream().map(JSONObject::from)
          .filter(a -> attribute.equals(a.getString("name")) && !Boolean.FALSE.equals(a.getBoolean("enable"))).findFirst()
          .orElseThrow(() -> new DslContractViolationException(INVALID_GRAMMAR, "answer.steps", "Unknown source attribute: " + attribute));
      String id = node("field", label(attr.get("attrDesc"), attribute), "attrName", attribute);
      edge("contains", owner, id); fields.put(attribute, id); return id;
    }

    void condition(JSONObject condition, String variable) {
      Set<String> targets = new LinkedHashSet<>();
      conditionFields(condition, variable, targets);
      if (targets.isEmpty() && owners.containsKey(variable)) targets.add(owners.get(variable));
      if (targets.isEmpty()) throw new DslContractViolationException(INVALID_GRAMMAR, "answer.steps", "Condition has no source reference");
      String expression = condition.toJSONString();
      filters.add(JSONObject.of("id", id("filter-"), "queryId", query, "targetIds", targets, "label", expression, "expression", expression));
    }

    void conditionFields(Object value, String variable, Set<String> targets) {
      if (value instanceof Map<?, ?> map) {
        if (map.get("field") instanceof String name) targets.add(field(variable, name));
        for (Object child : map.values()) conditionFields(child, variable, targets);
      } else if (value instanceof Iterable<?> list) for (Object item : list) conditionFields(item, variable, targets);
    }
  }
}
