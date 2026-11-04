package io.ontomato.dataengine.config;

import java.util.LinkedHashMap;
import java.util.Map;

import io.ontomato.dataengine.config.multisource.MultiDataSourceDefinition;
import io.ontomato.dataengine.dataAdapter.DataAdapterConnection;


import lombok.Data;

@Data
public class BusinessConfig {

	
	private int knowledgeMaxResult;

    private Long dslCookerTimeout;

    private Integer reportCardPythonTimeout = 60;
    
    private String lang;
    
    private String dataAdapter;
    /** Saved connection per data adapter type. */
    private Map<String, DataAdapterConnection> dataAdapterConnections = new LinkedHashMap<>();

    /**
     * Multi-source routing; {@code null} means a single-source domain.
     *
     * <p>Set together with {@code dataAdapter = "multi"}: the routing then decides which source each class
     * belongs to, and with the ontomap which source each relationship belongs to. See
     * {@link MultiDataSourceDefinition} for why it lives here rather than in the ontomap.</p>
     */
    private MultiDataSourceDefinition multiDataSource;

	public static BusinessConfig from(
			DataRagConfig dataRagConfig) {
		BusinessConfig businessConfig = new BusinessConfig();
			businessConfig.setKnowledgeMaxResult(dataRagConfig.getKnowledgeMaxResult());

			businessConfig.setDslCookerTimeout(dataRagConfig.getDslCookerTimeout());

			businessConfig.setDataAdapter(dataRagConfig.getDataAdapter());
		return businessConfig;
    }
}
