package io.ontomato.dataengine.logging;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.zaxxer.hikari.HikariDataSource;
import io.ontomato.dataengine.core.db.jdbc.JdbcProps;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.core.*;
import org.apache.logging.log4j.core.appender.AbstractAppender;
import org.apache.logging.log4j.core.appender.AsyncAppender;
import org.apache.logging.log4j.core.appender.db.ColumnMapping;
import org.apache.logging.log4j.core.appender.db.jdbc.AbstractConnectionSource;
import org.apache.logging.log4j.core.appender.db.jdbc.JdbcAppender;
import org.apache.logging.log4j.core.appender.rewrite.RewriteAppender;
import org.apache.logging.log4j.core.config.AppenderRef;
import org.apache.logging.log4j.core.config.Property;
import org.apache.logging.log4j.core.filter.AbstractFilter;
import org.apache.logging.log4j.core.layout.MessageLayout;
import org.springframework.stereotype.Component;

/** Owns only ontology service logs. The existing audit_log is deliberately unrelated. */
@Component
public final class ServiceLogStore {
  private static final JSONObject POLICY = ServiceLogFormat.DEFAULTS.getJSONObject("postgres");
  private static final Map<String, String> FILTERS = Map.of("correlationId", "correlation_id", "runId", "run_id", "sessionId", "session_id", "domainId", "domain_id", "userId", "user_id", "instanceId", "instance_id", "module", "module");
  private final HikariDataSource pool = new HikariDataSource();
  private final ScheduledExecutorService maintenance = Executors.newSingleThreadScheduledExecutor(r -> { Thread t = new Thread(r, "service-log-maintenance"); t.setDaemon(true); return t; });
  private final AtomicLong lastWarning = new AtomicLong();
  private volatile boolean ready;
  private volatile boolean closed;
  private String table;
  private AsyncAppender async;
  private JdbcAppender jdbc;
  private AbstractAppender dropped;
  private ScheduledFuture<?> retry;

  public ServiceLogStore(JdbcProps props) {
    pool.setJdbcUrl(props.getUrl()); pool.setUsername(props.getUsername()); pool.setPassword(props.getPassword());
    pool.setDriverClassName(props.getDriverClassName()); pool.setMaximumPoolSize(1); pool.setMinimumIdle(0);
    pool.setConnectionTimeout(1000); pool.setValidationTimeout(1000); pool.setInitializationFailTimeout(-1);
    pool.setConnectionInitSql("SET statement_timeout=2000");
    pool.addDataSourceProperty("connectTimeout", "1"); pool.addDataSourceProperty("socketTimeout", "2");
    pool.setPoolName("ontology-service-log");
  }
  @PostConstruct public void start() {
    retry = maintenance.scheduleWithFixedDelay(this::initialize, 0, POLICY.getLongValue("reconnectIntervalMs"), TimeUnit.MILLISECONDS);
    maintenance.scheduleWithFixedDelay(this::cleanup, POLICY.getLongValue("cleanupIntervalMs"), POLICY.getLongValue("cleanupIntervalMs"), TimeUnit.MILLISECONDS);
  }
  private void initialize() {
    if (ready || closed) return;
    try (Connection connection = pool.getConnection(); Statement statement = connection.createStatement()) {
      String schema = connection.getSchema();
      table = quoteIdentifier(schema == null ? "public" : schema) + "." + quoteIdentifier(ServiceLogFormat.DEFINITION.getJSONObject("tables").getString("ontology"));
      statement.execute("CREATE TABLE IF NOT EXISTS " + table + " (id uuid PRIMARY KEY,time timestamptz NOT NULL,level varchar(5) NOT NULL,module text NOT NULL,instance_id text,correlation_id text,domain_id text,user_id text,run_id text,session_id text,line text NOT NULL CHECK(octet_length(line)<" + ServiceLogFormat.DEFINITION.getJSONObject("limits").getIntValue("lineBytesIncludingLf") + "))");
      for (String field : List.of("time", "correlation_id", "run_id", "session_id", "level"))
        statement.execute("CREATE INDEX IF NOT EXISTS ontology_service_log_" + field + " ON " + table + " (" + (field.equals("time") ? "time,id" : field + ",time,id") + ")");
    } catch (Exception error) { warn("Service log table is unavailable; stdout and file logging continue"); return; }
    try { installSink(); ready = true; cleanup(); }
    catch (RuntimeException error) { warn("Service log PG appender could not be installed"); }
  }
  private static String quoteIdentifier(String name) { return "\"" + name.replace("\"", "\"\"") + "\""; }
  private void warn(String message) {
    long now = System.currentTimeMillis(), previous = lastWarning.get();
    if (now - previous >= 60000 && lastWarning.compareAndSet(previous, now)) ServiceLogEvents.localWarning(message);
  }
  private void installSink() {
    LoggerContext context = (LoggerContext) LogManager.getContext(false);
    var configuration = context.getConfiguration();
    if (configuration.getAppender("ServiceEvents") == null) throw new IllegalStateException("Common logging configuration is required");
    var builder = JdbcAppender.newBuilder();
    builder.setName("ServiceJdbc"); builder.setConfiguration(configuration); builder.setIgnoreExceptions(true);
    builder.setTableName(table); builder.setBufferSize(POLICY.getIntValue("batchRows"));
    builder.setImmediateFail(true); builder.setReconnectIntervalMillis(POLICY.getLongValue("reconnectIntervalMs"));
    builder.setLayout(new MessageLayout());
    builder.setConnectionSource(new AbstractConnectionSource() {
      @Override public Connection getConnection() throws SQLException { return pool.getConnection(); }
      @Override public String toString() { return "Ontology service log connection"; }
    });
    String[][] columns = {{"id", "id"}, {"time", "time"}, {"level", "level"}, {"module", "module"}, {"instance_id", "instanceId"}, {"correlation_id", "correlationId"}, {"domain_id", "domainId"}, {"user_id", "userId"}, {"run_id", "runId"}, {"session_id", "sessionId"}, {"line", "line"}};
    builder.setColumnMappings(Arrays.stream(columns).map(pair -> ColumnMapping.newBuilder()
      .setName(pair[0]).setSource(pair[1]).setParameter(pair[0].equals("id") ? "?::uuid" : pair[0].equals("time") ? "?::timestamptz" : "?").build()).toArray(ColumnMapping[]::new));
    jdbc = builder.build();
    jdbc.setHandler(new ErrorHandler() {
      @Override public void error(String message) { failed(); }
      @Override public void error(String message, Throwable error) { failed(); }
      @Override public void error(String message, LogEvent event, Throwable error) { failed(); }
      private void failed() { warn("PG log batch failed; up to " + POLICY.getIntValue("batchRows") + " records may be missing; stdout and file logging continue"); }
    });
    jdbc.start(); configuration.addAppender(jdbc);
    AtomicLong lost = new AtomicLong();
    dropped = new AbstractAppender("ServiceLogDropped", null, null, true, Property.EMPTY_ARRAY) {
      @Override public void append(LogEvent event) { warn("PG log queue dropped " + lost.incrementAndGet() + " records; stdout and file logging continue"); }
    };
    dropped.start(); configuration.addAppender(dropped);
    var asyncBuilder = AsyncAppender.newBuilder().setName("ServicePgAsync").setConfiguration(configuration)
      .setAppenderRefs(new AppenderRef[]{AppenderRef.createAppenderRef(jdbc.getName(), null, null)})
      .setErrorRef(dropped.getName()).setBlocking(false).setBufferSize(POLICY.getIntValue("queueRecords"))
      .setShutdownTimeout(POLICY.getLongValue("shutdownTimeoutMs")).setIgnoreExceptions(true);
    asyncBuilder.setFilter(new AbstractFilter() {
        @Override public Result filter(LogEvent event) { return event.getMarker() != null && event.getMarker().isInstanceOf("LOGGING_LOCAL") ? Result.DENY : Result.NEUTRAL; }
      });
    async = asyncBuilder.build();
    async.start(); configuration.addAppender(async);
    AppenderRef[] refs = {AppenderRef.createAppenderRef("ServiceConsole", null, null), AppenderRef.createAppenderRef("ServiceFile", null, null), AppenderRef.createAppenderRef(async.getName(), null, null)};
    RewriteAppender rewrite = RewriteAppender.createAppender("ServiceEvents", "true", refs, configuration, ServiceLogPolicy.create(), null);
    rewrite.start();
    configuration.getRootLogger().removeAppender("ServiceEvents");
    configuration.addAppender(rewrite); configuration.getRootLogger().addAppender(rewrite, null, null); context.updateLoggers();
  }
  public Map<String, Object> query(Map<String, String> input) {
    Map<String, String> query = new HashMap<>(input);
    String from, to; int limit; JSONObject cursor = null;
    try {
      Set<String> allowed = new HashSet<>(FILTERS.keySet()); allowed.addAll(List.of("minLevel", "from", "to", "limit", "cursor"));
      if (!allowed.containsAll(query.keySet())) throw new IllegalArgumentException();
      if (query.containsKey("cursor")) {
        if (query.get("cursor").length() > 2048) throw new IllegalArgumentException();
        cursor = JSON.parseObject(new String(Base64.getUrlDecoder().decode(query.get("cursor")), StandardCharsets.UTF_8));
        if (!cursor.keySet().equals(Set.of("time", "id", "from", "to"))) throw new IllegalArgumentException();
        UUID.fromString(cursor.getString("id")); Instant.parse(cursor.getString("time"));
      }
      to = query.getOrDefault("to", cursor == null ? ServiceLogFormat.time(System.currentTimeMillis()) : cursor.getString("to"));
      from = query.getOrDefault("from", cursor == null ? ServiceLogFormat.time(Instant.parse(to).toEpochMilli() - ServiceLogFormat.DEFAULTS.getJSONObject("query").getLongValue("defaultWindowMs")) : cursor.getString("from"));
      if (!Instant.parse(from).isBefore(Instant.parse(to)) || (cursor != null && (!from.equals(cursor.getString("from")) || !to.equals(cursor.getString("to"))))) throw new IllegalArgumentException();
      for (String timestamp : List.of(from, to)) if (!ServiceLogFormat.time(Instant.parse(timestamp).toEpochMilli()).equals(timestamp)) throw new IllegalArgumentException();
      if (cursor != null && (Instant.parse(cursor.getString("time")).isBefore(Instant.parse(from)) || !Instant.parse(cursor.getString("time")).isBefore(Instant.parse(to)))) throw new IllegalArgumentException();
      if (query.containsKey("limit") && !query.get("limit").matches("[0-9]+")) throw new IllegalArgumentException();
      limit = Integer.parseInt(query.getOrDefault("limit", ServiceLogFormat.DEFAULTS.getJSONObject("query").getString("defaultLimit")));
      if (limit < 1 || limit > ServiceLogFormat.DEFAULTS.getJSONObject("query").getIntValue("maxLimit")) throw new IllegalArgumentException();
      for (String field : FILTERS.keySet()) if (query.containsKey(field) && (query.get(field).isEmpty() || ServiceLogFormat.bytes(ServiceLogFormat.quote(query.get(field))) > ServiceLogFormat.DEFINITION.getJSONObject("limits").getIntValue("encodedIdentityBytes"))) throw new IllegalArgumentException();
      if (query.containsKey("minLevel") && !ServiceLogFormat.fields("levels").contains(query.get("minLevel"))) throw new IllegalArgumentException();
    } catch (RuntimeException error) { throw new QueryException(400, "INVALID_LOG_QUERY", "Invalid log query"); }
    if (!ready || closed) throw new QueryException(503, "LOG_STORE_UNAVAILABLE", "Service log store is unavailable");
    List<Object> values = new ArrayList<>(List.of(Timestamp.from(Instant.parse(from)), Timestamp.from(Instant.parse(to))));
    StringBuilder where = new StringBuilder("time>=? AND time<?");
    FILTERS.forEach((key, column) -> { if (query.containsKey(key)) { where.append(" AND ").append(column).append("=?"); values.add(query.get(key)); } });
    if (query.containsKey("minLevel")) {
      List<String> levels = ServiceLogFormat.fields("levels");
      List<String> wanted = levels.subList(levels.indexOf(query.get("minLevel")), levels.size());
      where.append(" AND level IN (").append(String.join(",", Collections.nCopies(wanted.size(), "?"))).append(")"); values.addAll(wanted);
    }
    if (cursor != null) { where.append(" AND (time,id)>(?,?)"); values.add(Timestamp.from(Instant.parse(cursor.getString("time")))); values.add(UUID.fromString(cursor.getString("id"))); }
    values.add(limit + 1);
    try (Connection connection = pool.getConnection(); PreparedStatement statement = connection.prepareStatement("SELECT * FROM " + table + " WHERE " + where + " ORDER BY time,id LIMIT ?")) {
      for (int i = 0; i < values.size(); i++) statement.setObject(i + 1, values.get(i));
      List<Map<String, Object>> records = new ArrayList<>();
      try (ResultSet rows = statement.executeQuery()) {
        while (rows.next()) {
          Map<String, Object> row = new LinkedHashMap<>();
          row.put("id", rows.getString("id")); row.put("time", ServiceLogFormat.time(rows.getTimestamp("time").getTime()));
          row.put("level", rows.getString("level")); row.put("module", rows.getString("module")); row.put("line", rows.getString("line"));
          row.put("instanceId", rows.getString("instance_id")); row.put("correlationId", rows.getString("correlation_id")); row.put("domainId", rows.getString("domain_id"));
          row.put("userId", rows.getString("user_id")); row.put("runId", rows.getString("run_id")); row.put("sessionId", rows.getString("session_id")); records.add(row);
        }
      }
      String next = null;
      if (records.size() > limit) {
        records.remove(records.size() - 1); Map<String, Object> last = records.getLast();
        next = Base64.getUrlEncoder().withoutPadding().encodeToString(JSON.toJSONBytes(Map.of("time", last.get("time"), "id", last.get("id"), "from", from, "to", to)));
      }
      Map<String, Object> page = new LinkedHashMap<>();
      page.put("service", "ontology"); page.put("window", Map.of("from", from, "to", to)); page.put("records", records); page.put("nextCursor", next);
      page.put("storage", Map.of("mode", "best-effort", "retentionDays", POLICY.getIntValue("retentionDays"))); return page;
    } catch (SQLException error) {
      String state = error.getSQLState(); boolean unavailable = state == null || state.matches("^(08|53|57).*|42P01");
      throw new QueryException(unavailable ? 503 : 500, unavailable ? "LOG_STORE_UNAVAILABLE" : "LOG_QUERY_FAILED", unavailable ? "Service log store is unavailable" : "Service log query failed");
    }
  }
  private void cleanup() {
    if (!ready || closed) return;
    try {
      int removed;
      do {
        try (Connection connection = pool.getConnection()) {
          connection.setAutoCommit(false);
          try (PreparedStatement lock = connection.prepareStatement("SELECT pg_try_advisory_xact_lock(hashtext(?))")) {
            lock.setString(1, table + ":retention");
            try (ResultSet row = lock.executeQuery()) { row.next(); if (!row.getBoolean(1)) { connection.rollback(); return; } }
          }
          try (PreparedStatement delete = connection.prepareStatement("DELETE FROM " + table + " WHERE id IN (SELECT id FROM " + table + " WHERE time<now()-(? * interval '1 day') ORDER BY time,id LIMIT ?)")) {
            delete.setInt(1, POLICY.getIntValue("retentionDays")); delete.setInt(2, POLICY.getIntValue("deleteBatchRows")); removed = delete.executeUpdate();
          }
          connection.commit();
        }
        Thread.yield();
      } while (!closed && removed == POLICY.getIntValue("deleteBatchRows"));
    } catch (SQLException error) { warn("Service log retention cleanup failed; it will retry on the next tick"); }
  }
  @PreDestroy public void close() {
    closed = true; ready = false;
    if (retry != null) retry.cancel(false); maintenance.shutdownNow();
    if (async != null) async.stop(POLICY.getLongValue("shutdownTimeoutMs"), TimeUnit.MILLISECONDS);
    if (jdbc != null) jdbc.stop(POLICY.getLongValue("shutdownTimeoutMs"), TimeUnit.MILLISECONDS);
    if (dropped != null) dropped.stop(); pool.close();
  }
  public static final class QueryException extends RuntimeException {
    public final int status; public final String code;
    public QueryException(int status, String code, String message) { super(message); this.status = status; this.code = code; }
  }
}
