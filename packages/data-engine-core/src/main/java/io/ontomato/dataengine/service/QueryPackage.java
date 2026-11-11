package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.*;
import com.alibaba.fastjson2.schema.JSONSchema;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import java.util.*;

/** A closed query source bundle. DSL provenance is derived; Python computation is declared. */
public final class QueryPackage {
  private QueryPackage() {}
  private static final JSONSchema SHAPE;
  static {
    try (var in = QueryPackage.class.getResourceAsStream("/ontology-contracts/query-package.schema.json")) {
      if (in == null) throw new IllegalStateException("Missing query package schema");
      SHAPE = JSONSchema.of(JSON.parseObject(in.readAllBytes()));
    } catch (Exception e) { throw new ExceptionInInitializerError(e); }
  }

  public static JSONObject copy(JSONObject value) {
    return JSON.parseObject(JSON.toJSONString(value, JSONWriter.Feature.WriteMapNullValue));
  }

  public static JSONObject validate(JSONObject value) {
    var result = SHAPE.validate(value);
    if (!result.isSuccess()) throw new IllegalArgumentException("Invalid query package: " + result.getMessage());
    var manifest = value.getJSONObject("manifest");
    var files = files(value);
    var expected = new HashSet<String>();
    for (Object item : manifest.getJSONObject("queries").values())
      if (!expected.add(path((String) item))) throw new IllegalArgumentException("Duplicate query file");
    for (String module : manifest.getList("modules", String.class))
      if (!expected.add(path(module))) throw new IllegalArgumentException("Duplicate module file");
    var entry = manifest.getJSONObject("entry");
    if ("python".equals(entry.getString("kind"))) {
      if (!expected.add(path(entry.getString("path")))) throw new IllegalArgumentException("Duplicate entry file");
      if (manifest.getJSONObject("computation") == null) throw new IllegalArgumentException("Python computation declaration is required");
    } else if (!manifest.getJSONObject("queries").containsKey(entry.getString("query")))
      throw new IllegalArgumentException("Unknown DSL entry query");
    if (!expected.equals(files.keySet())) throw new IllegalArgumentException("Package files must match the manifest exactly");
    Set<String> parameters = new HashSet<>();
    for (Parameter p : definitions(value))
      if (p.getName() == null || !parameters.add(p.getName())) throw new IllegalArgumentException("Duplicate parameter name");
    Set<String> pointers = new HashSet<>();
    for (Object item : manifest.getJSONArray("parameterBindings")) {
      var binding = JSONObject.from(item);
      String query = binding.getString("query"), pointer = binding.getString("pointer");
      if (!parameters.contains(binding.getString("parameter")) || !pointers.add(query + ":" + pointer))
        throw new IllegalArgumentException("Invalid parameter binding");
      bind(query(value, query), pointer, null);
    }
    return value;
  }

  /** Capture model input once, before its identity or execution receipt is established. */
  public static JSONObject accept(JSONObject value) {
    var accepted = copy(validate(value));
    for (Object item : accepted.getJSONObject("manifest").getJSONArray("parameterDefs")) {
      var definition = (JSONObject) item;
      definition.put("value", io.ontomato.dataengine.util.ParameterValues.normalize(
          definition.getString("type"), definition.get("value")));
    }
    return accepted;
  }

  public static JSONObject fromDsl(String text) {
    return JSONObject.of("manifest", JSONObject.of("schema", "ontomato.query-package.v1",
        "entry", JSONObject.of("kind", "dsl", "query", "main"), "queries", JSONObject.of("main", "query.json"),
        "modules", new JSONArray(), "parameterDefs", new JSONArray(), "parameterBindings", new JSONArray(), "computation", null),
        "files", JSONArray.of(JSONObject.of("path", "query.json", "content", text)));
  }

  public static String path(String name) {
    if (name == null || name.isEmpty() || name.startsWith("/") || name.contains("\\") || name.contains(":"))
      throw new IllegalArgumentException("Expected a package-relative path");
    for (String part : name.split("/", -1))
      if (part.isEmpty() || part.equals(".") || part.equals("..")) throw new IllegalArgumentException("Invalid package path");
    return name;
  }

  public static Map<String, String> files(JSONObject value) {
    var files = new LinkedHashMap<String, String>();
    for (Object item : value.getJSONArray("files")) {
      var f = JSONObject.from(item);
      if (files.put(path(f.getString("path")), f.getString("content")) != null)
        throw new IllegalArgumentException("Duplicate package file");
    }
    return files;
  }

  public static List<Parameter> definitions(JSONObject value) {
    return value.getJSONObject("manifest").getJSONArray("parameterDefs").toJavaList(Parameter.class);
  }

  public static JSONObject parameters(JSONObject value, JSONObject supplied) {
    var defaults = new JSONObject();
    var function = new Function();
    function.setParameters(definitions(value));
    for (var p : function.getParameters()) defaults.put(p.getName(), p.getValue());
    if (supplied != null) defaults.putAll(supplied);
    MetricViewBindings.validateValues(function, defaults);
    return defaults;
  }

  public static JSONObject query(JSONObject value, String id) {
    var manifest = value.getJSONObject("manifest");
    var queries = manifest.getJSONObject("queries");
    String filename = queries.getString(id);
    if (filename == null && queries.containsValue(id)) filename = id;
    if (filename == null) throw new IllegalArgumentException("Query is not declared in the package: " + id);
    return JSON.parseObject(files(value).get(filename));
  }

  public static JSONObject query(JSONObject value, String id, JSONObject values) {
    var dsl = query(value, id);
    String filename = value.getJSONObject("manifest").getJSONObject("queries").getString(id);
    for (Object item : value.getJSONObject("manifest").getJSONArray("parameterBindings")) {
      var binding = JSONObject.from(item);
      String name = binding.getString("query");
      if (name.equals(id) || Objects.equals(value.getJSONObject("manifest").getJSONObject("queries").getString(name), id) || name.equals(filename))
        bind(dsl, binding.getString("pointer"), values.get(binding.getString("parameter")));
    }
    return dsl;
  }

  /** Bind JSON values only, never query identifiers, operators or expression text. */
  private static void bind(JSONObject dsl, String pointer, Object value) {
    if (!pointer.startsWith("/answer/steps/")) throw new IllegalArgumentException("Parameter must target a DSL value");
    String[] parts = pointer.substring(1).split("/", -1);
    Object parent = dsl;
    for (int i = 0; i < parts.length - 1; i++) {
      String key = parts[i].replace("~1", "/").replace("~0", "~");
      parent = parent instanceof JSONObject object ? object.get(key)
          : parent instanceof JSONArray array ? array.get(Integer.parseInt(key)) : null;
      if (parent == null) throw new IllegalArgumentException("Parameter pointer does not exist: " + pointer);
    }
    String leaf = parts[parts.length - 1];
    if (!(parent instanceof JSONObject object) || !object.containsKey(leaf) ||
        !(leaf.equals("value") && (object.containsKey("operator") || object.containsKey("function")) ||
          (leaf.equals("start") || leaf.equals("end")) && pointer.contains("/time_range/") ||
          (leaf.equals("count") || leaf.equals("offset")) && pointer.contains("/limit/") ||
          leaf.equals("query") && object.containsKey("field")))
      throw new IllegalArgumentException("Parameter must target a DSL value: " + pointer);
    // Adapters cannot emit IN (). Bind an empty set to a false predicate on the same field.
    if ("value".equals(leaf) && "in".equals(object.getString("operator"))
        && pointer.contains("/conditions/properties/") && value instanceof List<?> items && items.isEmpty()) {
      String field = object.getString("field");
      object.clear();
      object.putAll(io.ontomato.dataengine.util.DslPermissionUtil.alwaysFalse(field));
    } else object.put(leaf, value);
  }

  public static JSONObject analysis(JSONObject value, JSONObject values, JSONObject labels,
      List<Map<String, Object>> definitions) {
    validate(value);
    var manifest = value.getJSONObject("manifest");
    var entry = manifest.getJSONObject("entry");
    if ("dsl".equals(entry.getString("kind"))) {
      var graph = QuerySourceAnalysis.fromDsl(query(value, entry.getString("query"), values), definitions);
      labels(graph, labels);
      return graph;
    }
    var graph = JSONObject.of("schema", "ontomato.query-subgraph.v1", "queries", new JSONArray(),
        "nodes", new JSONArray(), "edges", new JSONArray(), "filters", new JSONArray());
    var refs = new HashMap<String, String>();
    for (String id : manifest.getJSONObject("queries").keySet()) {
      var part = QuerySourceAnalysis.fromDsl(query(value, id, values), definitions);
      for (Object item : part.getJSONArray("nodes")) {
        var node = (JSONObject) item;
        if ("output".equals(node.getString("kind"))) {
          refs.put(id + "." + node.getString("key"), id + ":" + node.getString("id"));
          node.put("kind", "operation");
          node.put("queryId", "dsl-query");
          node.put("operation", "project");
          node.put("expression", node.remove("key"));
        }
      }
      for (String collection : List.of("queries", "nodes", "edges", "filters")) {
        for (Object item : part.getJSONArray(collection)) {
          var object = copy(JSONObject.from(item));
          for (String key : List.of("id", "queryId", "source", "target"))
            if (object.get(key) != null) object.put(key, id + ":" + object.getString(key));
          if (object.containsKey("targetIds")) object.put("targetIds", object.getList("targetIds", String.class).stream().map(n -> id + ":" + n).toList());
          graph.getJSONArray(collection).add(object);
        }
      }
    }
    var computation = manifest.getJSONObject("computation");
    for (Object item : computation.getJSONArray("operations")) {
      var op = JSONObject.from(item);
      if (refs.put(op.getString("id"), "python:" + op.getString("id")) != null)
        throw new IllegalArgumentException("Duplicate computation id");
    }
    int edge = 0;
    for (Object item : computation.getJSONArray("operations")) {
      var op = JSONObject.from(item);
      String target = refs.get(op.getString("id"));
      graph.getJSONArray("nodes").add(JSONObject.of("id", target, "kind", "operation", "queryId", null,
          "operation", op.getString("operation"), "expression", op.getString("expression"), "label", op.getString("expression")));
      for (Object input : op.getJSONArray("inputs")) {
        var from = JSONObject.from(input);
        String ref = from.containsKey("query") ? from.getString("query") + "." + from.getString("key") : from.getString("operation");
        if (!refs.containsKey(ref)) throw new IllegalArgumentException("Unknown computation input: " + ref);
        graph.getJSONArray("edges").add(JSONObject.of("id", "python:edge" + edge++, "kind", "dependency",
            "source", refs.get(ref), "target", target, "role", from.getString("role"), "label", ""));
      }
    }
    for (Object item : computation.getJSONArray("outputs")) {
      var output = JSONObject.from(item);
      String key = output.getString("key"), ref = refs.get(output.getString("from"));
      if (ref == null) throw new IllegalArgumentException("Unknown output computation");
      graph.getJSONArray("nodes").add(JSONObject.of("id", "python:out:" + key, "kind", "output", "key", key, "label", key));
      graph.getJSONArray("edges").add(JSONObject.of("id", "python:edge" + edge++, "kind", "dependency",
          "source", ref, "target", "python:out:" + key, "role", "value", "label", ""));
    }
    labels(graph, labels);
    return QuerySubgraphContract.validate(graph);
  }

  public static void labels(JSONObject graph, JSONObject labels) {
    if (labels == null || !new HashSet<>(QuerySourceAnalysis.outputKeys(graph)).equals(labels.keySet()))
      throw new IllegalArgumentException("Column labels must match package outputs");
    for (Object item : graph.getJSONArray("nodes")) {
      var node = (JSONObject) item;
      if ("output".equals(node.getString("kind"))) {
        String label = labels.getString(node.getString("key"));
        if (label == null || label.isBlank()) throw new IllegalArgumentException("Column labels must not be blank");
        node.put("label", label);
      }
    }
  }

  public static JSONObject labels(JSONObject graph) {
    var result = new JSONObject();
    for (Object item : graph.getJSONArray("nodes")) {
      var node = JSONObject.from(item);
      if ("output".equals(node.getString("kind"))) result.put(node.getString("key"), node.getString("label"));
    }
    return result;
  }

  public static void prepareReadFunction(Function function, List<Map<String, Object>> definitions) {
    if (!Function.OPERATION_READ.equals(function.getOperation())) return;
    if (function.getQueryPackage() == null)
      throw new IllegalArgumentException("Convert this read Function to a query package before saving");
    if (function.getCode() != null && !function.getCode().isBlank())
      throw new IllegalArgumentException("Read Functions have one query package, not a second code definition");
    var bundle = accept(function.getQueryPackage());
    function.setQueryPackage(bundle);
    var returns = function.getReturnDef();
    if (returns == null) returns = new io.ontomato.dataengine.bean.function.ReturnDef();
    var labels = returns.getColumnLabels();
    if (labels == null && returns.getSourceAnalysis() != null) labels = labels(returns.getSourceAnalysis());
    var symbolic = new JSONObject();
    for (var parameter : definitions(bundle)) symbolic.put(parameter.getName(), "${" + parameter.getName() + "}");
    var graph = analysis(bundle, symbolic, labels, definitions);
    returns.setColumnLabels(labels);
    returns.setSourceAnalysis(graph);
    returns.setOutKeyRefs(null);
    returns.setIsVoid(false);
    returns.setClassNames(graph.getJSONArray("nodes").stream().map(JSONObject::from)
        .filter(n -> "class".equals(n.getString("kind"))).map(n -> n.getString("className")).distinct().toList());
    function.setReturnDef(returns);
    function.setCode(null);
    function.setParameters(null);
  }

  public static String launcher(JSONObject value) {
    return "# ontomato-python:2\nimport query_runtime\nimport runpy, sys\nsys.path.insert(0, 'package')\nrunpy.run_path("
        + JSON.toJSONString("package/" + value.getJSONObject("manifest").getJSONObject("entry").getString("path")) + ", run_name='__main__')\n";
  }

}
