package io.ontomato.dataengine.schedules;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.*;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.support.CronExpression;
import org.springframework.web.server.ResponseStatusException;

public record TaskDefinition(
    String name,
    String description,
    JsonNode target,
    JsonNode frequency,
    String timeZone,
    String notifyEmail) {
  static ResponseStatusException bad(String message) {
    return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
  }

  String application() {
    return isAgent() ? "agents" : "ontology";
  }

  boolean isAgent() {
    return "agent".equals(target.path("kind").asText());
  }

  void validate() {
    if (name == null
        || name.isBlank()
        || target == null
        || !target.isObject()
        || frequency == null
        || !frequency.isObject()) throw bad("Name, target and frequency are required");
    if (isAgent()) {
      if (target.size() != 3
          || !target.path("prompt").isTextual()
          || target.path("prompt").asText().isBlank()
          || target.path("prompt").asText().length() > 4000) throw bad("Invalid agent prompt");
      try {
        UUID.fromString(target.path("agentId").asText());
      } catch (IllegalArgumentException e) {
        throw bad("Invalid agent ID");
      }
    } else if (!"function".equals(target.path("kind").asText())
        || target.size() != 2
        || !target.path("functionId").isTextual()
        || target.path("functionId").asText().isBlank()) {
      throw bad("Invalid function target");
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
