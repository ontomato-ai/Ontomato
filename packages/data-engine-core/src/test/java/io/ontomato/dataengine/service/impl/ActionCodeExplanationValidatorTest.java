package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import org.junit.jupiter.api.Test;

class ActionCodeExplanationValidatorTest {
  private static JSONObject segment(Object count) {
    return JSONObject.of(
        "id", "s1",
        "kind", "QUERY",
        "title", "query",
        "codeRange", JSONObject.of("start", 1, "end", 2),
        "output", JSONObject.of("limit", JSONObject.of("offset", 0, "count", count)));
  }

  private static JSONObject result(Object count) {
    return JSONObject.of("segs", JSONArray.of(segment(count)));
  }

  @Test
  void acceptsAdescriptiveLimitExpression() {
    assertEquals(
        1,
        ActionCodeExplanationValidator.segments(result("产品编号去重数量 + 10")).size());
  }

  @Test
  void stillRejectsAnEmptyLimit() {
    assertThrows(
        IllegalArgumentException.class, () -> ActionCodeExplanationValidator.segments(result("")));
  }
}
