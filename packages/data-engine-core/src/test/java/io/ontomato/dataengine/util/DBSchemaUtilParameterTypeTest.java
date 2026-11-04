package io.ontomato.dataengine.util;

import static org.junit.jupiter.api.Assertions.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.service.MetricViewBindings;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

/** A parameter's declared type owns its value shape before a candidate binding is written. */
class DBSchemaUtilParameterTypeTest {
  @Test
  void numericParameterDefinitionsBecomeNumbersBeforeSave() {
    List<Map> defs =
        List.of(
            Map.of("name", "min_age", "type", Parameter.TYPE_NUMBER, "value", "25"),
            Map.of("name", "max_age", "type", Parameter.TYPE_NUMBER, "value", "35"),
            Map.of(
                "name",
                "ages",
                "type",
                Parameter.TYPE_NUMBER_ARRAY,
                "value",
                List.of("25", "35")));
    Function function = new Function();
    function.setParameters(DBSchemaUtil.buildParameters(defs, List.of()));

    assertEquals(new BigDecimal("25"), function.getParameters().get(0).getValue());
    assertEquals(new BigDecimal("35"), function.getParameters().get(1).getValue());
    assertEquals(
        List.of(new BigDecimal("25"), new BigDecimal("35")),
        function.getParameters().get(2).getValue());

    JSONObject values = MetricViewBindings.values(function);
    assertDoesNotThrow(() -> MetricViewBindings.validateValues(function, values));
  }

  @Test
  void nonNumericTextIsNotSilentlyConverted() {
    Function function = new Function();
    function.setParameters(
        DBSchemaUtil.buildParameters(
            List.of(Map.of("name", "min_age", "type", Parameter.TYPE_NUMBER, "value", "abc")),
            List.of()));

    assertEquals("abc", function.getParameters().get(0).getValue());
    assertThrows(
        IllegalArgumentException.class,
        () -> MetricViewBindings.validateValues(function, MetricViewBindings.values(function)));
  }
}
