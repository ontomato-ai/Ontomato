package io.ontomato.dataengine.schedules;

import static io.ontomato.dataengine.schedules.ScheduleJson.*;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.annotation.PreDestroy;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Slf4j
@Service
public class PlatformScheduler {
  private final TaskStore store;
  private final TransactionTemplate transactions;
  private final ScheduleApplications applications;
  private final TaskCredentials credentials;
  private final ScheduleIdentity identity;
  private final TaskMail mail;
  private final Instant boot = Instant.now();
  private final Set<UUID> active = ConcurrentHashMap.newKeySet();
  private final ExecutorService workers = Executors.newFixedThreadPool(4);
  private final ExecutorService settlements = Executors.newSingleThreadExecutor();
  private final java.util.concurrent.atomic.AtomicBoolean settling =
      new java.util.concurrent.atomic.AtomicBoolean();
  private Instant nextSettlement = Instant.MIN;

  public PlatformScheduler(
      TaskStore store,
      TransactionTemplate transactions,
      ScheduleApplications applications,
      TaskCredentials credentials,
      ScheduleIdentity identity,
      TaskMail mail) {
    this.store = store;
    this.transactions = transactions;
    this.applications = applications;
    this.credentials = credentials;
    this.identity = identity;
    this.mail = mail;
  }

  @PreDestroy
  void stop() {
    workers.shutdown();
    settlements.shutdown();
  }

  @Scheduled(fixedDelay = 1000)
  public void tick() {
    Instant now = Instant.now();
    transactions.executeWithoutResult(
        tx -> {
          var ids =
              store
                  .jdbc()
                  .queryForList(
                      "SELECT id FROM platform_task WHERE enabled AND pause_code IS NULL AND"
                          + " next_run_at<=? ORDER BY next_run_at,id LIMIT 100 FOR UPDATE SKIP"
                          + " LOCKED",
                      UUID.class,
                      TaskStore.timestamp(now));
          for (UUID id : ids) {
            var task = store.get(id, false);
            var slot = task.nextRunAt();
            store
                .jdbc()
                .update(
                    "UPDATE platform_task SET next_run_at=? WHERE id=?",
                    TaskStore.timestamp(task.definition().next(slot, now)),
                    id);
            if ("cron".equals(task.definition().frequency().path("kind").asText())
                && slot.isBefore(boot)) continue;
            if (store.admit(task, UUID.randomUUID(), "schedule", slot) == null)
              store.skipped(task, slot);
          }
        });
    for (UUID id :
        store
            .jdbc()
            .queryForList(
                "SELECT id FROM platform_task_run WHERE status='running' AND dispatched_at IS NULL"
                    + " ORDER BY started_at,id LIMIT 100",
                UUID.class)) {
      if (!active.add(id)) continue;
      workers.execute(
          () -> {
            try {
              dispatch(id);
            } catch (Exception error) {
              log.error("Schedule dispatch failed for {}", id, error);
            } finally {
              active.remove(id);
            }
          });
    }
    if (!now.isBefore(nextSettlement) && settling.compareAndSet(false, true)) {
      nextSettlement = now.plusSeconds(30);
      settlements.execute(
          () -> {
            try {
              settle(now);
            } finally {
              settling.set(false);
            }
          });
    }
  }

  void dispatch(UUID id) {
    var run = store.run(id);
    if (run == null || !"running".equals(run.status())) return;
    if (store
            .jdbc()
            .update(
                "UPDATE platform_task_run SET dispatched_at=now(),deadline=now()+interval '11"
                    + " minutes' WHERE id=? AND status='running' AND dispatched_at IS NULL",
                id)
        == 0) return;
    String dispatchedKey = null;
    try {
      var provider = applications.require(run.snapshot().definition().appId());
      var execution = run.execution();
      var user = identity.creator(execution.domainId(), execution.creatorId());
      if (user == null || !user.isEnable()) {
        failure(
            run, "creator_unavailable", "Task creator is no longer an active domain member", true);
        return;
      }
      String key =
          provider.remote()
              ? credentials.forOwner(execution.domainId(), execution.creatorId())
              : null;
      dispatchedKey = key;
      var actor =
          new ScheduleApplication.Actor(
              user,
              identity.dataPermission(execution.domainId(), execution.creatorId()),
              null,
              key,
              execution.locale());
      provider.authorize(actor);
      provider.validate(execution.definition(), actor);
      store
          .jdbc()
          .update(
              "UPDATE platform_task_run SET deadline=now()+(? * interval '1 minute') WHERE id=?",
              provider.deadlineMinutes(execution),
              id);
      if (provider.asynchronous()) {
        var state = provider.start(execution, actor);
        apply(run, state);
      } else {
        // A session advisory lock protects recovery while grants commit before the runtime calls
        // back.
        // Holding a row transaction across the program would hide its newly signed grants from HTTP
        // callbacks.
        try (var connection = store.jdbc().getDataSource().getConnection()) {
          try (var statement =
              connection.prepareStatement("SELECT pg_advisory_lock(hashtextextended(?,2))")) {
            statement.setString(1, id.toString());
            statement.execute();
          }
          try {
            apply(run, provider.start(execution, actor));
          } finally {
            try (var statement =
                connection.prepareStatement("SELECT pg_advisory_unlock(hashtextextended(?,2))")) {
              statement.setString(1, id.toString());
              statement.execute();
            }
          }
        }
      }
    } catch (TaskCredentials.Invalid invalid) {
      failure(run, "credential_invalid", "The creator's background credential is invalid", true);
    } catch (ScheduleException error) {
      switch (error.code) {
        case "PERMISSION_DENIED" -> failure(run, "permission_denied", error.getReason(), true);
        case "UNAUTHENTICATED", "INTERACTIVE_LOGIN_REQUIRED" -> {
          credentials.invalidate(
              run.snapshot().domainId(), run.snapshot().creatorId(), dispatchedKey);
          failure(run, "credential_invalid", "Background credential rejected", true);
        }
        case "APPLICATION_NOT_FOUND" ->
            failure(run, "application_unavailable", error.getReason(), true);
        case "TARGET_UNAVAILABLE", "FIELD_VALIDATION_FAILED" ->
            failure(run, "target_unavailable", error.getReason(), true);
        case "FORM_CHANGED" -> failure(run, "definition_changed", error.getReason(), true);
        default -> {
          if (error.getStatusCode().value() < 500)
            failure(run, "start_failed", error.getReason(), false);
        }
      }
    } catch (io.ontomato.dataengine.service.agent.AgentHttpException error) {
      if (error.status() == 403) failure(run, "permission_denied", error.getMessage(), true);
      else if (error.status() == 401)
        failure(run, "creator_unavailable", "Task creator is unavailable", true);
      else if (error.status() < 500) failure(run, "start_failed", error.getMessage(), false);
    } catch (org.springframework.web.server.ResponseStatusException denied) {
      if (denied.getStatusCode().value() == 403)
        failure(run, "permission_denied", denied.getReason(), true);
      else if (denied.getStatusCode().value() == 401)
        failure(run, "creator_unavailable", "Task creator is unavailable", true);
      else failure(run, "dependency_unavailable", "The application is unavailable", false);
    } catch (org.springframework.web.client.ResourceAccessException unavailable) {
      log.warn("Schedule admission response unavailable for {}", id);
    } catch (Exception error) {
      failure(run, "dependency_unavailable", "The application is unavailable", false);
    }
  }

  void settle(Instant now) {
    var ids =
        store
            .jdbc()
            .queryForList(
                "SELECT id FROM platform_task_run WHERE status='running' AND dispatched_at IS NOT"
                    + " NULL ORDER BY started_at,id",
                UUID.class);
    for (UUID id : ids)
      try {
        settleOne(id, now);
      } catch (Exception unavailable) {
        log.warn(
            "Schedule status unavailable for {}: {}", id, unavailable.getClass().getSimpleName());
      }
  }

  private void settleOne(UUID id, Instant now) {
    var run = store.run(id);
    if (run == null || !"running".equals(run.status())) return;
    ScheduleApplication provider;
    try {
      provider = applications.require(run.snapshot().definition().appId());
    } catch (ScheduleException missing) {
      if ("APPLICATION_NOT_FOUND".equals(missing.code)) {
        failure(run, "application_unavailable", "Scheduled application no longer installed", true);
        return;
      }
      throw missing;
    }
    boolean expired = run.deadline() != null && !now.isBefore(run.deadline());
    if (!provider.asynchronous()) {
      if (expired && !active.contains(id))
        transactions.executeWithoutResult(
            tx -> {
              if (Boolean.TRUE.equals(
                  store
                      .jdbc()
                      .queryForObject(
                          "SELECT pg_try_advisory_xact_lock(hashtextextended(?,2))",
                          Boolean.class,
                          id.toString())))
                failure(
                    run,
                    "interrupted",
                    "Write outcome unknown; check the result before retrying",
                    false);
            });
      return;
    }
    try {
      apply(run, provider.status(run.execution(), run.handle()));
    } catch (ScheduleException error) {
      if ((error.getStatusCode().value() == 404 || error.getStatusCode().value() == 410) && expired)
        failure(run, "interrupted", "Application execution not found; no automatic replay", false);
      else throw error;
    } catch (io.ontomato.dataengine.service.agent.AgentHttpException error) {
      if ((error.status() == 404 || error.status() == 410) && expired)
        failure(run, "interrupted", "Application execution not found", false);
      else throw error;
    }
  }

  private void failure(TaskStore.Run run, String code, String message, boolean pause) {
    var state = ScheduleForms.execution("failed");
    state.set("error", object("code", code, "message", message));
    if (pause) state.set("pause", object("code", code, "message", message));
    apply(run, state);
  }

  private void apply(TaskStore.Run run, JsonNode state) {
    String status = state.path("status").asText();
    if (!Set.of("running", "completed", "failed", "skipped").contains(status))
      throw new IllegalStateException("Invalid application execution state");
    transactions.executeWithoutResult(
        tx -> {
          if ("running".equals(status)) {
            store
                .jdbc()
                .update(
                    "UPDATE platform_task_run SET handle=?::jsonb,result_link=?::jsonb WHERE id=?"
                        + " AND status='running'",
                    jsonValue(state.get("handle")),
                    jsonValue(state.get("resultLink")),
                    run.id());
            return;
          }
          int count =
              store
                  .jdbc()
                  .update(
                      """
UPDATE platform_task_run SET status=?,handle=coalesce(?::jsonb,handle),result_link=coalesce(?::jsonb,result_link),
result_summary=?,result=?,execution_details=?::jsonb,spend_time=?,error_code=?,error_message=?,finished_at=now()
WHERE id=? AND status='running'
""",
                      status,
                      jsonValue(state.get("handle")),
                      jsonValue(state.get("resultLink")),
                      state.path("resultSummary").asText(null),
                      state.path("result").asText(null),
                      jsonValue(state.get("executionDetails")),
                      state.path("spendTime").isNumber()
                          ? state.path("spendTime").longValue()
                          : null,
                      state.path("error").path("code").asText(null),
                      state.path("error").path("message").asText(null),
                      run.id());
          if (count != 1) return;
          var pause = state.get("pause");
          if (pause != null && !pause.isNull())
            store
                .jdbc()
                .update(
                    """
UPDATE platform_task SET pause_code=?,pause_message=?,next_run_at=NULL,revision=revision+1,updated_at=now()
WHERE id=? AND revision=? AND enabled AND
(? <> 'credential_invalid' OR NOT EXISTS(SELECT FROM platform_task_credential WHERE domain_id=platform_task.domain_id AND creator_id=platform_task.creator_id AND valid))
""",
                    pause.path("code").asText(),
                    pause.path("message").asText(),
                    run.taskId(),
                    run.snapshot().taskRevision(),
                    pause.path("code").asText());
          if (!"skipped".equals(status) && run.snapshot().definition().notifyEmail() != null)
            org.springframework.transaction.support.TransactionSynchronizationManager
                .registerSynchronization(
                    new org.springframework.transaction.support.TransactionSynchronization() {
                      @Override
                      public void afterCommit() {
                        mail.send(
                            run,
                            state.path("result").asText(null),
                            state.path("error").isObject()
                                ? new TaskStore.Failure(
                                    state.path("error").path("code").asText(),
                                    state.path("error").path("message").asText(null))
                                : null);
                      }
                    });
        });
  }

  private static String jsonValue(JsonNode value) {
    return value == null || value.isNull() ? null : value.toString();
  }
}
