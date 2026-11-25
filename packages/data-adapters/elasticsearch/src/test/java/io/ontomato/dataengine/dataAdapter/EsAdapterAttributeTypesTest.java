package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertFalse;

import io.ontomato.dataengine.service.OntologyModelService;
import org.junit.jupiter.api.Test;

class EsAdapterAttributeTypesTest {
	@Test
	void mapsEveryModelAttributeType() {
		for (String type : OntologyModelService.ATTRIBUTE_TYPES) {
			assertFalse(EsAdapter.mappingOf(type).getString("type").isBlank(), type);
		}
	}
}
