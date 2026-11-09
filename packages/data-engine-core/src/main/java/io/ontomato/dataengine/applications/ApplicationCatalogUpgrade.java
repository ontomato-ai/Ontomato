package io.ontomato.dataengine.applications;

import com.alibaba.fastjson2.JSON;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.context.annotation.DependsOn;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
@DependsOn("jdbcInitDb")
public class ApplicationCatalogUpgrade implements InitializingBean {
    private final JdbcTemplate db;
    public ApplicationCatalogUpgrade(JdbcTemplate db) { this.db = db; }
    public void afterPropertiesSet() {
        db.execute("""
            CREATE TABLE IF NOT EXISTS sys_application(id varchar(128) PRIMARY KEY,names jsonb NOT NULL,
                entry_path text NOT NULL,sort integer NOT NULL,groups jsonb NOT NULL,updated_at timestamptz NOT NULL);
            ALTER TABLE sys_application ADD COLUMN IF NOT EXISTS domain_id varchar(128);
            ALTER TABLE sys_application ADD COLUMN IF NOT EXISTS owner_service varchar(64);
            ALTER TABLE sys_application ADD COLUMN IF NOT EXISTS owner_user_id varchar(128);
            ALTER TABLE sys_application ADD COLUMN IF NOT EXISTS kind varchar(16);
            ALTER TABLE sys_application ADD COLUMN IF NOT EXISTS descriptions jsonb;
            ALTER TABLE sys_application ADD COLUMN IF NOT EXISTS icon varchar(64);
            ALTER TABLE sys_application ADD COLUMN IF NOT EXISTS rail varchar(16);
            ALTER TABLE sys_application ADD COLUMN IF NOT EXISTS entry jsonb;
            ALTER TABLE sys_application ADD COLUMN IF NOT EXISTS entry_access jsonb;
            ALTER TABLE sys_application ADD COLUMN IF NOT EXISTS schedule_adapter varchar(64);
            ALTER TABLE sys_application ADD COLUMN IF NOT EXISTS release_id varchar(128);
            """);
    }
    @Component("applicationBuiltins")
    @DependsOn("applicationCatalogUpgrade")
    public static class Builtins implements InitializingBean {
        private final ApplicationCatalog catalog;
        public Builtins(ApplicationCatalog catalog) { this.catalog = catalog; }
        public void afterPropertiesSet() throws Exception {
            for (var resource : new PathMatchingResourcePatternResolver().getResources("classpath*:applications/*.json"))
                catalog.builtins("data-engine", List.of(JSON.parseObject(resource.getContentAsString(StandardCharsets.UTF_8), ApplicationCatalog.Builtin.class)));
        }
    }
}
