package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.dao.KnowledgeDao;
import io.ontomato.dataengine.util.DBSchemaUtil;
import io.ontomato.dataengine.util.DslRuleUtil;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Read facade over ontology-owned definitions and execution. */
@Service
public class OntologyQueryService {
  private final AdminService admin;
  private final DslService dsl;
  private final MetricViewService metrics;
  private final KnowledgeDao knowledge;

  public OntologyQueryService(
      AdminService admin, DslService dsl, MetricViewService metrics, KnowledgeDao knowledge) {
    this.admin = admin;
    this.dsl = dsl;
    this.metrics = metrics;
    this.knowledge = knowledge;
  }

  public Map<String, Object> rule(QueryAccessService.Access access) {
    return admin.getJSONRule(access.user().getDomainId());
  }

  @SuppressWarnings("unchecked")
  private List<Map<String, Object>> classes(QueryAccessService.Access access) {
    return (List<Map<String, Object>>) rule(access).get("classDef");
  }

  private String checkedClass(String name, QueryAccessService.Access access) {
    String normalized = DBSchemaUtil.normalizeClassName(name, classes(access));
    if (classes(access).stream().noneMatch(c -> normalized.equals(c.get("className"))))
      throw new IllegalArgumentException("Unknown ontology class: " + name);
    List<String> scope =
        access.grant() == null ? List.of() : access.grant().getList("classNames", String.class);
    if (scope != null && !scope.isEmpty() && !scope.contains(normalized))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Class is outside this run's scope");
    return normalized;
  }

  public Object overview(QueryAccessService.Access access) {
    List<Object> list = new ArrayList<>();
    for (var c : classes(access)) {
      try {
        checkedClass((String) c.get("className"), access);
      } catch (ResponseStatusException e) {
        continue;
      }
      JSONObject item = new JSONObject();
      item.put("name", c.get("className"));
      item.put("description", c.get("classDesc"));
      list.add(item);
    }
    return Map.of(
        "description", Objects.toString(rule(access).get("datasetdesc"), ""), "classes", list);
  }

  private JSONObject classSpecification(Map<String, Object> definition) {
    JSONObject result = JSONObject.of("className", definition.get("className"));
    result.put("classDesc", definition.get("classDesc"));
    List<JSONObject> attrs = new ArrayList<>();
    for (Object value : (List<?>) definition.get("attrs")) {
      JSONObject attr = JSONObject.from(value);
      if (Boolean.FALSE.equals(attr.getBoolean("enable"))) continue;
      JSONObject field = new JSONObject();
      for (String key : List.of("name", "type", "primaryKey", "attrDesc", "indicators"))
        field.put(key, attr.get(key));
      attrs.add(field);
    }
    result.put("attrs", attrs);
    return result;
  }

  public Object schema(List<String> names, QueryAccessService.Access access) {
    if (names == null || names.isEmpty())
      throw new IllegalArgumentException("classNames are required");
    Set<String> selected = new HashSet<>();
    for (String n : names) selected.add(checkedClass(n, access));
    Object relationships = rule(access).get("relationship_rule");
    List<Object> rels = new ArrayList<>();
    if (relationships instanceof Map<?, ?> map)
      for (var entry : map.entrySet()) {
        JSONObject rel = JSONObject.from(entry.getValue());
        if (selected.contains(rel.getString("fromclass"))
            || selected.contains(rel.getString("toclass"))) {
          rel.put("name", entry.getKey());
          rels.add(rel);
        }
      }
    return Map.of(
        "classes",
        classes(access).stream()
            .filter(c -> selected.contains(c.get("className")))
            .map(this::classSpecification)
            .toList(),
        "relationships",
        rels);
  }

  public Object reference(List<String> names, QueryAccessService.Access access) {
    if (names == null || names.isEmpty())
      throw new IllegalArgumentException("classNames are required");
    List<String> normalized = names.stream().map(n -> checkedClass(n, access)).toList();
    JSONObject query = new JSONObject();
    query.put("classes", normalized);
    for (String key :
        List.of(
            "DSL_relationship",
            "DSL_C_Step_group_by",
            "DSL_C_Step_function",
            "DSL_C_Step_four_basic_math",
            "DSL_C_Step_sort")) query.put(key, true);
    query.put("C_Step", "on demand");
    return Map.of(
        "classNames",
        normalized,
        "syntaxMarkdown",
        DslRuleUtil.generateDslRule(query, rule(access)),
        "exampleMarkdown",
        DslRuleUtil.generateDslExample(query, rule(access)));
  }

  private void checkGraph(Object value, QueryAccessService.Access access, Set<String> temporary) {
    if (value instanceof Map<?, ?> object)
      for (var entry : object.entrySet()) {
        String key = entry.getKey().toString();
        if (Set.of("sql", "nativeQuery", "action", "insert", "update", "delete").contains(key))
          throw new IllegalArgumentException("Only read ontology DSL is allowed");
        if (key.equals("class")
            && entry.getValue() instanceof String name
            && !temporary.contains(name)) checkedClass(name, access);
        checkGraph(entry.getValue(), access, temporary);
      }
    else if (value instanceof Iterable<?> array)
      for (Object item : array) checkGraph(item, access, temporary);
  }

  public Map<String, Object> execute(JSONObject query, QueryAccessService.Access access) {
    if (query == null
        || !query.keySet().stream().allMatch(k -> Set.of("problem", "answer").contains(k))
        || query.getJSONObject("answer") == null)
      throw new IllegalArgumentException("One read DSL object with answer.steps is required");
    JSONArray steps = query.getJSONObject("answer").getJSONArray("steps");
    if (steps == null || steps.isEmpty())
      throw new IllegalArgumentException("DSL steps are required");
    Set<String> temporary = new HashSet<>();
    for (Object step : steps) {
      checkGraph(step, access, temporary);
      JSONObject output = JSONObject.from(step).getJSONObject("output");
      if (output != null && output.getString("save_table") != null)
        temporary.add(output.getString("save_table"));
    }
    Map<String, Object> result = dsl.executeV1(query, access.permission(), access.user());
    if (result.get("error") != null)
      throw new ResponseStatusException(
          HttpStatus.UNPROCESSABLE_ENTITY, result.get("error").toString());
    return result;
  }

  public Object distinct(JSONObject body, QueryAccessService.Access access) {
    String name = checkedClass(body.getString("className"), access),
        attribute = body.getString("attribute");
    var def =
        classes(access).stream()
            .filter(c -> name.equals(c.get("className")))
            .findFirst()
            .orElseThrow();
    JSONArray attrs = JSONArray.from(def.get("attrs"));
    boolean valid =
        attrs.stream()
            .map(JSONObject::from)
            .anyMatch(
                a ->
                    !Boolean.FALSE.equals(a.getBoolean("enable"))
                        && Objects.equals(attribute, a.getString("name"))
                        && Set.of("varchar", "text").contains(a.getString("type")));
    if (!valid) throw new IllegalArgumentException("A varchar/text attribute is required");
    int limit = limit(body);
    JSONObject object = JSONObject.of("idx", 0, "variable", "v", "class", name);
    String like = body.getString("like");
    if (like != null && !like.isBlank())
      object.put(
          "conditions",
          Map.of(
              "properties",
              Map.of(
                  "field",
                  attribute,
                  "operator",
                  "like",
                  "value",
                  like.contains("%") ? like : "%" + like + "%")));
    JSONObject query =
        JSONObject.of(
            "problem",
            "",
            "answer",
            Map.of(
                "steps",
                List.of(
                    Map.of(
                        "graph",
                        Map.of(
                            "patterns",
                            List.of(Map.of("objects", List.of(object))),
                            "pattern_logic",
                            "and"),
                        "output",
                        Map.of(
                            "to_user",
                            true,
                            "fields",
                            List.of(
                                Map.of(
                                    "variable",
                                    "v",
                                    "field",
                                    attribute,
                                    "distinct",
                                    true,
                                    "as",
                                    attribute)),
                            "limit",
                            Map.of("count", limit))))));
    JSONObject result = JSONObject.from(execute(query, access));
    JSONObject datum = result.getJSONArray("data").getJSONObject(0);
    List<Object> values =
        datum.getJSONArray("answer").stream().map(r -> JSONObject.from(r).get(attribute)).toList();
    JSONObject answer = JSONObject.of("values", values, "displayedCount", values.size());
    answer.put("truncation", partial(datum));
    return answer;
  }

  public static JSONObject partial(JSONObject datum) {
    if (!Boolean.TRUE.equals(datum.getBoolean("truncated"))) return null;
    Integer limit = datum.getInteger("rowLimit");
    String hint = datum.getString("truncationHint");
    if (limit == null || limit <= 0 || hint == null || hint.isBlank())
      throw new IllegalArgumentException("Invalid partial-query metadata");
    return JSONObject.of("truncated", true, "rowLimit", limit, "truncationHint", hint);
  }

  private static Object canonical(Object value) {
    if (value instanceof Map<?, ?> map) {
      Map<String, Object> sorted = new TreeMap<>();
      map.forEach((k, v) -> sorted.put(k.toString(), canonical(v)));
      return sorted;
    }
    if (value instanceof Iterable<?> array) {
      List<Object> values = new ArrayList<>();
      array.forEach(v -> values.add(canonical(v)));
      return values;
    }
    return value;
  }

  public static String digest(Object value) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256")
                  .digest(
                      JSON.toJSONBytes(
                          canonical(JSON.toJSON(value)),
                          com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue)));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  public MetricView metric(String id, String revision, QueryAccessService.Access access) {
    if (id == null || id.isBlank() || revision == null || revision.isBlank())
      throw new IllegalArgumentException("Metric id and revision are required");
    MetricView metric = metrics.queryById(id, access.user().getDomainId());
    if (metric == null
        || !access.user().getDomainId().equals(metric.getDomainId())
        || !MetricView.STATUS_PUBLISHED.equals(metric.getStatus())
        || metric.getFunction() == null
        || !access.user().getDomainId().equals(metric.getFunction().getDomainId())
        || !Function.OPERATION_READ.equals(metric.getFunction().getOperation()))
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Published read metric not found");
    if (revision != null && !digest(metric).equals(revision))
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "Metric specification changed; retrieve it again");
    return metric;
  }

  public Object metrics(JSONObject body, QueryAccessService.Access access) {
    int limit = limit(body);
    String text = Objects.toString(body.getString("query"), "").toLowerCase(Locale.ROOT);
    String cursor = body.getString("cursor");
    List<String> requested = body.getList("classNames", String.class);
    if (requested != null)
      requested = requested.stream().map(name -> checkedClass(name, access)).toList();
    List<MetricView> all =
        metrics.queryForRetrieval(access.user().getDomainId(), text, cursor, requested, limit + 1);
    List<JSONObject> found = new ArrayList<>();
    for (MetricView metric : all) {
      JSONObject spec =
          JSON.parseObject(
              JSON.toJSONString(
                  metric, com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue));
      spec.put("revision", digest(metric));
      Set<String> involved = new LinkedHashSet<>();
      List<Object> fields = new ArrayList<>(), parameterFields = new ArrayList<>();
      var function = metric.getFunction();
      if (function.getReturnDef() != null && function.getReturnDef().getClassNames() != null)
        involved.addAll(function.getReturnDef().getClassNames());
      if (function.getReturnDef() != null && function.getReturnDef().getOutKeyRefs() != null)
        for (var ref : function.getReturnDef().getOutKeyRefs()) {
          involved.add(ref.getClassName());
          fields.add(
              JSONObject.of(
                  "className",
                  ref.getClassName(),
                  "attribute",
                  ref.getAttrName(),
                  "outputKey",
                  ref.getKey()));
        }
      if (function.getParameters() != null)
        for (var parameter : function.getParameters()) {
          if (parameter.getClassNames() != null) involved.addAll(parameter.getClassNames());
          JSONObject field = JSONObject.of("parameter", parameter.getName());
          field.put("classes", parameter.getClassNames());
          field.put("attribute", null);
          parameterFields.add(field);
        }
      spec.put(
          "context",
          Map.of(
              "classes",
              classes(access).stream()
                  .filter(c -> involved.contains(c.get("className")))
                  .map(this::classSpecification)
                  .toList(),
              "fields",
              fields,
              "parameterFields",
              parameterFields,
              "valueRanges",
              List.of(),
              "unresolved",
              List.of(
                  "Additional Python dependencies and parameter attribute/value mappings require"
                      + " schema inspection and value probing; declarations are not complete"
                      + " program lineage")));
      found.add(spec);
    }
    boolean more = found.size() > limit;
    if (more) found.remove(found.size() - 1);
    JSONObject result = JSONObject.of("items", found);
    result.put("nextCursor", more ? found.get(found.size() - 1).getString("id") : null);
    return result;
  }

  public Object knowledge(JSONObject body, QueryAccessService.Access access) {
    List<JSONObject> items = new ArrayList<>();
    for (var k :
        knowledge.findKnowledge(
            body.getString("query"), limit(body), access.user().getDomainId())) {
      JSONObject item = JSONObject.of("id", k.getKnowledgeID(), "text", k.getKnowledgeText());
      item.put("title", k.getKnowledgeTitle());
      item.put(
          "modifiedAt",
          k.getModifyTime() == null ? null : k.getModifyTime().toInstant().toString());
      items.add(item);
    }
    return Map.of("items", items);
  }

  private int limit(JSONObject body) {
    Integer value = body.getInteger("limit");
    if (value == null || value < 1 || value > 100)
      throw new IllegalArgumentException("limit must be between 1 and 100");
    return value;
  }
}
