package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import io.ontomato.dataengine.dao.AssetLookupPolicy;

class OssAssetLookupAssemblyTest {
    @Test
    void theEditionSuppliesItsLookupPolicy() {
        JdbcTemplate jdbc = org.mockito.Mockito.mock(JdbcTemplate.class);
        try (var context = new AnnotationConfigApplicationContext(OssAssetLookupAssembly.class)) {
            AssetLookupPolicy policy = context.getBean(AssetLookupPolicy.class);
            for (Integer count : new Integer[] {0, null, 1}) {
                org.mockito.Mockito.when(jdbc.queryForObject(org.mockito.ArgumentMatchers.anyString(),
                        org.mockito.ArgumentMatchers.eq(Integer.class), org.mockito.ArgumentMatchers.any(Object[].class))).thenReturn(count);
                assertEquals(count != null && count > 0, policy.shouldQuery(jdbc, "action"));
            }
            org.mockito.Mockito.when(jdbc.queryForObject(org.mockito.ArgumentMatchers.anyString(),
                    org.mockito.ArgumentMatchers.eq(Integer.class), org.mockito.ArgumentMatchers.any(Object[].class)))
                    .thenThrow(new IllegalStateException("metadata unavailable"));
            assertFalse(policy.shouldQuery(jdbc, "metric_view"));
        }
    }
}
