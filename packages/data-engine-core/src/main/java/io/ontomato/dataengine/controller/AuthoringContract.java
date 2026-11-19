package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.schema.JSONSchema;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import java.io.IOException;
import java.util.Map;
import java.util.HashMap;

/** Request shapes generated from the same public contract that registers the Workbench callback. */
final class AuthoringContract {
  private static final Map<String, JSONSchema> SHAPES;

  static {
    try (var input = AuthoringContract.class.getResourceAsStream("/ontology-contracts/authoring.java.schema.json")) {
      var definitions = JSON.parseObject(input.readAllBytes()).getJSONObject("definitions");
      var shapes = new HashMap<String, JSONSchema>();
      definitions.forEach((name, shape) -> shapes.put(name, JSONSchema.of((JSONObject) shape)));
      shapes.put("adoptionInput", JSONSchema.of(definitions.getJSONObject("adoptionRequest")
          .getJSONObject("properties").getJSONObject("input")));
      SHAPES = Map.copyOf(shapes);
    } catch (IOException error) {
      throw new ExceptionInInitializerError(error);
    }
  }

  private AuthoringContract() {}

  static void validate(String name, JSONObject value) {
    var result = SHAPES.get(name).validate(value);
    if (!result.isSuccess()) throw AgentHttpException.invalid(result.getMessage());
  }

  static void validateOperation(String kind, String operation, JSONObject input) {
    boolean action = "action".equals(kind);
    if (!action && !"metric-view".equals(kind)) throw AgentHttpException.missing();
    String name = switch (operation) {
      case "context" -> "resetRequest";
      case "test" -> action ? "actionTestRequest" : "metricViewTestRequest";
      case "read-test" -> "readTestParams";
      case "adopt" -> "adoptionInput";
      default -> {
        if (!action) throw AgentHttpException.missing();
        yield switch (operation) {
          case "prepare" -> "prepareRequest";
          case "reset" -> "resetRequest";
          case "query-sandbox" -> "querySandboxRequest";
          case "explain-draft" -> "explainDraftRequest";
          default -> throw AgentHttpException.missing();
        };
      }
    };
    validate(name, input);
  }
}
