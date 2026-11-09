package io.ontomato.dataengine.service;

import static io.ontomato.dataengine.schedules.ScheduleJson.object;
import static org.junit.jupiter.api.Assertions.*;

import io.ontomato.dataengine.bean.function.Parameter;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The input each context's users already rely on; a change here changes what saved tasks and Action forms mean. */
class ParameterFormsTest {
  private static Parameter parameter(String name, String type) {
    var parameter = new Parameter();
    parameter.setName(name);
    parameter.setType(type);
    return parameter;
  }

  @Test
  void scheduledTextKeepsLinesTaskZoneDatesAndTheActualStart() {
    var parameters =
        List.of(
            parameter("region", Parameter.TYPE_STRING),
            parameter("limit", Parameter.TYPE_NUMBER),
            parameter("cutoff", Parameter.TYPE_TIME),
            parameter("times", Parameter.TYPE_TIME_ARRAY),
            parameter("numbers", Parameter.TYPE_NUMBER_ARRAY));
    Instant start = Instant.parse("2026-02-01T00:00:00Z");
    var zone = ZoneId.of("Asia/Shanghai");
    var parsed =
        ParameterForms.scheduled(
            parameters,
            "parameter:",
            object(
                "parameter:region", " ",
                "parameter:limit", "",
                "parameter:cutoff", "",
                "parameter:times", "2026-11-06\n\n2026-11-07 09:30\n2026-11-08T01:30:00Z",
                "parameter:numbers", "10\n\n20.5"),
            zone,
            start,
            "/content/",
            "en");
    assertEquals(0, parsed.errors().size());
    assertFalse(parsed.values().containsKey("region"));
    assertFalse(parsed.values().containsKey("limit"));
    assertEquals(start.toString(), parsed.values().getString("cutoff"));
    assertEquals(
        List.of("2026-11-05T16:00:00Z", "2026-11-07T01:30:00Z", "2026-11-08T01:30:00Z"),
        parsed.values().get("times"));
    assertEquals(List.of(new BigDecimal("10"), new BigDecimal("20.5")), parsed.values().get("numbers"));

    var invalid =
        ParameterForms.scheduled(
            parameters,
            "parameter:",
            object("parameter:cutoff", "2026-02-30", "parameter:numbers", "1\n[2]"),
            zone,
            start,
            "/content/",
            "en");
    assertEquals(2, invalid.errors().size());
    assertEquals("/content/parameter:cutoff", invalid.errors().get(0).path("field").asText());
    assertEquals("invalid_time", invalid.errors().get(0).path("code").asText());
    assertEquals("invalid_number", invalid.errors().get(1).path("code").asText());
  }

  @Test
  void actionFormsTakeJsonForStructuredValuesAndKeepTextAsTyped() {
    var parameters =
        List.of(
            parameter("note", Parameter.TYPE_STRING),
            parameter("at", Parameter.TYPE_TIME),
            parameter("amount", Parameter.TYPE_NUMBER),
            parameter("tags", Parameter.TYPE_STRING_ARRAY),
            parameter("rows", Parameter.TYPE_DATASET),
            parameter("order", Parameter.TYPE_ONTOOBJ));
    var parsed =
        ParameterForms.interactive(
            parameters,
            object(
                "note", "",
                "at", "2026-11-09 08:00",
                "amount", " 12.50 ",
                "tags", "[\"001\", \"B\"]",
                "rows", "[{\"id\": 1}]",
                "order", "{\"id\": \"SO-1\"}"),
            Map.of(),
            List.of(),
            "en");
    assertEquals(0, parsed.errors().size());
    assertEquals("", parsed.values().get("note"));
    assertEquals("2026-11-09 08:00", parsed.values().get("at"));
    assertEquals(new BigDecimal("12.50"), parsed.values().get("amount"));
    assertEquals(List.of("001", "B"), parsed.values().get("tags"));
    assertEquals(List.of(Map.of("id", 1)), parsed.values().get("rows"));
    assertEquals(Map.of("id", "SO-1"), parsed.values().get("order"));

    var invalid =
        ParameterForms.interactive(
            parameters,
            object("amount", "", "tags", "001\nB", "rows", "[1]", "order", "{\"id\": 1} {}"),
            Map.of(),
            List.of(),
            "en");
    assertEquals(
        List.of("invalid_number", "invalid_array", "invalid_array", "invalid_object"),
        invalid.errors().findValuesAsText("code"));
    assertTrue(invalid.values().containsKey("note"));
  }

  @Test
  void readOnlyParametersKeepTheirBoundValueWhateverTheirText() {
    var parameters = List.of(parameter("person", Parameter.TYPE_STRING), parameter("count", Parameter.TYPE_NUMBER));
    var parsed =
        ParameterForms.interactive(
            parameters,
            object("person", "someone-else", "count", "2"),
            Map.of("person", "person-1", "count", 1),
            List.of("person"),
            "en");
    assertEquals("person-1", parsed.values().get("person"));
    assertEquals(2, parsed.values().get("count"));

    var unfit =
        ParameterForms.interactive(
            parameters, object("count", "2"), Map.of("person", 7), List.of("person"), "en");
    assertEquals("/values/person", unfit.errors().get(0).path("field").asText());
  }
}
