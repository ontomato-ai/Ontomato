package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;

/**
 * The JSON of one field in a PanelFormDescription, as contracts/panel-projection.ts describes it: what the panel
 * renders, which value schema its consumers read, and whether the owner lets the caller edit it.
 */
public final class PanelFormFields {
  private PanelFormFields() {}

  public static JSONObject text(boolean multiline) {
    JSONObject control = JSONObject.of("kind", "text");
    if (multiline) control.put("multiline", true);
    return control;
  }

  public static JSONObject select(JSONArray options) {
    return JSONObject.of("kind", "select", "options", options);
  }

  public static JSONObject hidden() {
    return JSONObject.of("kind", "hidden");
  }

  public static JSONObject code(String language) {
    return JSONObject.of("kind", "code", "language", language);
  }

  public static JSONObject stringArray() {
    return JSONObject.of("kind", "string-array");
  }

  public static JSONObject objectArray(JSONArray itemFields, JSONObject defaultItem, String itemKeyPath) {
    JSONObject control =
        JSONObject.of("kind", "object-array", "itemFields", itemFields, "defaultItem", defaultItem);
    if (itemKeyPath != null) control.put("itemKeyPath", itemKeyPath);
    return control;
  }

  public static JSONObject option(String value, String label) {
    JSONObject option = JSONObject.of("value", value, "label", label);
    option.put("description", null);
    option.put("disabled", false);
    option.put("disabledReason", null);
    return option;
  }

  public static JSONObject field(
      String path,
      String label,
      JSONObject control,
      JSONObject valueSchema,
      boolean required,
      boolean readOnly,
      String readOnlyReason,
      String help,
      boolean refreshOnChange) {
    JSONObject field =
        JSONObject.of(
            "path", path,
            "label", label,
            "control", control,
            "valueSchema", valueSchema,
            "required", required,
            "readOnly", readOnly);
    if (readOnlyReason != null) field.put("readOnlyReason", readOnlyReason);
    if (help != null) field.put("help", help);
    if (refreshOnChange) field.put("refreshOnChange", true);
    return field;
  }

  public static JSONObject schema(String type) {
    return JSONObject.of("type", type);
  }

  public static JSONObject arraySchema(JSONObject items) {
    return JSONObject.of("type", "array", "items", items);
  }

  /** The asset shape an owner returns from queryById, with its null fields kept. */
  public static JSONObject asset(Object value) {
    return JSON.parseObject(JSON.toJSONString(value, Feature.WriteMapNullValue));
  }

  /** A JSON Pointer token for a property name. */
  public static String pointer(String token) {
    return token.replace("~", "~0").replace("/", "~1");
  }
}
