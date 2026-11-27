package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The external sample boundary shared by Action trials and generation tests. */
class SandboxSampleInputTest {
  @Test void rejectsWrongContainersWithTheirJsonPathBeforeMetadataOrResourceAccess() {
    var schemas = mock(JSONRuleDao.class);
    var loader = new DataSandboxService(null, null, schemas, null, null, null, null);
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
    var schemas = mock(JSONRuleDao.class);
    var loader = new DataSandboxService(null, null, schemas, null, null, null, null);
    when(schemas.query("domain")).thenReturn(JSON.parseObject("{\"classDef\":[{\"className\":\"item\",\"attrs\":[{\"name\":\"id\",\"type\":\"varchar\",\"primaryKey\":true}]}],\"relationship_rule\":{}}"));
    JSONObject result=loader.validateSample(JSON.parseObject("{\"objDatas\":[{\"className\":\"item\",\"rows\":[]}],\"relDatas\":[],\"vectorDatas\":[]}"),Map.of(),"domain");
    assertTrue(result.getJSONArray("objDatas").getJSONObject(0).getJSONArray("rows").isEmpty());
  }
}
