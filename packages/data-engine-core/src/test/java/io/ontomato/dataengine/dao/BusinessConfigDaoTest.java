package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSON;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

class BusinessConfigDaoTest {
  @Test
  void queryIgnoresRemovedTimeoutInStoredConfig() {
    String legacyKey = "report" + "CardPythonTimeout";
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    when(jdbc.queryForObject(anyString(), eq(String.class), eq("sales")))
        .thenReturn(JSON.toJSONString(Map.of("lang", "en", legacyKey, 15)));

    BusinessConfigDao dao = new BusinessConfigDao();
    ReflectionTestUtils.setField(dao, "jdbcTemplate", jdbc);

    var config = dao.query("sales");

    assertEquals("en", config.getLang());
    assertFalse(JSON.parseObject(JSON.toJSONString(config)).containsKey(legacyKey));
  }
}
