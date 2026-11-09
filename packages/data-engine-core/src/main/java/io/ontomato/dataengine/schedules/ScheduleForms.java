package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.ontomato.dataengine.service.FormFields;
import java.util.Map;

/**
 * Complete form responses and strict submission checks shared by the local application providers.
 */
public final class ScheduleForms {
  private ScheduleForms() {}

  public static JsonNode form(String app, String revision, ArrayNode fields, JsonNode supplied) {
    var values = object();
    var errors = array();
    var summary = array();
    boolean complete = true;
    for (var field : fields) {
      String key = field.path("key").asText();
      String value =
          supplied.has(key) ? supplied.path(key).asText() : field.path("defaultValue").asText("");
      values.put(key, value);
      if (field.path("required").asBoolean() && value.isBlank()) complete = false;
      String display = value;
      if ("select".equals(field.path("type").asText()) && !value.isBlank()) {
        JsonNode selected = null;
        for (var candidate : field.path("options"))
          if (value.equals(candidate.path("value").asText())) selected = candidate;
        if (selected == null || selected.path("disabled").asBoolean()) {
          errors.add(
              FormFields.error(
                  "/values/" + pointer(key),
                  "target_unavailable",
                  selected == null
                      ? "Target unavailable"
                      : selected.path("disabledReason").asText()));
          complete = false;
        }
        if (selected != null) display = selected.path("label").asText();
      }
      if (!display.isBlank())
        summary.add(
            object(
                "key",
                key,
                "label",
                field.path("label").asText(),
                "value",
                display.substring(0, Math.min(display.length(), 160))));
    }
    return object(
        "appId",
        app,
        "formRevision",
        revision,
        "fields",
        fields,
        "values",
        values,
        "summary",
        summary,
        "errors",
        errors,
        "submittable",
        complete);
  }

  public static ScheduleApplication.Validation validate(TaskDefinition definition, JsonNode form) {
    if (!definition.formRevision().equals(form.path("formRevision").asText()))
      throw new ScheduleException(
          409,
          "FORM_CHANGED",
          "The execution definition changed; review the form",
          Map.of("form", form));
    if (!fieldNames(definition.content()).equals(fieldNames(form.path("values"))))
      throw new ScheduleException(
          422, "FIELD_VALIDATION_FAILED", "Content must match the form fields");
    var errors = array();
    for (var error : form.path("errors")) {
      var copy = (ObjectNode) error.deepCopy();
      copy.put("field", copy.path("field").asText().replaceFirst("^/values/", "/content/"));
      errors.add(copy);
    }
    for (var field : form.path("fields")) {
      String key = field.path("key").asText();
      if (field.path("required").asBoolean() && definition.content().path(key).asText().isBlank())
        errors.add(
            FormFields.error(
                "/content/" + pointer(key),
                "required",
                field.path("label").asText() + " is required"));
    }
    if (!errors.isEmpty())
      throw new ScheduleException(
          422, "FIELD_VALIDATION_FAILED", "Check the form values", Map.of("fields", errors));
    return new ScheduleApplication.Validation(
        form.path("values"),
        form.path("formRevision").asText(),
        definition.timeZone(),
        form.path("summary"),
        null);
  }

  public static ObjectNode execution(String status) {
    return object(
        "status",
        status,
        "handle",
        null,
        "resultLink",
        null,
        "resultSummary",
        null,
        "result",
        null,
        "spendTime",
        null,
        "error",
        null,
        "pause",
        null,
        "executionDetails",
        null);
  }
}
