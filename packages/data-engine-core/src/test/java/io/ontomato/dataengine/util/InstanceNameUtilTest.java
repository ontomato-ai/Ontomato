package io.ontomato.dataengine.util;

import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class InstanceNameUtilTest {
    @Test void choosesBusinessNameAndDoesNotUsePrimaryKeyAsFallback() {
        assertEquals("org_name", InstanceNameUtil.businessKey(Map.of("attrs", List.of(
            Map.of("name", "id", "primaryKey", true), Map.of("name", "code", "bizzkey", true), Map.of("name", "org_name", "bizzkey", true)))));
        assertNull(InstanceNameUtil.businessKey(Map.of("attrs", List.of(Map.of("name", "id", "primaryKey", true)))));
        assertEquals("—", InstanceNameUtil.display(null, "internal-id"));
        assertEquals("—", InstanceNameUtil.display("name", " "));
        assertEquals("Business name", InstanceNameUtil.display("name", "Business name"));
    }
}
