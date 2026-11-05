package io.ontomato.dataengine.schedules;

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
import org.springframework.web.client.RestClientResponseException;

@Slf4j
@Service
public class PlatformScheduler {
  private final TaskStore store;
  private final TransactionTemplate transactions;
  private final AgentHost agents;
  private final FunctionTarget functions;
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
      AgentHost agents,
      FunctionTarget functions,
      TaskCredentials credentials,
      ScheduleIdentity identity,
      TaskMail mail) {
    this.store = store;
    this.transactions = transactions;
    this.agents = agents;
    this.functions = functions;
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
    var now = Instant.now();
    transactions.executeWithoutResult(
        tx -> {
          var ids =
              store.db.queryForList(
                  """
SELECT id FROM platform_task WHERE enabled AND paused_reason IS NULL AND next_run_at<=?
ORDER BY next_run_at,id LIMIT 100 FOR UPDATE SKIP LOCKED""",
                  UUID.class,
                  TaskStore.timestamp(now));
          for (var id : ids) {
            var t = store.get(id, false);
            var next = t.definition().next(t.nextRunAt(), now);
            store.db.update(
                "UPDATE platform_task SET next_run_at=? WHERE id=?", TaskStore.timestamp(next), id);
            boolean expiredCron =
                "cron".equals(t.definition().frequency().path("kind").asText())
                    && t.nextRunAt().isBefore(boot);
            if (!expiredCron) store.admit(t, UUID.randomUUID(), "schedule");
          }
        });
    // Queue admission and execution are separately durable. Both manual and scheduled runs enter
    // here.
    for (var id :
        store.db.queryForList(
            "SELECT id FROM platform_task_run WHERE status='running' AND dispatched_at IS NULL"
                + " ORDER BY started_at,id LIMIT 100",
            UUID.class)) submit(id);
    if (!now.isBefore(nextSettlement) && settling.compareAndSet(false, true)) {
      nextSettlement = now.plusSeconds(30);
      settlements.execute(
          () -> {
            try {
              settle(now);
            } catch (RuntimeException e) {
              log.error("Task settlement failed", e);
            } finally {
              settling.set(false);
            }
          });
    }
  }

  private void submit(UUID id) {
    if (!active.add(id)) return;
    workers.execute(
        () -> {
          try {
            dispatch(id);
          } catch (Exception e) {
            log.error("Task dispatch failed for {}", id, e);
          } finally {
            active.remove(id);
          }
        });
  }

  void dispatch(UUID id) {
    var run = store.run(id);
    if (run == null || !"running".equals(run.status())) return;
    var t = store.get(run.taskId(), false);
    if (t == null) return;
    boolean agent = "agent".equals(run.target().path("kind").asText());
    // A dispatched write is never submitted again. On a lost response only its outcome is
    // uncertain.
    if (store.db.update(
            """
            UPDATE platform_task_run SET dispatched_at=now(),deadline=now()+interval '10 minutes'
            WHERE id=? AND status='running' AND dispatched_at IS NULL""",
            id)
        == 0) return;
    try {
      if (agent) {
        String key = credentials.forOwner(t.domain(), t.owner());
        transactions.executeWithoutResult(
            tx -> {
              // Account deletion takes this same task row before publishing its Node cleanup event.
              if (store.get(t.id(), true) == null) return;
              agents.start(t, run, key);
              store.acknowledgeSession(run);
            });
      } else {
        int timeout = functions.timeout(t.domain());
        store.db.update(
            "UPDATE platform_task_run SET deadline=now()+(? * interval '1 minute') WHERE id=?",
            Math.max(timeout, 1) + 1,
            id);
        transactions.executeWithoutResult(
            tx -> {
              // This row lock lives exactly as long as execution. Recovery skips a live write on
              // any instance.
              if (store
                  .db
                  .queryForList(
                      "SELECT id FROM platform_task_run WHERE id=? AND status='running' FOR UPDATE",
                      UUID.class,
                      id)
                  .isEmpty()) return;
              try {
                var result = functions.execute(t, run, timeout);
                finish(
                    t,
                    run,
                    result.getResult(),
                    result.getSpendTime(),
                    result.getError() == null
                        ? null
                        : new TaskStore.Failure("run_failed", result.getError()),
                    null);
              } catch (Exception e) {
                finish(
                    t, run, null, null, new TaskStore.Failure("run_failed", e.getMessage()), null);
              }
            });
      }
    } catch (TaskCredentials.Invalid e) {
      finish(
          t,
          run,
          null,
          null,
          new TaskStore.Failure("credential_invalid", ""),
          "credential_invalid");
    } catch (RestClientResponseException e) {
      if (e.getStatusCode().value() == 401 || e.getStatusCode().value() == 403) {
        // The key may have rotated between local verification and host admission.
        try {
          credentials.forOwner(t.domain(), t.owner());
        } catch (TaskCredentials.Invalid invalid) {
          finish(
              t,
              run,
              null,
              null,
              new TaskStore.Failure("credential_invalid", ""),
              "credential_invalid");
          return;
        } catch (RuntimeException unavailable) {
          finish(
              t,
              run,
              null,
              null,
              new TaskStore.Failure("dependency_unavailable", "Identity unavailable"),
              null);
          return;
        }
      }
      if (e.getStatusCode().value() == 409
          && (e.getResponseBodyAsString().contains("AGENT_UNAVAILABLE")
              || e.getResponseBodyAsString().contains("AGENT_DISABLED")))
        finish(
            t,
            run,
            null,
            null,
            new TaskStore.Failure("agent_unavailable", "Agent disabled or missing"),
            "agent_unavailable");
      else if (e.getStatusCode().is4xxClientError())
        finish(t, run, null, null, new TaskStore.Failure("start_failed", e.getStatusText()), null);
      // The host may already have accepted this run. The scanner resolves the same run ID.
    } catch (org.springframework.web.client.ResourceAccessException e) {
      log.warn("Host admission response unavailable for {}", id);
    } catch (Exception e) {
      finish(
          t,
          run,
          null,
          null,
          new TaskStore.Failure(agent ? "dependency_unavailable" : "run_failed", e.getMessage()),
          null);
    }
  }

  void settle(Instant now) {
    // Visit every outstanding record; long-running turns cannot starve later rows.
    var ids =
        store.db.queryForList(
            "SELECT id FROM platform_task_run WHERE status='running' AND dispatched_at IS NOT NULL"
                + " ORDER BY started_at,id",
            UUID.class);
    for (UUID id : ids) {
      try {
        settleOne(id, now);
      } catch (Exception e) {
        log.warn("Task status unavailable for {}: {}", id, e.toString());
      }
    }
  }

  private void settleOne(UUID id, Instant now) {
    var run = store.run(id);
    if (run == null || !"running".equals(run.status())) return;
    var t = store.get(run.taskId(), false);
    if (t == null) return;
    boolean expired =
        Boolean.TRUE.equals(
            store.db.queryForObject(
                "SELECT EXISTS(SELECT FROM platform_task_run WHERE id=? AND deadline<=?)",
                Boolean.class,
                id,
                TaskStore.timestamp(now)));
    if (!"agent".equals(run.target().path("kind").asText())) {
      if (expired && !active.contains(id))
        transactions.executeWithoutResult(
            tx -> {
              if (!store
                  .db
                  .queryForList(
                      "SELECT id FROM platform_task_run WHERE id=? AND status='running' FOR UPDATE"
                          + " SKIP LOCKED",
                      UUID.class,
                      id)
                  .isEmpty())
                finish(
                    t,
                    run,
                    null,
                    null,
                    new TaskStore.Failure(
                        "interrupted", "Function outcome unknown; check before retrying"),
                    null);
            });
      return;
    }
    try {
      var result = agents.status(t, run, identity.hostOwner(t.owner()));
      store.acknowledgeSession(run);
      switch (result.path("status").asText()) {
        case "running" -> {}
        case "completed" -> finish(t, run, result.path("answer").asText(""), null, null, null);
        case "failed", "cancelled" ->
            finish(
                t,
                run,
                null,
                null,
                new TaskStore.Failure("run_failed", result.path("error").asText()),
                null);
        default -> throw new IllegalStateException("Unknown agent status");
      }
    } catch (RestClientResponseException e) {
      boolean missing = e.getStatusCode().value() == 404 || e.getStatusCode().value() == 410;
      if (missing && expired)
        finish(
            t, run, null, null, new TaskStore.Failure("interrupted", "Agent run not found"), null);
      else if (!missing) throw e;
    }
  }

  private void finish(
      TaskStore.Task t,
      TaskStore.Run run,
      String result,
      Long spent,
      TaskStore.Failure error,
      String pause) {
    transactions.executeWithoutResult(
        tx -> {
          int count =
              store.db.update(
                  """
UPDATE platform_task_run SET status=?,result=?,spend_time=?,error_code=?,error_message=?,finished_at=now()
WHERE id=? AND status='running'""",
                  error == null ? "completed" : "failed",
                  result,
                  spent,
                  error == null ? null : error.code(),
                  error == null ? null : error.message(),
                  run.id());
          if (count == 1 && pause != null) {
            // A renewal or target edit may already have corrected the cause of this run's failure.
            store.db.update(
                """
UPDATE platform_task SET paused_reason=?,next_run_at=NULL WHERE id=? AND enabled AND target=?::jsonb
AND (? <> 'credential_invalid' OR NOT EXISTS (SELECT FROM platform_task_credential
WHERE domain_id=platform_task.domain_id AND owner_id=platform_task.owner_id AND valid))""",
                pause,
                t.id(),
                run.target().toString(),
                pause);
          }
          if (count == 1 && t.definition().notifyEmail() != null)
            org.springframework.transaction.support.TransactionSynchronizationManager
                .registerSynchronization(
                    new org.springframework.transaction.support.TransactionSynchronization() {
                      @Override
                      public void afterCommit() {
                        mail.send(t, run, result, error);
                      }
                    });
        });
  }
}
