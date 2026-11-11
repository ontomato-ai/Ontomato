package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

class ClickHouseAdapterProviderTest {

	private final ClickHouseAdapterProvider provider = new ClickHouseAdapterProvider();

	@Test
	void metadata() {
		assertEquals("clickhouse", provider.type());
		assertEquals("ClickHouse", provider.label());
		assertTrue(provider.requiresJoinFields());
		assertEquals(List.of("url", "user", "password"), provider.connectionFields());
		assertEquals("jdbc:clickhouse://host:8123/default", provider.connectionExamples().get("url"));
	}
}
