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

  /** Check an incoming draft without saving it; reject with the field paths that fail. */
  public static void checkDraft(JSONObject values) {
    PanelFormErrors errors = new PanelFormErrors();
    errors.requiredString(values, "name", "/name");
    errors.optionalString(values, "description", "/description");
    Object status = values.get("status");
    if (status == null) errors.required("/status", "status is required");
    else if (!(status instanceof String statusText)) errors.invalidObject("/status", "expected a string");
    else if (!STATUSES.contains(statusText))
      errors.invalidOption("/status", "expected PENDING_REVIEW, PUBLISHED or UNUSED");
    errors.stringArray(values, "matchQuestions", "/matchQuestions");
    checkFunctionShape(values, errors);
    checkBindingShapes(values, errors);
    errors.throwIfAny("Invalid MetricView draft");

    Function function;
    try {
      function = Function.fromAsset(values);
    } catch (RuntimeException error) {
      errors.invalidObject("/function", error);
      errors.throwIfAny("Invalid MetricView draft");
      return;
    }
    if (!Function.OPERATION_READ.equals(function.getOperation())) {
      errors.invalidOption("/function/operation", "expected OPERATION_READ");
      errors.throwIfAny("Invalid MetricView draft");
    }
    MetricView metric;
    try {
      metric = values.to(MetricView.class);
      metric.setFunction(function);
    } catch (RuntimeException error) {
      errors.invalidObject("/bindings", error);
      errors.throwIfAny("Invalid MetricView draft");
      return;
    }
    List<MetricViewBinding> bindings = metric.getBindings() == null ? List.of() : metric.getBindings();
    try {
      MetricViewBindings.validate(function, bindings);
    } catch (RuntimeException error) {
      errors.invalidObject("/bindings", error);
    }
    errors.throwIfAny("Invalid MetricView draft");
  }

  private static void checkFunctionShape(JSONObject values, PanelFormErrors errors) {
    Object raw = values.get("function");
    if (!(raw instanceof Map<?, ?>)) {
      errors.invalidObject("/function", "expected an embedded Function object");
      return;
    }
    JSONObject function = values.getJSONObject("function");
    JSONObject returnDef = errors.objectField(function, "returnDef", "/function/returnDef");
    if (returnDef != null) errors.objectField(returnDef, "columnLabels", "/function/returnDef/columnLabels");
    Object queryPackage = function.get("queryPackage");
    if (queryPackage == null) errors.required("/function/queryPackage", "queryPackage is required");
    else if (!(queryPackage instanceof Map<?, ?>)) errors.invalidObject("/function/queryPackage", "expected an object");
  }

  private static void checkBindingShapes(JSONObject values, PanelFormErrors errors) {
    Object raw = values.get("bindings");
    if (raw == null) return;
    if (!(raw instanceof List<?> list)) {
      errors.invalidArray("/bindings", "expected an array of bindings");
      return;
    }
    JSONArray bindingsJson = values.getJSONArray("bindings");
    for (int i = 0; i < list.size(); i++) {
      Object item = list.get(i);
      if (!(item instanceof Map<?, ?>)) {
        errors.invalidObject("/bindings/" + i, "expected a binding object");
        continue;
      }
      JSONObject binding = bindingsJson.getJSONObject(i);
      String base = "/bindings/" + i;
      errors.optionalString(binding, "id", base + "/id");
      errors.requiredString(binding, "name", base + "/name");
      errors.optionalString(binding, "description", base + "/description");
      errors.stringArray(binding, "matchQuestions", base + "/matchQuestions");
      errors.requiredObject(binding, "parameters", base + "/parameters");
    }
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
