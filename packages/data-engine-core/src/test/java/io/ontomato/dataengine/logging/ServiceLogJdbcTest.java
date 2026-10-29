package io.ontomato.dataengine.logging;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.PreparedStatement;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Types;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.apache.logging.log4j.Level;
import org.apache.logging.log4j.core.appender.db.jdbc.AbstractConnectionSource;
import org.apache.logging.log4j.core.config.DefaultConfiguration;
import org.apache.logging.log4j.core.impl.Log4jLogEvent;
import org.apache.logging.log4j.message.SimpleMessage;
import org.apache.logging.log4j.message.StringMapMessage;
import org.apache.logging.log4j.util.SortedArrayStringMap;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class ServiceLogJdbcTest {
  private static final List<String> COLUMNS = List.of("id", "time", "level", "module", "instance_id",
    "correlation_id", "domain_id", "user_id", "run_id", "session_id", "line");
  private static final List<String> FIELDS = List.of("id", "time", "level", "module", "instanceId",
    "correlationId", "domainId", "userId", "runId", "sessionId", "line");

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void bufferedWritesBindEveryColumnIncludingMissingContext(boolean endOfBatch) throws Exception {
    RecordingJdbc database = new RecordingJdbc();
    var appender = ServiceLogStore.createJdbcAppender(new DefaultConfiguration(), "ontology_service_log", database);
    int count = endOfBatch ? 2 : ServiceLogFormat.DEFAULTS.getJSONObject("postgres").getIntValue("batchRows");
    List<Map<Integer, Object>> expected = new ArrayList<>();
    appender.start();
    try {
      for (int row = 0; row < count; row++) {
        var context = new SortedArrayStringMap();
        if (row % 2 == 0) {
          for (String field : List.of("correlationId", "domainId", "userId", "runId", "sessionId"))
            context.putValue(field, field + "-" + row);
        }
        var event = ServiceLogPolicy.create().rewrite(Log4jLogEvent.newBuilder()
          .setLoggerName("jdbc.binding").setLevel(Level.WARN).setTimeMillis(1793232000000L + row)
          .setContextData(context).setMessage(new SimpleMessage("diagnostic line\n第二行 " + row)).build());
        var message = (StringMapMessage) event.getMessage();
        Map<Integer, Object> values = new LinkedHashMap<>();
        for (int column = 0; column < FIELDS.size(); column++) values.put(column + 1, message.get(FIELDS.get(column)));
        expected.add(values);
        event.setEndOfBatch(endOfBatch && row == count - 1);
        appender.append(event);
      }
      // Both a full buffer and the async appender's end-of-batch signal must flush all bindings.
      // Explicit SQL NULL entries must also exist, so missing bindings cannot pass as null values.
      assertEquals(expected, database.executedRows);
    } finally {
      appender.stop();
    }
  }

  private static final class RecordingJdbc extends AbstractConnectionSource {
    private final Connection connection = mock(Connection.class);
    private final List<Map<Integer, Object>> executedRows = new ArrayList<>();

    RecordingJdbc() throws SQLException {
      DatabaseMetaData databaseMetaData = mock(DatabaseMetaData.class);
      when(connection.getMetaData()).thenReturn(databaseMetaData);
      when(databaseMetaData.supportsBatchUpdates()).thenReturn(true);
      PreparedStatement insert = mock(PreparedStatement.class);
      PreparedStatement metadataQuery = mock(PreparedStatement.class);
      when(connection.prepareStatement(startsWith("insert into "))).thenReturn(insert);
      when(connection.prepareStatement(startsWith("select "))).thenReturn(metadataQuery);
      ResultSetMetaData columns = mock(ResultSetMetaData.class);
      when(metadataQuery.getMetaData()).thenReturn(columns);
      when(columns.getColumnCount()).thenReturn(COLUMNS.size());
      for (int column = 0; column < COLUMNS.size(); column++) {
        int index = column + 1;
        when(columns.getColumnName(index)).thenReturn(COLUMNS.get(column));
        when(columns.getColumnType(index)).thenReturn(column == 0 ? Types.OTHER : column == 1 ? Types.TIMESTAMP_WITH_TIMEZONE : Types.VARCHAR);
        when(columns.getPrecision(index)).thenReturn(Integer.MAX_VALUE);
      }

      Map<Integer, Object> parameters = new LinkedHashMap<>();
      List<Map<Integer, Object>> batch = new ArrayList<>();
      doAnswer(call -> { parameters.clear(); return null; }).when(insert).clearParameters();
      doAnswer(call -> { parameters.put(call.getArgument(0), call.getArgument(1)); return null; })
        .when(insert).setObject(anyInt(), any());
      doAnswer(call -> { parameters.put(call.getArgument(0), null); return null; })
        .when(insert).setNull(anyInt(), anyInt());
      doAnswer(call -> { batch.add(new LinkedHashMap<>(parameters)); return null; }).when(insert).addBatch();
      when(insert.executeBatch()).thenAnswer(call -> {
        executedRows.addAll(batch);
        int[] counts = new int[batch.size()];
        Arrays.fill(counts, 1);
        batch.clear();
        return counts;
      });
    }

    @Override public Connection getConnection() { return connection; }
    @Override public String toString() { return "Recording service log JDBC connection"; }
  }
}
