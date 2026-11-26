package io.ontomato.dataengine.schedules;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.*;
import org.springframework.scheduling.support.CronExpression;

public record TaskDefinition(
    String title,
    String appId,
    JsonNode content,
    String formRevision,
    JsonNode frequency,
    String timeZone,
    String notifyEmail,
    String description,
    String targetKind,
    String targetId) {
  public boolean application() { return "application".equals(targetKind); }
  static ScheduleException bad(String message) {
    return ScheduleJson.bad(message);
  }

  static TaskDefinition input(JsonNode value, String defaultZone, boolean update) {
    var fields = new java.util.ArrayList<>(java.util.List.of("title", "appId", "content", "formRevision",
        "frequency", "timeZone", "notifyEmail", "description", "targetKind", "targetId", "executorId", "coauthorIds"));
    if (update) fields.add("revision");
    ScheduleJson.keys(value, fields.toArray(String[]::new));
    if (!value.has("notifyEmail")
        || (!value.get("notifyEmail").isNull() && !value.get("notifyEmail").isTextual()))
      throw bad("Notification email must be text or null");
    if (value.has("timeZone") && !value.get("timeZone").isTextual()) throw bad("Invalid time zone");
    var result =
        new TaskDefinition(
            ScheduleJson.text(value, "title").trim(),
            ScheduleJson.optionalText(value, "appId"),
            value.get("content"),
            ScheduleJson.optionalText(value, "formRevision"),
            value.get("frequency"),
            value.has("timeZone") ? value.get("timeZone").asText() : defaultZone,
            ScheduleJson.optionalText(value, "notifyEmail"),
            ScheduleJson.optionalText(value, "description"),
            ScheduleJson.text(value, "targetKind"),
            ScheduleJson.optionalText(value, "targetId"));
    result.validate();
    return result;
  }

  TaskDefinition validated(ScheduleApplication.Validation validation) {
    return new TaskDefinition(
        title,
        appId,
        validation.content(),
        validation.formRevision(),
        frequency,
        timeZone,
        notifyEmail,
        description,
        targetKind,
        targetId);
  }

  void validate() {
    if (title.isBlank() || title.length() > (application() ? 200 : 255)
        || frequency == null || !frequency.isObject() || timeZone.isBlank())
      throw bad("Title, frequency and time zone are required");
    if (application()) {
      if (appId == null || !appId.matches("[a-z][a-z0-9-]{0,63}") || formRevision == null
          || formRevision.isBlank() || targetId != null)
        throw bad("An application target requires an application ID and form revision");
      ScheduleJson.content(content);
    } else {
      if (appId != null || formRevision != null || targetId == null || targetId.isBlank())
        throw bad("A capability target requires its ID and no application fields");
      switch (targetKind) {
        case "action" -> {
          ScheduleJson.keys(content, "parameters", "runStartParameters");
          if (!content.path("parameters").isObject()) throw bad("Action parameters must be an object");
          if (content.has("runStartParameters")) {
            var names = content.get("runStartParameters");
            if (!names.isArray()) throw bad("runStartParameters must be a parameter name array");
            var used = new java.util.HashSet<String>();
            for (var name : names) {
              if (!name.isTextual() || name.textValue().isBlank() || !used.add(name.textValue())
                  || content.get("parameters").has(name.textValue()))
                throw bad("Run-start and static action parameters must have distinct names");
            }
          }
        }
        case "workflow" -> {
          ScheduleJson.keys(content, "inputs", "requester", "goalText");
          if (!content.path("inputs").isObject()) throw bad("Workflow inputs must be an object");
          ScheduleJson.optionalText(content, "requester");
          ScheduleJson.optionalText(content, "goalText");
        }
        default -> throw bad("Invalid target kind");
      }
    }
    switch (frequency.path("kind").asText()) {
      case "interval" -> ScheduleJson.keys(frequency, "kind", "every", "unit");
      case "daily" -> ScheduleJson.keys(frequency, "kind", "time");
      case "weekly" -> ScheduleJson.keys(frequency, "kind", "weekday", "time");
      case "monthly" -> ScheduleJson.keys(frequency, "kind", "day", "time");
      case "cron" -> ScheduleJson.keys(frequency, "kind", "expression");
      default -> throw bad("Invalid frequency");
    }
    if (notifyEmail != null
        && (notifyEmail.length() > 320 || !notifyEmail.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")))
      throw bad("Invalid notification address");
    next(Instant.now(), Instant.now());
  }

  private int number(String field, int max) {
    var n = frequency.path(field);
    if (!n.isIntegralNumber() || !n.canConvertToInt() || n.intValue() < 1 || n.intValue() > max)
      throw bad("Invalid " + field);
    return n.intValue();
  }

  Instant next(Instant slot, Instant now) {
    try {
      var zone = ZoneId.of(timeZone);
      var wall = now.atZone(zone);
      var day = wall.toLocalDate();
      String kind = frequency.path("kind").asText();
      if (kind.equals("interval")) {
        long unit =
            switch (frequency.path("unit").asText()) {
              case "minute" -> 60;
              case "hour" -> 3600;
              case "day" -> 86400;
              default -> throw bad("Invalid interval unit");
            };
        long step = number("every", 1000) * unit;
        return slot.plusSeconds(
            (Math.max(0, Duration.between(slot, now).getSeconds()) / step + 1) * step);
      }
      if (kind.equals("cron")) {
        var next = CronExpression.parse(frequency.path("expression").asText()).next(wall);
        if (next == null) throw bad("Cron has no future slot");
        return next.toInstant();
      }
      String time = frequency.path("time").asText();
      if (!time.matches("([01][0-9]|2[0-3]):[0-5][0-9]")) throw bad("Invalid wall-clock time");
      LocalTime at = LocalTime.parse(time);
      switch (kind) {
        case "daily" -> {
          if (!day.atTime(at).atZone(zone).toInstant().isAfter(now)) day = day.plusDays(1);
        }
        case "weekly" -> {
          day =
              day.plusDays(Math.floorMod(number("weekday", 7) - day.getDayOfWeek().getValue(), 7));
          if (!day.atTime(at).atZone(zone).toInstant().isAfter(now)) day = day.plusWeeks(1);
        }
        case "monthly" -> {
          int desired = number("day", 31);
          day = day.withDayOfMonth(Math.min(desired, day.lengthOfMonth()));
          if (!day.atTime(at).atZone(zone).toInstant().isAfter(now)) {
            day = day.plusMonths(1);
            day = day.withDayOfMonth(Math.min(desired, day.lengthOfMonth()));
          }
        }
        default -> throw bad("Invalid frequency");
      }
      return day.atTime(at).atZone(zone).toInstant();
    } catch (DateTimeException | IllegalArgumentException e) {
      throw bad("Invalid time zone or frequency: " + e.getMessage());
    }
  }
}
