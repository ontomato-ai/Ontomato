package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleIdentity.FunctionOperation.*;

import com.fasterxml.jackson.annotation.JsonUnwrapped;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.IdentityService;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class PlatformTasks {
  private final TaskStore store;
  private final IdentityService identities;
  private final ScheduleIdentity identity;
  private final TaskCredentials credentials;
  private final FunctionTarget functions;
  private final AgentHost agents;

  @Value("${SCHEDULE_TIMEZONE:}")
  private String configuredZone;

  public record View(
      UUID id,
      String appId,
      String ownerId,
      @JsonUnwrapped TaskDefinition definition,
      boolean enabled,
      String pausedReason,
      Instant nextRunAt,
      Instant createdAt,
      Instant updatedAt,
      TaskStore.Run lastRun) {}

  record Created(View task, boolean created) {}

  record History(List<TaskStore.Run> runs, String nextCursor) {}

  private User current() {
    var user = identities.getCurrentUser();
    if (user == null || user.getDomainId() == null || user.getId() == null)
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "A domain user is required");
    return user;
  }

  private String zone() {
    return configuredZone.isBlank() ? ZoneId.systemDefault().getId() : configuredZone;
  }

  private static ResponseStatusException missing() {
    return new ResponseStatusException(HttpStatus.NOT_FOUND, "Task not found");
  }

  private View view(TaskStore.Task t) {
    boolean allowed = t.owner() != null || readsResults(current());
    var history = allowed ? store.history(t.id(), null, null, 1) : List.<TaskStore.Run>of();
    return view(t, history.isEmpty() ? null : history.getFirst());
  }

  private boolean readsResults(User user) {
    return identity.permits(user, HISTORY) || identity.permits(user, RESULT);
  }

  private View view(TaskStore.Task t, TaskStore.Run last) {
    return new View(
        t.id(),
        t.appId(),
        t.owner(),
        t.definition(),
        t.enabled(),
        t.pausedReason(),
        t.nextRunAt(),
        t.createdAt(),
        t.updatedAt(),
        last);
  }

  private TaskStore.Task accessible(
      UUID id, User user, ScheduleIdentity.FunctionOperation operation, boolean lock) {
    if (lock) credentials.lockOwner(user.getDomainId(), user.getId());
    var t = store.get(id, lock);
    if (t == null || !t.domain().equals(user.getDomainId())) throw missing();
    if (t.owner() != null) {
      if (!t.owner().equals(user.getId())) throw missing();
    } else if (!identity.permits(user, operation))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    return t;
  }

  public void renewOnVisit() {
    credentials.prepare(current(), true);
  }

  public List<FunctionTarget.Option> functionTargets() {
    var user = current();
    if (!identity.permits(user, LIST)) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    return functions.list(user.getDomainId());
  }

  public Map<String, Object> list(String app, UUID agent) {
    var user = current();
    var tasks =
        store.visible(user.getDomainId(), user.getId(), identity.permits(user, LIST), app, agent);
    boolean functionHistory = readsResults(user);
    var last =
        store.latest(
            tasks.stream()
                .filter(t -> t.owner() != null || functionHistory)
                .map(TaskStore.Task::id)
                .toList());
    return Map.of(
        "tasks", tasks.stream().map(t -> view(t, last.get(t.id()))).toList(), "timeZone", zone());
  }

  private TaskDefinition normalized(TaskDefinition d) {
    var input =
        new TaskDefinition(
            d.name(),
            d.description(),
            d.target(),
            d.frequency(),
            d.timeZone() == null ? zone() : d.timeZone(),
            d.notifyEmail());
    input.validate();
    return input;
  }

  private void prepare(User user, TaskDefinition d) {
    if (d.isAgent()) {
      // Validation uses the caller's current session; a newly issued key commits with this task.
      agents.validate(d.target().get("agentId").asText(), identity.onlineToken());
      credentials.prepareForSetup(user);
    } else {
      if (!identity.permits(user, SAVE)) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
      String id = d.target().get("functionId").asText();
      store.jdbc().queryForList("SELECT id FROM function WHERE id=? FOR UPDATE", String.class, id);
      functions.require(user.getDomainId(), id);
    }
  }

  @Transactional
  public Created create(UUID id, TaskDefinition d, String locale, boolean enabled) {
    var user = current();
    var input = normalized(d);
    // Serialize creation for a given key, including attempts from other users.
    store.jdbc().query("SELECT pg_advisory_xact_lock(hashtextextended(?,1))", r -> {}, id.toString());
    var old = store.get(id, false);
    if (old != null) {
      if (old.domain().equals(user.getDomainId())
          && (old.owner() == null ? identity.permits(user, SAVE) : old.owner().equals(user.getId()))
          && old.enabled() == enabled
          && old.definition().equals(input)) return new Created(view(old), false);
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Idempotency key reused");
    }
    prepare(user, input);
    if (input.isAgent()
        && store.jdbc().queryForObject(
                "SELECT count(*) FROM platform_task WHERE domain_id=? AND owner_id=?",
                Integer.class,
                user.getDomainId(),
                user.getId())
            >= 50) throw new ResponseStatusException(HttpStatus.CONFLICT, "Task limit reached");
    Instant now = Instant.now();
    store.insert(
        id,
        user.getDomainId(),
        input.isAgent() ? user.getId() : null,
        input,
        locale,
        input.next(now, now));
    if (!enabled)
      store.jdbc().update("UPDATE platform_task SET enabled=false,next_run_at=NULL WHERE id=?", id);
    return new Created(view(store.get(id, false)), true);
  }

  @Transactional
  public View update(UUID id, TaskDefinition d, String locale) {
    var user = current();
    var task = accessible(id, user, SAVE, true);
    var input = normalized(d);
    if (task.definition().isAgent() != input.isAgent())
      throw TaskDefinition.bad("Cannot change the ownership of a task");
    prepare(user, input);
    Instant now = Instant.now();
    store.update(task, input, locale, task.enabled() ? input.next(now, now) : null);
    return view(store.get(id, false));
  }

  @Transactional
  public View enabled(UUID id, boolean enabled) {
    var user = current();
    var t = accessible(id, user, SAVE, true);
    if (enabled) prepare(user, t.definition());
    var now = Instant.now();
    store.jdbc().update(
        "UPDATE platform_task SET enabled=?,paused_reason=NULL,next_run_at=?,updated_at=now() WHERE"
            + " id=?",
        enabled,
        enabled ? TaskStore.timestamp(t.definition().next(now, now)) : null,
        id);
    return view(store.get(id, false));
  }

  @Transactional
  public void delete(UUID id) {
    accessible(id, current(), DELETE, true);
    store.jdbc().update("DELETE FROM platform_task WHERE id=?", id);
  }

  @Transactional
  public TaskStore.Run manual(UUID id, UUID runId) {
    var user = current();
    var t = accessible(id, user, RUN, true);
    var old = store.run(runId);
    if (old != null) {
      if (id.equals(old.taskId()) && "manual".equals(old.trigger())) {
        if (t.owner() != null || readsResults(user)) return old;
        return new TaskStore.Run(
            old.id(),
            id,
            old.target(),
            null,
            old.trigger(),
            old.status(),
            old.startedAt(),
            old.finishedAt(),
            null,
            null,
            null);
      }
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Idempotency key reused");
    }
    if (t.definition().isAgent()) credentials.prepare(user, false);
    var run = store.admit(t, runId, "manual");
    if (run == null) throw new ResponseStatusException(HttpStatus.CONFLICT, "Task already running");
    return run;
  }

  public View detail(UUID id) {
    return view(accessible(id, current(), READ, false));
  }

  public TaskStore.Run detail(UUID id, UUID runId) {
    accessible(id, current(), RESULT, false);
    var run = store.run(runId);
    if (run == null || !id.equals(run.taskId())) throw missing();
    return run;
  }

  public History history(UUID id, String cursor, int limit) {
    accessible(id, current(), HISTORY, false);
    if (limit < 1 || limit > 100) throw TaskDefinition.bad("Invalid limit");
    TaskStore.Run after = null;
    if (cursor != null) {
      try {
        after = store.run(UUID.fromString(cursor));
      } catch (IllegalArgumentException e) {
        throw TaskDefinition.bad("Invalid cursor");
      }
      if (after == null || !id.equals(after.taskId())) throw TaskDefinition.bad("Invalid cursor");
    }
    var rows =
        store.history(
            id,
            after == null ? null : after.startedAt(),
            after == null ? null : after.id(),
            limit + 1);
    if (rows.size() <= limit) return new History(rows, null);
    return new History(rows.subList(0, limit), rows.get(limit - 1).id().toString());
  }
}
