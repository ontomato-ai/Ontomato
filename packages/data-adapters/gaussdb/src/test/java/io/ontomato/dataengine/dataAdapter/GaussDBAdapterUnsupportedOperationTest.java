package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Map;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;

class GaussDBAdapterUnsupportedOperationTest {

	private final GaussDBAdapter adapter = new GaussDBAdapter(null, null);

	@Test
	void unsupportedOperationsThrow() {
		assertThrowsUnsupported(() -> adapter.createNamespace("ns"), "createNamespace");
		assertThrowsUnsupported(() -> adapter.truncateNamespace("ns"), "truncateNamespace");
		assertThrowsUnsupported(() -> adapter.dropNamespace("ns"), "dropNamespace");
		assertThrowsUnsupported(() -> adapter.createClass("ns", Map.of()), "createClass");
		assertThrowsUnsupported(() -> adapter.createEdgeType("ns", "edge"), "createEdgeType");
		assertThrowsUnsupported(() -> adapter.insertObjects("ns", Map.of(), new JSONArray()), "insertObjects");
		assertThrowsUnsupported(() -> adapter.updateObjects("ns", Map.of(), new JSONObject(), new JSONObject()), "updateObjects");
		assertThrowsUnsupported(() -> adapter.deleteObjects("ns", Map.of(), new JSONObject()), "deleteObjects");
		assertThrowsUnsupported(() -> adapter.createEdge("ns", "rel", "c1", "o1", "c2", "o2"), "createEdge");
		assertThrowsUnsupported(() -> adapter.deleteEdge("ns", "rel", "c1", "o1", "c2", "o2"), "deleteEdge");
		assertThrowsUnsupported(() -> adapter.query(new JSONObject(), "s", "d", null, null), "query");
	}

    @Test void unknownWriteConditionsAlsoThrow() throws Exception {
        var where = JSONObject.of("field", "id", "operator", "unknown", "value", "p");
        assertThrows(UnsupportedDataAdapterOperationException.class, () -> adapter.deleteObjects(null, Map.of(), where));
        assertThrows(UnsupportedDataAdapterOperationException.class, () -> adapter.updateObjects(null, Map.of(), new JSONObject(), where));
    }

	private void assertThrowsUnsupported(org.junit.jupiter.api.function.Executable exec, String op) {
		assertThrows(UnsupportedDataAdapterOperationException.class, exec, op);
	}
}
