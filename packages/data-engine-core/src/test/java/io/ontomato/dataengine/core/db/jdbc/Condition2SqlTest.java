package io.ontomato.dataengine.core.db.jdbc;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.Date;
import java.util.List;

import org.junit.jupiter.api.Test;

import io.ontomato.dataengine.core.bean.Condition;
import io.ontomato.dataengine.core.bean.Entity;

class Condition2SqlTest {
    private final Condition2Sql converter = new Condition2Sql(new TableDesc(Record.class), Filter.class);

    @Test
    void startAndEndConditionsUseInclusiveBoundsForSupportedRangeTypes() {
        Filter filter = new Filter();
        filter.startCount = 1;
        filter.endCount = 3;
        filter.startTimeout = 100L;
        filter.endTimeout = 200L;
        filter.startLevel = 2;
        filter.endLevel = 4;
        filter.startTime = new Date(1000);
        filter.endTime = new Date(2000);

        Condition2Sql.Where where = converter.build(filter);

        assertEquals("count >= ? AND count <= ? AND timeout >= ? AND timeout <= ?"
                + " AND level >= ? AND level <= ? AND time >= ? AND time <= ?", where.whereSql());
        assertEquals(List.of(1, 3, 100L, 200L, (short) 2, (short) 4, new Date(1000), new Date(2000)),
                where.params());
    }

    @Test
    void exactFieldsKeepEqualityIncludingNamesStartingWithStartOrEnd() {
        Filter filter = new Filter();
        filter.timeout = 100L;
        filter.startSequence = 10L;
        filter.endSequence = 20L;
        filter.nameEqual = "sample";

        Condition2Sql.Where where = converter.build(filter);

        assertEquals("timeout = ? AND start_sequence = ? AND end_sequence = ? AND name = ?", where.whereSql());
        assertEquals(List.of(100L, 10L, 20L, "sample"), where.params());
    }

    static class Record implements Entity {
        private Integer count;
        private Long timeout;
        private Short level;
        private Date time;
        private Long startSequence;
        private Long endSequence;
        private String name;

        public String getId() { return null; }
        public void setId(String id) {}
    }

    static class Filter implements Condition {
        private Integer startCount;
        private Integer endCount;
        private Long startTimeout;
        private Long endTimeout;
        private Short startLevel;
        private Short endLevel;
        private Date startTime;
        private Date endTime;
        private Long timeout;
        private Long startSequence;
        private Long endSequence;
        private String nameEqual;
    }
}
