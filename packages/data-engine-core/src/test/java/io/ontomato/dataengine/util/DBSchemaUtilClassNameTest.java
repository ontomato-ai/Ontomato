package io.ontomato.dataengine.util;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class DBSchemaUtilClassNameTest {
  private static List<Map<String, Object>> schema(String className) {
    return List.of(Map.of("className", className));
  }

  @Test
  void mapsSlashFormToBareSchemaName() {
    assertEquals("customers", DBSchemaUtil.normalizeClassName("/customers", schema("customers")));
  }

  @Test
  void mapsBareFormToSlashSchemaName() {
    assertEquals("/customers", DBSchemaUtil.normalizeClassName("customers", schema("/customers")));
  }

  @Test
  void keepsTheExactSchemaName() {
    assertEquals("/customers", DBSchemaUtil.normalizeClassName("/customers", schema("/customers")));
    assertEquals("customers", DBSchemaUtil.normalizeClassName("customers", schema("customers")));
  }

  @Test
  void leavesAnUnknownNameUnchanged() {
    assertEquals("unknown", DBSchemaUtil.normalizeClassName("unknown", schema("customers")));
  }
}
