package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionTemplate;

import com.pgvector.PGvector;

import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.model.output.Response;
import io.ontomato.dataengine.bean.VectorResource;
import io.ontomato.dataengine.migration.VectorResourceIndexMigration;
import io.ontomato.dataengine.service.ai.EmbeddingService;
import io.ontomato.dataengine.service.vector.VectorRetrievalGate;
import io.ontomato.dataengine.test.PostgresTestDatabase;

/**
 * The search contract on a real pgvector: searches order and filter exactly as the partial HNSW index
 * is defined, so the planner can use it, and a table holding two generations' dimensions still writes
 * and searches.
 */
class VectorSearchIndexPostgresBoundaryTest extends PostgresTestDatabase {

	private static final String TABLE = "vector-_doc-text-d1";

	private VectorResourceDao dao;
	private EmbeddingService embeddingService;

	@BeforeEach
	void wireDao() {
		requireVectorExtension();
		dao = wire(new VectorResourceDao());
		embeddingService = mock(EmbeddingService.class);
		VectorRetrievalGate gate = mock(VectorRetrievalGate.class);
		when(gate.read(anyString(), any())).thenAnswer(call -> call.<Supplier<?>>getArgument(1).get());
		when(gate.write(anyString(), any())).thenAnswer(call -> call.<Supplier<?>>getArgument(1).get());
		ReflectionTestUtils.setField(dao, "embeddingService", embeddingService);
		ReflectionTestUtils.setField(dao, "retrievalGate", gate);
		ReflectionTestUtils.setField(dao, "transactions", new TransactionTemplate(new DataSourceTransactionManager(dataSource)));
		jdbc.execute("CREATE TABLE \"" + TABLE + "\" (id VARCHAR(64) PRIMARY KEY, brief TEXT, path VARCHAR(512), "
				+ "class_name VARCHAR(256), attr_name VARCHAR(256), object_id VARCHAR(256), brief_vector vector)");
	}

	private void row(String id, float... vector) {
		jdbc.update("INSERT INTO \"" + TABLE + "\" VALUES (?, ?, ?, '/doc', 'text', ?, ?::vector)",
				id, "brief " + id, TABLE + "/" + id + ".txt", "obj-" + id, new PGvector(vector));
	}

	private void queryVector(float... vector) {
		when(embeddingService.embedding(anyString(), anyString())).thenReturn(Response.from(Embedding.from(vector)));
	}

	private List<String> indexes() {
		return jdbc.queryForList("SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ? AND indexname LIKE 'vidx\\_%' ORDER BY 1",
				String.class, TABLE);
	}

	private List<String> ids(List<VectorResource> resources) {
		return resources.stream().map(VectorResource::getId).toList();
	}

	@Test
	void searchReturnsTheNearestFirstThroughTheIndex() {
		row("far", 0f, 0f, 1f);
		row("near", 1f, 0f, 0f);
		row("mid", 1f, 1f, 0f);
		dao.ensureVectorIndex(TABLE, 3);
		queryVector(1f, 0f, 0f);

		assertEquals(List.of("near", "mid"), ids(dao.find("q", 2, "/doc", "text", "d1")));

		// With the sequential scan ruled out the plan must name the index: the search expression matches it.
		List<String> plan = jdbc.execute((ConnectionCallback<List<String>>) connection -> {
			List<String> lines = new ArrayList<>();
			try (Statement statement = connection.createStatement()) {
				statement.execute("SET enable_seqscan = off");
				String sql = VectorResourceDao.searchSql(TABLE, 3).replaceFirst("\\?", "'[1,0,0]'").replace("LIMIT ?", "LIMIT 2");
				try (ResultSet rs = statement.executeQuery("EXPLAIN " + sql)) {
					while (rs.next()) lines.add(rs.getString(1));
				}
			}
			return lines;
		});
		String index = indexes().get(0);
		assertTrue(plan.stream().anyMatch(line -> line.contains(index)), "the search must use " + index + ": " + plan);
	}

	@Test
	void twoGenerationsOfDimensionsWriteAndSearchSideBySide() {
		row("three", 1f, 0f, 0f);
		dao.ensureVectorIndex(TABLE, 3);
		row("four", 1f, 0f, 0f, 0f);
		dao.ensureVectorIndex(TABLE, 4);
		assertEquals(2, indexes().size());

		queryVector(1f, 0f, 0f, 0f);
		assertEquals(List.of("four"), ids(dao.find("q", 5, "/doc", "text", "d1")));
		queryVector(1f, 0f, 0f);
		assertEquals(List.of("three"), ids(dao.find("q", 5, "/doc", "text", "d1")));
	}

	@Test
	void migrationIndexesStoredDimensionsAndANewGenerationReplacesThem() {
		row("a", 1f, 0f, 0f);
		row("b", 0f, 1f, 0f);
		VectorResourceIndexMigration migration = new VectorResourceIndexMigration();
		ReflectionTestUtils.setField(migration, "vectorResourceDao", dao);
		migration.run();
		assertEquals(1, indexes().size());

		dao.clearTableVectors(TABLE);
		assertEquals(List.of(), indexes(), "a cleared generation keeps no index");
		dao.fillTableVector(TABLE, "a", new float[] { 1f, 0f, 0f, 0f, 0f });
		assertEquals(1, indexes().size());
		assertTrue(indexes().get(0).endsWith("_5"));
	}
}
