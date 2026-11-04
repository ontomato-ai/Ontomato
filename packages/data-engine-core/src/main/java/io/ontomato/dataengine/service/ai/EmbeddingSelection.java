package io.ontomato.dataengine.service.ai;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Non-secret identity of a vector generation. The runtime owns all model configuration. */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class EmbeddingSelection {
    private String modelId;
    private Integer dimensions;
}
