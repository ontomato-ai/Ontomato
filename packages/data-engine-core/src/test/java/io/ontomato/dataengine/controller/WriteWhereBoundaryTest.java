package io.ontomato.dataengine.controller;

import com.alibaba.fastjson2.*;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.service.*;
import org.junit.jupiter.api.*;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class WriteWhereBoundaryTest {
    WriteFunctionOperationController controller;
    WriteFunctionOperationService writes;
    JSONRuleDao rules;

    @BeforeEach void setup() {
        controller = new WriteFunctionOperationController();
        writes = mock(WriteFunctionOperationService.class);
        rules = mock(JSONRuleDao.class);
        ReflectionTestUtils.setField(controller, "writeFunctionOperationService", writes);
        ReflectionTestUtils.setField(controller, "jsonRuleDao", rules);
        when(rules.query("d")).thenReturn(Map.of("classDef", List.of(Map.of("className", "person", "attrs",
                List.of(Map.of("name", "id", "primaryKey", true), Map.of("name", "photo", "type", "vector"), Map.of("name", "age"), Map.of("name", "disabled", "enable", false))))));
        var request = new MockHttpServletRequest();
        request.setAttribute(QueryGrantService.ATTRIBUTE, JSONObject.of("domainId", "d"));
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
    }
    @AfterEach void cleanup() { RequestContextHolder.resetRequestAttributes(); }

    @Test void rejectsEveryInvalidShapeBeforeWriteServiceCanQueryOrCleanResources() throws Exception {
        String[] invalid = {"[{\"id\":\"accident-person-id\"}]", "\"text\"", "42", "null", "{}",
            "{\"operator\":\"logic\",\"and\":[]}", "{\"and\":{}}", "{\"or\":[null]}",
            "{\"operator\":\"=\",\"value\":1}", "{\"field\":\"id\",\"operator\":\"unknown\",\"value\":1}",
            "{\"field\":\"id\",\"value\":1}", "{\"field\":\"foreign\",\"operator\":\"=\",\"value\":1}",
            "{\"field\":\"disabled\",\"operator\":\"=\",\"value\":1}",
            "{\"field\":\"id\",\"operator\":\"=\",\"value\":[]}",
            "{\"field\":\"id\",\"operator\":\"=\",\"value\":{}}",
            "{\"field\":\"id\",\"operator\":\"=\"}",
            "{\"field\":\"id\",\"operator\":\"in\",\"value\":[]}",
            "{\"field\":\"id\",\"operator\":\"in\",\"value\":\"x\"}",
            "{\"field\":\"id\",\"operator\":\"in\",\"value\":[{}]}",
            "{\"field\":\"id\",\"operator\":\"between\",\"value\":[1]}",
            "{\"field\":\"id\",\"operator\":\"like\",\"value\":2}",
            "{\"field\":\"id\",\"operator\":\"is\",\"value\":2}",
            "{\"and\":[{\"field\":\"id\",\"operator\":\"=\",\"value\":1}],\"or\":[]}"};
        for (String raw : invalid) {
            JSONObject body = JSONObject.of("className", "person", "where", JSON.parse(raw), "setValues", JSONObject.of("age", 2));
            for (JSONObject result : List.of(controller.delete(body), controller.update(body))) {
                assertFalse(result.getBooleanValue("success"), raw);
                assertTrue(result.getString("message").startsWith("Invalid where:"), raw);
            }
        }
        var missing = JSONObject.of("className", "person");
        assertFalse(controller.delete(missing).getBooleanValue("success"));
        assertFalse(controller.update(missing).getBooleanValue("success"));
        // All object queries, vector cleanup, file deletion and adapter writes are downstream of this service.
        verifyNoInteractions(writes);
    }

    @Test void accidentInputLeavesObjectsVectorIndexAndPhysicalFileUntouched(@org.junit.jupiter.api.io.TempDir java.nio.file.Path dir) throws Exception {
        var objects = new ArrayList<>(List.of(JSONObject.of("id", "p", "age", 1)));
        var vectors = new ArrayList<>(List.of("p-photo-index"));
        var file = dir.resolve("photo.bin");
        java.nio.file.Files.writeString(file, "original-photo-bytes");
        var adapter = mock(io.ontomato.dataengine.dataAdapter.DataAdapter.class);
        when(adapter.query(any(), any(), any(), any(), any())).thenReturn(Map.of("data",
                JSONArray.of(JSONObject.of("answer", JSONArray.of(JSONObject.of("pk", "p"))))));
        var vectorDao = mock(io.ontomato.dataengine.dao.VectorResourceDao.class);
        var registry = mock(io.ontomato.dataengine.dataAdapter.DataAdapterRegistry.class);
        var config = mock(BusinessConfigService.class);
        when(registry.create(any(), any())).thenReturn(adapter);
        doAnswer(inv -> { objects.clear(); return null; }).when(adapter).deleteObjects(any(), any(), any());
        doAnswer(inv -> { objects.get(0).put("age", 2); return null; }).when(adapter).updateObjects(any(), any(), any(), any());
        doAnswer(inv -> { vectors.clear(); java.nio.file.Files.delete(file); return null; })
                .when(vectorDao).deleteByObjectId(any(), any(), any(), any());
        var service = new io.ontomato.dataengine.service.impl.WriteFunctionOperationServiceImpl();
        ReflectionTestUtils.setField(service, "jsonRuleDao", rules);
        ReflectionTestUtils.setField(service, "dataAdapterRegistry", registry);
        ReflectionTestUtils.setField(service, "businessConfigService", config);
        ReflectionTestUtils.setField(service, "vectorResourceDao", vectorDao);
        ReflectionTestUtils.setField(controller, "writeFunctionOperationService", service);
        var body = JSONObject.of("className", "person", "where", JSON.parse("[{\"id\":\"p\"}]"), "setValues", JSONObject.of("age", 2));
        assertFalse(controller.delete(body).getBooleanValue("success"));
        assertFalse(controller.update(body).getBooleanValue("success"));
        assertEquals(List.of(JSONObject.of("id", "p", "age", 1)), objects);
        assertEquals(List.of("p-photo-index"), vectors);
        assertEquals("original-photo-bytes", java.nio.file.Files.readString(file));
        verifyNoInteractions(registry, adapter, vectorDao);
        // Prove this fixture really mutates objects, vector indexes and files on valid requests.
        body.put("where", JSONObject.of("field", "id", "operator", "=", "value", "p"));
        assertTrue(controller.update(body).getBooleanValue("success"));
        assertEquals(2, objects.get(0).getIntValue("age"));
        body.put("where", JSONObject.of("operator", "logic", "and", JSONArray.of(body.getJSONObject("where"))));
        assertTrue(controller.delete(body).getBooleanValue("success"));
        assertTrue(objects.isEmpty());
        assertTrue(vectors.isEmpty());
        assertFalse(java.nio.file.Files.exists(file));
    }

    @Test void validSingleAndNestedLogicReachBothOperations() throws Exception {
        var single = JSONObject.of("field", "id", "operator", "=", "value", "person-id");
        var logic = JSONObject.of("operator", "logic", "and", JSONArray.of(single,
                JSONObject.of("or", JSONArray.of(JSONObject.of("field", "age", "operator", "between", "value", JSONArray.of(1, 9)),
                        JSONObject.of("field", "id", "operator", "in", "value", JSONArray.of("p"))))));
        for (JSONObject where : List.of(single, logic)) {
            var values = JSONObject.of("age", 2);
            var body = JSONObject.of("className", "person", "where", where, "setValues", values);
            assertTrue(controller.delete(body).getBooleanValue("success"));
            assertTrue(controller.update(body).getBooleanValue("success"));
            verify(writes).delete("person", where, null, "d");
            verify(writes).update("person", values, where, null, "d");
        }
    }
}
