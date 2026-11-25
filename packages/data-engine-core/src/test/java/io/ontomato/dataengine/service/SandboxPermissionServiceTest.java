package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dataAdapter.DataAdapter;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.dataAdapter.SandboxCapability;
import java.util.List;
import java.util.concurrent.locks.ReentrantLock;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class SandboxPermissionServiceTest {
    @Test
    void readingAnUncheckedConnectionNeverProbesAndAUserCheckPersistsItsResult() {
        var jdbc = mock(JdbcTemplate.class);
        var adapters = mock(DataAdapterRegistry.class);
        var configs = mock(BusinessConfigService.class);
        var deployment = mock(SandboxDeployment.class);
        var config = new BusinessConfig();
        config.setDataAdapter("postgresql");
        var adapter = mock(DataAdapter.class);
        when(configs.get("domain")).thenReturn(config);
        when(adapters.supportsSandbox(config)).thenReturn(true);
        when(jdbc.queryForList(anyString(), eq(String.class), eq("domain"), anyString())).thenReturn(List.of());
        var service = new SandboxPermissionService(jdbc, adapters, configs, deployment);

        assertEquals("unchecked", service.read("domain").getString("status"));
        verifyNoInteractions(adapter, deployment);
        verify(jdbc, never()).execute(anyString());

        when(adapters.create(config, null)).thenReturn(adapter);
        when(deployment.tag()).thenReturn("dep001");
        when(deployment.operationLock()).thenReturn(new ReentrantLock());
        when(adapter.probeSandboxPermission("dep001")).thenReturn(SandboxCapability.passed());
        var report = service.check("domain");
        assertEquals("passed", report.getString("status"));
        verify(jdbc).update(contains("INSERT INTO data_sandbox_probes"), eq("domain"), anyString(),
            eq("passed"), eq(true), eq(report.getString("reason")), eq(report.toJSONString()));
        when(jdbc.queryForList(anyString(), eq(String.class), eq("domain"), anyString()))
            .thenReturn(List.of(report.toJSONString()));
        assertEquals(report.toJSONString(), service.read("domain").toJSONString());
        verify(adapter, times(1)).probeSandboxPermission(anyString());
    }
}
