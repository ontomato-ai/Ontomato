package io.ontomato.dataengine.dataAdapter;
import com.alibaba.fastjson2.*;
import java.util.Map;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;
class Neo4jWriteWhereTest {
    private final Neo4jAdapter adapter = new Neo4jAdapter(new DataAdapterConnection(), Map.of());
    private Object compile(JSONObject where) { return invoke( "buildWhere", where, Map.of("id", "varchar"), null); }
    private Object invoke(String name, Object... args) {
        try {
            var method = java.util.Arrays.stream(adapter.getClass().getDeclaredMethods())
                    .filter(m -> m.getName().equals(name)).findFirst().orElseThrow();
            method.setAccessible(true);
            return method.invoke(adapter, args);
        } catch (java.lang.reflect.InvocationTargetException e) {
            throw (RuntimeException) e.getCause();
        } catch (ReflectiveOperationException e) { throw new AssertionError(e); }
    }
    @Test void unknownAndMalformedConditionsThrow() {
        assertThrows(IllegalArgumentException.class, () -> compile(JSONObject.of("field", "id", "operator", "unknown", "value", "p")));
        assertThrows(IllegalArgumentException.class, () -> compile(new JSONObject()));
        assertThrows(IllegalArgumentException.class, () -> compile(JSONObject.of("and", new JSONArray())));
        assertThrows(IllegalArgumentException.class, () -> compile(JSONObject.of("and", JSONArray.of(JSONObject.of("field", "id", "operator", "unknown")))));
    }
    @Test void internalNullCleanupIsStillSupported() { assertNotNull(compile(null)); }
}
