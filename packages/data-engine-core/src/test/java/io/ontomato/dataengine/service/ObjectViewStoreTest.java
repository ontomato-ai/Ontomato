package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.alibaba.fastjson2.JSONObject;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class ObjectViewStoreTest {
    private JSONObject document() {
        return JSONObject.parseObject("""
            {"schemaVersion":1,"className":"Order","title":"Order","variables":{},"tabs":[
              {"id":"tab","title":"Overview","sections":[{"id":"section","title":"","widgets":[
                {"id":"properties","kind":"properties","title":"Details","span":12,"height":240,"parameters":{}}
              ]}]}]}
            """);
    }

    @Test void rejectsCrossTypeAndDuplicateIdsBeforePersistence() {
        JSONObject document = document();
        assertThrows(IllegalArgumentException.class, () -> ObjectViewStore.validateDocument("Other", document));
        var widget = document.getJSONArray("tabs").getJSONObject(0).getJSONArray("sections").getJSONObject(0).getJSONArray("widgets").getJSONObject(0);
        widget.put("id", "tab");
        assertThrows(IllegalArgumentException.class, () -> ObjectViewStore.validateDocument("Order", document));
    }

    @Test void rejectsInvalidBindingsAndRuntimeSettings() {
        JSONObject document = document();
        var widget = document.getJSONArray("tabs").getJSONObject(0).getJSONArray("sections").getJSONObject(0).getJSONArray("widgets").getJSONObject(0);
        widget.put("binding", JSONObject.of("source", "object", "path", "constructor.secret"));
        assertThrows(IllegalArgumentException.class, () -> ObjectViewStore.validateDocument("Order", document));
        widget.remove("binding");
        widget.put("onClick", "executeJavaScript");
        assertThrows(IllegalArgumentException.class, () -> ObjectViewStore.validateDocument("Order", document));
    }

    @Test void rejectsConflictingSaveBeforeInsertingRevision() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        var store = new ObjectViewStore(jdbc);
        assertThrows(ObjectViewStore.ViewConflictException.class, () -> store.save("domain-a", "user", "Order", "full", 2, document(), "Draft"));
        verify(jdbc).update(contains("WHERE domain_id=? AND class_name=? AND form=? AND revision=?"), eq("domain-a"), eq("Order"), eq("full"), eq(2));
        verify(jdbc, never()).update(startsWith("INSERT INTO object_view_version"), any(Object[].class));
    }

    @Test void refusesToPublishMissingRevision() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        var store = new ObjectViewStore(jdbc);
        when(jdbc.queryForObject(anyString(), eq(Integer.class), eq("domain-a"), eq("Order"), eq("panel"), eq(7))).thenReturn(0);
        assertThrows(IllegalArgumentException.class, () -> store.publish("domain-a", "Order", "panel", 7, 9));
        verify(jdbc, never()).update(anyString(), any(Object[].class));
    }

    @Test void validatesTypedInputsAndFindsDependencies() {
        JSONObject document = document();
        document.put("inputs", JSONObject.of("period", JSONObject.of("type", "string", "default", "month", "enum", java.util.List.of("month", "year"))));
        var widget = document.getJSONArray("tabs").getJSONObject(0).getJSONArray("sections").getJSONObject(0).getJSONArray("widgets").getJSONObject(0);
        widget.put("binding", JSONObject.of("source", "input", "path", "period"));
        assertDoesNotThrow(() -> ObjectViewStore.validateDocument("Order", document));
        document.getJSONObject("inputs").getJSONObject("period").put("default", 10);
        assertThrows(IllegalArgumentException.class, () -> ObjectViewStore.validateDocument("Order", document));
        widget.put("kind", "chart");
        widget.put("resourceId", "summary");
        assertEquals(java.util.Set.of("summary"), ObjectViewStore.dependencies(document).get("metricViews"));
    }

    @Test void pinnedReadsRequireAPublishedRevisionInTheCurrentDomain() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        var store = new ObjectViewStore(jdbc);
        assertThrows(IllegalArgumentException.class, () -> store.resolve("domain-a", "Order", "full", 3));
        verify(jdbc).query(contains("AND published=TRUE"), any(org.springframework.jdbc.core.RowMapper.class), eq("domain-a"), eq("Order"), eq("full"), eq(3));
    }
}
