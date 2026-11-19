package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * The field errors of one PanelFormRequest draft. Each error carries the JSON Pointer of the value that
 * failed, a code from contracts/form-fields.ts, and a message.
 */
public final class PanelFormErrors {
  private final List<ObjectNode> errors = new ArrayList<>();

  public String requiredString(JSONObject values, String field, String pointer) {
    Object value = values.get(field);
    if (value == null) {
      required(pointer, field + " is required");
      return null;
    }
    if (!(value instanceof String text)) {
      invalidObject(pointer, "expected a string");
      return null;
    }
    if (text.isBlank()) {
      required(pointer, field + " is required");
      return null;
    }
    return text;
  }

  public String optionalString(JSONObject values, String field, String pointer) {
    Object value = values.get(field);
    if (value == null) return null;
    if (!(value instanceof String text)) {
      invalidObject(pointer, "expected a string");
      return null;
    }
    return text;
  }

  public void stringArray(JSONObject values, String field, String pointer) {
    Object value = values.get(field);
    if (value == null) return;
    if (!(value instanceof List<?> list)) {
      invalidArray(pointer, "expected an array of strings");
      return;
    }
    for (Object item : list)
      if (!(item instanceof String)) {
        invalidArray(pointer, "expected an array of strings");
        return;
      }
  }

  /** An optional object at {@code field}; null when absent, and an error when it is another type. */
  public JSONObject objectField(JSONObject parent, String field, String pointer) {
    Object value = parent.get(field);
    if (value == null) return null;
    if (!(value instanceof Map<?, ?>)) {
      invalidObject(pointer, "expected an object");
      return null;
    }
    return parent.getJSONObject(field);
  }

  /** An object the draft must supply. */
  public JSONObject requiredObject(JSONObject parent, String field, String pointer) {
    Object value = parent.get(field);
    if (value == null) {
      required(pointer, field + " is required");
      return null;
    }
    if (!(value instanceof Map<?, ?>)) {
      invalidObject(pointer, "expected an object");
      return null;
    }
    return parent.getJSONObject(field);
  }

  public void required(String field, String message) {
    add(field, "required", message);
  }

  public void invalidOption(String field, String message) {
    add(field, "invalid_option", message);
  }

  public void invalidArray(String field, String message) {
    add(field, "invalid_array", message);
  }

  public void invalidObject(String field, String message) {
    add(field, "invalid_object", message);
  }

  /** A validator's original message, placed at the container it validated. */
  public void invalidObject(String field, RuntimeException error) {
    String message = error.getMessage();
    add(field, "invalid_object", message == null || message.isBlank() ? error.getClass().getName() : message);
  }

  public boolean isEmpty() {
    return errors.isEmpty();
  }

  public void throwIfAny(String message) {
    if (!errors.isEmpty()) throw new PanelFormException(message, errors);
  }

  private void add(String field, String code, String message) {
    errors.add(FormFields.error(field, code, message));
  }
}
