package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import io.ontomato.dataengine.config.DataRagConfig;

/** The ArangoDB provider's contract: its type, label, non-SQL flag, and connection fields. */
class ArangoAdapterProviderTest {

	private final ArangoAdapterProvider provider = new ArangoAdapterProvider();

	@Test
	void declaresTypeLabelAndFields() {
		assertEquals("arangodb", provider.type());
		assertEquals("ArangoDB", provider.label());
		assertFalse(provider.requiresJoinFields());
		assertEquals(List.of("url", "user", "password"), provider.connectionFields());
		assertEquals(Map.of("url", "http://host:8529", "user", "root"), provider.connectionExamples());
	}

	@Test
	void createsAnAdapterForTheGivenConnection() {
		DataAdapterConnection connection = new DataAdapterConnection();
		connection.setUrl("http://host:8529");
		DataAdapter adapter = provider.create(connection, new DataRagConfig(), Map.of("classDef", List.of()));
		assertEquals(ArangoAdapter.class, adapter.getClass());
	}
}
