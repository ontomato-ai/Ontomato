package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.ontomato.dataengine.bean.action.Action;
import io.ontomato.dataengine.bean.trigger.Trigger;
import io.ontomato.dataengine.bean.workflow.Workflow;
import java.time.DateTimeException;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.scheduling.support.CronExpression;

/**
 * The owner's form description, validation and cadence formatting for a Trigger: its time schedule, target Action or
 * Workflow, execution principal and publication status.
 */
public final class TriggerForm {
  private TriggerForm() {}

  public static final String CREATE_OPERATION = "trigger.create";
  public static final String UPDATE_OPERATION = "trigger.update";
  public static final String DEFAULT_TIME_ZONE = "Asia/Shanghai";

  private static final int NAME_MAX = 255;
  private static final int EXECUTOR_MAX = 128;
  private static final Pattern TIME_PATTERN = Pattern.compile("^([01]\\d|2[0-3]):[0-5]\\d$");

  private static final List<String> STATUSES =
      List.of(Trigger.STATUS_PENDING_REVIEW, Trigger.STATUS_PUBLISHED, Trigger.STATUS_UNUSED);
  private static final List<String> EXECUTED_EFFECTS =
      List.of(Trigger.EFFECT_ACTION, Trigger.EFFECT_WORKFLOW);
  private static final Set<String> INTERVAL_UNITS = Set.of("minute", "hour", "day");

  public static JSONObject defaultValues() {
    return JSONObject.of(
        "name", "",
        "description", "",
        "conditionKind", Trigger.CONDITION_TIME,
        "condition",
            JSONObject.of(
                "frequency", JSONObject.of("kind", "interval", "every", 60, "unit", "minute"),
                "timeZone", DEFAULT_TIME_ZONE),
        "effectKind", Trigger.EFFECT_ACTION,
        "effect", JSONObject.of("actionId", "", "parameters", null),
        "executor", "",
        "status", Trigger.STATUS_PUBLISHED);
  }

  /** Complete form values for an existing Trigger, preserving executor and JSON parameters/inputs. */
  public static JSONObject fromTrigger(Trigger trigger) {
    JSONObject condition = copyObject(trigger.getCondition());
    if (condition.getJSONObject("frequency") == null) {
      condition.put("frequency", JSONObject.of("kind", "interval", "every", 60, "unit", "minute"));
    }
    String tz = condition.getString("timeZone");
    if (tz == null || tz.isBlank()) condition.put("timeZone", DEFAULT_TIME_ZONE);

    String effectKind =
        Trigger.EFFECT_WORKFLOW.equals(trigger.getEffectKind())
            ? Trigger.EFFECT_WORKFLOW
            : Trigger.EFFECT_ACTION;
    JSONObject effect = copyObject(trigger.getEffect());
    if (Trigger.EFFECT_WORKFLOW.equals(effectKind)) {
      if (effect.get("workflowId") == null) effect.put("workflowId", "");
      JSONObject inputs = effect.getJSONObject("inputs");
      if (inputs == null || inputs.isEmpty()) effect.put("inputs", null);
    } else {
      if (effect.get("actionId") == null) effect.put("actionId", "");
      JSONObject parameters = effect.getJSONObject("parameters");
      if (parameters == null || parameters.isEmpty()) effect.put("parameters", null);
    }

    JSONObject values = new JSONObject();
    if (trigger.getId() != null) values.put("id", trigger.getId());
    values.put("name", trigger.getName() == null ? "" : trigger.getName());
    values.put("description", trigger.getDescription() == null ? "" : trigger.getDescription());
    values.put(
        "conditionKind",
        trigger.getConditionKind() == null || trigger.getConditionKind().isBlank()
            ? Trigger.CONDITION_TIME
            : trigger.getConditionKind());
    values.put("condition", condition);
    values.put("effectKind", effectKind);
    values.put("effect", effect);
    values.put("executor", trigger.getExecutor() == null ? "" : trigger.getExecutor());
    values.put(
        "status",
        trigger.getStatus() == null ? Trigger.STATUS_PENDING_REVIEW : trigger.getStatus());
    return values;
  }

  /** Normalizes an incoming draft during a form refresh (for instance when effectKind changes). */
  public static JSONObject normalizeDraft(JSONObject raw, String changedField) {
    JSONObject values = copyObject(raw);
    if (values.get("conditionKind") == null) values.put("conditionKind", Trigger.CONDITION_TIME);
    if (values.get("condition") == null) {
      values.put(
          "condition",
          JSONObject.of(
              "frequency", JSONObject.of("kind", "interval", "every", 60, "unit", "minute"),
              "timeZone", DEFAULT_TIME_ZONE));
    }
    String effectKind = values.getString("effectKind");
    if (effectKind == null || effectKind.isBlank()) {
      effectKind = Trigger.EFFECT_ACTION;
      values.put("effectKind", effectKind);
    }
    if ("/effectKind".equals(changedField)) {
      JSONObject effect = values.get("effect") instanceof JSONObject obj ? obj : new JSONObject();
      if (Trigger.EFFECT_WORKFLOW.equals(effectKind)) {
        effect.remove("actionId");
        effect.remove("parameters");
        if (effect.get("workflowId") == null) effect.put("workflowId", "");
        if (!effect.containsKey("inputs")) effect.put("inputs", null);
      } else {
        effect.remove("workflowId");
        effect.remove("inputs");
        if (effect.get("actionId") == null) effect.put("actionId", "");
        if (!effect.containsKey("parameters")) effect.put("parameters", null);
      }
      values.put("effect", effect);
    }
    return values;
  }

  public static JSONObject describe(
      JSONObject values,
      List<ObjectNode> errors,
      boolean existing,
      List<Action> actions,
      List<Workflow> workflows,
      String lang,
      LangService langService) {
    String effectKind =
        Trigger.EFFECT_WORKFLOW.equals(values.getString("effectKind"))
            ? Trigger.EFFECT_WORKFLOW
            : Trigger.EFFECT_ACTION;
    JSONObject effect = values.get("effect") instanceof JSONObject obj ? obj : new JSONObject();

    JSONArray fields = new JSONArray();
    fields.add(
        PanelFormFields.field(
            "/name",
            text(langService, lang, "PanelForm.name"),
            PanelFormFields.text(false, text(langService, lang, "PanelForm.trigger.namePlaceholder")),
            PanelFormFields.schema("string"),
            true,
            false,
            null,
            null,
            false));
    fields.add(
        PanelFormFields.field(
            "/description",
            text(langService, lang, "PanelForm.description"),
            PanelFormFields.text(true),
            PanelFormFields.schema("string"),
            false,
            false,
            null,
            null,
            false));
    fields.add(
        PanelFormFields.field(
            "/condition/frequency",
            text(langService, lang, "PanelForm.trigger.frequency"),
            PanelFormFields.frequency(),
            PanelFormFields.schema("object"),
            true,
            false,
            null,
            null,
            false));
    fields.add(
        PanelFormFields.field(
            "/condition/timeZone",
            text(langService, lang, "PanelForm.trigger.timeZone"),
            PanelFormFields.text(false, DEFAULT_TIME_ZONE),
            PanelFormFields.schema("string"),
            true,
            false,
            null,
            null,
            false));
    fields.add(
        PanelFormFields.field(
            "/effectKind",
            text(langService, lang, "PanelForm.trigger.effectKind"),
            PanelFormFields.select(effectKindOptions(lang, langService)),
            JSONObject.of("type", "string", "enum", JSONArray.of(EXECUTED_EFFECTS.toArray())),
            true,
            false,
            null,
            null,
            true));

    if (Trigger.EFFECT_WORKFLOW.equals(effectKind)) {
      fields.add(
          PanelFormFields.field(
              "/effect/workflowId",
              text(langService, lang, "PanelForm.trigger.workflow"),
              PanelFormFields.select(
                  workflowOptions(workflows, effect.getString("workflowId"), lang, langService)),
              PanelFormFields.schema("string"),
              true,
              false,
              null,
              null,
              false));
      fields.add(
          PanelFormFields.field(
              "/effect/inputs",
              text(langService, lang, "PanelForm.trigger.inputs"),
              PanelFormFields.code("json"),
              nullableObject(),
              false,
              false,
              null,
              text(langService, lang, "PanelForm.trigger.inputsHelp"),
              false));
    } else {
      fields.add(
          PanelFormFields.field(
              "/effect/actionId",
              text(langService, lang, "PanelForm.trigger.action"),
              PanelFormFields.select(
                  actionOptions(actions, effect.getString("actionId"), lang, langService)),
              PanelFormFields.schema("string"),
              true,
              false,
              null,
              null,
              false));
      fields.add(
          PanelFormFields.field(
              "/effect/parameters",
              text(langService, lang, "PanelForm.trigger.parameters"),
              PanelFormFields.code("json"),
              nullableObject(),
              false,
              false,
              null,
              text(langService, lang, "PanelForm.trigger.parametersHelp"),
              false));
    }

    fields.add(
        PanelFormFields.field(
            "/executor",
            text(langService, lang, "PanelForm.trigger.executor"),
            PanelFormFields.text(
                false, text(langService, lang, "PanelForm.trigger.executorPlaceholder")),
            PanelFormFields.schema("string"),
            false,
            false,
            null,
            text(langService, lang, "PanelForm.trigger.executorHelp"),
            false));
    fields.add(
        PanelFormFields.field(
            "/status",
            text(langService, lang, "PanelForm.status"),
            PanelFormFields.select(statusOptions(lang, langService)),
            JSONObject.of("type", "string", "enum", JSONArray.of(STATUSES.toArray())),
            true,
            false,
            null,
            null,
            false));

    return JSONObject.of("fields", fields, "values", values, "errors", errors, "save", save(existing));
  }

  /**
   * Field errors for a Trigger draft or save payload. When {@code actionIds} or {@code workflowIds} is non-null, a
   * referenced target missing from the domain is reported as {@code target_unavailable}.
   */
  public static List<ObjectNode> fieldErrors(
      JSONObject values,
      Set<String> actionIds,
      Set<String> workflowIds,
      String lang,
      LangService langService) {
    PanelFormErrors errors = new PanelFormErrors();
    String name = errors.requiredString(values, "name", "/name");
    if (name != null && name.trim().length() > NAME_MAX) {
      errors.valueTooLong("/name", "name must be at most " + NAME_MAX + " characters");
    }
    errors.optionalString(values, "description", "/description");

    Object conditionKind = values.get("conditionKind");
    if (conditionKind != null) {
      if (!(conditionKind instanceof String kind) || !Trigger.CONDITION_TIME.equals(kind)) {
        errors.invalidOption(
            "/conditionKind",
            text(langService, lang, "Trigger.condition.unsupported"));
      }
    }

    JSONObject condition = errors.requiredObject(values, "condition", "/condition");
    if (condition != null) {
      validateFrequency(condition, errors);
      String timeZone = errors.requiredString(condition, "timeZone", "/condition/timeZone");
      if (timeZone != null) {
        try {
          ZoneId.of(timeZone.trim());
        } catch (DateTimeException invalid) {
          errors.invalidFormat("/condition/timeZone", "Invalid time zone: " + timeZone);
        }
      }
    }

    String effectKind = errors.requiredString(values, "effectKind", "/effectKind");
    if (effectKind != null && !EXECUTED_EFFECTS.contains(effectKind)) {
      errors.invalidOption("/effectKind", text(langService, lang, "Trigger.effect.unsupported"));
    }

    JSONObject effect = errors.requiredObject(values, "effect", "/effect");
    if (effect != null && effectKind != null) {
      if (Trigger.EFFECT_ACTION.equals(effectKind)) {
        String actionId = errors.requiredString(effect, "actionId", "/effect/actionId");
        if (actionId != null && actionIds != null && !actionIds.contains(actionId)) {
          errors.targetUnavailable(
              "/effect/actionId", text(langService, lang, "PanelForm.trigger.targetMissing"));
        }
        errors.objectField(effect, "parameters", "/effect/parameters");
      } else if (Trigger.EFFECT_WORKFLOW.equals(effectKind)) {
        String workflowId = errors.requiredString(effect, "workflowId", "/effect/workflowId");
        if (workflowId != null && workflowIds != null && !workflowIds.contains(workflowId)) {
          errors.targetUnavailable(
              "/effect/workflowId", text(langService, lang, "PanelForm.trigger.targetMissing"));
        }
        errors.objectField(effect, "inputs", "/effect/inputs");
      }
    }

    String executor = errors.optionalString(values, "executor", "/executor");
    if (executor != null && executor.trim().length() > EXECUTOR_MAX) {
      errors.valueTooLong("/executor", "executor must be at most " + EXECUTOR_MAX + " characters");
    }

    Object status = values.get("status");
    if (status != null && !(status instanceof String text && STATUSES.contains(text))) {
      errors.invalidOption("/status", text(langService, lang, "Trigger.statusInvalid"));
    }
    return errors.list();
  }

  private static void validateFrequency(JSONObject condition, PanelFormErrors errors) {
    JSONObject frequency = errors.requiredObject(condition, "frequency", "/condition/frequency");
    if (frequency == null) return;
    String kind = frequency.getString("kind");
    if (kind == null || kind.isBlank()) {
      errors.required("/condition/frequency", "frequency.kind is required");
      return;
    }
    switch (kind) {
      case "interval" -> {
        Integer every = wholeNumber(frequency.get("every"));
        if (every == null || every < 1 || every > 1000) {
          errors.invalidNumber("/condition/frequency", "frequency.every must be an integer between 1 and 1000");
        }
        String unit = frequency.getString("unit");
        if (unit == null || !INTERVAL_UNITS.contains(unit)) {
          errors.invalidOption("/condition/frequency", "frequency.unit must be minute, hour or day");
        }
      }
      case "daily" -> validateTime(frequency.get("time"), errors);
      case "weekly" -> {
        Integer weekday = wholeNumber(frequency.get("weekday"));
        if (weekday == null || weekday < 1 || weekday > 7) {
          errors.invalidNumber("/condition/frequency", "frequency.weekday must be an integer between 1 and 7");
        }
        validateTime(frequency.get("time"), errors);
      }
      case "monthly" -> {
        Integer day = wholeNumber(frequency.get("day"));
        if (day == null || day < 1 || day > 31) {
          errors.invalidNumber("/condition/frequency", "frequency.day must be an integer between 1 and 31");
        }
        validateTime(frequency.get("time"), errors);
      }
      case "cron" -> {
        Object rawExpression = frequency.get("expression");
        if (!(rawExpression instanceof String expr) || expr.isBlank()) {
          errors.required("/condition/frequency", "frequency.expression is required");
          return;
        }
        try {
          CronExpression parsed = CronExpression.parse(expr.trim());
          if (parsed.next(LocalDateTime.now()) == null) {
            errors.invalidFormat("/condition/frequency", "Cron expression has no future slot");
          }
        } catch (IllegalArgumentException invalid) {
          errors.invalidFormat("/condition/frequency", "Invalid cron expression: " + invalid.getMessage());
        }
      }
      default ->
          errors.invalidOption(
              "/condition/frequency",
              "frequency.kind must be interval, daily, weekly, monthly or cron");
    }
  }

  private static void validateTime(Object rawTime, PanelFormErrors errors) {
    if (!(rawTime instanceof String time) || !TIME_PATTERN.matcher(time).matches()) {
      errors.invalidTime("/condition/frequency", "frequency.time must match HH:mm");
    }
  }

  private static Integer wholeNumber(Object value) {
    if (value instanceof Integer i) return i;
    if (value instanceof Long l && l >= Integer.MIN_VALUE && l <= Integer.MAX_VALUE) return l.intValue();
    if (value instanceof Number n) {
      double d = n.doubleValue();
      if (Double.isFinite(d) && Math.floor(d) == d && d >= Integer.MIN_VALUE && d <= Integer.MAX_VALUE) {
        return (int) d;
      }
    }
    return null;
  }

  /** Human-readable cadence text in the reader's language, matching the Trigger catalogue's wording. */
  public static String cadenceSummary(JSONObject condition, String lang, LangService langService) {
    if (condition == null) return "";
    JSONObject frequency = condition.getJSONObject("frequency");
    if (frequency == null) return "";
    String kind = frequency.getString("kind");
    if (kind == null || kind.isBlank()) return "";
    return switch (kind) {
      case "interval" -> {
        String unitKey =
            switch (String.valueOf(frequency.getString("unit"))) {
              case "minute" -> "Trigger.unit.minute";
              case "hour" -> "Trigger.unit.hour";
              case "day" -> "Trigger.unit.day";
              default -> null;
            };
        String unitLabel = unitKey == null ? String.valueOf(frequency.getString("unit")) : text(langService, lang, unitKey);
        yield text(langService, lang, "Trigger.cadence.interval")
            .replace("{every}", String.valueOf(frequency.getIntValue("every")))
            .replace("{unit}", unitLabel);
      }
      case "daily" ->
          text(langService, lang, "Trigger.cadence.daily")
              .replace("{time}", nonNull(frequency.getString("time")));
      case "weekly" -> {
        int weekday = Math.max(1, Math.min(7, frequency.getIntValue("weekday")));
        String dayLabel = text(langService, lang, "Trigger.weekday." + weekday);
        yield text(langService, lang, "Trigger.cadence.weekly")
            .replace("{weekday}", dayLabel)
            .replace("{time}", nonNull(frequency.getString("time")));
      }
      case "monthly" ->
          text(langService, lang, "Trigger.cadence.monthly")
              .replace("{day}", String.valueOf(frequency.getIntValue("day")))
              .replace("{time}", nonNull(frequency.getString("time")));
      case "cron" -> nonNull(frequency.getString("expression"));
      default -> "";
    };
  }

  private static JSONArray effectKindOptions(String lang, LangService langService) {
    JSONArray options = new JSONArray();
    options.add(
        PanelFormFields.option(Trigger.EFFECT_ACTION, text(langService, lang, "Trigger.effect.action")));
    options.add(
        PanelFormFields.option(Trigger.EFFECT_WORKFLOW, text(langService, lang, "Trigger.effect.workflow")));
    return options;
  }

  private static JSONArray actionOptions(
      List<Action> actions, String currentId, String lang, LangService langService) {
    JSONArray options = new JSONArray();
    boolean matched = false;
    if (actions != null) {
      for (Action action : actions) {
        if (action == null || action.getId() == null || action.getId().isBlank()) continue;
        String label =
            action.getName() == null || action.getName().isBlank() ? action.getId() : action.getName();
        options.add(PanelFormFields.option(action.getId(), label));
        if (action.getId().equals(currentId)) matched = true;
      }
    }
    if (currentId != null && !currentId.isBlank() && !matched) {
      options.add(
          PanelFormFields.option(
              currentId,
              currentId,
              null,
              true,
              text(langService, lang, "PanelForm.trigger.targetMissing")));
    }
    return options;
  }

  private static JSONArray workflowOptions(
      List<Workflow> workflows, String currentId, String lang, LangService langService) {
    JSONArray options = new JSONArray();
    boolean matched = false;
    if (workflows != null) {
      for (Workflow workflow : workflows) {
        if (workflow == null || workflow.getId() == null || workflow.getId().isBlank()) continue;
        String label =
            workflow.getName() == null || workflow.getName().isBlank()
                ? workflow.getId()
                : workflow.getName();
        options.add(PanelFormFields.option(workflow.getId(), label));
        if (workflow.getId().equals(currentId)) matched = true;
      }
    }
    if (currentId != null && !currentId.isBlank() && !matched) {
      options.add(
          PanelFormFields.option(
              currentId,
              currentId,
              null,
              true,
              text(langService, lang, "PanelForm.trigger.targetMissing")));
    }
    return options;
  }

  private static JSONArray statusOptions(String lang, LangService langService) {
    JSONArray options = new JSONArray();
    options.add(
        PanelFormFields.option(
            Trigger.STATUS_PENDING_REVIEW, text(langService, lang, "PanelForm.status.pendingReview")));
    options.add(
        PanelFormFields.option(
            Trigger.STATUS_PUBLISHED, text(langService, lang, "PanelForm.status.published")));
    options.add(
        PanelFormFields.option(
            Trigger.STATUS_UNUSED, text(langService, lang, "PanelForm.status.unused")));
    return options;
  }

  private static JSONObject save(boolean existing) {
    JSONObject properties = new JSONObject();
    properties.put("id", PanelFormFields.schema("string"));
    properties.put("name", JSONObject.of("type", "string", "minLength", 1, "maxLength", NAME_MAX));
    properties.put("description", JSONObject.of("type", JSONArray.of("string", "null")));
    properties.put("conditionKind", JSONObject.of("type", "string", "enum", JSONArray.of(Trigger.CONDITION_TIME)));
    properties.put("condition", PanelFormFields.schema("object"));
    properties.put("effectKind", JSONObject.of("type", "string", "enum", JSONArray.of(EXECUTED_EFFECTS.toArray())));
    properties.put("effect", PanelFormFields.schema("object"));
    properties.put("executor", JSONObject.of("type", JSONArray.of("string", "null")));
    properties.put("status", JSONObject.of("type", "string", "enum", JSONArray.of(STATUSES.toArray())));
    return JSONObject.of(
        "method", "POST",
        "path", "/trigger/save",
        "bodySchema",
            JSONObject.of(
                "type", "object",
                "properties", properties,
                "required", JSONArray.of("name", "condition", "effectKind", "effect")),
        "draftOperation", existing ? UPDATE_OPERATION : CREATE_OPERATION);
  }

  private static JSONObject nullableObject() {
    return JSONObject.of("type", JSONArray.of("object", "null"));
  }

  private static JSONObject copyObject(JSONObject source) {
    if (source == null) return new JSONObject();
    JSONObject copied = JSON.parseObject(JSON.toJSONString(source, Feature.WriteMapNullValue));
    return copied == null ? new JSONObject() : copied;
  }

  private static String nonNull(String value) {
    return value == null ? "" : value;
  }

  private static String text(LangService langService, String lang, String key) {
    if (langService == null) return key;
    String value = langService.get(lang, key);
    return value == null || value.isBlank() ? key : value;
  }
}
