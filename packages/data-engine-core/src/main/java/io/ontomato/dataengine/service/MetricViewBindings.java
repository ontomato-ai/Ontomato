package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONWriter;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewBinding;
import java.util.*;

/** The parameter contract shared by management, candidate writes and execution. */
public final class MetricViewBindings {
  private MetricViewBindings() {}

  public static JSONObject values(Function function) {
    JSONObject values = new JSONObject();
    if (function.getParameters() != null)
      for (Parameter p : function.getParameters()) values.put(p.getName(), p.getValue());
    return values;
  }

  public static void validate(Function function, List<MetricViewBinding> bindings) {
    Set<String> ids = new HashSet<>();
    for (MetricViewBinding binding : bindings) {
      if (binding.getId() != null && !ids.add(binding.getId()))
        throw new IllegalArgumentException("Duplicate binding ID: " + binding.getId());
      if (binding.getName() == null || binding.getName().isBlank())
        throw new IllegalArgumentException("Binding name is required");
      try {
        validateValues(function, binding.getParameters());
      } catch (IllegalArgumentException error) {
        throw new IllegalArgumentException("Binding '" + binding.getName() + "': " + error.getMessage());
      }
    }
  }

  public static void validateValues(Function function, JSONObject values) {
    if (values == null) throw new IllegalArgumentException("Parameter values must be an object");
    Set<String> names = new HashSet<>();
    if (function.getParameters() != null) {
      for (int i = 0; i < function.getParameters().size(); i++) {
        Parameter p = function.getParameters().get(i);
        if (p.getName() == null || p.getName().isBlank())
          throw new IllegalArgumentException("Function.parameters[" + i + "].name: expected a nonempty parameter name");
        if (!names.add(p.getName()))
          throw new IllegalArgumentException("Function.parameters[" + i + "].name: duplicate parameter '" + p.getName() + "'");
        if (!values.containsKey(p.getName()))
          throw new IllegalArgumentException("Missing parameter: " + p.getName());
        Object value = values.get(p.getName());
        if (value != null && !accepts(p.getType(), value))
          throw new IllegalArgumentException("Parameter '" + p.getName() + "' requires " + p.getType() + "; received " + value.getClass().getSimpleName());
      }
    }
    if (!names.equals(values.keySet())) {
      var unknown = new HashSet<>(values.keySet());
      unknown.removeAll(names);
      throw new IllegalArgumentException("Unknown parameters: " + unknown + "; expected exactly " + names);
    }
  }

  /** Whether a non-null value fits a parameter type; Action forms check what they interpret by the same rule. */
  static boolean accepts(String type, Object value) {
    if (type == null) throw new IllegalArgumentException("Parameter type is required");
    return switch (type) {
      case Parameter.TYPE_STRING, Parameter.TYPE_TIME -> value instanceof String;
      case Parameter.TYPE_NUMBER -> value instanceof Number;
      case Parameter.TYPE_STRING_ARRAY, Parameter.TYPE_TIME_ARRAY ->
          value instanceof List<?> list && list.stream().allMatch(v -> v instanceof String);
      case Parameter.TYPE_NUMBER_ARRAY ->
          value instanceof List<?> list && list.stream().allMatch(v -> v instanceof Number);
      case Parameter.TYPE_ONTOOBJ, Parameter.TYPE_VECTOR -> value instanceof Map<?, ?>;
      case Parameter.TYPE_DATASET ->
          value instanceof List<?> list && list.stream().allMatch(v -> v instanceof Map<?, ?>);
      default -> throw new IllegalArgumentException("Unknown parameter type: " + type);
    };
  }

  public static MetricViewBinding binding(MetricView metric, String id) {
    return Objects.requireNonNull(metric.getBindings(), "Metric bindings were not loaded").stream()
        .filter(b -> Objects.equals(id, b.getId())).findFirst()
        .orElseThrow(() -> new IllegalArgumentException("Metric binding not found"));
  }

  public static JSONObject resolve(MetricView metric, String bindingId, JSONObject supplied) {
    JSONObject values;
    if (bindingId != null) {
      values = binding(metric, bindingId).getParameters();
      if (supplied != null && !supplied.isEmpty() && !supplied.equals(values))
        throw new IllegalArgumentException("A binding cannot be overridden with parameters");
    } else values = supplied == null ? new JSONObject() : supplied;
    validateValues(metric.getFunction(), values);
    return JSON.parseObject(JSON.toJSONString(values, JSONWriter.Feature.WriteMapNullValue));
  }

  /** Write execution uses the same explicit parameter contract as read execution. */
  public static Function executionWriteFunction(Function definition, JSONObject supplied) {
    if (!Function.OPERATION_WRITE.equals(definition.getOperation()))
      throw new IllegalArgumentException("Expected a write function");
    return executionFunction(definition, supplied);
  }

  /** Execution gets a detached value map; the saved Function remains the definition. */
  public static Function executionFunction(Function definition, JSONObject values) {
    validateValues(definition, values);
    Function execution = JSON.parseObject(
        JSON.toJSONString(definition, JSONWriter.Feature.WriteMapNullValue), Function.class);
    if (execution.getQueryPackage() != null) {
      for (Object item : execution.getQueryPackage().getJSONObject("manifest").getJSONArray("parameterDefs")) {
        var parameter = (JSONObject) item;
        parameter.put("value", values.get(parameter.getString("name")));
      }
    } else if (execution.getParameters() != null)
      for (Parameter p : execution.getParameters()) p.setValue(values.get(p.getName()));
    return execution;
  }
}
