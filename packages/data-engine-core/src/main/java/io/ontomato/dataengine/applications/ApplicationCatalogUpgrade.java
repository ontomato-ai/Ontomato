package io.ontomato.dataengine.applications;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectReader;
import com.fasterxml.jackson.databind.json.JsonMapper;
import java.io.IOException;
import java.util.ArrayList;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.context.annotation.DependsOn;
import org.springframework.core.io.Resource;
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
            ALTER TABLE sys_application ADD COLUMN IF NOT EXISTS category varchar(16) NOT NULL DEFAULT 'business';
            ALTER TABLE sys_application ADD COLUMN IF NOT EXISTS entry jsonb;
            ALTER TABLE sys_application ADD COLUMN IF NOT EXISTS entry_access jsonb;
            ALTER TABLE sys_application ADD COLUMN IF NOT EXISTS schedule_adapter varchar(64);
            ALTER TABLE sys_application ADD COLUMN IF NOT EXISTS release_id varchar(128);
            ALTER TABLE sys_application ADD COLUMN IF NOT EXISTS page_skills jsonb NOT NULL DEFAULT '[]'::jsonb;
            ALTER TABLE sys_application ADD COLUMN IF NOT EXISTS panel_uses jsonb NOT NULL DEFAULT '[]'::jsonb;
            ALTER TABLE sys_application ADD COLUMN IF NOT EXISTS declaration_permissions jsonb NOT NULL DEFAULT '[]'::jsonb;
            ALTER TABLE sys_application ADD COLUMN IF NOT EXISTS panel_settings jsonb NOT NULL DEFAULT '{}'::jsonb;
            """);
        db.execute("""
            UPDATE sys_application AS app SET panel_uses = (
                SELECT jsonb_agg(
                    CASE WHEN use_item ? 'defaultAgentId' THEN (use_item - 'defaultAgentId') ||
                        CASE WHEN use_item ? 'defaultAgent' OR use_item->>'defaultAgentId' IS NULL THEN '{}'::jsonb
                            ELSE jsonb_build_object('defaultAgent', jsonb_build_object('kind', 'id', 'id', use_item->>'defaultAgentId'))
                        END
                    ELSE use_item END ORDER BY position)
                FROM jsonb_array_elements(app.panel_uses) WITH ORDINALITY AS uses(use_item, position)
            ) WHERE app.panel_uses @? '$[*].defaultAgentId';

            UPDATE sys_application AS app SET page_skills = (
                SELECT jsonb_agg(
                    CASE WHEN mapping @? '$.defaults[*].agentKey' THEN jsonb_set(mapping, '{defaults}', (
                        SELECT jsonb_agg(
                            CASE WHEN entry ? 'agentKey' THEN (entry - 'agentKey') ||
                                CASE WHEN entry ? 'defaultAgent' THEN '{}'::jsonb
                                    ELSE jsonb_build_object('defaultAgent', jsonb_build_object('kind', 'preset', 'agentKind', entry->>'agentKey'))
                                END
                            ELSE entry END ORDER BY default_position)
                        FROM jsonb_array_elements(mapping->'defaults') WITH ORDINALITY AS defaults(entry, default_position)
                    )) ELSE mapping END ORDER BY mapping_position)
                FROM jsonb_array_elements(app.page_skills) WITH ORDINALITY AS mappings(mapping, mapping_position)
            ) WHERE app.page_skills @? '$[*].defaults[*].agentKey';
            """);
    }
    @Component("applicationBuiltins")
    @DependsOn("applicationCatalogUpgrade")
    public static class Builtins implements InitializingBean {
        private static final ObjectReader DECLARATIONS = JsonMapper.builder()
            .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .build().readerFor(ApplicationCatalog.Builtin.class);

        private final ApplicationCatalog catalog;
        public Builtins(ApplicationCatalog catalog) { this.catalog = catalog; }
        public void afterPropertiesSet() throws Exception {
            var declarations = new ArrayList<ApplicationCatalog.Builtin>();
            for (var resource : new PathMatchingResourcePatternResolver().getResources("classpath*:applications/*.json"))
                declarations.add(readDeclaration(resource));
            catalog.builtins("data-engine", declarations);
        }

        static ApplicationCatalog.Builtin readDeclaration(Resource resource) throws IOException {
            try {
                return DECLARATIONS.readValue(resource.getInputStream());
            } catch (JsonProcessingException error) {
                throw new IOException(resource.getDescription() + ": " + error.getOriginalMessage(), error);
            }
        }
    }
}
