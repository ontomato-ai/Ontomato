package io.ontomato.dataengine.dataAdapter;

import com.alibaba.fastjson2.JSONObject;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

public final class JdbcSandboxArtifacts {

    private JdbcSandboxArtifacts() {}

    public static String quote(Connection connection, String name) throws SQLException {
        String opening = connection.getMetaData().getIdentifierQuoteString().trim();
        String closing = "[".equals(opening) ? "]" : opening;
        return opening + name.replace(closing, closing + closing) + closing;
    }

    public static SandboxCapability probe(DataAdapter adapter, String deployTag) {
        try (var connection = adapter.openConnection(); var statement = connection.createStatement()) {
            return SandboxCapability.probe(deployTag,
                name -> statement.executeUpdate("CREATE TABLE " + quote(connection, name) + " (id VARCHAR(16))"),
                name -> statement.executeUpdate("DROP TABLE " + quote(connection, name)));
        } catch (SQLException failure) {
            return SandboxCapability.failed("connect to the database for", failure);
        }
    }

    public static List<JSONObject> list(DataAdapter adapter, String prefix) {
        var artifacts = new ArrayList<JSONObject>();
        try (var connection = adapter.openConnection()) {
            var metadata = connection.getMetaData();
            String escape = metadata.getSearchStringEscape();
            String pattern = prefix.replace("_", escape + "_") + "%";
            try (var tables = metadata.getTables(connection.getCatalog(), connection.getSchema(), pattern,
                    new String[] {"TABLE", "BASE TABLE"})) {
                while (tables.next()) {
                    String name = tables.getString("TABLE_NAME");
                    if (name.startsWith(prefix)) {
                        artifacts.add(JSONObject.of("kind", "table", "name", name,
                            "schema", tables.getString("TABLE_SCHEM"), "catalog", tables.getString("TABLE_CAT")));
                    }
                }
            }
        } catch (SQLException failure) {
            throw new IllegalStateException("Cannot list sandbox tables: " + failure.getMessage(), failure);
        }
        return artifacts;
    }
}
