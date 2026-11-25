package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;

import io.ontomato.dataengine.service.OntologyModelService;
import java.util.List;
import org.junit.jupiter.api.Test;

class Neo4jAdapterAttributeTypesTest {
	@Test
	void mapsEveryModelAttributeTypeToADriverProperty() {
		for (String type : OntologyModelService.ATTRIBUTE_TYPES) {
			Object value = switch (type) {
				case "int" -> 1;
				case "long" -> 3_000_000_000L;
				case "float", "double" -> 1.25d;
				case "boolean" -> true;
				case "date" -> "2026-11-25";
				case "datetime", "timestamp" -> "2026-11-25 12:34:56";
				case "varchar", "text" -> "text";
				case "vector" -> List.of();
				default -> throw new AssertionError("Missing driver value for " + type);
			};
			Object property = Neo4jAdapter.normalizeValue(type, value);
			assertEquals("vector".equals(type) ? "[]" : value, property, type);
			org.neo4j.driver.Values.value(property);
		}
	}
}
