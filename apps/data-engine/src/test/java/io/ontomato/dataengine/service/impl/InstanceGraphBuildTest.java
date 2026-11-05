package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dao.VectorResourceDao;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;

class InstanceGraphBuildTest {
    @TempDir Path directory;

    DataServiceImpl service(DuckDbGraphFixture store) {
        AdminService admin = mock(AdminService.class);
        when(admin.getJSONRule("domain")).thenReturn(store.rule);
        BusinessConfigService configs = mock(BusinessConfigService.class);
        when(configs.get("domain")).thenReturn(store.config);
        DataServiceImpl service = new DataServiceImpl();
        ReflectionTestUtils.setField(service, "adminService", admin);
        ReflectionTestUtils.setField(service, "dataAdapterRegistry", store.registry);
        ReflectionTestUtils.setField(service, "businessConfigService", configs);
        ReflectionTestUtils.setField(service, "langService", mock(LangService.class));
        ReflectionTestUtils.setField(service, "vectorResourceDao", mock(VectorResourceDao.class));
        ReflectionTestUtils.setField(service, "dataRagConfig", new DataRagConfig());
        return service;
    }

    @Test
    void independentClassScanKeepsUnconnectedRecordsAndBusinessNames() throws Exception {
        DuckDbGraphFixture store = new DuckDbGraphFixture(directory.resolve("graph.db"), "");
        DataServiceImpl service = service(store);
        JSONObject graph = service.cutWholeData("domain", store.config);
        InstanceGraphIndex index = new InstanceGraphIndex(graph);
        assertEquals(3, index.summary().getIntValue("nodeCount"));
        assertEquals(1, index.summary().getIntValue("isolatedNodeCount"));
        assertEquals(1, index.summary().getIntValue("edgeCount"));
        assertTrue(index.summary().getBooleanValue("complete"));
        assertEquals(1, index.search(JSONObject.of("term", "Business name")).getJSONArray("nodes").size());
        store.execute("DROP TABLE pump");
        JSONObject failed = service.cutWholeData("domain", store.config);
        assertFalse(failed.getBooleanValue("complete"));
        assertTrue(failed.getJSONArray("failures").contains("class:pump"));
    }

    @Test
    void aRelationshipNodeIdReadsBackTheSameObjectByItsActualPrimaryKey() throws Exception {
        DuckDbGraphFixture store = new DuckDbGraphFixture(directory.resolve("graph.db"), "");
        DataServiceImpl service = service(store);
        JSONObject edge = service.cutWholeData("domain", store.config).getJSONArray("edges").getJSONObject(0);
        assertEquals("feeds", edge.getString("type"));
        assertEquals("tank:T1", edge.getString("target"));
        UserDataPermission permission = new UserDataPermission();
        permission.setFullData(true);
        JSONObject details = service.queryInfoByNode(JSONObject.of("id", edge.getString("source"), "class", "pump"),
                "en", permission, "domain");
        assertTrue(details.getBooleanValue("success"), details.toJSONString());
        assertEquals(JSONObject.of("code", "P1", "name", "Business name", "tank_code", "T1"),
                details.getJSONObject("data").getJSONObject("data"));
    }
}
