package io.ontomato.dataengine.service;

import static io.ontomato.dataengine.schedules.ScheduleJson.object;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * The JSON of a form's fields and field errors, as contracts/form-fields.ts describes them: what a scheduled task's
 * application and an Action form both declare. Values stay text; their owner interprets them.
 */
public final class FormFields {
  private FormFields() {}

  /** One choice of a select; an unavailable one stays listed with its {@code reason}. */
  public static JsonNode option(String value, String label, String reason, String description) {
    return object(
        "value",
        value,
        "label",
        label,
        "description",
        description,
        "disabled",
        reason != null,
        "disabledReason",
        reason);
  }

  public static JsonNode select(String key, String label, JsonNode options, boolean refresh) {
    return object(
        "key",
        key,
        "label",
        label,
        "type",
        "select",
        "required",
        true,
        "defaultValue",
        null,
        "help",
        null,
        "refreshOnChange",
        refresh,
        "options",
        options);
  }

  public static JsonNode text(
      String key, String label, boolean required, boolean multiline, String help, int maxLength) {
    return object(
        "key",
        key,
        "label",
        label,
        "type",
        "text",
        "required",
        required,
        "defaultValue",
        null,
        "help",
        help,
        "multiline",
        multiline,
        "placeholder",
        null,
        "maxLength",
        maxLength);
  }

  /** An error on the value {@code field} points to (a JSON Pointer under /values/ or /content/). */
  public static ObjectNode error(String field, String code, String message) {
    return object("field", field, "code", code, "message", message);
  }
}
