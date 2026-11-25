package io.ontomato.dataengine.dataAdapter;

import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.DataRagConfig;

/** The data adapters installed in this edition, keyed by type. */
@Component
public class DataAdapterRegistry {

	private final Map<String, DataAdapterProvider> providers = new HashMap<>();
	private final DataRagConfig dataRagConfig;

	public DataAdapterRegistry(List<DataAdapterProvider> providers, DataRagConfig dataRagConfig) {
		for (DataAdapterProvider provider : providers) {
			if (this.providers.putIfAbsent(provider.type(), provider) != null) {
				throw new IllegalStateException("Duplicate data adapter type: " + provider.type());
			}
		}
		this.dataRagConfig = dataRagConfig;
	}

	public DataAdapterProvider provider(String type) {
		DataAdapterProvider provider = providers.get(type);
		if (provider == null) {
			throw new IllegalArgumentException("Data adapter not installed in this edition: " + type);
		}
		return provider;
	}

	public boolean isInstalled(String type) {
		return providers.containsKey(type);
	}

	/** The adapter of the business config's current type, with that type's saved connection. */
	public DataAdapter create(BusinessConfig businessConfig, Map<String, Object> jsonRule) {
		String type = businessConfig.getDataAdapter();
		// The provider reads the whole config, so a type that needs more than one connection can build itself;
		// the default implementation falls back to the connection saved under its own type, which keeps the
		// historical single-connection shape: a type never configured has no connection, and only a query
		// actually needs values.
		return provider(type).create(businessConfig, dataRagConfig, jsonRule);
	}

	/** An adapter for a candidate connection, leaving the saved configuration untouched. */
	public DataAdapter createForTest(String type, DataAdapterConnection connection) {
		return provider(type).create(connection, dataRagConfig, null);
	}

	public boolean supportsSandbox(BusinessConfig config) {
		return create(config, null).supportsSandbox();
	}

	public List<DataAdapterProvider> installed() {
		return providers.values().stream().sorted(Comparator.comparing(DataAdapterProvider::label)).toList();
	}
}
