package io.ontomato.dataengine.dao;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.util.DigestUtils;

import com.pgvector.PGvector;
import io.ontomato.dataengine.bean.VectorResource;
import io.ontomato.dataengine.service.ai.EmbeddingService;
import io.ontomato.dataengine.service.vector.VectorRetrievalGate;

import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.model.output.Response;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("vectorResourceDao")
public class VectorResourceDao extends BaseDao {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Autowired
	private EmbeddingService embeddingService;

	@Autowired
	private VectorRetrievalGate retrievalGate;

	@Autowired
	private TransactionTemplate transactions;

	private String dirName = "vectorResource";

	/** pgvector builds HNSW indexes on {@code halfvec} of at most this many dimensions. */
	static final int HNSW_MAX_DIMENSIONS = 4000;

	/** The fewest HNSW candidates a search keeps; pgvector's own default. */
	private static final int MIN_EF_SEARCH = 40;

	/** Vector indexes this process has confirmed, as {@code table#dimensions}; cleared with the table. */
	private final Set<String> ensuredIndexes = ConcurrentHashMap.newKeySet();

	private String generateIndexNamePrefix(String tmpNamespace) {
		return "vector-" + tmpNamespace.replace("/", "_");
	}

	private String generateIndexName(String className, String attrName, String domainId) {
		return "vector-" + className.replace("/", "_") + "-" + attrName + "-" + domainId;
	}

	/**
	 * Compose the stored relative path of a vector resource from its file id (the last path segment,
	 * {@code id.suffix}). The {@code className} passed in must already carry the sandbox prefix when
	 * inside a sandbox (see {@link io.ontomato.dataengine.dataAdapter.DataAdapter#sandboxClassName});
	 * this method only mirrors how {@link #generateIndexName} and {@link #insert} form the path.
	 */
	public String generatePath(String className, String attrName, String domainId, String fileId) {
		return generateIndexName(className, attrName, domainId) + "/" + fileId;
	}

	private String quotedTable(String indexName) {
		return "\"" + indexName + "\"";
	}

	/** The text a resource is embedded with: the stored brief and every batch embedding go through it. */
	public String replace(String brief) {
		String regex = "[\\+\\-\\=\\&\\|\\>\\<!\\(\\)\\{\\}\\[\\]\\^\\\\\\\"\\~\\*\\?\\:\\/\\s]";
		String replaceBrief = brief.replaceAll(regex, "");
		return replaceBrief;
	}

	/**
	 * The HNSW index of one vector table for vectors of one dimension count. It is partial
	 * ({@code vector_dims(brief_vector) = n}), so rows of another generation's dimensions, which a
	 * table holds while a rebuild of its domain is pending, neither break the cast nor enter it.
	 */
	private static String vectorIndexName(String indexName, int dimensions) {
		return "vidx_" + DigestUtils.md5DigestAsHex(indexName.getBytes(StandardCharsets.UTF_8)).substring(0, 24)
				+ "_" + dimensions;
	}

	/**
	 * Make sure the table has the HNSW index searches of this dimension count use. Every path that
	 * stores a vector calls it with that vector's length, so a new table, a new generation after a
	 * rebuild and a table from before the index all get it on their next write.
	 */
	public void ensureVectorIndex(String indexName, int dimensions) {
		String key = indexName + "#" + dimensions;
		if (ensuredIndexes.contains(key)) {
			return;
		}
		if (dimensions > HNSW_MAX_DIMENSIONS) {
			log.warn("Vector table {} holds {}-dimension vectors; pgvector indexes at most {} dimensions, so its searches scan the table",
					indexName, dimensions, HNSW_MAX_DIMENSIONS);
			ensuredIndexes.add(key);
			return;
		}
		String name = vectorIndexName(indexName, dimensions);
		Integer existing = jdbcTemplate.queryForObject(
				"SELECT count(*) FROM pg_indexes WHERE schemaname = current_schema() AND indexname = ?", Integer.class, name);
		if (existing == null || existing == 0) {
			log.info("Creating vector index {} on {} for {} dimensions", name, indexName, dimensions);
			jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS \"" + name + "\" ON " + quotedTable(indexName)
					+ " USING hnsw ((brief_vector::halfvec(" + dimensions + ")) halfvec_l2_ops)"
					+ " WHERE vector_dims(brief_vector) = " + dimensions);
		}
		ensuredIndexes.add(key);
	}

	/** Forget the confirmed indexes of a table that was dropped or whose vector indexes were dropped. */
	private void forgetVectorIndexes(String indexName) {
		ensuredIndexes.removeIf(key -> key.startsWith(indexName + "#"));
	}

	/** Every vector resource table of the current schema, across domains. */
	public List<String> listAllTables() {
		return jdbcTemplate.queryForList(
				"SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' AND table_name LIKE 'vector-%'",
				String.class);
	}

	/** The dimension counts of the vectors a table currently stores. */
	public List<Integer> storedDimensions(String indexName) {
		return jdbcTemplate.queryForList("SELECT DISTINCT vector_dims(brief_vector) FROM " + quotedTable(indexName)
				+ " WHERE brief_vector IS NOT NULL", Integer.class);
	}

	private float[] briefToVector(String replaceBrief, String domainId) {
		Response<Embedding> embeddingResponse = embeddingService.embedding(replaceBrief, domainId);
		float[] embededVector = embeddingResponse.content().vector();
		return embededVector;
	}

	private void ensureTable(String indexName) {
		jdbcTemplate.execute(
				"CREATE TABLE IF NOT EXISTS " + quotedTable(indexName) + " ("
						+ "id VARCHAR(64) PRIMARY KEY, "
						+ "brief TEXT, "
						+ "path VARCHAR(512), "
						+ "class_name VARCHAR(256), "
						+ "attr_name VARCHAR(256), "
						+ "object_id VARCHAR(256), "
						+ "brief_vector vector"
						+ ")");
	}

	/**
	 * Ensure the vector table and its file directory exist (idempotent).
	 *
	 * <p>Used by the sandbox {@code createClass} to materialize the vector table and directory as an
	 * explicit step, symmetric with {@link #dropNamespace}. Also the single place that backs the lazy
	 * creation inside {@link #insert}, so the two callers share one idempotent rule.</p>
	 */
	public void ensureVectorTable(String className, String attrName, String domainId) {
		String indexName = generateIndexName(className, attrName, domainId);
		new File("conf/" + dirName + "/" + indexName).mkdirs();
		ensureTable(indexName);
	}

	/** The suffix rule for an uploaded resource file; shared by {@link #insert} and the test-data import preflight. */
	public static boolean isValidSuffix(String suffix) {
		return suffix != null && suffix.matches("^[a-zA-Z0-9]{1,16}$");
	}

	public VectorResource insert(VectorResource vectorResource, InputStream is, String suffix, String domainId) {
		return insert(vectorResource, is, suffix, domainId, null);
	}

	/**
	 * Store one resource: its file, its brief and its vector. {@code vector} is the embedding of
	 * {@link #replace}d content computed by a batch upload inside the same write boundary; null
	 * embeds the content here.
	 */
	public VectorResource insert(VectorResource vectorResource, InputStream is, String suffix, String domainId, float[] vector) {
		if (vectorResource.getContent() == null || vectorResource.getContent().trim().isEmpty()) {
			throw new IllegalArgumentException("content is required");
		}
		if (is != null) {
			if (!isValidSuffix(suffix)) {
				throw new IllegalArgumentException("Invalid suffix: must be 1-16 alphanumeric characters");
			}
		} else {
			suffix = "txt";
		}

		String indexName = generateIndexName(vectorResource.getClassName(), vectorResource.getAttrName(), domainId);
		File dir = new File("conf/" + dirName + "/" + indexName);
		dir.mkdirs();
		String id = UUID.randomUUID().toString();
		File file = new File(dir, id + "." + suffix);

		try {
			try (FileOutputStream fos = new FileOutputStream(file)) {
				if (is != null) {
					fos.write(is.readAllBytes());
				} else {
					fos.write(vectorResource.getContent().getBytes(StandardCharsets.UTF_8));
				}
			}

			vectorResource.setId(id);
			vectorResource.setPath(indexName + "/" + id + "." + suffix);

			// Vector store storage
			ensureTable(indexName);

			String brief = vectorResource.getContent();
			String replaceBrief = this.replace(brief);
			vectorResource.setContent(replaceBrief);
			retrievalGate.write(domainId, () -> {
				float[] stored = vector != null ? vector : this.briefToVector(replaceBrief, domainId);
				ensureVectorIndex(indexName, stored.length);
				return jdbcTemplate.update(
					"INSERT INTO " + quotedTable(indexName) + " (id, brief, path, class_name, attr_name, object_id, brief_vector) "
							+ "VALUES (?, ?, ?, ?, ?, ?, ?::vector) "
							+ "ON CONFLICT (id) DO UPDATE SET brief = EXCLUDED.brief, path = EXCLUDED.path, "
							+ "class_name = EXCLUDED.class_name, attr_name = EXCLUDED.attr_name, "
							+ "object_id = EXCLUDED.object_id, brief_vector = EXCLUDED.brief_vector",
					vectorResource.getId(), vectorResource.getContent(), vectorResource.getPath(),
					vectorResource.getClassName(), vectorResource.getAttrName(), vectorResource.getObjectId(),
					new PGvector(stored));
			});

			return vectorResource;
		} catch (Exception e) {
			if (file.exists()) {
				file.delete();
			}
			log.error(e.getMessage(), e);
			if (e instanceof RuntimeException re) {
				throw re;
			}
			throw new RuntimeException("Failed to insert vector resource: " + e.getMessage(), e);
		}
	}

	/**
	 * The {@code topK} resources of a class attribute nearest to the question, nearest first. The
	 * count is the caller's: no score threshold trims it.
	 */
	public List<VectorResource> find(String question, int topK, String className, String attrName, String domainId) {
		if (topK <= 0) {
			throw new IllegalArgumentException("topK must be positive: " + topK);
		}
		return retrievalGate.read(domainId, () -> search(question, topK, className, attrName, domainId));
	}

	/** The nearest-first search of one table; its filter and ordering match the index of {@link #ensureVectorIndex}. */
	static String searchSql(String indexName, int dimensions) {
		return "SELECT id, brief, path, class_name, attr_name, object_id FROM " + "\"" + indexName + "\""
				+ " WHERE vector_dims(brief_vector) = " + dimensions
				+ " ORDER BY brief_vector::halfvec(" + dimensions + ") <-> (?::vector)::halfvec(" + dimensions + ")"
				+ " LIMIT ?";
	}

	/**
	 * Runs inside the read boundary: the query vector and the rows belong to one generation. The
	 * ordering expression and the filter match {@link #ensureVectorIndex}, so the planner uses the
	 * HNSW index; {@code hnsw.ef_search} is raised to at least {@code topK}, otherwise the index scan
	 * would return fewer rows than asked.
	 */
	private List<VectorResource> search(String question, int topK, String className, String attrName, String domainId) {
		String indexName = this.generateIndexName(className, attrName, domainId);
		float[] findVector = null;
		String queryString = "";
		try {
			ensureTable(indexName);

			String replaceQuestion = this.replace(question);
			Response<Embedding> embeddingResponse = embeddingService.embedding(replaceQuestion, domainId);
			findVector = embeddingResponse.content().vector();
			int dimensions = findVector.length;

			queryString = searchSql(indexName, dimensions);
			String sql = queryString;
			PGvector pgVector = new PGvector(findVector);
			List<VectorResource> rows = transactions.execute(status -> {
				jdbcTemplate.execute("SET LOCAL hnsw.ef_search = " + Math.max(MIN_EF_SEARCH, topK));
				return jdbcTemplate.query(sql, (rs, rowNum) -> {
					VectorResource vectorResource = new VectorResource();
					vectorResource.setId(rs.getString("id"));
					vectorResource.setContent(rs.getString("brief"));
					vectorResource.setPath(rs.getString("path"));
					vectorResource.setClassName(rs.getString("class_name"));
					vectorResource.setAttrName(rs.getString("attr_name"));
					vectorResource.setObjectId(rs.getString("object_id"));
					return vectorResource;
				}, pgVector, topK);
			});
			log.info("Vector search of {} returned {} of top {}", indexName, rows.size(), topK);
			return rows;
		} catch (Exception e) {
			log.error("Exception:{},question:{},findVector length={},queryString:\n{}", e.getMessage(), question,
					findVector == null ? 0 : findVector.length, queryString);
			if (e instanceof RuntimeException re) {
				throw re;
			}
			throw new RuntimeException("Vector search failed: " + e.getMessage(), e);
		}
	}

	public File getFile(String indexName, String fileName) {
		return new File("conf/" + dirName + "/" + indexName + "/" + fileName);
	}

	/**
	 * Delete one vector resource of this domain's class attribute: its vector table record and its file.
	 *
	 * <p>The class, attribute and path come from the API caller. The index directory must be a direct child of
	 * the vector resource root and the path a direct file of that directory, recorded for the object;
	 * anything else is rejected before any record or file is touched.</p>
	 *
	 * @param path the stored relative path ({@code indexName/id.suffix}), matching {@link VectorResource#getPath()}
	 */
	public void delete(String className, String attrName, String objectId, String path, String domainId) {
		String indexName = this.generateIndexName(className, attrName, domainId);
		Path root = Paths.get("conf", dirName).toAbsolutePath();
		Path indexDir = root.resolve(indexName).normalize();
		Path file = root.resolve(path).normalize();
		if (!root.equals(indexDir.getParent()) || !indexDir.equals(file.getParent())) {
			throw new IllegalArgumentException("Vector resource path does not belong to " + indexName + ": " + path);
		}
		int deleted = jdbcTemplate.update("DELETE FROM " + quotedTable(indexName) + " WHERE object_id = ? AND path = ?", objectId, path);
		if (deleted == 0) {
			throw new IllegalArgumentException("Vector resource not found for object " + objectId + ": " + path);
		}
		if (!file.toFile().delete()) {
			throw new IllegalStateException("Failed to delete vector resource file: " + file.toAbsolutePath());
		}
	}

	/**
	 * Delete every vector resource of a single object for one attribute: its vector table records and files.
	 * Used by object deletion to cascade-clean the object's vector resources. Does nothing when the vector
	 * table does not exist yet.
	 */
	public void deleteByObjectId(String className, String attrName, String objectId, String domainId) {
		String indexName = this.generateIndexName(className, attrName, domainId);
		String tableName = quotedTable(indexName);
		Integer cnt = jdbcTemplate.queryForObject(
				"SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?",
				Integer.class, indexName);
		if (cnt == null || cnt == 0) {
			return;
		}
		Path root = Paths.get("conf", dirName).toAbsolutePath();
		Path indexDir = root.resolve(indexName).normalize();
		List<String> paths = jdbcTemplate.queryForList("SELECT path FROM " + tableName + " WHERE object_id = ?", String.class, objectId);
		jdbcTemplate.update("DELETE FROM " + tableName + " WHERE object_id = ?", objectId);
		for (String path : paths) {
			Path file = root.resolve(path).normalize();
			if (!root.equals(indexDir.getParent()) || !indexDir.equals(file.getParent())) {
				log.warn("Skip deleting vector file outside index dir {}: {}", indexName, path);
				continue;
			}
			if (!file.toFile().delete()) {
				log.warn("Failed to delete vector resource file: {}", file.toAbsolutePath());
			}
		}
	}

	/**
	 * Update an existing vector resource in place: rewrite its file, recompute the embedding and refresh
	 * the vector table row. The {@code className}/{@code objectId} must already carry the sandbox prefix
	 * when inside a sandbox; {@code fileId} is the last path segment ({@code id.suffix}).
	 */
	public void update(String className, String attrName, String objectId, String fileId, String content, InputStream is, String domainId) {
		String indexName = this.generateIndexName(className, attrName, domainId);
		String path = indexName + "/" + fileId;
		Path root = Paths.get("conf", dirName).toAbsolutePath();
		Path indexDir = root.resolve(indexName).normalize();
		Path file = root.resolve(path).normalize();
		if (!root.equals(indexDir.getParent()) || !indexDir.equals(file.getParent())) {
			throw new IllegalArgumentException("Vector resource path does not belong to " + indexName + ": " + path);
		}
		FileOutputStream fos = null;
		try {
			fos = new FileOutputStream(file.toFile());
			fos.write(is.readAllBytes());
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			throw new RuntimeException(e);
		} finally {
			if (fos != null) {
				try {
					fos.close();
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
		}
		String replaceBrief = this.replace(content);
		int updated = retrievalGate.write(domainId, () -> {
			float[] vector = this.briefToVector(replaceBrief, domainId);
			ensureVectorIndex(indexName, vector.length);
			return jdbcTemplate.update(
				"UPDATE " + quotedTable(indexName) + " SET brief = ?, brief_vector = ?::vector WHERE object_id = ? AND path = ?",
				replaceBrief, new PGvector(vector), objectId, path);
		});
		if (updated == 0) {
			throw new IllegalArgumentException("Vector resource not found for object " + objectId + ": " + path);
		}
	}

	public void rebuildIndex(String className, String attrName, String domainId) {
		String indexName = this.generateIndexName(className, attrName, domainId);
		String tableName = quotedTable(indexName);

		log.info(">>>rebuild " + indexName);

		jdbcTemplate.execute("DROP TABLE IF EXISTS " + tableName);
		forgetVectorIndexes(indexName);
		jdbcTemplate.execute("CREATE TABLE " + tableName + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "brief TEXT, "
				+ "path VARCHAR(512), "
				+ "class_name VARCHAR(256), "
				+ "attr_name VARCHAR(256), "
				+ "object_id VARCHAR(256), "
				+ "brief_vector vector"
				+ ")");
		deleteFilesInDirectory(indexName);
		new File("conf/" + dirName + "/" + indexName).mkdirs();
		log.info("<<<rebuild " + indexName);
	}
	
	/** Every vector table of this domain in the current schema: the rebuild scope for resource vectors. */
	public List<String> listDomainTables(String domainId) {
		String sql = "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'";
		List<String> all = jdbcTemplate.queryForList(sql, String.class);
		List<String> matched = new ArrayList<>();
		for (String tableName : all) {
			if (tableName.startsWith("vector-") && tableName.endsWith("-" + domainId)) {
				matched.add(tableName);
			}
		}
		return matched;
	}

	public int countTableRows(String indexName) {
		return jdbcTemplate.queryForObject("SELECT COUNT(*) FROM " + quotedTable(indexName), Integer.class);
	}

	public int countTablePending(String indexName) {
		return jdbcTemplate.queryForObject(
				"SELECT COUNT(*) FROM " + quotedTable(indexName) + " WHERE brief_vector IS NULL", Integer.class);
	}

	/**
	 * The stored brief is the exact text the write path embedded, so the rebuild re-embeds it as is.
	 */
	public List<VectorRebuildItem> listTablePending(String indexName) {
		return jdbcTemplate.query("SELECT id, brief FROM " + quotedTable(indexName) + " WHERE brief_vector IS NULL",
				(rs, rowNum) -> new VectorRebuildItem(rs.getString("id"), rs.getString("brief")));
	}

	/**
	 * Start a new generation of the table: every vector is cleared and the indexes of the previous
	 * generation are dropped; the refill creates the index of the new dimensions.
	 */
	public void clearTableVectors(String indexName) {
		jdbcTemplate.execute("UPDATE " + quotedTable(indexName) + " SET brief_vector = NULL");
		List<String> indexes = jdbcTemplate.queryForList(
				"SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ? AND indexname LIKE 'vidx\\_%'",
				String.class, indexName);
		for (String index : indexes) {
			jdbcTemplate.execute("DROP INDEX IF EXISTS \"" + index + "\"");
		}
		forgetVectorIndexes(indexName);
	}

	/** Fill a pending row only: a row written meanwhile keeps the vector of its newer content. */
	public void fillTableVector(String indexName, String id, float[] vector) {
		ensureVectorIndex(indexName, vector.length);
		jdbcTemplate.update("UPDATE " + quotedTable(indexName) + " SET brief_vector = ?::vector WHERE id = ? AND brief_vector IS NULL",
				new PGvector(vector), id);
	}

	public void clearDomainVectors(String domainId) {
		for (String indexName : listDomainTables(domainId)) {
			clearTableVectors(indexName);
		}
	}

	/**
	 * Clear the data of every vector table belonging to this sandbox (prefix-matched by namespace and domain),
	 * keeping the tables and their file directories in place.
	 */
	public void truncateNamespace(String tmpNamespace, String domainId) {
		String prefix = generateIndexNamePrefix(tmpNamespace);
		for (String tableName : listVectorTables(prefix, domainId)) {
			jdbcTemplate.execute("DELETE FROM " + quotedTable(tableName));
			deleteFilesInDirectory(tableName);
		}
	}

	/**
	 * Drop every vector table of this sandbox (prefix-matched by namespace and domain) and delete their file
	 * directories entirely.
	 */
	public void dropNamespace(String tmpNamespace, String domainId) {
		String prefix = generateIndexNamePrefix(tmpNamespace);
		for (String tableName : listVectorTables(prefix, domainId)) {
			jdbcTemplate.execute("DROP TABLE IF EXISTS " + quotedTable(tableName));
			forgetVectorIndexes(tableName);
			deleteFilesInDirectory(tableName);
			File dir = new File("conf/" + dirName + "/" + tableName);
			if (dir.isDirectory() && !dir.delete()) {
				log.warn("Failed to delete vector resource directory: {}", dir.getAbsolutePath());
			}
		}
	}

	/** Vector table names of the current schema matching the given prefix and ending with {@code -domainId}. */
	private List<String> listVectorTables(String prefix, String domainId) {
		String sql = "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'";
		List<String> all = jdbcTemplate.queryForList(sql, String.class);
		List<String> matched = new ArrayList<>();
		for (String tableName : all) {
			if (tableName.startsWith(prefix) && tableName.endsWith("-" + domainId)) {
				matched.add(tableName);
			}
		}
		return matched;
	}

	/** Delete all files directly under a vector resource directory, keeping the directory itself. */
	private void deleteFilesInDirectory(String indexName) {
		File dir = new File("conf/" + dirName + "/" + indexName);
		if (!dir.isDirectory()) {
			return;
		}
		File[] files = dir.listFiles();
		if (files == null) {
			return;
		}
		for (File file : files) {
			if (file.isFile() && !file.delete()) {
				log.warn("Failed to delete vector resource file: {}", file.getAbsolutePath());
			}
		}
	}

	public void clear(String className, String attrName, String domainId) {
		String indexName = this.generateIndexName(className, attrName, domainId);
		clearIndex(indexName);
	}

	public void clearByDomain(String domainId) {
		Set<String> indexNames = new HashSet<>();
		File rootDir = new File("conf/" + dirName);
		if (rootDir.exists() && rootDir.isDirectory()) {
			File[] dirs = rootDir.listFiles();
			if (dirs != null) {
				for (File dir : dirs) {
					if (dir.isDirectory() && dir.getName().startsWith("vector-") && dir.getName().endsWith("-" + domainId)) {
						indexNames.add(dir.getName());
					}
				}
			}
		}
		List<String> tables = jdbcTemplate.queryForList(
				"SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name LIKE ?",
				String.class,
				"vector-%-" + domainId);
		if (tables != null) {
			indexNames.addAll(tables);
		}
		for (String indexName : indexNames) {
			clearIndex(indexName);
		}
	}

	private void clearIndex(String indexName) {
		jdbcTemplate.execute("DROP TABLE IF EXISTS " + quotedTable(indexName));
		forgetVectorIndexes(indexName);
		File dir = new File("conf/" + dirName + "/" + indexName);
		if (dir.exists()) {
			File[] files = dir.listFiles();
			if (files != null) {
				for (File f : files) {
					if (!f.delete()) {
						throw new IllegalStateException("Failed to delete vector resource file: " + f.getAbsolutePath());
					}
				}
			}
			if (!dir.delete()) {
				throw new IllegalStateException("Failed to delete vector resource directory: " + dir.getAbsolutePath());
			}
		}
	}

}
