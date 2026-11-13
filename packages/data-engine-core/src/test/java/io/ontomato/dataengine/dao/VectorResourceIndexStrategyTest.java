package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;

/** SQL strategy boundaries independent of an optional PostgreSQL test server. */
class VectorResourceIndexStrategyTest {

    @Test
    void keepsHalfPrecisionIndexAt4000AndUsesBinaryIndexAbove4000() {
        VectorResourceDao dao = new VectorResourceDao();
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        ReflectionTestUtils.setField(dao, "jdbcTemplate", jdbc);

        dao.ensureVectorIndex("vector-test", 4000);
        dao.ensureVectorIndex("vector-test", 4096);
        ArgumentCaptor<String> statements = ArgumentCaptor.forClass(String.class);
        verify(jdbc, times(2)).execute(statements.capture());
        List<String> create = statements.getAllValues();
        assertTrue(create.get(0).contains("halfvec(4000)") && create.get(0).contains("halfvec_l2_ops"));
        assertTrue(create.get(1).contains("binary_quantize(brief_vector)::bit(4096)"));
        assertTrue(create.get(1).contains("bit_hamming_ops"));
    }

    @Test
    void highDimensionalQueryReranksCandidatesUsingOriginalVectors() {
        String high = VectorResourceDao.searchSql("vector-test", 4096);
        assertTrue(high.contains("WITH candidates AS MATERIALIZED"));
        assertTrue(high.contains("binary_quantize(brief_vector)::bit(4096)"));
        assertTrue(high.contains("ORDER BY brief_vector <-> ?::vector LIMIT ?"));
        String standard = VectorResourceDao.searchSql("vector-test", 4000);
        assertTrue(standard.contains("halfvec(4000)"));
    }
}
