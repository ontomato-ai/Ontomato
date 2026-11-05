package io.ontomato.dataengine.core.db.jdbc;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import io.ontomato.dataengine.core.bean.Condition;
import io.ontomato.dataengine.core.bean.Entity;

class AbsJdbcBaseDaoIdTest extends io.ontomato.dataengine.test.PostgresTestDatabase {

    /** A form that starts with id "" must create a row under a generated id, never under "". */
    @Test
    void saveOrUpdateWithBlankIdInsertsUnderGeneratedId() {
        ProbeDao dao = new ProbeDao(jdbc);
        jdbc.execute(dao.tableDesc.ddl());
        Probe probe = new Probe();
        probe.setId("");

        String id = dao.saveOrUpdate(probe);

        assertFalse(id.isBlank());
        assertEquals(id, probe.getId());
        assertEquals(id, dao.getById(id).getId());
        assertEquals(1, dao.queryList(new ProbeCondition()).size());
        org.junit.jupiter.api.Assertions.assertNull(dao.getById(""));
    }

    static class ProbeDao extends AbsJdbcBaseDao<Probe, ProbeCondition> {
        ProbeDao(JdbcTemplate jdbcTemplate) {
            super(jdbcTemplate);
        }
    }

    public static class Probe implements Entity {
        private String id;

        public String getId() {
            return id;
        }

        public void setId(String id) {
            this.id = id;
        }
    }

    public static class ProbeCondition implements Condition {
    }
}
