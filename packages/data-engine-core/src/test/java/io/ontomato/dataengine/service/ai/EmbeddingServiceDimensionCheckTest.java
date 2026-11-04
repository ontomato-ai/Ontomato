package io.ontomato.dataengine.service.ai;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.agent.AgentRuntimeClient;
import io.ontomato.dataengine.dao.VectorRebuildState;
import org.junit.jupiter.api.Test;
class EmbeddingServiceDimensionCheckTest {
    @Test void sendsOnlyTextAndChecksTheReturnedGeneration() throws Exception {
        var runtime = mock(AgentRuntimeClient.class);
        when(runtime.json(eq("d1"), anyString(), eq("/v1/models/embeddings"), eq("POST"), any(), isNull()))
            .thenReturn(JSONObject.parseObject("{\"modelId\":\"gateway/embed\",\"dimensions\":2,\"vectors\":[[0.1,0.2]]}"));
        var service = new EmbeddingService(runtime);
        assertArrayEquals(new float[]{0.1f,0.2f}, service.embedWith(new EmbeddingSelection("gateway/embed",2),"text","d1"));
        verify(runtime).json(eq("d1"), anyString(), anyString(), eq("POST"), eq(JSONObject.parseObject("{\"texts\":[\"text\"]}")), isNull());
        assertThrows(IllegalStateException.class, () -> service.embedWith(new EmbeddingSelection("gateway/other",2),"text","d1"));
    }
    @Test void modelChangesRequireRebuildEvenAtTheSameDimension() {
        var state = VectorRebuildState.of(new EmbeddingSelection("gateway/embed",2), VectorRebuildState.Status.READY,true);
        assertTrue(state.sameGeneration(new EmbeddingSelection("gateway/embed",2)));
        assertFalse(state.sameGeneration(new EmbeddingSelection("gateway/other",2)));
        assertFalse(state.sameGeneration(new EmbeddingSelection("gateway/embed",3)));
    }
}
