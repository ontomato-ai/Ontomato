package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.sys.bean.permission.FieldPermission;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.mock.http.MockHttpInputMessage;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

class DataServiceImplClassPageTest {
    private final DataServiceImpl service = new DataServiceImpl();
    private final DataAdapter adapter = mock(DataAdapter.class);
    private final UserDataPermission permission = new UserDataPermission();
    private final List<JSONObject> queries = new ArrayList<>();

    @BeforeEach
    void setUp() throws Exception {
        var admin = mock(AdminService.class);
        when(admin.getJSONRule("domain")).thenReturn(JSONObject.parseObject("""
                {"classDef":[{"className":"Device","attrs":[
                    {"name":"id","type":"varchar","primaryKey":true},
                    {"name":"title","type":"varchar","bizzkey":true},
                    {"name":"size","type":"int"},
                    {"name":"secret","type":"varchar"},
                    {"name":"disabled","type":"varchar","enable":false}
                ]}],"relationship_rule":{}}
                """));
        var configs = mock(BusinessConfigService.class);
        when(configs.get("domain")).thenReturn(new BusinessConfig());
        var registry = mock(DataAdapterRegistry.class);
        when(registry.create(any(), any())).thenReturn(adapter);
        ReflectionTestUtils.setField(service, "adminService", admin);
        ReflectionTestUtils.setField(service, "businessConfigService", configs);
        ReflectionTestUtils.setField(service, "dataAdapterRegistry", registry);

        var fields = new FieldPermission("Device");
        fields.getVisibleFields().addAll(List.of("id", "title", "size", "disabled"));
        fields.getGroupableColumns().add("secret");
        permission.addFieldPermission(fields);
        permission.getFullRowPermissions().add("Device");

        when(adapter.executeDsl(anyString(), anyString(), any(), anyList())).thenAnswer(call -> {
            var step = JSONArray.parseArray(call.getArgument(0)).getJSONObject(0)
                    .getJSONObject("answer").getJSONArray("steps").getJSONObject(0);
            queries.add(step);
            var output = step.getJSONObject("output");
            var answer = output.containsKey("limit")
                    ? JSONArray.of(JSONObject.of("id", "d2", "title", "Pump", "size", 4, "secret", "masked"))
                    : JSONArray.of(JSONObject.of("count_id", 3));
            return JSONArray.of(JSONObject.of("answer", answer)).toJSONString();
        });
    }

    @Test
    void allOperatorsAndSearchReachBothQueriesWhileSortAndPageApplyOnlyToRows() throws Exception {
        // Jackson binds nested request structures as List and Map.
        var body = new MockHttpInputMessage("""
                {"classname":"Device","pagenum":2,"pagecount":1,"search":"pump",
                 "filters":[{"field":"size","operator":"eq","value":4},
                   {"field":"size","operator":"ne","value":1},{"field":"title","operator":"contains","value":"%_!"},
                   {"field":"size","operator":"gt","value":2},{"field":"size","operator":"lt","value":8},
                   {"field":"size","operator":"gte","value":"4"},{"field":"size","operator":"lte","value":5},
                   {"field":"title","operator":"null"},{"field":"title","operator":"notnull"}],
                 "sort":{"field":"title","order":"desc"}}
                """.getBytes(StandardCharsets.UTF_8));
        var request = (JSONObject) new MappingJackson2HttpMessageConverter().read(JSONObject.class, body);
        var response = service.getWholeClassDataByPage(request, "en", permission, "domain");

        var conditions = conditions(queries.getFirst());
        assertEquals(conditions, conditions(queries.getLast()));
        assertEquals("pump", conditions.getJSONObject("text").getString("query"));
        var filters = conditions.getJSONObject("properties").getJSONArray("and");
        assertEquals(List.of("=", "!=", "like", ">", "<", ">=", "<=", "is", "is not"),
                filters.stream().map(JSONObject::from).map(filter -> filter.getString("operator")).toList());
        assertEquals("%!%!_!!%", filters.getJSONObject(2).getString("value"));
        assertEquals("!", filters.getJSONObject(2).getString("escape"));
        assertInstanceOf(Number.class, filters.getJSONObject(5).get("value"));
        assertNull(filters.getJSONObject(7).get("value"));
        assertNull(filters.getJSONObject(8).get("value"));

        var output = queries.getFirst().getJSONObject("output");
        var sort = output.getJSONObject("sort").getJSONArray("fields");
        assertEquals("title", sort.getJSONObject(0).getString("field"));
        assertEquals("desc", sort.getJSONObject(0).getString("order"));
        assertEquals(1, output.getJSONObject("limit").getIntValue("offset"));
        assertFalse(queries.getLast().getJSONObject("output").containsKey("limit"));
        assertEquals(3, response.getIntValue("total_count"));
        assertEquals(1, response.getJSONArray("data").size());
        assertEquals(List.of("id", "title", "size"), response.getList("readable_fields", String.class));
    }

    @Test
    void rejectsNonReadableDisabledAndMissingFieldsBeforeReadingRows() {
        for (String field : List.of("secret", "disabled", "missing")) {
            int status = field.equals("secret") ? 403 : 400;
            var filter = JSONObject.of("classname", "Device", "pagenum", 1, "pagecount", 20,
                    "filters", List.of(JSONObject.of("field", field, "operator", "eq", "value", "x")));
            assertEquals(status, assertThrows(ResponseStatusException.class,
                    () -> service.getWholeClassDataByPage(filter, "en", permission, "domain")).getStatusCode().value());
            var sort = JSONObject.of("classname", "Device", "pagenum", 1, "pagecount", 20,
                    "sort", JSONObject.of("field", field, "order", "asc"));
            assertEquals(status, assertThrows(ResponseStatusException.class,
                    () -> service.getWholeClassDataByPage(sort, "en", permission, "domain")).getStatusCode().value());
        }
        verifyNoInteractions(adapter);
    }

    private static JSONObject conditions(JSONObject step) {
        return step.getJSONObject("graph").getJSONArray("patterns").getJSONObject(0)
                .getJSONArray("objects").getJSONObject(0).getJSONObject("conditions");
    }
}
