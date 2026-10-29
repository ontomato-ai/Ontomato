package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.VectorRebuildState;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.ai.EmbeddingService;
import io.ontomato.dataengine.service.vector.VectorRebuildService;
import io.ontomato.dataengine.service.vector.VectorRebuildStatus;
import io.ontomato.dataengine.util.SpringBeanUtil;

/**
 * The embedding boundary (contract interfaces 2-5): dimensions validated where the page submits,
 * the draft dimensions used for the test, rebuild state reported and started per domain.
 */
class BusinessConfigControllerVectorRebuildTest {

    private final BusinessConfigService businessConfigService = mock(BusinessConfigService.class);
    private final EmbeddingService embeddingService = mock(EmbeddingService.class);
    private final LangService langService = mock(LangService.class);
    private final VectorRebuildService vectorRebuildService = mock(VectorRebuildService.class);
    private final BusinessConfigController controller = new BusinessConfigController();
    private BusinessConfig stored;

    @BeforeEach
    void setUp() {
        User user = mock(User.class);
        when(user.getDomainId()).thenReturn("d1");
        IdentityService identityService = mock(IdentityService.class);
        when(identityService.getCurrentUser()).thenReturn(user);
        GenericApplicationContext context = new GenericApplicationContext();
        context.registerBean(IdentityService.class, () -> identityService);
        context.refresh();
        new SpringBeanUtil().setApplicationContext(context);

        stored = new BusinessConfig();


        when(businessConfigService.get("d1")).thenReturn(stored);
        when(langService.get(any(), anyString())).thenAnswer(invocation -> invocation.getArgument(1));
        ReflectionTestUtils.setField(controller, "businessConfigService", businessConfigService);
        ReflectionTestUtils.setField(controller, "embeddingService", embeddingService);
        ReflectionTestUtils.setField(controller, "langService", langService);
        ReflectionTestUtils.setField(controller, "vectorRebuildService", vectorRebuildService);
    }

    private static JSONObject embeddingInput(Integer dimensions) {
        JSONObject input = new JSONObject();
        input.put("baseUrl", "http://emb/v1");
        input.put("apiKey", "key");
        input.put("modelName", "m1");
        if (dimensions != null) {
            input.put("dimensions", dimensions);
        }
        return input;
    }

    @Test
    void saveEmbeddingModelHandsTheDimensionsToTheVectorService() {
        JSONObject response = controller.saveEmbeddingModel("zh-CN", embeddingInput(2048));

        assertTrue(response.getBooleanValue("success"), response.toJSONString());
        ArgumentCaptor<BusinessConfig.EmbeddingModelProperties> captor =
                ArgumentCaptor.forClass(BusinessConfig.EmbeddingModelProperties.class);
        verify(vectorRebuildService).saveEmbeddingModel(eq("d1"), eq("zh-CN"), captor.capture());
        assertEquals(2048, captor.getValue().getDimensions());
    }

    @Test
    void saveEmbeddingModelRejectsMissingOrNonPositiveDimensions() {
        for (JSONObject input : List.of(embeddingInput(null), embeddingInput(0), embeddingInput(-4))) {
            JSONObject response = controller.saveEmbeddingModel("zh-CN", input);
            assertFalse(response.getBooleanValue("success"), input.toJSONString());
            assertTrue(response.getString("message").contains("dimensions"), response.toJSONString());
        }
    }

    @Test
    void saveEmbeddingModelReportsARefusalWhileARebuildRuns() {
        org.mockito.Mockito.doThrow(new IllegalStateException("Vector.saveRefusedWhileRebuilding"))
                .when(vectorRebuildService).saveEmbeddingModel(eq("d1"), eq("zh-CN"), any());

        JSONObject response = controller.saveEmbeddingModel("zh-CN", embeddingInput(2048));

        assertFalse(response.getBooleanValue("success"));
        assertTrue(response.getString("message").contains("Vector.saveRefusedWhileRebuilding"), response.toJSONString());
    }

    @Test
    void testEmbeddingModelRejectsMissingDimensions() {
        JSONObject input = new JSONObject();
        input.put("modelConfig", embeddingInput(null));

        JSONObject response = controller.testEmbeddingModel(input);

        assertFalse(response.getBooleanValue("success"));
        assertTrue(response.getString("message").contains("dimensions"), response.toJSONString());
    }

    @Test
    void testEmbeddingModelReportsDraftAgainstActualLength() throws Exception {
        when(embeddingService.testEmbeddingModel(any(), anyString()))
                .thenThrow(new IllegalArgumentException(
                        "The vector dimension returned by the embedding model 2048 and the requested embedding dimension 4096 are inconsistent"));
        JSONObject input = new JSONObject();
        input.put("modelConfig", embeddingInput(4096));

        JSONObject response = controller.testEmbeddingModel(input);

        assertFalse(response.getBooleanValue("success"));
        assertTrue(response.getString("message").contains("4096"), response.toJSONString());
        assertTrue(response.getString("message").contains("2048"), response.toJSONString());
    }

    @Test
    void vectorRebuildStatusReportsStateProgressAndTheFailure() {
        VectorRebuildStatus status = new VectorRebuildStatus();
        status.setState(VectorRebuildStatus.State.FAILED);
        status.setTotal(7);
        status.setDone(3);
        VectorRebuildState.Failure failure = new VectorRebuildState.Failure();
        failure.setPhase(VectorRebuildState.Phase.EMBED);
        failure.setItemType(VectorRebuildState.ItemType.ACTION);
        failure.setItemId("a1");
        failure.setReason("timeout");
        status.setError(failure);
        when(vectorRebuildService.status("d1")).thenReturn(status);

        JSONObject response = controller.vectorRebuildStatus();

        assertTrue(response.getBooleanValue("success"));
        JSONObject data = response.getJSONObject("data");
        assertEquals("FAILED", data.getString("state"));
        assertEquals(7, data.getIntValue("total"));
        assertEquals(3, data.getIntValue("done"));
        assertEquals("EMBED", data.getJSONObject("error").getString("phase"));
        assertEquals("ACTION", data.getJSONObject("error").getString("itemType"));
        assertEquals("a1", data.getJSONObject("error").getString("itemId"));
        assertEquals("timeout", data.getJSONObject("error").getString("reason"));
    }

    @Test
    void rebuildVectorsRefusesWhenNotNeeded() {
        org.mockito.Mockito.doThrow(new IllegalStateException("Vector.rebuildNotNeeded"))
                .when(vectorRebuildService).start(eq("d1"), anyString());

        JSONObject response = controller.rebuildVectors("zh-CN");

        assertFalse(response.getBooleanValue("success"));
        assertTrue(response.getString("message").contains("Vector.rebuildNotNeeded"), response.toJSONString());
    }


    @Test
    void pauseVectorRebuildPausesThisDomainOrReportsTheRefusal() {
        assertTrue(controller.pauseVectorRebuild("zh-CN").getBooleanValue("success"));
        verify(vectorRebuildService).pause("d1", "zh-CN");

        org.mockito.Mockito.doThrow(new IllegalStateException("Vector.rebuildNotRunning"))
                .when(vectorRebuildService).pause(eq("d1"), anyString());
        JSONObject response = controller.pauseVectorRebuild("zh-CN");
        assertFalse(response.getBooleanValue("success"));
        assertTrue(response.getString("message").contains("Vector.rebuildNotRunning"), response.toJSONString());
    }

}
