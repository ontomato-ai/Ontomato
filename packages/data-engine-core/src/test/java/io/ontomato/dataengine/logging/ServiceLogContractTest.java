package io.ontomato.dataengine.logging;

import static org.junit.jupiter.api.Assertions.*;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

class ServiceLogContractTest {
  @Test void javaUsesTheSameLineAndUtf8TruncationExamplesAsNode() throws Exception {
    JSONObject fixtures;
    try (var input = getClass().getResourceAsStream("/service-logging-fixtures.json")) {
      fixtures = JSON.parseObject(new String(input.readAllBytes(), StandardCharsets.UTF_8));
    }
    for (Object item : fixtures.getJSONArray("lines")) {
      JSONObject example = (JSONObject) item;
      var normalized = ServiceLogFormat.normalize(example.getJSONObject("event"));
      assertEquals(example.getString("line"), ServiceLogFormat.line(normalized) + "\n", example.getString("name"));
    }
    for (Object item : fixtures.getJSONArray("truncation")) {
      JSONObject example = (JSONObject) item;
      String actual = ServiceLogFormat.bound(example.getString("input"), example.getIntValue("fieldLimitBytes"));
      assertEquals(example.getString("encodedValue"), ServiceLogFormat.quote(actual), example.getString("name"));
    }
  }
  @Test void configuredConsoleAndFileContainTheSameSingleLine(@org.junit.jupiter.api.io.TempDir java.nio.file.Path directory) throws Exception {
    String xml = java.nio.file.Files.readString(java.nio.file.Path.of("conf-defaults/log4j2.xml"))
      .replace("${env:ONTOLOGY_LOG_DIR:-./logs}", directory.toString().replace("&", "&amp;").replace("<", "&lt;"));
    var bytes = new java.io.ByteArrayOutputStream();
    var original = System.out;
    var context = new org.apache.logging.log4j.core.LoggerContext("service-log-contract");
    try {
      System.setOut(new java.io.PrintStream(bytes, true, StandardCharsets.UTF_8));
      var source = new org.apache.logging.log4j.core.config.ConfigurationSource(new java.io.ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));
      context.start(new org.apache.logging.log4j.core.config.xml.XmlConfiguration(context, source));
      context.getLogger("contract").error("failure", new IllegalArgumentException("diagnostic\ntext"));
    } finally { context.stop(); System.setOut(original); }
    String console = bytes.toString(StandardCharsets.UTF_8);
    assertEquals(java.nio.file.Files.readString(directory.resolve("ontology.log")), console);
    assertEquals(1, console.chars().filter(c -> c == '\n').count());
    assertTrue(console.contains(" stack="));
  }

  @Test void asynchronousContextIsCapturedAndRestored() throws Exception {
    org.apache.logging.log4j.ThreadContext.clearAll();
    java.util.concurrent.atomic.AtomicReference<String> observed = new java.util.concurrent.atomic.AtomicReference<>();
    Runnable task;
    try (var ignored = ServiceLogContext.open(java.util.Map.of("correlationId", "first-request", "userId", "first-user"))) {
      task = ServiceLogContext.wrap(() -> observed.set(org.apache.logging.log4j.ThreadContext.get("correlationId") + ":" + org.apache.logging.log4j.ThreadContext.get("userId")));
    }
    try (var ignored = ServiceLogContext.open(java.util.Map.of("correlationId", "second-request"))) {
      task.run();
      assertEquals("first-request:first-user", observed.get());
      assertEquals("second-request", org.apache.logging.log4j.ThreadContext.get("correlationId"));
      assertNull(org.apache.logging.log4j.ThreadContext.get("userId"));
    }
    assertNull(org.apache.logging.log4j.ThreadContext.get("correlationId"));
  }

}
