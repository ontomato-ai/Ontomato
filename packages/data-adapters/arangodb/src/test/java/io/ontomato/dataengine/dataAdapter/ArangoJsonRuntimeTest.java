package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

import dev.langchain4j.internal.Json;
import jakarta.json.JsonObject;

class ArangoJsonRuntimeTest {

	@Test
	void langChainJsonCodecLoadsTheDriversJsonpModule() {
		JsonObject value = Json.fromJson("{\"adapter\":\"arangodb\"}", JsonObject.class);
		assertEquals("arangodb", value.getString("adapter"));
		assertEquals(value, Json.fromJson(Json.toJson(value), JsonObject.class));
	}
}
