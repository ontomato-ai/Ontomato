package io.ontomato.dataengine.dao;

import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONReader;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.dataAdapter.ConnectionSecretCodec;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("businessConfigDao")
public class BusinessConfigDao {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	/** Optional in tests that construct the DAO directly; Spring injects it in the app. */
	@Autowired(required = false)
	private ConnectionSecretCodec connectionSecretCodec;

	private static final String TABLE_NAME = "business_config";

	private static final String EMBEDDING_KEY = "embeddingModelProperties";

	@PostConstruct
	public void initIndex() {
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + TABLE_NAME + " ("
				+ "id VARCHAR(64) PRIMARY KEY, "
				+ "content TEXT"
				+ ")");
		log.info(">>>businessConfig table initialization complete");
	}

	/**
	 * Save the whole record. A stored config keeps its embedding configuration: it changes only through
	 * {@link #saveEmbeddingModel}, so a save built from an older snapshot cannot write an old embedding
	 * generation back. A new row, or one whose content is SQL or JSON null and is being seeded again by
	 * {@code BusinessConfigService.get}, takes the embedding configuration it is given.
	 */
	public void save(BusinessConfig businessConfig, String domainId) {
		String stored = TABLE_NAME + ".content::jsonb";
		String content = JSON.toJSONString(businessConfig, Feature.WriteMapNullValue);
		if (connectionSecretCodec != null) {
			content = connectionSecretCodec.encryptJson(content).json();
		}
		jdbcTemplate.update(
				"INSERT INTO " + TABLE_NAME + " (id, content) VALUES (?, ?) "
						+ "ON CONFLICT (id) DO UPDATE SET content = CASE WHEN jsonb_typeof(" + stored + ") = 'object' "
						+ "THEN jsonb_set(EXCLUDED.content::jsonb, '{" + EMBEDDING_KEY + "}', "
						+ "COALESCE(" + stored + " -> '" + EMBEDDING_KEY + "', 'null'::jsonb))::text "
						+ "ELSE EXCLUDED.content END",
				domainId, content);
	}

	/** Replace only the embedding configuration of an existing record; the vector rebuild service owns this write. */
	public void saveEmbeddingModel(BusinessConfig.EmbeddingModelProperties properties, String domainId) {
		int updated = jdbcTemplate.update(
				"UPDATE " + TABLE_NAME + " SET content = jsonb_set(content::jsonb, '{" + EMBEDDING_KEY + "}', ?::jsonb)::text WHERE id = ?",
				JSON.toJSONString(properties, Feature.WriteMapNullValue), domainId);
		if (updated == 0) {
			throw new IllegalStateException("business_config record not found (domainId=" + domainId + ")");
		}
	}

	public BusinessConfig query(String domainId) {
		try {
			String content = jdbcTemplate.queryForObject(
					"SELECT content FROM " + TABLE_NAME + " WHERE id = ?",
					String.class, domainId);
			if (content == null) {
				return null;
			}
			JSONObject stored = JSON.parseObject(content, JSONReader.Feature.DisableReferenceDetect);
			if (stored == null) {
				return null;
			}
			if (LegacyDataAdapterConnections.migrate(stored)) {
				content = JSON.toJSONString(stored, Feature.WriteMapNullValue);
				jdbcTemplate.update("UPDATE " + TABLE_NAME + " SET content = ? WHERE id = ?", content, domainId);
				log.info("business_config data adapter connections migrated (domainId={})", domainId);
			}
			BusinessConfig businessConfig = JSON.parseObject(
					content, BusinessConfig.class, JSONReader.Feature.DisableReferenceDetect);
			if (connectionSecretCodec != null) {
				connectionSecretCodec.decryptInPlace(businessConfig);
			}
			return businessConfig;
		} catch (org.springframework.dao.EmptyResultDataAccessException e) {
			return null;
		} catch (RuntimeException e) {
			log.error("Failed to read BusinessConfig from PostgreSQL", e);
			throw e;
		}
	}

	/**
	 * Encrypt every stored connection secret that is still plaintext. Idempotent:
	 * rows already carrying {@code enc:v1:} are left untouched. Gated by
	 * {@code ontomato.connection-secrets.backfill} when called from the runner.
	 *
	 * @return number of records rewritten
	 */
	public int backfillConnectionSecrets() {
		if (connectionSecretCodec == null) {
			return 0;
		}
		List<Map<String, Object>> rows = jdbcTemplate.queryForList(
				"SELECT id, content FROM " + TABLE_NAME);
		int changed = 0;
		for (Map<String, Object> row : rows) {
			String id = (String) row.get("id");
			Object raw = row.get("content");
			if (raw == null) {
				continue;
			}
			String content = raw.toString();
			String candidate = content;
			try {
				JSONObject stored = JSON.parseObject(content);
				if (stored != null && LegacyDataAdapterConnections.migrate(stored)) {
					candidate = JSON.toJSONString(stored, Feature.WriteMapNullValue);
				}
			} catch (RuntimeException e) {
				log.warn("Connection-secret backfill skipped a malformed record (domainId={})", id, e);
				continue;
			}
			String encrypted = connectionSecretCodec.encryptJson(candidate).json();
			if (!encrypted.equals(content)) {
				jdbcTemplate.update("UPDATE " + TABLE_NAME + " SET content = ? WHERE id = ?", encrypted, id);
				changed++;
			}
		}
		return changed;
	}

}
