package io.ontomato.dataengine.service.impl;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.action.BusinessMeaning;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.function.ReturnDef;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Projects the stored code explanation into a Palantir-style Action definition.
 *
 * <p>The projection is descriptive: the Python function remains the only execution semantics.
 * Every definition produced here is marked {@code source=DERIVED} and {@code verified=false};
 * consumers must not treat its rules or guards as platform-enforced behaviour. The projection
 * is recomputed from the stored segments and bound to the action's code hash, so a changed code
 * explanation naturally produces a different definition.
 */
final class ActionDefinitionProjector {

  private static final Set<String> OBJECT_KINDS =
      Set.of("CREATE_OBJECT", "UPDATE_OBJECT", "DELETE_OBJECT");
  private static final Set<String> EDGE_KINDS = Set.of("CREATE_EDGE", "DELETE_EDGE");
  private static final Set<String> VECTOR_KINDS =
      Set.of("APPEND_VECTOR", "UPDATE_VECTOR", "DELETE_VECTOR");

  private static final Map<String, String> TYPE_NAMES =
      Map.ofEntries(
          Map.entry("TYPE_STRING", "STRING"),
          Map.entry("TYPE_NUMBER", "NUMBER"),
          Map.entry("TYPE_TIME", "TIMESTAMP"),
          Map.entry("TYPE_STRING_ARRAY", "ARRAY<STRING>"),
          Map.entry("TYPE_NUMBER_ARRAY", "ARRAY<NUMBER>"),
          Map.entry("TYPE_TIME_ARRAY", "ARRAY<TIMESTAMP>"),
          Map.entry("TYPE_ONTOOBJ", "OBJECT_REFERENCE"),
          Map.entry("TYPE_DATASET", "OBJECT_SET"),
          Map.entry("TYPE_VECTOR", "FILE"));

  private ActionDefinitionProjector() {}

  static JSONObject project(Action action) {
    JSONObject definition = new JSONObject();
    definition.put("version", 1);
    definition.put("source", "DERIVED");
    definition.put("verified", false);
    definition.put("name", action.getName());
    definition.put("description", action.getDescription());
    definition.put("codeHash", action.getCodeHash());
    definition.put("explanationVersion", action.getExplanationVersion());

    Function function = action.getFunction();
    if (function == null) {
      return definition;
    }
    definition.put(
        "execution",
        JSONObject.of("kind", "FUNCTION", "operation", function.getOperation()));
    definition.put("parameters", parameters(function.getParameters()));
    definition.put("returnDef", returnDef(function.getReturnDef()));
    if (action.getSubmissionCriteria() != null) {
      JSONObject criteria = com.alibaba.fastjson2.JSONObject.from(action.getSubmissionCriteria());
      criteria.putIfAbsent("source", "GENERATED");
      criteria.putIfAbsent("verified", false);
      definition.put("submissionCriteria", criteria);
    }

    List<JSONObject> effects = new ArrayList<>();
    List<JSONObject> reads = new ArrayList<>();
    walk(action.getCodeSegments(), effects, reads);
    definition.put("effects", dedupe(effects));
    definition.put("reads", dedupe(reads));
    definition.put("objects", objects(effects, function));
    definition.put("target", target(effects));

    BusinessMeaning meaning = action.getBusinessMeaning();
    if (meaning != null) {
      definition.put(
          "businessMeaning",
          JSONObject.of(
              "operations", meaning.getOperations(),
              "negativeEffect", meaning.getNegativeEffect()));
    }
    return definition;
  }

  private static JSONArray parameters(List<Parameter> parameters) {
    JSONArray result = new JSONArray();
    if (parameters == null) {
      return result;
    }
    for (Parameter parameter : parameters) {
      JSONObject item = new JSONObject();
      item.put("name", parameter.getName());
      item.put("type", TYPE_NAMES.getOrDefault(parameter.getType(), parameter.getType()));
      item.put("description", parameter.getDescription());
      item.put("sample", parameter.getSample());
      item.put("objectTypes", parameter.getClassNames());
      // Existing actions carry no authored constraint or default; do not invent them.
      item.put("required", null);
      item.put("constraints", null);
      result.add(item);
    }
    return result;
  }

  private static JSONObject returnDef(ReturnDef returnDef) {
    if (returnDef == null) {
      return null;
    }
    return JSONObject.of(
        "isVoid", returnDef.getIsVoid(),
        "classNames", returnDef.getClassNames(),
        "outKeyRefs", returnDef.getOutKeyRefs());
  }

  private static void walk(JSONArray segments, List<JSONObject> effects, List<JSONObject> reads) {
    if (segments == null) {
      return;
    }
    for (int i = 0; i < segments.size(); i++) {
      JSONObject segment = segments.getJSONObject(i);
      if (segment == null) {
        continue;
      }
      String kind = segment.getString("kind");
      if (kind == null) {
        continue;
      }
      if (OBJECT_KINDS.contains(kind)) {
        effects.add(objectEffect(segment, kind));
      } else if (EDGE_KINDS.contains(kind)) {
        effects.add(edgeEffect(segment, kind));
      } else if (VECTOR_KINDS.contains(kind)) {
        effects.add(vectorEffect(segment, kind));
      } else if ("EXTERNAL_CALL".equals(kind)) {
        effects.add(externalEffect(segment));
      } else if ("QUERY".equals(kind)) {
        reads.add(read(segment));
      }
      walk(segment.getJSONArray("segs"), effects, reads);
      walk(segment.getJSONArray("trySegs"), effects, reads);
      for (String groupKey : List.of("catchs", "branchArms")) {
        JSONArray groups = segment.getJSONArray(groupKey);
        if (groups == null) {
          continue;
        }
        for (int group = 0; group < groups.size(); group++) {
          JSONObject item = groups.getJSONObject(group);
          if (item != null) {
            walk(item.getJSONArray("segs"), effects, reads);
          }
        }
      }
    }
  }

  private static JSONObject objectEffect(JSONObject segment, String kind) {
    JSONObject effect = base(segment, kind);
    effect.put("className", segment.getString("class"));
    if (segment.get("assignments") != null) {
      effect.put("assignments", segment.get("assignments"));
    }
    if (segment.getString("objectIdFrom") != null) {
      effect.put("objectIdFrom", segment.getString("objectIdFrom"));
    }
    if (segment.get("conditions") != null) {
      effect.put("guards", segment.get("conditions"));
    }
    return effect;
  }

  private static JSONObject edgeEffect(JSONObject segment, String kind) {
    JSONObject effect = base(segment, kind);
    effect.put("relation", segment.getString("relation"));
    effect.put("sourceClass", segment.getString("sourceClass"));
    effect.put("targetClass", segment.getString("targetClass"));
    if (segment.getString("sourceObjectIdFrom") != null) {
      effect.put("sourceObjectIdFrom", segment.getString("sourceObjectIdFrom"));
    }
    if (segment.getString("targetObjectIdFrom") != null) {
      effect.put("targetObjectIdFrom", segment.getString("targetObjectIdFrom"));
    }
    return effect;
  }

  private static JSONObject vectorEffect(JSONObject segment, String kind) {
    JSONObject effect = base(segment, kind);
    effect.put("className", segment.getString("class"));
    effect.put("attrName", segment.getString("attrName"));
    if (segment.getString("fileIdFrom") != null) {
      effect.put("fileIdFrom", segment.getString("fileIdFrom"));
    }
    if (segment.getString("textFrom") != null) {
      effect.put("textFrom", segment.getString("textFrom"));
    }
    return effect;
  }

  private static JSONObject externalEffect(JSONObject segment) {
    JSONObject effect = base(segment, "EXTERNAL_CALL");
    if (segment.getString("narrative") != null) {
      effect.put("narrative", segment.getString("narrative"));
    }
    return effect;
  }

  private static JSONObject read(JSONObject segment) {
    JSONObject item = new JSONObject();
    item.put("className", segment.getString("class"));
    if (segment.get("conditions") != null) {
      item.put("conditions", segment.get("conditions"));
    }
    if (segment.get("filters") != null) {
      item.put("filters", segment.get("filters"));
    }
    return item;
  }

  private static JSONObject base(JSONObject segment, String kind) {
    JSONObject item = new JSONObject();
    item.put("kind", kind);
    String title = segment.getString("title");
    if (title != null) {
      item.put("title", title);
    }
    return item;
  }

  private static JSONArray dedupe(List<JSONObject> items) {
    Map<String, JSONObject> unique = new LinkedHashMap<>();
    for (JSONObject item : items) {
      unique.putIfAbsent(item.toJSONString(), item);
    }
    JSONArray result = new JSONArray();
    result.addAll(unique.values());
    return result;
  }

  private static JSONArray objects(List<JSONObject> effects, Function function) {
    Set<String> names = new LinkedHashSet<>();
    for (JSONObject effect : effects) {
      add(names, effect.getString("className"));
      add(names, effect.getString("sourceClass"));
      add(names, effect.getString("targetClass"));
    }
    if (function.getParameters() != null) {
      for (Parameter parameter : function.getParameters()) {
        if (parameter.getClassNames() != null) {
          for (String name : parameter.getClassNames()) {
            add(names, name);
          }
        }
      }
    }
    if (function.getReturnDef() != null && function.getReturnDef().getClassNames() != null) {
      for (String name : function.getReturnDef().getClassNames()) {
        add(names, name);
      }
    }
    JSONArray result = new JSONArray();
    result.addAll(names);
    return result;
  }

  private static JSONObject target(List<JSONObject> effects) {
    if (effects.size() != 1) {
      return null;
    }
    JSONObject effect = effects.get(0);
    String kind = effect.getString("kind");
    String className = effect.getString("className");
    if (className == null || !OBJECT_KINDS.contains(kind)) {
      return null;
    }
    return JSONObject.of("objectType", className, "operation", kind);
  }

  private static void add(Set<String> names, String name) {
    if (name != null && !name.isBlank()) {
      names.add(name);
    }
  }
}
