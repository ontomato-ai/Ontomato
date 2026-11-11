package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.IdentityService;
import java.time.Instant;
import java.time.ZoneId;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
@RequiredArgsConstructor
public class PlatformTasks {
  private final TaskStore store;
  private final IdentityService identities;
  private final ScheduleIdentity identity;
  private final TaskCredentials credentials;
  private final ScheduleApplications applications;
  private final TransactionTemplate transactions;

  @Value("${SCHEDULE_TIMEZONE:}")
  private String configuredZone;

  public record Created(JsonNode task, boolean created) {}

  private User current() {
    var user = identities.getCurrentUser();
    if (user == null || user.getId() == null || user.getDomainId() == null || !user.isEnable())
      throw new ScheduleException(401, "UNAUTHENTICATED", "A current domain user is required");
    return user;
  }

  private String zone() {
    return configuredZone == null || configuredZone.isBlank()
        ? ZoneId.systemDefault().getId()
        : configuredZone;
  }

  private ScheduleApplication.Actor actor(User user, String locale) {
    return new ScheduleApplication.Actor(
        user,
        identity.dataPermission(user.getDomainId(), user.getId()),
        identity.onlineToken(),
        identity.onlineApiKey(),
        locale);
  }

  private static ScheduleException missing() {
    return new ScheduleException(404, "TASK_NOT_FOUND", "Task not found");
  }

  private TaskStore.Task accessible(UUID id, User user, boolean lock) {
    var task = store.get(id, lock);
    if (task == null
        || !task.domain().equals(user.getDomainId())
        || !task.creator().equals(user.getId())) throw missing();
    return task;
  }

  private static long revision(JsonNode value) {
    var revision = value.path("revision");
    if (!revision.isIntegralNumber()
        || !revision.canConvertToLong()
        || revision.asLong() < 1
        || revision.asLong() > 9007199254740991L) throw bad("Invalid revision");
    return revision.asLong();
  }

  private void checkRevision(TaskStore.Task task, long expected) {
    if (task.revision() != expected)
      throw new ScheduleException(
          409, "REVISION_CONFLICT", "The task changed; reload before editing");
  }

  private void requireIdle(UUID task) {
    UUID active = store.active(task);
    if (active != null)
      throw new ScheduleException(
          409, "TASK_RUNNING", "Task is already running", Map.of("activeRunId", active));
  }

  private void requireCapacity(ScheduleApplication provider, User user) {
    if (provider.creatorLimit() > 0
        && store.visible(user.getDomainId(), user.getId(), provider.id()).size()
            >= provider.creatorLimit())
      throw new ScheduleException(409, "TASK_LIMIT_REACHED", "Application task limit reached");
  }

  private JsonNode view(TaskStore.Task task) {
    var definition = task.definition();
    var latest = store.history(task.id(), null, null, 1);
    var result = store.latestResult(task.id());
    return object(
        "id",
        task.id(),
        "creatorId",
        task.creator(),
        "title",
        definition.title(),
        "appId",
        definition.appId(),
        "content",
        definition.content(),
        "formRevision",
        definition.formRevision(),
        "summary",
        task.summary(),
        "frequency",
        definition.frequency(),
        "timeZone",
        definition.timeZone(),
        "notifyEmail",
        definition.notifyEmail(),
        "enabled",
        task.enabled(),
        "pause",
        task.pause(),
        "nextRunAt",
        task.nextRunAt(),
        "revision",
        task.revision(),
        "createdAt",
        task.createdAt(),
        "updatedAt",
        task.updatedAt(),
        "activeRunId",
        store.active(task.id()),
        "lastRun",
        latest.isEmpty() ? null : latest.getFirst().summaryView(),
        "latestResult",
        result == null ? null : object("runId", result.id(), "link", result.resultLink()));
  }

  public JsonNode list(String app) {
    var user = current();
    if (app != null && !app.matches("[a-z][a-z0-9-]{0,63}")) throw bad("Invalid application ID");
    return object(
        "tasks",
        store.visible(user.getDomainId(), user.getId(), app).stream().map(this::view).toList(),
        "timeZone",
        zone());
  }

  public JsonNode applications(String locale) {
    var user = current();
    var actor = actor(user, locale);
    var result = array();
    var tasks = store.visible(user.getDomainId(), user.getId(), null);
    for (var entry : applications.all(user.getDomainId()).entrySet()) {
      var provider = entry.getValue();
      ObjectNode descriptor;
      try {
        descriptor = (ObjectNode) provider.describe(actor);
      } catch (RuntimeException unavailable) {
        descriptor =
            object(
                "id",
                entry.getKey(),
                "description",
                provider.description(locale),
                "available",
                false,
                "unavailableReason",
                locale.startsWith("zh")
                    ? "暂时无法确认你能否使用这个应用"
                    : "Unable to confirm whether you can use this application right now",
                "taskCount",
                0);
      }
      if (!applications.canEnter(entry.getKey(),user)) {
        descriptor.put("available",false);
        descriptor.put("unavailableReason",locale.startsWith("zh") ? "没有应用入口权限" : "Application entry permission is required");
      }
      descriptor.put(
          "taskCount",
          tasks.stream().filter(task -> entry.getKey().equals(task.definition().appId())).count());
      result.add(descriptor);
    }
    return object("applications", result, "totalCount", tasks.size());
  }

  public JsonNode form(String appId, JsonNode input, String locale) {
    keys(input, "values", "changedField", "taskId", "timeZone");
    content(input.get("values"));
    if (!input.has("changedField")
        || (!input.get("changedField").isNull() && !input.get("changedField").isTextual()))
      throw bad("Invalid changedField");
    if (input.get("changedField").isTextual()
        && (input.get("changedField").asText().isEmpty()
            || input.get("changedField").asText().length() > 256))
      throw bad("Invalid changedField");
    if (!input.has("taskId")) throw bad("Missing taskId");
    UUID task = input.get("taskId").isNull() ? null : UUID.fromString(input.get("taskId").asText());
    var user = current();
    if (task != null) accessible(task, user, false);
    String zone = text(input, "timeZone");
    ZoneId.of(zone);
    var provider = applications.require(appId);
    var actor = actor(user, locale);
    provider.authorize(actor, input.get("values"));
    return provider.form(
        new ScheduleApplication.FormInput(
            input.get("values"), input.get("changedField").asText(null), task, zone),
        actor);
  }

  private ScheduleApplication.Validation prepare(
      TaskDefinition definition, ScheduleApplication provider, User user, String locale) {
    var actor = actor(user, locale);
    provider.authorize(actor, definition.content());
    var validation = provider.validate(definition, actor);
    if (provider.remote()) credentials.prepareForSetup(user);
    return validation;
  }

  public Created create(UUID id, JsonNode input, String locale, boolean enabled) {
    var user = current();
    var definition = TaskDefinition.input(input, zone(), false);
    var previous = store.get(id, false);
    if (previous != null) return replay(previous, user, definition, enabled);
    var provider = applications.require(definition.appId());
    var validated = prepare(definition, provider, user, locale);
    var normalized = definition.validated(validated);
    return transactions.execute(
        tx -> {
          credentials.lockOwner(user.getDomainId(), user.getId());
          store
              .jdbc()
              .query(
                  "SELECT pg_advisory_xact_lock(hashtextextended(?,1))", row -> {}, id.toString());
          var old = store.get(id, false);
          if (old != null) return replay(old, user, normalized, enabled);
          requireCapacity(provider, user);
          Instant now = Instant.now();
          store.insert(
              id,
              user.getDomainId(),
              user.getId(),
              normalized,
              validated.summary(),
              locale,
              enabled ? normalized.next(now, now) : null,
              enabled);
          provider.attach(id, validated);
          return new Created(view(store.get(id, false)), true);
        });
  }

  private Created replay(
      TaskStore.Task old, User user, TaskDefinition definition, boolean enabled) {
    if (old.domain().equals(user.getDomainId())
        && old.creator().equals(user.getId())
        && old.enabled() == enabled
        && old.definition().equals(definition)) return new Created(view(old), false);
    throw new ScheduleException(409, "IDEMPOTENCY_CONFLICT", "Idempotency key reused");
  }

  public JsonNode update(UUID id, JsonNode input, String locale) {
    var user = current();
    var old = accessible(id, user, false);
    long expected = revision(input);
    checkRevision(old, expected);
    requireIdle(id);
    var definition = TaskDefinition.input(input, zone(), true);
    var provider = applications.require(definition.appId());
    var validated = prepare(definition, provider, user, locale);
    var normalized = definition.validated(validated);
    return transactions.execute(
        tx -> {
          credentials.lockOwner(user.getDomainId(), user.getId());
          var task = accessible(id, user, true);
          checkRevision(task, expected);
          requireIdle(id);
          if (!task.definition().appId().equals(provider.id())) requireCapacity(provider, user);
          applications.detach(id);
          Instant now = Instant.now();
          store.update(
              task,
              normalized,
              validated.summary(),
              locale,
              task.enabled() ? normalized.next(now, now) : null);
          provider.attach(id, validated);
          return view(store.get(id, false));
        });
  }

  public JsonNode enabled(UUID id, JsonNode input, String locale) {
    keys(input, "enabled", "revision");
    if (!input.path("enabled").isBoolean()) throw bad("Missing enabled flag");
    var user = current();
    var old = accessible(id, user, false);
    long expected = revision(input);
    checkRevision(old, expected);
    boolean enabled = input.path("enabled").asBoolean();
    if (enabled)
      prepare(old.definition(), applications.require(old.definition().appId()), user, locale);
    return transactions.execute(
        tx -> {
          var task = accessible(id, user, true);
          checkRevision(task, expected);
          Instant now = Instant.now();
          store
              .jdbc()
              .update(
                  "UPDATE platform_task SET"
                      + " enabled=?,pause_code=NULL,pause_message=NULL,next_run_at=?,revision=revision+1,updated_at=now()"
                      + " WHERE id=?",
                  enabled,
                  enabled ? TaskStore.timestamp(task.definition().next(now, now)) : null,
                  id);
          return view(store.get(id, false));
        });
  }

  public void delete(UUID id, String ifMatch) {
    if (ifMatch == null || !ifMatch.matches("\"[1-9][0-9]*\""))
      throw bad("A quoted revision is required");
    long expected;
    try {
      expected = Long.parseLong(ifMatch.substring(1, ifMatch.length() - 1));
    } catch (NumberFormatException error) {
      throw bad("Invalid revision");
    }
    var user = current();
    transactions.executeWithoutResult(
        tx -> {
          var task = accessible(id, user, true);
          checkRevision(task, expected);
          requireIdle(id);
          store.jdbc().update("DELETE FROM platform_task WHERE id=?", id);
        });
  }

  public JsonNode manual(UUID id, UUID runId, String locale) {
    var user = current();
    var task = accessible(id, user, false);
    var old = store.run(runId);
    if (old != null) return replayRun(id, old);
    var provider = applications.require(task.definition().appId());
    prepare(task.definition(), provider, user, locale);
    return transactions.execute(
        tx -> {
          var locked = accessible(id, user, true);
          checkRevision(locked, task.revision());
          var existing = store.run(runId);
          if (existing != null) return replayRun(id, existing);
          requireIdle(id);
          var run = store.admit(locked, runId, "manual", null);
          if (run == null)
            throw new ScheduleException(409, "IDEMPOTENCY_CONFLICT", "Idempotency key reused");
          return run.wire();
        });
  }

  private JsonNode replayRun(UUID id, TaskStore.Run old) {
    if (id.equals(old.taskId()) && "manual".equals(old.trigger())) return old.wire();
    throw new ScheduleException(409, "IDEMPOTENCY_CONFLICT", "Idempotency key reused");
  }

  public JsonNode detail(UUID id) {
    return view(accessible(id, current(), false));
  }

  public JsonNode detail(UUID id, UUID runId) {
    accessible(id, current(), false);
    var run = store.run(runId);
    if (run == null || !id.equals(run.taskId())) throw missing();
    return run.wire();
  }

  public JsonNode history(UUID id, String cursor, int limit) {
    accessible(id, current(), false);
    if (limit < 1 || limit > 100) throw bad("Invalid limit");
    TaskStore.Run after = null;
    if (cursor != null) {
      try {
        after = store.run(UUID.fromString(cursor));
      } catch (IllegalArgumentException invalid) {
        throw bad("Invalid cursor");
      }
      if (after == null || !id.equals(after.taskId())) throw bad("Invalid cursor");
    }
    var rows =
        store.history(
            id,
            after == null ? null : after.startedAt(),
            after == null ? null : after.id(),
            limit + 1);
    var selected = rows.subList(0, Math.min(limit, rows.size()));
    return object(
        "runs",
        selected.stream().map(TaskStore.Run::wire).toList(),
        "nextCursor",
        rows.size() > limit ? selected.getLast().id().toString() : null);
  }

  public void renewOnVisit(String locale) {
    var user = current();
    var tasks = store.visible(user.getDomainId(), user.getId(), null);
    boolean needs = false;
    for (var task : tasks) {
      try {
        if (applications.require(task.definition().appId()).remote()) needs = true;
      } catch (ScheduleException missing) {
        if (!"APPLICATION_NOT_FOUND".equals(missing.code)) throw missing;
      }
    }
    if (!needs) return;
    credentials.prepareForSetup(user);
    for (var task : tasks)
      if (task.enabled()
          && task.pause() != null
          && "credential_invalid".equals(task.pause().code())) {
        try {
          var provider = applications.require(task.definition().appId());
          var actor = actor(user, locale);
          provider.authorize(actor, task.definition().content());
          provider.validate(task.definition(), actor);
          transactions.executeWithoutResult(
              tx -> {
                var locked = accessible(task.id(), user, true);
                if (locked.revision() != task.revision()) return;
                Instant now = Instant.now();
                store
                    .jdbc()
                    .update(
                        "UPDATE platform_task SET"
                            + " pause_code=NULL,pause_message=NULL,next_run_at=?,revision=revision+1,updated_at=now()"
                            + " WHERE id=?",
                        TaskStore.timestamp(task.definition().next(now, now)),
                        task.id());
              });
        } catch (ScheduleException invalid) {
          if (invalid.getStatusCode().value() >= 500) throw invalid;
          String pause =
              switch (invalid.code) {
                case "PERMISSION_DENIED" -> "permission_denied";
                case "FORM_CHANGED" -> "definition_changed";
                case "FIELD_VALIDATION_FAILED", "TARGET_UNAVAILABLE" -> "target_unavailable";
                case "APPLICATION_NOT_FOUND" -> "application_unavailable";
                default -> null;
              };
          if (pause != null)
            store
                .jdbc()
                .update(
                    "UPDATE platform_task SET"
                        + " pause_code=?,pause_message=?,revision=revision+1,updated_at=now() WHERE"
                        + " id=? AND revision=? AND enabled",
                    pause,
                    java.util.Objects.toString(invalid.getReason(), "Task requires attention"),
                    task.id(),
                    task.revision());
        }
      }
  }
}
