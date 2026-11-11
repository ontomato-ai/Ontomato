package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.impl.SandboxServiceImpl;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/** The external sample boundary shared by Action generation and build tests. */
class SandboxSampleInputTest {
  @Test void rejectsWrongContainersWithTheirJsonPathBeforeMetadataOrResourceAccess() {
    var loader=new SandboxServiceImpl();var schemas=mock(JSONRuleDao.class);ReflectionTestUtils.setField(loader,"jsonRuleDao",schemas);
    for(var fixture:Map.of(
        "{\"objDatas\":[{\"className\":\"item\",\"datas\":[]}],\"relDatas\":[]}","$.objDatas[0].rows",
        "{\"objDatas\":[{\"className\":\"item\",\"rows\":{}}],\"relDatas\":[]}","$.objDatas[0].rows",
        "{\"objDatas\":[{\"className\":\"item\",\"rows\":[null]}],\"relDatas\":[]}","$.objDatas[0].rows[0]",
        "{\"objDatas\":[null],\"relDatas\":[]}","$.objDatas[0]",
        "{\"objDatas\":\"[]\",\"relDatas\":[]}","$.objDatas",
        "{\"objDatas\":[],\"relDatas\":null}","$.relDatas").entrySet()) {
      var error=assertThrows(AgentHttpException.class,()->loader.validateSample(JSON.parseObject(fixture.getKey()),Map.of(),"domain"));
      assertEquals(400,error.status());assertTrue(error.getMessage().contains(fixture.getValue()),error.getMessage());
      assertTrue(error.getMessage().contains("expected"),error.getMessage());
    }
    verifyNoInteractions(schemas);
  }
  @Test void acceptsAnExplicitEmptyRowsArrayWithoutLegacyAliases() {
    var loader=new SandboxServiceImpl();var schemas=mock(JSONRuleDao.class);ReflectionTestUtils.setField(loader,"jsonRuleDao",schemas);
    when(schemas.query("domain")).thenReturn(JSON.parseObject("{\"classDef\":[{\"className\":\"item\",\"attrs\":[{\"name\":\"id\",\"type\":\"varchar\",\"primaryKey\":true}]}],\"relationship_rule\":{}}"));
    JSONObject result=loader.validateSample(JSON.parseObject("{\"objDatas\":[{\"className\":\"item\",\"rows\":[]}],\"relDatas\":[],\"vectorDatas\":[]}"),Map.of(),"domain");
    assertTrue(result.getJSONArray("objDatas").getJSONObject(0).getJSONArray("rows").isEmpty());
  }
}
