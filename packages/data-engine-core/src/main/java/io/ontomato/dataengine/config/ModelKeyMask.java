package io.ontomato.dataengine.config;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.config.SecretMask.Style;

/**
 * Which model fields are write-only secrets: every model API key and the Embedding API key,
 * shown as {@link Style#TAIL}. The rule itself is {@link SecretMask}'s. The workbench server gets
 * the stored keys only sealed ({@link ModelKeySeal}). A mask is resolved within the model of the
 * same name, whose name cannot change once saved.
 */
public final class ModelKeyMask {

    private ModelKeyMask() {
    }

    /** Copies of the given models with every key masked, for a response; the given models are untouched. */
    public static List<ModelConfig> masked(List<ModelConfig> models) {
        if (models == null) {
            return null;
        }
        List<ModelConfig> copies = JSON.parseArray(JSON.toJSONString(models, Feature.WriteMapNullValue), ModelConfig.class);
        for (ModelConfig model : copies) {
            if (model.getApiKeys() != null) {
                model.setApiKeys(model.getApiKeys().stream().map(key -> SecretMask.mask(key, Style.TAIL))
                        .collect(Collectors.toCollection(ArrayList::new)));
            }
        }
        return copies;
    }

    /** Mask the Embedding key in place; the caller passes a copy made for the response. */
    public static void maskEmbedding(BusinessConfig.EmbeddingModelProperties embedding) {
        if (embedding != null) {
            embedding.setApiKey(SecretMask.mask(embedding.getApiKey(), Style.TAIL));
        }
    }

    /** Replace masks in the submitted models with the stored keys of the model with the same name. */
    public static void restoreModels(List<ModelConfig> incoming, List<ModelConfig> stored) {
        if (incoming == null) {
            return;
        }
        Map<String, ModelConfig> byName = stored == null ? Map.of()
                : stored.stream().filter(model -> model.getName() != null)
                        .collect(Collectors.toMap(ModelConfig::getName, Function.identity(), (a, b) -> a));
        for (ModelConfig model : incoming) {
            ModelConfig previous = model.getName() == null ? null : byName.get(model.getName());
            model.setApiKeys(SecretMask.restoreAll("model " + model.getName(), model.getApiKeys(),
                    previous == null ? null : previous.getApiKeys(), Style.TAIL));
        }
    }

    public static String restoreEmbedding(String incoming, String stored) {
        return SecretMask.restore("the Embedding model", incoming, stored, Style.TAIL);
    }
}
