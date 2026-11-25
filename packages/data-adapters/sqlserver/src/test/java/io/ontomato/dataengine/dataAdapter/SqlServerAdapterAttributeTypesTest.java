package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertFalse;

import io.ontomato.dataengine.service.OntologyModelService;
import org.junit.jupiter.api.Test;

class SqlServerAdapterAttributeTypesTest {
	@Test
	void mapsEveryModelAttributeType() {
		for (String type : OntologyModelService.ATTRIBUTE_TYPES) {
			assertFalse(SqlServerAdapter.columnType(type).isBlank(), type);
		}
	}

    @Test
    void resolvesSandboxClassesByMappedPhysicalName() {
        String longName = "期中检查材料提交记录复核归档表";
        var target = new SandboxTarget("sandbox", "dep001", "abcdefgh",
            java.util.Map.of(longName, "ot_sb_dep001_abcdefgh_c01", "e2e-expense", "ot_sb_dep001_abcdefgh_c02"),
            java.util.Map.of(), java.util.Map.of());
        var adapter = new SqlServerAdapter(new DataAdapterConnection(), java.util.Map.of()).forSandbox(target);
        org.junit.jupiter.api.Assertions.assertTrue(adapter.supportsWriteActions());
        org.junit.jupiter.api.Assertions.assertTrue(adapter.supportsSandbox());
        org.junit.jupiter.api.Assertions.assertEquals(target.classTable(longName),
            adapter.sandboxClassName(target.namespace(), longName));
        org.junit.jupiter.api.Assertions.assertEquals(target.classTable("e2e-expense"),
            adapter.sandboxClassName(target.namespace(), "e2e-expense"));
    }
}
