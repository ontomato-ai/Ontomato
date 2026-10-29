package io.ontomato.dataengine.config;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

import io.ontomato.dataengine.config.multisource.MultiDataSourceDefinition;
import io.ontomato.dataengine.dataAdapter.DataAdapterConnection;


import lombok.Data;

@Data
public class BusinessConfig {

	
	private EmbeddingModelProperties EmbeddingModelProperties;

	/**
	 * The embedding connection, model name and dimensions the vectors of this domain were generated with,
	 * as stored before vector_rebuild_state existed. Read only to seed that state the first time; the state
	 * then owns the generation and this value is no longer updated.
	 */
	private EmbeddingVectorSource embeddingVectorSource;
	
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

	@Data
	public class EmbeddingModelProperties {
		private String baseUrl;
		private String apiKey;
		private String modelName;
		private Integer dimensions;
		private Duration timeout;
		private Boolean logRequests;
	    private Boolean logResponses;
	    private Map<String, String> customHeaders;
	}

	@Data
	public static class EmbeddingVectorSource {
		private String baseUrl;
		private String modelName;
		private Integer dimensions;
	}
	
	public static BusinessConfig from(
			io.ontomato.dataengine.config.EmbeddingModelProperties fileEmbeddingModelProperties,
			DataRagConfig dataRagConfig) {
		BusinessConfig businessConfig = new BusinessConfig();
			EmbeddingModelProperties embeddingModelProperties = businessConfig.new EmbeddingModelProperties();
			embeddingModelProperties.setBaseUrl(fileEmbeddingModelProperties.getBaseUrl());
			embeddingModelProperties.setApiKey(fileEmbeddingModelProperties.getApiKey());
			embeddingModelProperties.setModelName(fileEmbeddingModelProperties.getModelName());
			embeddingModelProperties.setDimensions(fileEmbeddingModelProperties.getDimensions());
			embeddingModelProperties.setTimeout(fileEmbeddingModelProperties.getTimeout());
			embeddingModelProperties.setLogRequests(fileEmbeddingModelProperties.getLogRequests());
			embeddingModelProperties.setLogResponses(fileEmbeddingModelProperties.getLogResponses());
			businessConfig.setEmbeddingModelProperties(embeddingModelProperties);
			// A new domain has no vectors yet, so the configuration its vectors were generated with equals its initial configuration.
			EmbeddingVectorSource embeddingVectorSource = new EmbeddingVectorSource();
			embeddingVectorSource.setBaseUrl(fileEmbeddingModelProperties.getBaseUrl());
			embeddingVectorSource.setModelName(fileEmbeddingModelProperties.getModelName());
			embeddingVectorSource.setDimensions(fileEmbeddingModelProperties.getDimensions());
			businessConfig.setEmbeddingVectorSource(embeddingVectorSource);
			
			businessConfig.setKnowledgeMaxResult(dataRagConfig.getKnowledgeMaxResult());

			businessConfig.setDslCookerTimeout(dataRagConfig.getDslCookerTimeout());

			businessConfig.setDataAdapter(dataRagConfig.getDataAdapter());
		return businessConfig;
    }
}
