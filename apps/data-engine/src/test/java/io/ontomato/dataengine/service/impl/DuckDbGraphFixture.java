package io.ontomato.dataengine.service.impl;

import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.List;
import java.util.Map;
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.dataAdapter.DataAdapterConnection;
import io.ontomato.dataengine.dataAdapter.DataAdapterRegistry;
import io.ontomato.dataengine.dataAdapter.DuckDBAdapterProvider;

/** A relational graph consumed through the installed adapter, with a non-id primary key and one isolated object. */
final class DuckDbGraphFixture {
    final BusinessConfig config = new BusinessConfig();
    final DataAdapterRegistry registry = new DataAdapterRegistry(List.of(new DuckDBAdapterProvider()), new DataRagConfig());
    final JSONObject rule = JSON.parseObject("""
            {"classlist":["pump"],"classDef":[
              {"className":"pump","inStarChart":true,"attrs":[
                {"name":"code","type":"varchar","primaryKey":true},
                {"name":"name","type":"varchar","bizzkey":true},
                {"name":"tank_code","type":"varchar"}]},
              {"className":"tank","inStarChart":true,"attrs":[{"name":"id","type":"varchar","primaryKey":true}]}],
             "relationship_rule":{"feeds":{"fromclass":"pump","toclass":"tank",
               "fromField":"tank_code","toField":"id","desc":"feeds"}}}
            """);
    private final String url;

    DuckDbGraphFixture(Path file, String namespace) throws Exception {
        url = "jdbc:duckdb:" + file;
        DataAdapterConnection connection = new DataAdapterConnection();
        connection.setUrl(url);
        config.setDataAdapter("duckdb");
        config.setDataAdapterConnections(Map.of("duckdb", connection));
        execute("CREATE TABLE " + namespace + "pump (code VARCHAR PRIMARY KEY, name VARCHAR, tank_code VARCHAR)");
        execute("CREATE TABLE " + namespace + "tank (id VARCHAR PRIMARY KEY)");
        execute("INSERT INTO " + namespace + "pump VALUES ('P1','Business name','T1'),('P2','Isolated',NULL)");
        execute("INSERT INTO " + namespace + "tank VALUES ('T1')");
    }

    void execute(String sql) throws Exception {
        try (var connection = DriverManager.getConnection(url); var statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    String scalar(String sql) throws Exception {
        try (var connection = DriverManager.getConnection(url); var statement = connection.createStatement(); var rows = statement.executeQuery(sql)) {
            if (!rows.next()) throw new AssertionError("No fixture row");
            return rows.getString(1);
        }
    }
}
