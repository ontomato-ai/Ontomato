package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;

class LegacyDataAdapterConnectionsTest {

	// legacy key, legacy field prefix, adapter type
	private static final String[][] LEGACY = {
			{ "mysqlDataAdapterProperties", "mysql", "mysql" },
			{ "pgsqlDataAdapterProperties", "pgsql", "postgresql" },
			{ "oracleDataAdapterProperties", "oracle", "oracle" },
			{ "sqlServerDataAdapterProperties", "sqlServer", "sqlserver" },
			{ "db2DataAdapterProperties", "db2", "db2" },
			{ "gaussDBDataAdapterProperties", "gaussDB", "gaussdb" },
			{ "duckDBDataAdapterProperties", "duckdb", "duckdb" },
			{ "dmDataAdapterProperties", "dm", "dm" },
	};

	@Test
	void everyLegacyPropertyObjectBecomesTheConnectionOfItsType() {
		for (String[] legacy : LEGACY) {
			JSONObject properties = new JSONObject();
			properties.put(legacy[1] + "Url", "jdbc:" + legacy[2]);
			properties.put(legacy[1] + "User", legacy[2] + "-user");
			properties.put(legacy[1] + "Password", legacy[2] + "-password");
			JSONObject stored = new JSONObject();
			stored.put("dataAdapter", legacy[2]);
			stored.put(legacy[0], properties);

			assertTrue(LegacyDataAdapterConnections.migrate(stored), legacy[0]);

			assertFalse(stored.containsKey(legacy[0]), legacy[0]);
			JSONObject connection = stored.getJSONObject("dataAdapterConnections").getJSONObject(legacy[2]);
			assertEquals("jdbc:" + legacy[2], connection.getString("url"));
			assertEquals(legacy[2] + "-user", connection.getString("user"));
			assertEquals(legacy[2] + "-password", connection.getString("password"));
			assertEquals(legacy[2], stored.getString("dataAdapter"));
		}
	}

	@Test
	void allLegacyObjectsOfOneRecordMigrateTogetherAndNullOnesAreDropped() {
		JSONObject stored = new JSONObject();
		for (String[] legacy : LEGACY) {
			JSONObject properties = new JSONObject();
			properties.put(legacy[1] + "Url", "jdbc:" + legacy[2]);
			stored.put(legacy[0], properties);
		}
		stored.put("dmDataAdapterProperties", null);

		assertTrue(LegacyDataAdapterConnections.migrate(stored));

		JSONObject connections = stored.getJSONObject("dataAdapterConnections");
		assertEquals(LEGACY.length - 1, connections.size());
		assertNull(connections.get("dm"));
		for (String[] legacy : LEGACY) {
			assertFalse(stored.containsKey(legacy[0]), legacy[0]);
		}
	}

	@Test
	void aRecordAlreadyInTheNewFormatIsLeftAlone() {
		String content = "{\"dataAdapter\":\"postgresql\",\"dataAdapterConnections\":{\"postgresql\":{\"url\":\"jdbc:pg\",\"user\":\"u\",\"password\":\"p\"}}}";
		JSONObject stored = JSON.parseObject(content);

		assertFalse(LegacyDataAdapterConnections.migrate(stored));
		assertEquals(JSON.parseObject(content), stored);
	}


}
