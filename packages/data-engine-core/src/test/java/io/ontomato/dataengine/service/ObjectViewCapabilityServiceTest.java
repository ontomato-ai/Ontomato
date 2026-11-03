package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import org.junit.jupiter.api.Test;

class ObjectViewCapabilityServiceTest {
    @Test void objectBoundIdentityCannotBeOverriddenButEditableDefaultsCan() {
        JSONObject widget = JSONObject.of("parameters", JSONObject.of(
            "person_id", JSONObject.of("source", "object", "path", "id"),
            "degree", JSONObject.of("source", "object", "path", "degree")), "readOnlyParameters", JSONArray.of("person_id"));
        JSONObject object = JSONObject.of("id", "00123", "degree", "Bachelor");
        JSONObject params = ObjectViewCapabilityService.parameters(widget, object, new JSONObject(), JSONObject.of("degree", "Master"));
        assertEquals("00123", params.getString("person_id"));
        assertEquals("Master", params.getString("degree"));
        assertThrows(IllegalArgumentException.class, () -> ObjectViewCapabilityService.parameters(widget, object, new JSONObject(), JSONObject.of("person_id", "other")));
    }

    @Test void validatesInputsAndRejectsInteractiveStateAndPrototypePaths() {
        JSONObject document = JSONObject.of("inputs", JSONObject.of("period", JSONObject.of("type", "string", "required", true, "enum", JSONArray.of("month"))));
        assertThrows(IllegalArgumentException.class, () -> ObjectViewCapabilityService.inputs(document, new JSONObject()));
        assertThrows(IllegalArgumentException.class, () -> ObjectViewCapabilityService.inputs(document, JSONObject.of("period", "year")));
        assertThrows(IllegalArgumentException.class, () -> ObjectViewCapabilityService.binding(JSONObject.of("source", "variable", "path", "selection.id"), new JSONObject(), new JSONObject()));
        assertThrows(IllegalArgumentException.class, () -> ObjectViewCapabilityService.path(new JSONObject(), "constructor"));
        assertEquals(7, ObjectViewCapabilityService.path(JSONArray.of(JSONObject.of("count", 7)), "0.count"));
    }

    @Test void executionRequiresOriginalActionPermissionBeforeReadingAnything() {
        IdentityService identity = mock(IdentityService.class);
        doThrow(new SecurityException("Denied")).when(identity).requireApiPermission("/action/execute");
        ObjectViewStore store = mock(ObjectViewStore.class);
        var service = new ObjectViewCapabilityService(store, identity, null, null, null, null);
        assertThrows(SecurityException.class, () -> service.execute(new JSONObject(), "en"));
        verifyNoInteractions(store);
    }

    @Test void readUsesResolvedDomainObjectAndExecutesOnlyRequestedRegions() throws Exception {
        ObjectViewStore store = mock(ObjectViewStore.class);
        IdentityService identity = mock(IdentityService.class);
        var user = mock(io.ontomato.dataengine.core.bean.User.class);
        when(user.getDomainId()).thenReturn("domain-a");
        when(identity.getCurrentUser()).thenReturn(user);
        var permission = new io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission();
        when(identity.getCurrentUserDataPermission()).thenReturn(permission);
        JSONObject document = JSONObject.parseObject("""
            {"className":"Person","tabs":[{"sections":[{"widgets":[
              {"id":"p","key":"profile","kind":"properties","fields":["id","name"]},
              {"id":"m","key":"summary","kind":"metric","resourceId":"expensive"}
            ]}]}]}
            """);
        when(store.resolve("domain-a", "Person", "full", 4)).thenReturn(JSONObject.of("revision", 4, "document", document));
        DataService data = mock(DataService.class);
        when(data.queryInfoByNode(any(), eq("en"), eq(permission), eq("domain-a"))).thenReturn(JSONObject.of("success", true, "data", JSONObject.of(
            "data", JSONObject.of("name", "Alice"), "classDef", JSONObject.of("attrs", JSONArray.of(JSONObject.of("name", "id", "primaryKey", true))))));
        MetricViewService metrics = mock(MetricViewService.class);
        var service = new ObjectViewCapabilityService(store, identity, data, metrics, null, null);
        JSONObject result = service.read(JSONObject.of("view", JSONObject.of("className", "Person", "revision", 4), "object", JSONObject.of("primaryKey", "00123"), "regions", JSONArray.of("profile")), "en");
        assertEquals("00123", result.getJSONObject("regions").getJSONObject("profile").getJSONObject("value").getString("id"));
        assertEquals("Alice", result.getJSONObject("regions").getJSONObject("profile").getJSONObject("value").getString("name"));
        verifyNoInteractions(metrics);
        verify(identity).requireApiPermission("/data/queryInfoByNode");
    }
}
