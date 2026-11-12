package io.ontomato.dataengine.dataAdapter;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Base64;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson2.JSON;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;
import io.ontomato.dataengine.config.multisource.DataSourceEntry;
import io.ontomato.dataengine.config.multisource.MultiDataSourceDefinition;

class ConnectionSecretCodecTest {

	private static final String KEY = Base64.getEncoder().encodeToString(new byte[32]);

	private ConnectionSecretCodec codec(SecretCipher.Mode mode) {
		DataAdapterRegistry registry = new DataAdapterRegistry(List.of(
				new FakeDataAdapterProvider("postgresql", "PostgreSQL",
						List.of("url", "user", "password"), Map.of())),
				new DataRagConfig());
		return new ConnectionSecretCodec(registry, new SecretCipher(KEY, mode));
	}

	@Test
	void maskLeavesTheStoredObjectAlone() {
		BusinessConfig config = new BusinessConfig();
		DataAdapterConnection connection = new DataAdapterConnection();
		connection.put("url", "jdbc:pg");
		connection.put("user", "u");
		connection.put("password", "pw");
		config.getDataAdapterConnections().put("postgresql", connection);

		BusinessConfig masked = codec(SecretCipher.Mode.DUAL).maskedCopy(config);

		assertEquals("******", masked.getDataAdapterConnections().get("postgresql").get("password"));
		assertEquals("pw", config.getDataAdapterConnections().get("postgresql").get("password"));
		assertEquals("jdbc:pg", masked.getDataAdapterConnections().get("postgresql").get("url"));
	}

	@Test
	void keepMaskedUsesTheStoredSecretOnlyForTheMask() {
		DataAdapterConnection stored = new DataAdapterConnection();
		stored.put("password", "old");
		DataAdapterConnection incoming = new DataAdapterConnection();
		incoming.put("password", "******");

		codec(SecretCipher.Mode.DUAL).keepMasked("postgresql", stored, incoming);
		assertEquals("old", incoming.get("password"));

		DataAdapterConnection changed = new DataAdapterConnection();
		changed.put("password", "new");
		codec(SecretCipher.Mode.DUAL).keepMasked("postgresql", stored, changed);
		assertEquals("new", changed.get("password"));
	}

	@Test
	void encryptJsonIsFlatAndIdempotent() {
		String json = "{\"dataAdapter\":\"postgresql\",\"dataAdapterConnections\":{\"postgresql\":"
				+ "{\"url\":\"jdbc:pg\",\"user\":\"u\",\"password\":\"pw\"}}}";
		ConnectionSecretCodec codec = codec(SecretCipher.Mode.DUAL);

		ConnectionSecretCodec.EncryptResult first = codec.encryptJson(json);
		assertTrue(first.changed());
		assertNotEquals(json, first.json());
		assertFalse(first.json().contains("\"password\":\"pw\""));

		ConnectionSecretCodec.EncryptResult second = codec.encryptJson(first.json());
		assertFalse(second.changed());
		assertEquals(first.json(), second.json());

		BusinessConfig config = JSON.parseObject(first.json(), BusinessConfig.class);
		codec.decryptInPlace(config);
		assertEquals("pw", config.getDataAdapterConnections().get("postgresql").get("password"));
	}

	@Test
	void enforcedModeRejectsPlaintextSecrets() {
		BusinessConfig config = new BusinessConfig();
		DataAdapterConnection connection = new DataAdapterConnection();
		connection.put("password", "pw");
		config.getDataAdapterConnections().put("postgresql", connection);

		ConnectionSecretCodec codec = codec(SecretCipher.Mode.ENFORCED);
		assertThrows(IllegalStateException.class, () -> codec.decryptInPlace(config));
	}

	@Test
	void multiSourceSecretsAreMaskedAndMergedById() {
		BusinessConfig config = new BusinessConfig();
		MultiDataSourceDefinition multi = new MultiDataSourceDefinition();
		DataSourceEntry source = new DataSourceEntry();
		source.setId("crm");
		source.setAdapterType("postgresql");
		DataAdapterConnection connection = new DataAdapterConnection();
		connection.put("url", "jdbc:pg");
		connection.put("password", "pw");
		source.setConnection(connection);
		multi.getDataSources().add(source);
		config.setMultiDataSource(multi);

		ConnectionSecretCodec codec = codec(SecretCipher.Mode.DUAL);
		BusinessConfig masked = codec.maskedCopy(config);
		assertEquals("******", masked.getMultiDataSource().getDataSources().get(0)
				.getConnection().get("password"));

		DataSourceEntry stored = new DataSourceEntry();
		stored.setId("crm");
		stored.setAdapterType("postgresql");
		DataAdapterConnection storedConnection = new DataAdapterConnection();
		storedConnection.put("password", "old");
		stored.setConnection(storedConnection);
		MultiDataSourceDefinition storedMulti = new MultiDataSourceDefinition();
		storedMulti.getDataSources().add(stored);
		BusinessConfig storedConfig = new BusinessConfig();
		storedConfig.setMultiDataSource(storedMulti);

		multi.getDataSources().get(0).getConnection().put("password", "******");
		codec.keepMaskedMulti(storedConfig, multi);
		assertEquals("old", multi.getDataSources().get(0).getConnection().get("password"));
	}
}
