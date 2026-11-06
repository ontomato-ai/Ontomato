package io.ontomato.dataengine.service.ai;

import java.util.ArrayList;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.service.BusinessConfigService;

import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.data.segment.TextSegment;
import dev.langchain4j.model.embedding.EmbeddingModel;
import dev.langchain4j.model.openai.OpenAiEmbeddingModel;
import dev.langchain4j.model.output.Response;

@Component("embeddingService")
public class EmbeddingService {

	@Autowired
	private BusinessConfigService businessConfigService;

	public Response<Embedding> embedding(String content, String domainId) {
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		return embedWith(businessConfig.getEmbeddingModelProperties(), content);
	}

	/** Embed several texts in one request with the domain's configuration, in input order. */
	public List<float[]> embedAll(List<String> contents, String domainId) {
		BusinessConfig businessConfig = businessConfigService.get(domainId);
		List<TextSegment> segments = new ArrayList<>(contents.size());
		for (String content : contents) {
			segments.add(TextSegment.from(content));
		}
		List<Embedding> embeddings = buildModel(businessConfig.getEmbeddingModelProperties()).embedAll(segments).content();
		if (embeddings.size() != contents.size()) {
			throw new IllegalStateException("The embedding model returned " + embeddings.size() + " vectors for "
					+ contents.size() + " texts");
		}
		List<float[]> vectors = new ArrayList<>(embeddings.size());
		for (Embedding embedding : embeddings) {
			vectors.add(embedding.vector());
		}
		return vectors;
	}

	/** Embed with a pinned configuration: the rebuild passes the configuration taken when it started. */
	public Response<Embedding> embedWith(BusinessConfig.EmbeddingModelProperties embeddingModelProperties, String content) {
		EmbeddingModel embedingModel = buildModel(embeddingModelProperties);
		return embedingModel.embed(content);
	}
	
	public JSONObject testEmbeddingModel(BusinessConfig.EmbeddingModelProperties embeddingModelProperties, String content) throws Exception {
		Response<Embedding> resp = embedWith(embeddingModelProperties, content);
		Embedding embedding = resp.content();
		int dimension = embedding.dimension();
		checkReturnedDimension(dimension, embeddingModelProperties.getDimensions());
		JSONObject ret = new JSONObject();
		ret.put("dimension", dimension);
		ret.put("vector", embedding.vector());
		return ret;
	}

	/** The model must return as many dimensions as the draft configuration asks for. */
	static void checkReturnedDimension(int actual, int expected) {
		if (actual != expected) {
			throw new IllegalArgumentException("The vector dimension returned by the embedding model " + actual
					+ " and the requested embedding dimension " + expected + " are inconsistent");
		}
	}
	
	private EmbeddingModel buildModel(BusinessConfig.EmbeddingModelProperties embeddingModelProperties) {
		EmbeddingModel embedingModel = OpenAiEmbeddingModel.builder()
		        .baseUrl(embeddingModelProperties.getBaseUrl())
		        .apiKey(embeddingModelProperties.getApiKey())
		        .modelName(embeddingModelProperties.getModelName())
		        .dimensions(embeddingModelProperties.getDimensions())
		        .timeout(embeddingModelProperties.getTimeout())
		        .logRequests(embeddingModelProperties.getLogRequests())
		        .logResponses(embeddingModelProperties.getLogResponses())
		        .customHeaders(embeddingModelProperties.getCustomHeaders())
		        .build();
		return embedingModel;
	}
	
}
