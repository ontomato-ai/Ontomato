package io.ontomato.dataengine.service.ai;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.agent.AgentRuntimeClient;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import org.springframework.stereotype.Component;
import java.util.List;

@Component("embeddingService")
public class EmbeddingService {
    private final AgentRuntimeClient runtime;
    public EmbeddingService(AgentRuntimeClient runtime) { this.runtime = runtime; }

    public EmbeddingSelection selection(String domain) {
        try {
            var options = runtime.json(domain, "embedding-selection", "/v1/models/options", "GET", null, null);
            String ref = options.getString("embeddingModelId");
            for (Object item : options.getJSONArray("models")) {
                var model = (JSONObject) item;
                if (ref != null && ref.equals(model.getString("ref")) && "embedding".equals(model.getString("type")))
                    return new EmbeddingSelection(ref, model.getInteger("dimensions"));
            }
            throw new AgentHttpException(422, "MODEL_NOT_CONFIGURED", "No embedding model is configured");
        } catch (RuntimeException e) { throw e; }
        catch (Exception e) { throw new IllegalStateException("Runtime embedding configuration is unavailable", e); }
    }

    public float[] embedding(String content, String domain) { return embedWith(null, content, domain); }

    /** A rebuild rejects a changed generation instead of mixing its vectors into the pinned round. */
    public float[] embedWith(EmbeddingSelection expected, String content, String domain) {
        try {
            var result = runtime.json(domain, "embedding", "/v1/models/embeddings", "POST", JSONObject.of("texts", List.of(content)), null);
            var actual = new EmbeddingSelection(result.getString("modelId"), result.getInteger("dimensions"));
            if (expected != null && !expected.equals(actual)) throw new IllegalStateException("Embedding model changed during vector rebuild");
            var vectors = result.getJSONArray("vectors");
            if (vectors == null || vectors.size() != 1 || actual.getDimensions() == null)
                throw new IllegalStateException("Invalid embedding response");
            var vector = vectors.getJSONArray(0);
            if (vector.size() != actual.getDimensions()) throw new IllegalStateException("Embedding dimensions do not match");
            float[] values = new float[vector.size()];
            for (int i = 0; i < values.length; i++) {
                values[i] = vector.getFloatValue(i);
                if (!Float.isFinite(values[i])) throw new IllegalStateException("Invalid embedding value");
            }
            return values;
        } catch (RuntimeException e) { throw e; }
        catch (Exception e) { throw new IllegalStateException("Runtime embedding call failed", e); }
    }
}
