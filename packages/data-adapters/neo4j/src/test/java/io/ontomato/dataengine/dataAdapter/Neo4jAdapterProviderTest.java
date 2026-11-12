package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import io.ontomato.dataengine.config.DataRagConfig;

/** The Neo4j provider creates its adapter for a Bolt connection. */
class Neo4jAdapterProviderTest {

	private final Neo4jAdapterProvider provider = new Neo4jAdapterProvider();

	@Test
	void createsAnAdapterForTheGivenConnection() {
		DataAdapterConnection connection = new DataAdapterConnection();
		connection.put("url", "bolt://host:7687");
		DataAdapter adapter = provider.create(connection, new DataRagConfig(), Map.of("classDef", List.of()));
		assertEquals(Neo4jAdapter.class, adapter.getClass());
	}
}
