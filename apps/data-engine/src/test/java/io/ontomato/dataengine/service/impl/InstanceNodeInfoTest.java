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

/** An instance graph node is named {@code class:primaryKeyValue}; its details are read back through the installed adapter. */
class InstanceNodeInfoTest {
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
    void aNodeIdReadsBackTheSameObjectByItsActualPrimaryKey() throws Exception {
        DuckDbGraphFixture store = new DuckDbGraphFixture(directory.resolve("graph.db"), "");
        UserDataPermission permission = new UserDataPermission();
        permission.setFullData(true);
        // The pump's primary key is `code`, not `id`: the node id carries that key's value.
        JSONObject details = service(store).queryInfoByNode(JSONObject.of("id", "pump:P1", "class", "pump"),
                "en", permission, "domain");
        assertTrue(details.getBooleanValue("success"), details.toJSONString());
        assertEquals(JSONObject.of("code", "P1", "name", "Business name", "tank_code", "T1"),
                details.getJSONObject("data").getJSONObject("data"));
    }
}
