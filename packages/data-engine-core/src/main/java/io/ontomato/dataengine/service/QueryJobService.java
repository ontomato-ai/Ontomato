package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.*;
import org.springframework.context.annotation.DependsOn;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/** Durable admission/status for final executions and legacy asynchronous checks. */
@Service
@DependsOn("jdbcInitDb")
public class QueryJobService {
  private final JdbcTemplate jdbc;
  private final SessionRegistryService sessions;
  private final RuntimeCodeClient runtime;
  private final ExecutorService executor = Executors.newCachedThreadPool();

  private record Job(String id, User user) {}

  private final ThreadLocal<Job> currentJob = new ThreadLocal<>();
  private final org.springframework.transaction.support.TransactionTemplate transactions;
  private final ConcurrentMap<String, Future<?>> running = new ConcurrentHashMap<>();

  public QueryJobService(
      JdbcTemplate jdbc,
      SessionRegistryService sessions,
      RuntimeCodeClient runtime,
      org.springframework.transaction.PlatformTransactionManager manager) {
    this.jdbc = jdbc;
    this.sessions = sessions;
    this.runtime = runtime;
    this.transactions = new org.springframework.transaction.support.TransactionTemplate(manager);
  }

  @PostConstruct
  public void initialize() {
    jdbc.execute(
        "CREATE TABLE IF NOT EXISTS ontology_query_jobs (id uuid NOT NULL, domain_id text NOT NULL,"
            + " user_id text NOT NULL, kind text NOT NULL, fingerprint text NOT NULL, state jsonb"
            + " NOT NULL, owner_node text NOT NULL, PRIMARY KEY(domain_id,user_id,id))");
    jdbc.update(
        "UPDATE ontology_query_jobs SET state=state ||"
            + " '{\"status\":\"interrupted\",\"error\":{\"code\":\"JOB_INTERRUPTED\",\"message\":\"Ontology"
            + " service restarted; unknown work was not replayed\"}}'::jsonb WHERE"
            + " state->>'status'='running' AND owner_node=?",
        sessions.getNodeId());
  }

  public JSONObject get(String id, User user, String kind) {
    var values =
        jdbc.query(
            "SELECT state::text FROM ontology_query_jobs WHERE id=? AND domain_id=? AND user_id=?"
                + " AND kind=?",
            (rs, n) -> JSON.parseObject(rs.getString(1)),
            UUID.fromString(id),
            user.getDomainId(),
            user.getId(),
            kind);
    if (values.isEmpty())
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Query job not found");
    return values.get(0);
  }

  @FunctionalInterface
  public interface Operation {
    Object execute(String sessionId) throws Exception;
  }

  private String sessionId(String id, User user) {
    return UUID.nameUUIDFromBytes(
            (user.getDomainId() + "\0" + user.getId() + "\0" + id)
                .getBytes(java.nio.charset.StandardCharsets.UTF_8))
        .toString();
  }

  public JSONObject start(String id, User user, String kind, Object input, Operation operation) {
    String sessionId = sessionId(id, user);
    UUID uuid = UUID.fromString(id);
    String hash = OntologyQueryService.digest(input);
    JSONObject state = JSONObject.of("id", id, "status", "running");
    state.put("result", null);
    state.put("error", null);
    int inserted =
        jdbc.update(
            "INSERT INTO ontology_query_jobs VALUES(?,?,?,?,?,?::jsonb,?) ON CONFLICT DO NOTHING",
            uuid,
            user.getDomainId(),
            user.getId(),
            kind,
            hash,
            JSON.toJSONString(state, com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue),
            sessions.getNodeId());
    if (inserted == 0) {
      Map<String, Object> previous =
          jdbc.queryForMap(
              "SELECT fingerprint,kind FROM ontology_query_jobs WHERE id=? AND domain_id=? AND"
                  + " user_id=?",
              uuid,
              user.getDomainId(),
              user.getId());
      if ("".equals(previous.get("fingerprint")) && kind.equals(previous.get("kind")))
        return get(id, user, kind);
      if (!hash.equals(previous.get("fingerprint")) || !kind.equals(previous.get("kind")))
        throw new ResponseStatusException(HttpStatus.CONFLICT, "Query job input changed");
      return get(id, user, kind);
    }
    JSONObject accepted = new JSONObject(state);
    sessions.registerStart(sessionId);
    FutureTask<Void> task =
        new FutureTask<>(
            () -> {
              try {
                currentJob.set(new Job(id, user));
                Object result =
                    io.ontomato.dataengine.service.agent.OntologyGenerationService.asOwner(
                        user, () -> operation.execute(sessionId));
                state.put("status", "completed");
                state.put("result", result);
              } catch (Exception e) {
                state.put(
                    "status",
                    e instanceof InterruptedException || Thread.currentThread().isInterrupted()
                        ? "cancelled"
                        : "failed");
                state.put(
                    "error",
                    Map.of(
                        "code",
                        "QUERY_JOB_FAILED",
                        "message",
                        e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
              } finally {
                jdbc.update(
                    "UPDATE ontology_query_jobs SET state=?::jsonb WHERE id=? AND domain_id=? AND"
                        + " user_id=? AND state->>'status'='running'",
                    JSON.toJSONString(
                        state, com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue),
                    uuid,
                    user.getDomainId(),
                    user.getId());
                sessions.registerEnd(sessionId);
                running.remove(sessionId);
                currentJob.remove();
              }
              return null;
            });
    running.put(sessionId, task);
    executor.execute(task);
    return accepted;
  }

  /** Shares the job row lock with cancellation; model calls never hold this transaction. */
  public <T> T settle(io.ontomato.dataengine.service.agent.OntologyGenerationService.Work<T> work) {
    Job job = currentJob.get();
    if (job == null) throw new IllegalStateException("A current query job is required");
    return transactions.execute(
        status -> {
          String state =
              jdbc.queryForObject(
                  "SELECT state->>'status' FROM ontology_query_jobs WHERE id=? AND domain_id=? AND"
                      + " user_id=? FOR UPDATE",
                  String.class,
                  UUID.fromString(job.id()),
                  job.user().getDomainId(),
                  job.user().getId());
          if (!"running".equals(state) || Thread.currentThread().isInterrupted())
            throw new SessionCancelledException(job.id());
          try {
            return work.run();
          } catch (RuntimeException e) {
            throw e;
          } catch (Exception e) {
            throw new IllegalStateException(e);
          }
        });
  }

  public JSONObject cancel(String id, User user, String kind) throws Exception {
    JSONObject closed =
        JSONObject.of(
            "id",
            id,
            "status",
            "cancelled",
            "error",
            Map.of("code", "QUERY_JOB_CANCELLED", "message", "Cancelled before admission"));
    closed.put("result", null);
    jdbc.update(
        "INSERT INTO ontology_query_jobs VALUES(?,?,?,?,?,?::jsonb,?) ON CONFLICT DO NOTHING",
        UUID.fromString(id),
        user.getDomainId(),
        user.getId(),
        kind,
        "",
        JSON.toJSONString(closed, com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue),
        sessions.getNodeId());
    JSONObject state = get(id, user, kind);
    if ("running".equals(state.getString("status"))) {
      state.put("status", "cancelled");
      state.put("error", Map.of("code", "QUERY_JOB_CANCELLED", "message", "Cancelled"));
      jdbc.update(
          "UPDATE ontology_query_jobs SET state=?::jsonb WHERE id=? AND domain_id=? AND user_id=?"
              + " AND state->>'status'='running'",
          JSON.toJSONString(state, com.alibaba.fastjson2.JSONWriter.Feature.WriteMapNullValue),
          UUID.fromString(id),
          user.getDomainId(),
          user.getId());
      sessions.markSessionCancelled(sessionId(id, user), System.currentTimeMillis());
      Future<?> task = running.get(sessionId(id, user));
      if (task != null) task.cancel(true);
      if (kind.equals("output")) runtime.closeIntent(user.getDomainId(), sessionId(id, user));
    }
    return get(id, user, kind);
  }

  @PreDestroy
  public void close() {
    executor.shutdownNow();
  }
}
