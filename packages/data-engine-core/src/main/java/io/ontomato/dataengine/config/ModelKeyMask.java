package io.ontomato.dataengine.config;

/** Write-only Embedding API keys; conversation model secrets belong to the runtime. */
public final class ModelKeyMask {
    private ModelKeyMask() {}
    public static void maskEmbedding(BusinessConfig.EmbeddingModelProperties embedding) {
        if (embedding != null) embedding.setApiKey(SecretMask.mask(embedding.getApiKey(), SecretMask.Style.TAIL));
    }
    public static String restoreEmbedding(String incoming, String stored) {
        return SecretMask.restore("the Embedding model", incoming, stored, SecretMask.Style.TAIL);
    }
}
