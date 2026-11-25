package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.OntologyQueryService;
import io.ontomato.dataengine.service.QueryAccessService;
import io.ontomato.dataengine.service.SandboxPermissionService;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class SandboxAuthoringCapabilityTest {
    @Test
    void actionContextReadsTheStoredCapability() {
        var ontology = mock(OntologyQueryService.class);
        var access = new QueryAccessService.Access(new QueryAccessService.GrantUser("author", "business"),
            null, null, null, null);
        when(ontology.rule(access)).thenReturn(Map.of("classDef", List.of()));
        var authoring = new PlatformAuthoringService(null, null, null, null, null, ontology,
            null, null, null, null, null, null, null, null, null);
        var sandboxPermissions = mock(SandboxPermissionService.class);
        when(sandboxPermissions.read("business")).thenReturn(JSONObject.of("status", "unchecked"));
        ReflectionTestUtils.setField(authoring, "sandboxPermissions", sandboxPermissions);
        JSONObject context = ReflectionTestUtils.invokeMethod(authoring, "context", "action", access);
        assertEquals("unchecked", context.getJSONObject("sandboxCapability").getString("status"));
        verify(sandboxPermissions).read("business");
        verifyNoMoreInteractions(sandboxPermissions);
    }
}
