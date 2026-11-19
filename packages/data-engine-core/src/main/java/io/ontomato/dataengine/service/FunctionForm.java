package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import java.util.List;
import java.util.Map;

/** The owner's form description for a Function: its read or write fields follow its operation. */
public final class FunctionForm {
  private FunctionForm() {}

  public static final String CREATE_OPERATION = "function.create";
  public static final String UPDATE_OPERATION = "function.update";

  private static final List<String> PARAMETER_TYPES =
      List.of(
          Parameter.TYPE_STRING,
          Parameter.TYPE_NUMBER,
          Parameter.TYPE_TIME,
          Parameter.TYPE_STRING_ARRAY,
          Parameter.TYPE_NUMBER_ARRAY,
          Parameter.TYPE_TIME_ARRAY);

  public static JSONObject defaultValues() {
    return JSONObject.of(
        "name", "",
        "description", "",
        "origin", Function.ORIGIN_USER,
        "operation", Function.OPERATION_READ,
        "parameters", new JSONArray(),
        "returnDef",
            JSONObject.of(
                "isVoid", false,
                "outKeyRefs", new JSONArray(),
                "value", new JSONObject(),
                "classNames", new JSONArray()),
        "code", "",
        "logic", "");
  }

  public static JSONObject describe(
      JSONObject values,
      boolean existing,
      String readOnlyReason,
      String operationReadOnlyReason,
      String lang,
      LangService langService) {
    String operation = values.getString("operation");
    boolean write = Function.OPERATION_WRITE.equals(operation);
    boolean legacy = legacy(values);
    JSONArray fields = new JSONArray();
    fields.add(
        PanelFormFields.field(
            "/name",
            text(langService, lang, "PanelForm.name"),
            PanelFormFields.text(false),
            PanelFormFields.schema("string"),
            true,
            readOnlyReason != null,
            readOnlyReason,
            null,
            false));
    fields.add(
        PanelFormFields.field(
            "/description",
            text(langService, lang, "PanelForm.description"),
            PanelFormFields.text(true),
            PanelFormFields.schema("string"),
            false,
            readOnlyReason != null,
            readOnlyReason,
            null,
            false));
    String operationReason = readOnlyReason != null ? readOnlyReason : (existing ? operationReadOnlyReason : null);
    fields.add(
        PanelFormFields.field(
            "/operation",
            text(langService, lang, "PanelForm.operation"),
            PanelFormFields.select(operationOptions(lang, langService)),
            JSONObject.of("type", "string", "enum", JSONArray.of(Function.OPERATION_READ, Function.OPERATION_WRITE)),
            false,
            operationReason != null,
            operationReason,
            null,
            true));
    if (write) {
      fields.add(
          PanelFormFields.field(
              "/parameters",
              text(langService, lang, "PanelForm.parameters"),
              PanelFormFields.objectArray(parameterFields(lang, langService, readOnlyReason), defaultParameter(), null),
              PanelFormFields.arraySchema(PanelFormFields.schema("object")),
              false,
              readOnlyReason != null,
              readOnlyReason,
              null,
              false));
      fields.add(
          PanelFormFields.field(
              "/returnDef/classNames",
              text(langService, lang, "PanelForm.returnClassNames"),
              PanelFormFields.stringArray(),
              PanelFormFields.arraySchema(PanelFormFields.schema("string")),
              false,
              readOnlyReason != null,
              readOnlyReason,
              null,
              false));
    } else {
      fields.add(
          PanelFormFields.field(
              "/queryPackage",
              text(langService, lang, "PanelForm.queryPackage"),
              PanelFormFields.code("json"),
              PanelFormFields.schema("object"),
              true,
              readOnlyReason != null,
              readOnlyReason,
              null,
              false));
      fields.add(
          PanelFormFields.field(
              "/returnDef/columnLabels",
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
                "/code",
                text(langService, lang, "PanelForm.legacyCode"),
                PanelFormFields.code("python"),
                PanelFormFields.schema("string"),
                false,
                true,
                readOnlyReason,
                null,
                false));
    }
    fields.add(
        PanelFormFields.field(
            "/logic",
            text(langService, lang, "PanelForm.logic"),
            PanelFormFields.text(true),
            PanelFormFields.schema("string"),
            false,
            readOnlyReason != null,
            readOnlyReason,
            null,
            false));
    if (write)
      fields.add(
          PanelFormFields.field(
              "/code",
              text(langService, lang, "PanelForm.code"),
              PanelFormFields.code("python"),
              PanelFormFields.schema("string"),
              false,
              readOnlyReason != null,
              readOnlyReason,
              null,
              false));
    return JSONObject.of("fields", fields, "values", values, "save", save(existing));
  }

  /** Check an incoming draft without saving it; reject with the field paths that fail. */
  public static void checkDraft(JSONObject values) {
    PanelFormErrors errors = new PanelFormErrors();
    errors.requiredString(values, "name", "/name");
    errors.optionalString(values, "description", "/description");
    Object rawOperation = values.get("operation");
    String operation = null;
    if (rawOperation == null) errors.required("/operation", "operation is required");
    else if (!(rawOperation instanceof String text)) errors.invalidObject("/operation", "expected a string");
    else {
      operation = text;
      if (!(Function.OPERATION_READ.equals(text) || Function.OPERATION_WRITE.equals(text)))
        errors.invalidOption("/operation", "expected OPERATION_READ or OPERATION_WRITE");
    }
    JSONObject returnDef = errors.objectField(values, "returnDef", "/returnDef");
    if (Function.OPERATION_READ.equals(operation)) {
      errors.requiredObject(values, "queryPackage", "/queryPackage");
      if (returnDef != null) errors.objectField(returnDef, "columnLabels", "/returnDef/columnLabels");
    } else if (Function.OPERATION_WRITE.equals(operation)) {
      if (returnDef != null) errors.stringArray(returnDef, "classNames", "/returnDef/classNames");
      checkParameters(values.get("parameters"), errors, "");
    }
    errors.throwIfAny("Invalid Function draft");
    try {
      Function.fromInput(values);
    } catch (RuntimeException error) {
      errors.invalidObject("/function", error);
      errors.throwIfAny("Invalid Function draft");
    }
  }

  public static void checkParameters(Object raw, PanelFormErrors errors, String prefix) {
    if (raw == null) return;
    if (!(raw instanceof List<?> list)) {
      errors.invalidArray(prefix + "/parameters", "expected an array of parameter definitions");
      return;
    }
    for (int i = 0; i < list.size(); i++) {
      Object item = list.get(i);
      if (!(item instanceof Map<?, ?>)) {
        errors.invalidObject(prefix + "/parameters/" + i, "expected a parameter definition object");
        continue;
      }
      JSONObject parameter = JSONObject.from(item);
      String base = prefix + "/parameters/" + i;
      errors.optionalString(parameter, "name", base + "/name");
      errors.optionalString(parameter, "type", base + "/type");
      errors.optionalString(parameter, "description", base + "/description");
      Object type = parameter.get("type");
      if (type != null && !(type instanceof String text && PARAMETER_TYPES.contains(text)))
        errors.invalidOption(
            base + "/type",
            "expected TYPE_STRING, TYPE_NUMBER, TYPE_TIME, TYPE_STRING_ARRAY, TYPE_NUMBER_ARRAY or TYPE_TIME_ARRAY");
      errors.stringArray(parameter, "classNames", base + "/classNames");
    }
  }

  public static JSONArray parameterFields(String lang, LangService langService, String readOnlyReason) {
    JSONArray fields = new JSONArray();
    fields.add(
        PanelFormFields.field(
            "/name",
            text(langService, lang, "PanelForm.name"),
            PanelFormFields.text(false),
            PanelFormFields.schema("string"),
            false,
            readOnlyReason != null,
            readOnlyReason,
            null,
            false));
    fields.add(
        PanelFormFields.field(
            "/type",
            text(langService, lang, "PanelForm.parameter.type"),
            PanelFormFields.select(parameterTypeOptions()),
            JSONObject.of("type", "string", "enum", JSONArray.of(PARAMETER_TYPES.toArray())),
            false,
            readOnlyReason != null,
            readOnlyReason,
            null,
            false));
    fields.add(
        PanelFormFields.field(
            "/description",
            text(langService, lang, "PanelForm.parameter.description"),
            PanelFormFields.text(false),
            PanelFormFields.schema("string"),
            false,
            readOnlyReason != null,
            readOnlyReason,
            null,
            false));
    fields.add(
        PanelFormFields.field(
            "/sample",
            text(langService, lang, "PanelForm.parameter.sample"),
            PanelFormFields.text(false),
            new JSONObject(),
            false,
            readOnlyReason != null,
            readOnlyReason,
            null,
            false));
    fields.add(
        PanelFormFields.field(
            "/classNames",
            text(langService, lang, "PanelForm.parameter.classNames"),
            PanelFormFields.stringArray(),
            PanelFormFields.arraySchema(PanelFormFields.schema("string")),
            false,
            readOnlyReason != null,
            readOnlyReason,
            null,
            false));
    return fields;
  }

  public static JSONObject defaultParameter() {
    return JSONObject.of(
        "name", "",
        "type", Parameter.TYPE_STRING,
        "description", "",
        "sample", "",
        "value", "",
        "classNames", new JSONArray());
  }

  private static JSONArray operationOptions(String lang, LangService langService) {
    JSONArray options = new JSONArray();
    options.add(PanelFormFields.option(Function.OPERATION_READ, text(langService, lang, "PanelForm.operation.read")));
    options.add(PanelFormFields.option(Function.OPERATION_WRITE, text(langService, lang, "PanelForm.operation.write")));
    return options;
  }

  private static JSONArray parameterTypeOptions() {
    JSONArray options = new JSONArray();
    for (String type : List.of(
        Parameter.TYPE_STRING,
        Parameter.TYPE_NUMBER,
        Parameter.TYPE_TIME,
        Parameter.TYPE_STRING_ARRAY,
        Parameter.TYPE_NUMBER_ARRAY,
        Parameter.TYPE_TIME_ARRAY))
      options.add(PanelFormFields.option(type, type));
    return options;
  }

  private static boolean legacy(JSONObject function) {
    Object code = function.get("code");
    return function.get("queryPackage") == null && code instanceof String text && !text.isBlank();
  }

  private static JSONObject save(boolean existing) {
    JSONObject properties = new JSONObject();
    properties.put("id", PanelFormFields.schema("string"));
    properties.put("name", JSONObject.of("type", "string", "minLength", 1));
    properties.put("description", PanelFormFields.schema("string"));
    properties.put(
        "operation",
        JSONObject.of("type", "string", "enum", JSONArray.of(Function.OPERATION_READ, Function.OPERATION_WRITE)));
    properties.put("queryPackage", PanelFormFields.schema("object"));
    properties.put("returnDef", PanelFormFields.schema("object"));
    properties.put("parameters", PanelFormFields.arraySchema(PanelFormFields.schema("object")));
    properties.put("code", PanelFormFields.schema("string"));
    properties.put("logic", PanelFormFields.schema("string"));
    return JSONObject.of(
        "method", "POST",
        "path", "/function/save",
        "bodySchema", JSONObject.of("type", "object", "properties", properties, "required", JSONArray.of("name", "operation")),
        "draftOperation", existing ? UPDATE_OPERATION : CREATE_OPERATION);
  }

  private static String text(LangService langService, String lang, String key) {
    return langService.get(lang, key);
  }
}
