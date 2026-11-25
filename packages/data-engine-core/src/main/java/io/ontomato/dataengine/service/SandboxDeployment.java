package io.ontomato.dataengine.service;

import io.ontomato.dataengine.dataAdapter.SandboxTarget;
import jakarta.annotation.PostConstruct;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
@DependsOn("jdbcInitDb")
public class SandboxDeployment {
    private final JdbcTemplate jdbc;
    private String tag;
    private final java.util.concurrent.locks.ReentrantReadWriteLock operations =
        new java.util.concurrent.locks.ReentrantReadWriteLock();

    public java.util.concurrent.locks.Lock operationLock() { return operations.readLock(); }
    public java.util.concurrent.locks.Lock scanLock() { return operations.writeLock(); }

    public SandboxDeployment(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @PostConstruct
    void initialize() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS platform_deployment_identity (
                id smallint PRIMARY KEY CHECK (id=1), deploy_tag text NOT NULL CHECK (deploy_tag ~ '^[a-z0-9]{6}$')
            )
            """);
        jdbc.update("INSERT INTO platform_deployment_identity (id, deploy_tag) VALUES (1,?) ON CONFLICT (id) DO NOTHING",
            SandboxTarget.randomTag(6));
        tag = jdbc.queryForObject("SELECT deploy_tag FROM platform_deployment_identity WHERE id=1", String.class);
    }

    public String tag() {
        return tag;
    }
}
