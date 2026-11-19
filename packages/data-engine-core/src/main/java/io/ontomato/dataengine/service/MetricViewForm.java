package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewBinding;
import java.util.List;
import java.util.Map;

/** The owner's form description for a MetricView, including its embedded Function and its bindings. */
public final class MetricViewForm {
  private MetricViewForm() {}

  public static final String CREATE_OPERATION = "metric-view.create";
  public static final String UPDATE_OPERATION = "metric-view.update";

  private static final List<String> STATUSES =
      List.of(MetricView.STATUS_PENDING_REVIEW, MetricView.STATUS_PUBLISHED, MetricView.STATUS_UNUSED);

  public static JSONObject defaults() {
    JSONObject function = FunctionForm.defaultValues();
    return JSONObject.of(
        "name", "",
        "description", "",
        "origin", MetricView.ORIGIN_USER,
        "bindings", new JSONArray(),
        "status", MetricView.STATUS_PENDING_REVIEW,
        "matchQuestions", new JSONArray(),
        "function", function);
  }

  public static JSONObject describe(
      JSONObject values,
      boolean existing,
      String readOnlyReason,
      String lang,
      LangService langService) {
    JSONObject function = values.getJSONObject("function");
    if (function == null) function = new JSONObject();
    boolean legacy = legacy(function);
    JSONArray parameterDefs = parameterDefs(function);
    JSONArray fields = new JSONArray();
    fields.add(textField("/name", text(langService, lang, "PanelForm.name"), false, true, readOnlyReason, null));
    fields.add(textField("/description", text(langService, lang, "PanelForm.description"), true, false, readOnlyReason, null));
    fields.add(
        PanelFormFields.field(
            "/status",
            text(langService, lang, "PanelForm.status"),
            PanelFormFields.select(statusOptions(lang, langService)),
            JSONObject.of("type", "string", "enum", JSONArray.of(STATUSES.toArray())),
            false,
            readOnlyReason != null,
            readOnlyReason,
            null,
            false));
    fields.add(
        PanelFormFields.field(
            "/matchQuestions",
            text(langService, lang, "PanelForm.matchQuestions"),
            PanelFormFields.stringArray(),
            PanelFormFields.arraySchema(PanelFormFields.schema("string")),
            false,
            readOnlyReason != null,
            readOnlyReason,
            null,
            false));
    fields.add(textField("/function/name", text(langService, lang, "PanelForm.functionName"), false, false, readOnlyReason, null));
    fields.add(
        PanelFormFields.field(
            "/function/queryPackage",
            text(langService, lang, "PanelForm.queryPackage"),
            PanelFormFields.code("json"),
            PanelFormFields.schema("object"),
            true,
            readOnlyReason != null,
            readOnlyReason,
            legacy ? text(langService, lang, "PanelForm.queryPackageLegacyHelp") : null,
            true));
    fields.add(
        PanelFormFields.field(
            "/function/returnDef/columnLabels",
            text(langService, lang, "PanelForm.columnLabels"),
            PanelFormFields.code("json"),
            PanelFormFields.schema("object"),
            false,
            readOnlyReason != null,
            readOnlyReason,
            null,
            false));
    if (legacy)
      fields.add(
          PanelFormFields.field(
              "/function/code",
              text(langService, lang, "PanelForm.legacyCode"),
              PanelFormFields.code("python"),
              PanelFormFields.schema("string"),
              false,
              true,
              readOnlyReason,
              null,
              false));
    fields.add(textField("/function/logic", text(langService, lang, "PanelForm.logic"), true, false, readOnlyReason, null));
    fields.add(bindingsField(parameterDefs, readOnlyReason, lang, langService));
    return description(fields, values, save(existing));
  }

  private static JSONObject bindingsField(
      JSONArray parameterDefs, String readOnlyReason, String lang, LangService langService) {
    JSONArray itemFields = new JSONArray();
    itemFields.add(
        PanelFormFields.field(
            "/id",
            text(langService, lang, "PanelForm.bindingId"),
            PanelFormFields.hidden(),
            PanelFormFields.schema("string"),
            false,
            readOnlyReason != null,
            readOnlyReason,
            null,
            false));
    itemFields.add(textField("/name", text(langService, lang, "PanelForm.name"), false, false, readOnlyReason, null));
    itemFields.add(textField("/description", text(langService, lang, "PanelForm.description"), false, false, readOnlyReason, null));
    itemFields.add(
        PanelFormFields.field(
            "/matchQuestions",
            text(langService, lang, "PanelForm.matchQuestions"),
            PanelFormFields.stringArray(),
            PanelFormFields.arraySchema(PanelFormFields.schema("string")),
            false,
            readOnlyReason != null,
            readOnlyReason,
            null,
            false));
    JSONObject defaultItem =
        JSONObject.of("name", "", "description", "", "matchQuestions", new JSONArray(), "parameters", new JSONObject());
    for (int i = 0; i < parameterDefs.size(); i++) {
      JSONObject definition = parameterDefs.getJSONObject(i);
      String name = definition.getString("name");
      String type = definition.getString("type");
      String description = definition.getString("description");
      itemFields.add(
          PanelFormFields.field(
              "/parameters/" + PanelFormFields.pointer(name),
              name + (type == null ? "" : " (" + type + ")"),
              PanelFormFields.code("json"),
              parameterSchema(type),
              false,
              readOnlyReason != null,
              readOnlyReason,
              description,
              false));
      defaultItem.getJSONObject("parameters").put(name, null);
    }
    return PanelFormFields.field(
        "/bindings",
        text(langService, lang, "PanelForm.bindings"),
        PanelFormFields.objectArray(itemFields, defaultItem, "/id"),
        PanelFormFields.arraySchema(PanelFormFields.schema("object")),
        false,
        readOnlyReason != null,
        readOnlyReason,
        null,
        false);
  }

  /** Check an incoming draft without saving it; reject at the field path that fails. */
  public static void checkDraft(JSONObject values) {
    requiredString(values, "name", "/name");
    optionalString(values, "description", "/description");
    Object status = values.get("status");
    if (!(status instanceof String statusText) || !STATUSES.contains(statusText))
      throw new IllegalArgumentException("/status: expected PENDING_REVIEW, PUBLISHED or UNUSED");
    stringArray(values, "matchQuestions", "/matchQuestions");
    Function function = checkFunction(values);
    checkBindings(values, function);
  }

  private static Function checkFunction(JSONObject values) {
    Object raw = values.get("function");
    if (!(raw instanceof Map<?, ?>))
      throw new IllegalArgumentException("/function: expected an embedded Function object");
    JSONObject function = values.getJSONObject("function");
    JSONObject returnDef = objectField(function, "returnDef", "/function/returnDef");
    if (returnDef != null) objectField(returnDef, "columnLabels", "/function/returnDef/columnLabels");
    Function accepted;
    try {
      accepted = Function.fromAsset(values);
    } catch (RuntimeException error) {
      throw functionError(error.getMessage(), "/function");
    }
    if (!Function.OPERATION_READ.equals(accepted.getOperation()))
      throw new IllegalArgumentException("/function/operation: expected OPERATION_READ");
    if (function.get("queryPackage") == null)
      throw new IllegalArgumentException("/function/queryPackage: expected a query package object");
    return accepted;
  }

  private static void checkBindings(JSONObject values, Function function) {
    Object raw = values.get("bindings");
    if (raw == null) return;
    if (!(raw instanceof List<?> list))
      throw new IllegalArgumentException("/bindings: expected an array of bindings");
    JSONArray bindingsJson = values.getJSONArray("bindings");
    for (int i = 0; i < list.size(); i++) {
      Object item = list.get(i);
      if (!(item instanceof Map<?, ?>))
        throw new IllegalArgumentException("/bindings/" + i + ": expected a binding object");
      JSONObject binding = bindingsJson.getJSONObject(i);
      String base = "/bindings/" + i;
      optionalString(binding, "id", base + "/id");
      requiredString(binding, "name", base + "/name");
      optionalString(binding, "description", base + "/description");
      stringArray(binding, "matchQuestions", base + "/matchQuestions");
      if (!(binding.get("parameters") instanceof Map<?, ?>))
        throw new IllegalArgumentException(base + "/parameters: expected an object of parameter values");
    }
    MetricView metric = values.to(MetricView.class);
    metric.setFunction(function);
    List<MetricViewBinding> bindings = metric.getBindings() == null ? List.of() : metric.getBindings();
    try {
      MetricViewBindings.validate(function, bindings);
    } catch (IllegalArgumentException error) {
      throw bindingError(error.getMessage(), bindings);
    }
  }

  private static IllegalArgumentException bindingError(String message, List<MetricViewBinding> bindings) {
    int index = -1;
    String detail = message;
    if (message.startsWith("Binding '")) {
      int end = message.indexOf("': ");
      if (end > 0) {
        String name = message.substring("Binding '".length(), end);
        for (int i = 0; i < bindings.size(); i++)
          if (name.equals(bindings.get(i).getName())) {
            index = i;
            break;
          }
        detail = message.substring(end + 3);
      }
    } else if (message.startsWith("Duplicate binding ID: ")) {
      String id = message.substring("Duplicate binding ID: ".length());
      for (int i = 0; i < bindings.size(); i++)
        if (id.equals(bindings.get(i).getId())) {
          index = i;
          break;
        }
    }
    if (index < 0) return new IllegalArgumentException("/bindings: " + message);
    String base = "/bindings/" + index;
    if (detail.startsWith("Missing parameter: "))
      return new IllegalArgumentException(
          base + "/parameters/" + PanelFormFields.pointer(detail.substring("Missing parameter: ".length())) + ": " + detail);
    if (detail.startsWith("Parameter '")) {
      int quote = detail.indexOf('\'');
      int next = detail.indexOf('\'', quote + 1);
      if (next > quote)
        return new IllegalArgumentException(
            base + "/parameters/" + PanelFormFields.pointer(detail.substring(quote + 1, next)) + ": " + detail);
    }
    if (detail.startsWith("Unknown parameters")) return new IllegalArgumentException(base + "/parameters: " + detail);
    return new IllegalArgumentException(base + ": " + detail);
  }

  private static IllegalArgumentException functionError(String message, String prefix) {
    if (message.startsWith("function:"))
      return new IllegalArgumentException(prefix + message.substring("function".length()));
    if (message.startsWith("Function.")) {
      String detail = message.substring("Function.".length());
      int colon = detail.indexOf(':');
      String field = (colon < 0 ? detail : detail.substring(0, colon)).replaceAll("\\[(\\d+)\\]", "/$1");
      String suffix = colon < 0 ? "" : detail.substring(colon);
      return new IllegalArgumentException(prefix + "/" + field + suffix);
    }
    return new IllegalArgumentException(message);
  }

  private static JSONObject objectField(JSONObject parent, String field, String pointer) {
    Object value = parent.get(field);
    if (value == null) return null;
    if (!(value instanceof Map<?, ?>)) throw new IllegalArgumentException(pointer + ": expected an object");
    return parent.getJSONObject(field);
  }

  private static void requiredString(JSONObject values, String field, String pointer) {
    Object value = values.get(field);
    if (!(value instanceof String text) || text.isBlank())
      throw new IllegalArgumentException(pointer + ": expected a nonempty string");
  }

  private static void optionalString(JSONObject values, String field, String pointer) {
    Object value = values.get(field);
    if (value != null && !(value instanceof String))
      throw new IllegalArgumentException(pointer + ": expected a string");
  }

  private static void stringArray(JSONObject values, String field, String pointer) {
    Object value = values.get(field);
    if (value == null) return;
    if (!(value instanceof List<?> list))
      throw new IllegalArgumentException(pointer + ": expected an array of strings");
    for (Object item : list)
      if (!(item instanceof String)) throw new IllegalArgumentException(pointer + ": expected an array of strings");
  }

  private static JSONArray statusOptions(String lang, LangService langService) {
    JSONArray options = new JSONArray();
    options.add(PanelFormFields.option(MetricView.STATUS_PENDING_REVIEW, text(langService, lang, "PanelForm.status.pendingReview")));
    options.add(PanelFormFields.option(MetricView.STATUS_PUBLISHED, text(langService, lang, "PanelForm.status.published")));
    options.add(PanelFormFields.option(MetricView.STATUS_UNUSED, text(langService, lang, "PanelForm.status.unused")));
    return options;
  }

  private static JSONArray parameterDefs(JSONObject function) {
    JSONObject queryPackage = function.getJSONObject("queryPackage");
    if (queryPackage != null) {
      JSONObject manifest = queryPackage.getJSONObject("manifest");
      JSONArray defs = manifest == null ? null : manifest.getJSONArray("parameterDefs");
      return defs == null ? new JSONArray() : defs;
    }
    JSONArray parameters = function.getJSONArray("parameters");
    return parameters == null ? new JSONArray() : parameters;
  }

  private static boolean legacy(JSONObject function) {
    Object code = function.get("code");
    return function.get("queryPackage") == null && code instanceof String text && !text.isBlank();
  }

  private static JSONObject parameterSchema(String type) {
    if (type == null) return new JSONObject();
    return switch (type) {
      case Parameter.TYPE_STRING, Parameter.TYPE_TIME -> JSONObject.of("type", JSONArray.of("string", "null"));
      case Parameter.TYPE_NUMBER -> JSONObject.of("type", JSONArray.of("number", "null"));
      case Parameter.TYPE_STRING_ARRAY, Parameter.TYPE_TIME_ARRAY ->
          JSONObject.of("type", JSONArray.of("array", "null"), "items", PanelFormFields.schema("string"));
      case Parameter.TYPE_NUMBER_ARRAY ->
          JSONObject.of("type", JSONArray.of("array", "null"), "items", PanelFormFields.schema("number"));
      case Parameter.TYPE_ONTOOBJ, Parameter.TYPE_VECTOR ->
          JSONObject.of("type", JSONArray.of("object", "null"));
      case Parameter.TYPE_DATASET ->
          JSONObject.of("type", JSONArray.of("array", "null"), "items", PanelFormFields.schema("object"));
      default -> new JSONObject();
    };
  }

  private static JSONObject textField(
      String path, String label, boolean multiline, boolean required, String readOnlyReason, String help) {
    return PanelFormFields.field(
        path,
        label,
        PanelFormFields.text(multiline),
        PanelFormFields.schema("string"),
        required,
        readOnlyReason != null,
        readOnlyReason,
        help,
        false);
  }

  private static JSONObject description(JSONArray fields, JSONObject values, JSONObject save) {
    return JSONObject.of("fields", fields, "values", values, "save", save);
  }

  private static JSONObject save(boolean existing) {
    JSONObject properties = new JSONObject();
    properties.put("id", PanelFormFields.schema("string"));
    properties.put("name", JSONObject.of("type", "string", "minLength", 1));
    properties.put("description", PanelFormFields.schema("string"));
    properties.put("status", JSONObject.of("type", "string", "enum", JSONArray.of(STATUSES.toArray())));
    properties.put("matchQuestions", PanelFormFields.arraySchema(PanelFormFields.schema("string")));
    properties.put("function", PanelFormFields.schema("object"));
    properties.put("bindings", PanelFormFields.arraySchema(PanelFormFields.schema("object")));
    return JSONObject.of(
        "method", "POST",
        "path", "/metricView/save",
        "bodySchema", JSONObject.of("type", "object", "properties", properties, "required", JSONArray.of("name", "function")),
        "draftOperation", existing ? UPDATE_OPERATION : CREATE_OPERATION);
  }

  private static String text(LangService langService, String lang, String key) {
    return langService.get(lang, key);
  }
}
