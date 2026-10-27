package io.ontomato.dataengine.dataAdapter;

import java.util.LinkedHashSet;
import java.util.Set;

import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.SecretMask;
import io.ontomato.dataengine.config.multisource.DataSourceEntry;
import io.ontomato.dataengine.config.multisource.MultiDataSourceDefinition;

/**
 * One place for the three connection-secret operations:
 *
 * <ul>
 *   <li><b>mask</b> a read view: every secret field becomes {@code ******};</li>
 *   <li><b>keep</b> a masked value on save: a submitted {@code ******} is replaced
 *       by the stored value before the connection is persisted;</li>
 *   <li><b>encrypt/decrypt</b> at the JSON boundary: only secret fields change,
 *       and a reader accepts both {@code enc:v1:} and legacy plaintext.</li>
 * </ul>
 *
 * <p>The provider metadata is the source of truth for which fields are secret;
 * an uninstalled provider or a renamed field falls back to the name heuristic
 * in {@link DataAdapterConnectionField#isSecretName(String)}.</p>
 */
@Component
public class ConnectionSecretCodec {

	private final DataAdapterRegistry registry;
	private final SecretCipher cipher;

	public ConnectionSecretCodec(DataAdapterRegistry registry, SecretCipher cipher) {
		this.registry = registry;
		this.cipher = cipher;
	}

	/** A copy safe to return from a read API; the caller's config is untouched. */
	public BusinessConfig maskedCopy(BusinessConfig config) {
		if (config == null) {
			return null;
		}
		BusinessConfig copy = JSON.parseObject(
				JSON.toJSONString(config, Feature.WriteMapNullValue), BusinessConfig.class);
		maskInPlace(copy);
		return copy;
	}

	public void maskInPlace(BusinessConfig config) {
		if (config == null) {
			return;
		}
		maskConnections(config.getDataAdapterConnections());
		MultiDataSourceDefinition multi = config.getMultiDataSource();
		if (multi != null && multi.getDataSources() != null) {
			for (DataSourceEntry source : multi.getDataSources()) {
				maskConnection(source.getAdapterType(), source.getConnection());
			}
		}
	}

	private void maskConnections(java.util.Map<String, DataAdapterConnection> connections) {
		if (connections == null) {
			return;
		}
		for (java.util.Map.Entry<String, DataAdapterConnection> entry : connections.entrySet()) {
			maskConnection(entry.getKey(), entry.getValue());
		}
	}

	private void maskConnection(String type, DataAdapterConnection connection) {
		if (connection == null) {
			return;
		}
		for (String field : secretNames(type, connection.keySet())) {
			if (connection.get(field) != null) {
				connection.put(field, SecretMask.mask(connection.get(field), SecretMask.Style.HIDDEN));
			}
		}
	}

	/**
	 * Replace a submitted mask with the stored secret ({@link SecretMask}); other fields are untouched.
	 * A mask with nothing stored behind it is refused rather than saved as the secret.
	 */
	public void keepMasked(String type, DataAdapterConnection stored, DataAdapterConnection incoming) {
		if (incoming == null) {
			return;
		}
		for (String field : secretNames(type, incoming.keySet())) {
			if (!SecretMask.isMasked(incoming.get(field))) {
				continue;
			}
			incoming.put(field, SecretMask.restore("connection field " + type + "." + field, incoming.get(field),
					stored == null ? null : stored.get(field), SecretMask.Style.HIDDEN));
		}
	}

	/** Merge masked secrets of each source from the stored source with the same id. */
	public void keepMaskedMulti(BusinessConfig stored, MultiDataSourceDefinition incoming) {
		if (incoming == null || incoming.getDataSources() == null) {
			return;
		}
		MultiDataSourceDefinition previous = stored == null ? null : stored.getMultiDataSource();
		for (DataSourceEntry source : incoming.getDataSources()) {
			DataSourceEntry old = previous == null ? null : previous.source(source.getId());
			keepMasked(source.getAdapterType(), old == null ? null : old.getConnection(), source.getConnection());
		}
	}

	/** Decrypt secret fields in place after the DAO parsed a stored record. */
	public void decryptInPlace(BusinessConfig config) {
		if (config == null) {
			return;
		}
		decryptConnections(config.getDataAdapterConnections());
		MultiDataSourceDefinition multi = config.getMultiDataSource();
		if (multi != null && multi.getDataSources() != null) {
			for (DataSourceEntry source : multi.getDataSources()) {
				decryptConnection(source.getAdapterType(), source.getConnection());
			}
		}
	}

	private void decryptConnections(java.util.Map<String, DataAdapterConnection> connections) {
		if (connections == null) {
			return;
		}
		for (java.util.Map.Entry<String, DataAdapterConnection> entry : connections.entrySet()) {
			decryptConnection(entry.getKey(), entry.getValue());
		}
	}

	private void decryptConnection(String type, DataAdapterConnection connection) {
		if (connection == null) {
			return;
		}
		Set<String> secrets = secretNames(type, connection.keySet());
		for (java.util.Map.Entry<String, String> entry : connection.entrySet()) {
			String value = entry.getValue();
			if (cipher.isEncrypted(value)) {
				entry.setValue(cipher.decrypt(value));
			} else if (cipher.isEnforced()
					&& secrets.contains(entry.getKey())
					&& value != null
					&& !value.isEmpty()) {
				throw new IllegalStateException(
						"Connection secret '" + entry.getKey() + "' of adapter '" + type
								+ "' is still plaintext; run the connection-secret backfill first");
			}
		}
	}

	/**
	 * Encrypt every secret in a stored JSON content string. Returns the original
	 * string and {@code changed=false} when there is nothing to do, so a backfill
	 * can be idempotent and avoid rewriting untouched rows.
	 */
	public EncryptResult encryptJson(String json) {
		if (json == null || !cipher.isEnabled()) {
			return new EncryptResult(json, false);
		}
		JSONObject stored;
		try {
			stored = JSON.parseObject(json);
		} catch (RuntimeException e) {
			return new EncryptResult(json, false);
		}
		if (stored == null) {
			return new EncryptResult(json, false);
		}

		boolean changed = encryptConnections(stored.getJSONObject("dataAdapterConnections"));
		JSONObject multi = stored.getJSONObject("multiDataSource");
		if (multi != null) {
			JSONArray sources = multi.getJSONArray("dataSources");
			if (sources != null) {
				for (int i = 0; i < sources.size(); i++) {
					JSONObject source = sources.getJSONObject(i);
					if (source != null) {
						changed |= encryptConnection(
								source.getString("adapterType"), source.getJSONObject("connection"));
					}
				}
			}
		}
		return changed
				? new EncryptResult(JSON.toJSONString(stored, Feature.WriteMapNullValue), true)
				: new EncryptResult(json, false);
	}

	private boolean encryptConnections(JSONObject connections) {
		if (connections == null) {
			return false;
		}
		boolean changed = false;
		for (String type : connections.keySet()) {
			changed |= encryptConnection(type, connections.getJSONObject(type));
		}
		return changed;
	}

	private boolean encryptConnection(String type, JSONObject connection) {
		if (connection == null) {
			return false;
		}
		boolean changed = false;
		for (String field : secretNames(type, connection.keySet())) {
			String value = connection.getString(field);
			if (value == null || value.isEmpty() || SecretMask.isMasked(value) || cipher.isEncrypted(value)) {
				continue;
			}
			connection.put(field, cipher.encrypt(value));
			changed = true;
		}
		return changed;
	}

	private Set<String> secretNames(String type, Set<String> keys) {
		Set<String> names = new LinkedHashSet<>();
		if (registry != null && type != null && registry.isInstalled(type)) {
			for (DataAdapterConnectionField field : registry.provider(type).connectionFieldDefinitions()) {
				if (field.secret()) {
					names.add(field.name());
				}
			}
		}
		if (keys != null) {
			for (String key : keys) {
				if (DataAdapterConnectionField.isSecretName(key)) {
					names.add(key);
				}
			}
		}
		return names;
	}

	public record EncryptResult(String json, boolean changed) {
	}
}
