package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

/** Pins the provider metadata the configuration page consumes. */
class MongoAdapterProviderTest {

	private final MongoAdapterProvider provider = new MongoAdapterProvider();

	@Test
	void metadata() {
		assertEquals("mongodb", provider.type());
		assertEquals("MongoDB", provider.label());
		assertTrue(provider.requiresJoinFields());
		assertEquals(List.of("url", "user", "password"), provider.connectionFields());
		assertEquals("mongodb://host:27017/db", provider.connectionExamples().get("url"));
	}
}
