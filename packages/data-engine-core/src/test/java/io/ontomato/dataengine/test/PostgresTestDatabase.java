package io.ontomato.dataengine.test;

import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;

/** Opt-in disposable PostgreSQL database; every test owns and removes only its unique schema. */
public abstract class PostgresTestDatabase {
    protected JdbcTemplate jdbc;
    protected DriverManagerDataSource dataSource;
    private final String schema = "test_" + UUID.randomUUID().toString().replace("-", "");

    @BeforeEach
    protected void openSchema() {
        String url = System.getenv("ONTOMATO_TEST_POSTGRES_URL");
        if (url == null || url.isBlank())
            throw new IllegalStateException(
                    "Set ONTOMATO_TEST_POSTGRES_URL to a disposable PostgreSQL database");
        dataSource = new DriverManagerDataSource(System.getenv("ONTOMATO_TEST_POSTGRES_URL"),
                System.getenv("ONTOMATO_TEST_POSTGRES_USER"), System.getenv("ONTOMATO_TEST_POSTGRES_PASSWORD"));
        new JdbcTemplate(dataSource).execute("CREATE SCHEMA " + schema);
        var properties = new java.util.Properties();
        properties.setProperty("currentSchema", schema + ",public");
        dataSource.setConnectionProperties(properties);
        jdbc = new JdbcTemplate(dataSource);
    }

    @AfterEach
    protected void closeSchema() {
        if (jdbc != null) jdbc.execute("DROP SCHEMA " + schema + " CASCADE");
    }

    protected <T> T wire(T dao) {
        ReflectionTestUtils.setField(dao, "jdbcTemplate", jdbc);
        return dao;
    }

    protected void requireVectorExtension() {
        org.junit.jupiter.api.Assumptions.assumeTrue(jdbc.queryForObject(
                "SELECT COUNT(*) FROM pg_available_extensions WHERE name = 'vector'", Integer.class) > 0,
                "pgvector is not installed");
        jdbc.execute("CREATE EXTENSION IF NOT EXISTS vector");
    }
}
