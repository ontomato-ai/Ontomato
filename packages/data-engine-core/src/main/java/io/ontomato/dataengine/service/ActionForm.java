package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import java.util.List;

/** The owner's form description for an Action: its target, its write Function and its publication status. */
public final class ActionForm {
  private ActionForm() {}

  public static final String CREATE_OPERATION = "action.create";
  public static final String UPDATE_OPERATION = "action.update";

  private static final List<String> STATUSES =
      List.of(Action.STATUS_PENDING_REVIEW, Action.STATUS_PUBLISHED, Action.STATUS_UNUSED);

  public static JSONObject defaultValues() {
    return JSONObject.of(
        "name", "",
        "description", "",
        "origin", Action.ORIGIN_USER,
        "status", Action.STATUS_PENDING_REVIEW,
        "target", null,
        "function",
            JSONObject.of(
                "name", "",
                "origin", Function.ORIGIN_USER,
                "operation", Function.OPERATION_WRITE,
                "parameters", new JSONArray(),
                "returnDef", JSONObject.of("isVoid", true, "classNames", new JSONArray()),
                "code", "",
                "logic", ""));
  }

  public static JSONObject describe(
      JSONObject values,
      boolean existing,
      String readOnlyReason,
      String codeReadOnlyReason,
      JSONArray classOptions,
      String lang,
      LangService langService) {
    String codeReason = readOnlyReason != null ? readOnlyReason : codeReadOnlyReason;
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
    fields.add(targetField(values, classOptions, readOnlyReason, lang, langService));
    fields.add(
        PanelFormFields.field(
            "/function/name",
            text(langService, lang, "PanelForm.functionName"),
            PanelFormFields.text(false),
            PanelFormFields.schema("string"),
            true,
            readOnlyReason != null,
            readOnlyReason,
            null,
            false));
    fields.add(
        PanelFormFields.field(
            "/function/parameters",
            text(langService, lang, "PanelForm.parameters"),
            PanelFormFields.objectArray(
                FunctionForm.parameterFields(lang, langService, readOnlyReason),
                FunctionForm.defaultParameter(),
                null),
            PanelFormFields.arraySchema(PanelFormFields.schema("object")),
            false,
            readOnlyReason != null,
            readOnlyReason,
            null,
            true));
    fields.add(
        PanelFormFields.field(
            "/function/returnDef/classNames",
            text(langService, lang, "PanelForm.returnClassNames"),
            PanelFormFields.stringArray(),
            PanelFormFields.arraySchema(PanelFormFields.schema("string")),
            false,
            readOnlyReason != null,
            readOnlyReason,
            null,
            false));
    fields.add(
        PanelFormFields.field(
            "/function/logic",
            text(langService, lang, "PanelForm.logic"),
            PanelFormFields.text(true),
            PanelFormFields.schema("string"),
            false,
            readOnlyReason != null,
            readOnlyReason,
            null,
            false));
    fields.add(
        PanelFormFields.field(
            "/function/code",
            text(langService, lang, "PanelForm.code"),
            PanelFormFields.code("python"),
            PanelFormFields.schema("string"),
            false,
            codeReason != null,
            codeReason,
            null,
            false));
    return JSONObject.of("fields", fields, "values", values, "save", save(existing));
  }

  /** Check an incoming draft without saving it; reject with the field paths that fail. */
  public static void checkDraft(JSONObject values) {
    PanelFormErrors errors = new PanelFormErrors();
    errors.requiredString(values, "name", "/name");
    errors.optionalString(values, "description", "/description");
    Object status = values.get("status");
    if (status != null && !(status instanceof String text && STATUSES.contains(text)))
      errors.invalidOption("/status", "expected PENDING_REVIEW, PUBLISHED or UNUSED");
    JSONObject target = errors.objectField(values, "target", "/target");
    if (target != null) {
      errors.requiredString(target, "className", "/target/className");
      errors.requiredString(target, "keyParameter", "/target/keyParameter");
    }
    JSONObject function = errors.requiredObject(values, "function", "/function");
    if (function != null) {
      if (!Function.OPERATION_WRITE.equals(function.get("operation")))
        errors.invalidOption("/function/operation", "expected OPERATION_WRITE");
      JSONObject returnDef = errors.objectField(function, "returnDef", "/function/returnDef");
      if (returnDef != null)
        errors.stringArray(returnDef, "classNames", "/function/returnDef/classNames");
      FunctionForm.checkParameters(function.get("parameters"), errors, "/function");
    }
    errors.throwIfAny("Invalid Action draft");
    try {
      Function.fromInput(function);
    } catch (RuntimeException error) {
      errors.invalidObject("/function", error);
      errors.throwIfAny("Invalid Action draft");
    }
  }

  private static JSONObject targetField(
      JSONObject values, JSONArray classOptions, String readOnlyReason, String lang, LangService langService) {
    JSONArray childFields = new JSONArray();
    childFields.add(
        PanelFormFields.field(
            "/className",
            text(langService, lang, "PanelForm.action.targetClass"),
            PanelFormFields.select(classSelectOptions(classOptions)),
            PanelFormFields.schema("string"),
            true,
            readOnlyReason != null,
            readOnlyReason,
            null,
            false));
    childFields.add(
        PanelFormFields.field(
            "/keyParameter",
            text(langService, lang, "PanelForm.action.targetKey"),
            PanelFormFields.select(targetKeyOptions(values)),
            PanelFormFields.schema("string"),
            true,
            readOnlyReason != null,
            readOnlyReason,
            null,
            false));
    return PanelFormFields.field(
        "/target",
        text(langService, lang, "PanelForm.action.target"),
        PanelFormFields.object(childFields, JSONObject.of("className", "", "keyParameter", "")),
        nullableObject(),
        false,
        readOnlyReason != null,
        readOnlyReason,
        text(langService, lang, "PanelForm.action.targetHelp"),
        false);
  }

  private static JSONArray classSelectOptions(JSONArray classDefs) {
    JSONArray options = new JSONArray();
    for (int i = 0; i < classDefs.size(); i++) {
      JSONObject definition = classDefs.getJSONObject(i);
      String className = definition.getString("className");
      String showName = definition.getString("showName");
      options.add(
          PanelFormFields.option(
              className, showName == null || showName.isBlank() ? className : showName));
    }
    return options;
  }

  private static JSONArray targetKeyOptions(JSONObject values) {
    JSONArray options = new JSONArray();
    JSONObject function = values.getJSONObject("function");
    if (function == null) return options;
    JSONArray parameters = function.getJSONArray("parameters");
    if (parameters == null) return options;
    for (int i = 0; i < parameters.size(); i++) {
      JSONObject parameter = parameters.getJSONObject(i);
      String name = parameter.getString("name");
      if (Parameter.TYPE_STRING.equals(parameter.getString("type")) && name != null && !name.isBlank())
        options.add(PanelFormFields.option(name, name));
    }
    return options;
  }

  private static JSONArray statusOptions(String lang, LangService langService) {
    JSONArray options = new JSONArray();
    options.add(
        PanelFormFields.option(
            Action.STATUS_PENDING_REVIEW, text(langService, lang, "PanelForm.status.pendingReview")));
    options.add(
        PanelFormFields.option(
            Action.STATUS_PUBLISHED, text(langService, lang, "PanelForm.status.published")));
    options.add(
        PanelFormFields.option(
            Action.STATUS_UNUSED, text(langService, lang, "PanelForm.status.unused")));
    return options;
  }

  private static JSONObject save(boolean existing) {
    JSONObject properties = new JSONObject();
    properties.put("id", PanelFormFields.schema("string"));
    properties.put("name", JSONObject.of("type", "string", "minLength", 1));
    properties.put("description", PanelFormFields.schema("string"));
    properties.put("status", JSONObject.of("type", "string", "enum", JSONArray.of(STATUSES.toArray())));
    properties.put("target", nullableObject());
    properties.put("submissionCriteria", nullableObject());
    properties.put("approvalMode", PanelFormFields.schema("string"));
    properties.put("function", PanelFormFields.schema("object"));
    properties.put("explanationRef", PanelFormFields.schema("string"));
    return JSONObject.of(
        "method", "POST",
        "path", "/action/save",
        "bodySchema",
            JSONObject.of(
                "type", "object",
                "properties", properties,
                "required", JSONArray.of("name", "function")),
        "draftOperation", existing ? UPDATE_OPERATION : CREATE_OPERATION);
  }

  /** A removable object writes null when removed, so its schema admits null beside the object. */
  private static JSONObject nullableObject() {
    return JSONObject.of("type", JSONArray.of("object", "null"));
  }

  private static String text(LangService langService, String lang, String key) {
    return langService.get(lang, key);
  }
}
