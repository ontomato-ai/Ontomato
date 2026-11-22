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
    return text(multiline, null);
  }

  public static JSONObject text(boolean multiline, String placeholder) {
    JSONObject control = JSONObject.of("kind", "text");
    if (multiline) control.put("multiline", true);
    if (placeholder != null && !placeholder.isBlank()) control.put("placeholder", placeholder);
    return control;
  }

  public static JSONObject frequency() {
    return JSONObject.of("kind", "frequency");
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

  /** A nested object the caller may add or remove as a whole; removing it writes null. */
  public static JSONObject object(JSONArray fields, JSONObject defaultObject) {
    JSONObject control = JSONObject.of("kind", "object", "fields", fields);
    if (defaultObject != null) control.put("defaultObject", defaultObject);
    return control;
  }

  /**
   * A nested object whose extra child fields depend on the scalar select field at {@code variantBy} inside
   * {@code fields}; {@code variants} maps each option value to its additional child fields.
   */
  public static JSONObject object(
      JSONArray fields, JSONObject defaultObject, String variantBy, JSONObject variants) {
    if ((variantBy == null) != (variants == null)) {
      throw new IllegalArgumentException("variantBy and variants must both be provided or both be null");
    }
    JSONObject control = object(fields, defaultObject);
    if (variantBy != null) {
      if (!variantBy.startsWith("/")) {
        throw new IllegalArgumentException("variantBy must be a relative JSON Pointer, got " + variantBy);
      }
      control.put("variantBy", variantBy);
      control.put("variants", variants);
    }
    return control;
  }

  public static JSONObject option(Object value, String label) {
    return option(value, label, null, false, null);
  }

  public static JSONObject option(
      Object value, String label, String description, boolean disabled, String disabledReason) {
    JSONObject option = JSONObject.of("value", value, "label", label);
    option.put("description", description);
    option.put("disabled", disabled);
    option.put("disabledReason", disabled ? disabledReason : null);
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

  /**
   * A draft laid over the form's current values: each value the draft gives replaces the one at its place, objects merge
   * key by key, arrays are replaced whole, and anything the draft leaves out keeps its current value.
   */
  public static JSONObject withDraft(JSONObject current, JSONObject draft) {
    JSONObject merged = JSON.parseObject(JSON.toJSONString(current, Feature.WriteMapNullValue));
    lay(merged, JSON.parseObject(JSON.toJSONString(draft, Feature.WriteMapNullValue)));
    return merged;
  }

  private static void lay(JSONObject onto, JSONObject draft) {
    for (var entry : draft.entrySet()) {
      Object current = onto.get(entry.getKey());
      if (current instanceof JSONObject object && entry.getValue() instanceof JSONObject given) lay(object, given);
      else onto.put(entry.getKey(), entry.getValue());
    }
  }

  /**
   * The values a save applies when the request names the fields it submitted: the saved values, with each submitted
   * field, by its JSON Pointer, taken from the request. A field the request did not submit keeps its saved value; a
   * submitted field the request leaves out is cleared.
   */
  public static JSONObject withSubmitted(JSONObject saved, JSONObject request, java.util.List<String> submitted) {
    JSONObject merged = JSON.parseObject(JSON.toJSONString(saved, Feature.WriteMapNullValue));
    for (String field : submitted) {
      java.util.List<String> tokens = tokens(field);
      set(merged, tokens, valueAt(request, tokens));
    }
    return merged;
  }

  private static java.util.List<String> tokens(String pointer) {
    if (pointer == null || !pointer.startsWith("/"))
      throw new IllegalArgumentException("submittedFields: expected JSON Pointers to form fields, got " + pointer);
    return java.util.Arrays.stream(pointer.substring(1).split("/", -1))
        .map(token -> token.replace("~1", "/").replace("~0", "~")).toList();
  }

  private static Object valueAt(Object node, java.util.List<String> tokens) {
    for (String token : tokens) {
      if (node instanceof java.util.Map<?, ?> object) node = object.get(token);
      else if (node instanceof java.util.List<?> list && index(token, list.size()) >= 0) node = list.get(index(token, list.size()));
      else return null;
    }
    return node;
  }

  @SuppressWarnings("unchecked")
  private static void set(JSONObject root, java.util.List<String> tokens, Object value) {
    Object node = root;
    for (int i = 0; i < tokens.size(); i++) {
      String token = tokens.get(i);
      boolean last = i == tokens.size() - 1;
      if (node instanceof java.util.Map<?, ?>) {
        java.util.Map<String, Object> object = (java.util.Map<String, Object>) node;
        if (last) {
          object.put(token, value);
          return;
        }
        if (!(object.get(token) instanceof java.util.Map<?, ?> || object.get(token) instanceof java.util.List<?>))
          object.put(token, new JSONObject());
        node = object.get(token);
      } else if (node instanceof java.util.List<?>) {
        java.util.List<Object> list = (java.util.List<Object>) node;
        int index = index(token, list.size());
        if (index < 0) return;
        if (last) {
          list.set(index, value);
          return;
        }
        node = list.get(index);
      } else {
        return;
      }
    }
  }

  /** The array position a token names, or -1 when it names none in a list of {@code size}. */
  private static int index(String token, int size) {
    if (!token.matches("\\d+")) return -1;
    int index = Integer.parseInt(token);
    return index < size ? index : -1;
  }
}
