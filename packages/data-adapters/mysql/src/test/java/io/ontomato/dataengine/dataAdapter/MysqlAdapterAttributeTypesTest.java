package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertFalse;

import io.ontomato.dataengine.service.OntologyModelService;
import org.junit.jupiter.api.Test;

class MysqlAdapterAttributeTypesTest {
	@Test
	void mapsEveryModelAttributeType() {
		for (String type : OntologyModelService.ATTRIBUTE_TYPES) {
			assertFalse(MysqlAdapter.columnType(type).isBlank(), type);
		}
	}
}
