package io.ontomato.dataengine.service.agent;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.service.QueryPackage;
import java.util.*;

/** Conservative structural coverage, never proof of semantic equivalence or authorization. */
public final class QueryIntent {
  private static final String VERSION = "ontomato.query-intent.v1";
  private static final int MAX_CONDITIONS = 64;
  private static final List<String> OPERATORS = List.of("=", "!=", ">", ">=", "<", "<=", "in", "like");
  private static final String[] INTENT_FIELDS = {"schema", "conditions", "outputs"};
  private static final String[] CONDITION_FIELDS = {"id", "quote", "mapping"};
  private static final String[] MAPPING_FIELDS = {"className", "field", "operator", "value"};

  private QueryIntent() {}

  static JSONObject schema() {
    var mapping = objectSchema(JSONObject.of(
        "className", JSONObject.of("type", "string", "pattern", "\\S"),
        "field", JSONObject.of("type", "string", "pattern", "\\S"),
        "operator", JSONObject.of("type", "string", "enum", OPERATORS),
        "value", new JSONObject()
    ), MAPPING_FIELDS);
    var condition = objectSchema(JSONObject.of(
        "id", JSONObject.of("type", "string", "pattern", "\\S", "description", "Unique condition ID within the intent."),
        "quote", JSONObject.of("type", "string", "pattern", "\\S", "description", "Verbatim condition from the complete question."),
        "mapping", JSONObject.of("anyOf", List.of(mapping, JSONObject.of("type", "null")),
            "description", "Ontology predicate. Use null if the mapping is not known.")
    ), CONDITION_FIELDS);
    return objectSchema(JSONObject.of(
        "schema", JSONObject.of("type", "string", "const", VERSION),
        "conditions", JSONObject.of("type", "array", "items", condition, "maxItems", MAX_CONDITIONS),
        "outputs", JSONObject.of("type", "array", "minItems", 1,
            "items", JSONObject.of("type", "string", "pattern", "\\S"),
            "description", "Descriptions of the requested outputs.")
    ), INTENT_FIELDS);
  }

  private static JSONObject objectSchema(JSONObject properties, String... fields) {
    return JSONObject.of("type", "object", "properties", properties, "required", List.of(fields),
        "additionalProperties", false);
  }

  public static JSONObject accept(JSONObject intent, String question) {
    AgentJson.fields(intent, INTENT_FIELDS);
    if (!VERSION.equals(intent.getString("schema"))) throw AgentHttpException.invalid("Invalid query intent version");
    if (!(intent.get("conditions") instanceof List<?> conditions) || conditions.size() > MAX_CONDITIONS)
      throw AgentHttpException.invalid("Query intent permits at most " + MAX_CONDITIONS + " conditions");
    var ids = new HashSet<String>();
    for (Object raw : conditions) {
      if (!(raw instanceof Map)) throw AgentHttpException.invalid("Condition must be an object");
      var item=JSONObject.from(raw); AgentJson.fields(item, CONDITION_FIELDS);
      if (!ids.add(AgentJson.text(item,"id")) || !question.contains(AgentJson.text(item,"quote")))
        throw AgentHttpException.invalid("Conditions require unique ids and quotes from the complete question");
      if (!item.containsKey("mapping")) throw AgentHttpException.invalid("Condition mapping is required; use null when unknown");
      if (item.get("mapping")!=null) {
        if (!(item.get("mapping") instanceof Map)) throw AgentHttpException.invalid("Mapping must be an object");
        var mapping=item.getJSONObject("mapping");AgentJson.fields(mapping, MAPPING_FIELDS);
        AgentJson.text(mapping,"className");AgentJson.text(mapping,"field");
        if (!OPERATORS.contains(mapping.getString("operator")) || !mapping.containsKey("value"))
          throw AgentHttpException.invalid("Invalid condition predicate");
      }
    }
    if (!(intent.get("outputs") instanceof List<?> outputs) || outputs.isEmpty() || outputs.stream().anyMatch(value -> !(value instanceof String s) || s.isBlank()))
      throw AgentHttpException.invalid("Query intent requires output descriptions");
    return AgentJson.copy(intent);
  }

  public static JSONObject coverage(JSONObject intent, JSONObject recipe, Object truncation) {
    var conditions=new JSONArray();var checks=new JSONArray();
    boolean partial=truncation!=null;
    JSONObject dsl=null;
    if ("package".equals(recipe.getString("kind"))) {
      var bundle=recipe.getJSONObject("package");var entry=bundle.getJSONObject("manifest").getJSONObject("entry");
      if ("dsl".equals(entry.getString("kind")))
        dsl=QueryPackage.query(bundle,entry.getString("query"),QueryPackage.parameters(bundle,recipe.getJSONObject("parameters")));
    }
    for (Object raw:intent.getJSONArray("conditions")) {
      var item=JSONObject.from(raw);var mapping=item.getJSONObject("mapping");
      // Multi-step provenance, OR branches and Python need a richer verifier; do not guess coverage.
      String status=mapping==null?"unmapped":dsl==null?"unverified":present(dsl,mapping)?"present":absent(dsl,mapping)?"missing":"unverified";
      conditions.add(JSONObject.of("id",item.getString("id"),"status",status));
    }
    if (partial) checks.add("truncated_result");
    checks.add("semantic_mapping_not_verified");
    checks.add("output_set_and_deduplication_require_review");
    return JSONObject.of("status",partial?"partial":"unverified","conditions",conditions,"checks",checks);
  }

  public static JSONObject bind(JSONObject intent,Object raw) {
    var resolved=AgentJson.copy(intent);
    if(raw==null) return resolved;
    if(!(raw instanceof Map<?,?>)) throw AgentHttpException.invalid("conditionBindings must be an object");
    var bindings=JSONObject.from(raw);
    var known=new HashSet<String>();
    for(Object value:resolved.getJSONArray("conditions")) {
      var condition=JSONObject.from(value);String id=condition.getString("id");known.add(id);
      if(!bindings.containsKey(id)) continue;
      if(!(bindings.get(id) instanceof Map)) throw AgentHttpException.invalid("Condition binding must be an object");
      var mapping=bindings.getJSONObject(id);
      if(condition.get("mapping")!=null && !condition.getJSONObject("mapping").equals(mapping))
        throw AgentHttpException.invalid("An admitted mapping cannot be replaced");
    }
    if(!known.containsAll(bindings.keySet())) throw AgentHttpException.invalid("Unknown condition binding");
    var conditions=new JSONArray();
    for(Object value:resolved.getJSONArray("conditions")) {
      var condition=JSONObject.from(value);
      if(bindings.containsKey(condition.getString("id"))) condition.put("mapping",bindings.get(condition.getString("id")));
      conditions.add(condition);
    }
    resolved.put("conditions",conditions);
    String quotes=conditions.stream().map(JSONObject::from).map(item -> item.getString("quote")).reduce("",(a,b)->a+"\n"+b);
    return accept(resolved,quotes);
  }

  private static boolean absent(JSONObject dsl,JSONObject expected) {
    // No predicate on the mapped field anywhere is a definite omission. An alternative
    // predicate, OR branch, or expression is not enough to prove equivalence or omission.
    String field=expected.getString("field");
    var steps=dsl.getJSONObject("answer").getJSONArray("steps");
    if(steps.size()!=1) return false;
    var graph=steps.getJSONObject(0).getJSONObject("graph");
    if(graph==null || graph.getJSONArray("patterns")==null || graph.getJSONArray("patterns").size()!=1) return false;
    return !conditionMentions(dsl,expected.getString("className"),field);
  }
  private static boolean conditionMentions(Object value,String className,String field) {
    if(value instanceof Map<?,?> map) {
      if(Objects.equals(map.get("class"),className) && mentions(map.get("conditions"),field)) return true;
      return map.values().stream().anyMatch(child -> conditionMentions(child,className,field));
    }
    if(value instanceof List<?> list) return list.stream().anyMatch(child -> conditionMentions(child,className,field));
    return false;
  }
  private static boolean mentions(Object value,String field) {
    if(value instanceof Map<?,?> map) {
      if(Objects.equals(map.get("field"),field)) return true;
      return map.values().stream().anyMatch(child -> mentions(child,field));
    }
    if(value instanceof List<?> list) return list.stream().anyMatch(child -> mentions(child,field));
    return value instanceof String text && text.contains(field);
  }

  private static boolean present(JSONObject dsl,JSONObject expected) {
    var steps=dsl.getJSONObject("answer").getJSONArray("steps");
    if (steps.size()!=1) return false;
    var graph=steps.getJSONObject(0).getJSONObject("graph");
    if(graph==null) return false;
    var patterns=graph.getJSONArray("patterns");
    if (patterns==null || patterns.size()!=1) return false;
    var pattern=patterns.getJSONObject(0);
    if (!(pattern.get("objects") instanceof List)) return false;
    for(Object raw:pattern.getJSONArray("objects")) {
      var object=JSONObject.from(raw);
      if(expected.getString("className").equals(object.getString("class")) && object.getJSONObject("conditions")!=null &&
          conjunct(object.getJSONObject("conditions").getJSONObject("properties"),expected)) return true;
    }
    return false;
  }
  private static boolean conjunct(JSONObject predicate,JSONObject expected) {
    if(predicate==null) return false;
    if("logic".equals(predicate.getString("operator"))) {
      if(predicate.containsKey("or") || !(predicate.get("and") instanceof List)) return false;
      return predicate.getJSONArray("and").stream().anyMatch(raw -> conjunct(JSONObject.from(raw),expected));
    }
    return Objects.equals(predicate.get("field"),expected.get("field")) &&
        Objects.equals(predicate.get("operator"),expected.get("operator")) &&
        Objects.equals(JSON.toJSONString(predicate.get("value")),JSON.toJSONString(expected.get("value")));
  }
}
