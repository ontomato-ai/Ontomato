package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;

import com.fasterxml.jackson.databind.JsonNode;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import java.time.Instant;
import java.util.UUID;

/** An application owns its form, authorization, execution and result location. */
public interface ScheduleApplication {
  record Actor(
      User user, UserDataPermission permission, String token, String apiKey, String locale) {
    public String domain() {
      return user.getDomainId();
    }

    public String creator() {
      return user.getId();
    }
  }

  record FormInput(JsonNode values, String changedField, String taskId, String timeZone) {}

  record Validation(
      JsonNode content,
      String formRevision,
      String timeZone,
      JsonNode summary,
      JsonNode references) {}

  record Execution(
      String taskId,
      UUID runId,
      String domainId,
      String executorId,
      TaskDefinition definition,
      String locale,
      String trigger,
      Instant scheduledAt,
      Instant admittedAt) {
    public JsonNode wire() {
      return object(
          "taskId",
          taskId,
          "runId",
          runId,
          "appId",
          definition.appId(),
          "title",
          definition.title(),
          "content",
          definition.content(),
          "formRevision",
          definition.formRevision(),
          "timeZone",
          definition.timeZone(),
          "locale",
          locale,
          "trigger",
          trigger,
          "scheduledAt",
          scheduledAt,
          "admittedAt",
          admittedAt);
    }
  }

  String id();

  JsonNode form(FormInput input, Actor actor);

  Validation validate(TaskDefinition definition, Actor actor);

  JsonNode start(Execution execution, Actor actor);

  JsonNode status(Execution execution, JsonNode handle);

  default boolean remote() {
    return false;
  }

  default boolean asynchronous() {
    return true;
  }

  default int deadlineMinutes(Execution execution) {
    return 11;
  }

  default int creatorLimit() {
    return 0;
  }

}
