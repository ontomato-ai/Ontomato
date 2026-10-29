package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ModelKeyMask;
import io.ontomato.dataengine.config.SecretMask;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dataAdapter.SecretCipher;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.util.SpringBeanUtil;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.test.util.ReflectionTestUtils;

/** Embedding keys remain write-only after conversation configuration moves to runtime. */
class BusinessConfigControllerModelKeyWriteOnlyTest {

    private final BusinessConfigService businessConfigService = mock(BusinessConfigService.class);
    private final BusinessConfigController controller = new BusinessConfigController();
    private String storedJson;

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

        BusinessConfig stored = new BusinessConfig();
        BusinessConfig.EmbeddingModelProperties embedding = stored.new EmbeddingModelProperties();
        embedding.setApiKey("sk-embedding-9876");
        stored.setEmbeddingModelProperties(embedding);
        storedJson = JSON.toJSONString(stored, Feature.WriteMapNullValue);

        // Every read gets its own record, as the DAO does.
        when(businessConfigService.get("d1"))
                .thenAnswer(invocation -> JSON.parseObject(storedJson, BusinessConfig.class));
        ReflectionTestUtils.setField(controller, "businessConfigService", businessConfigService);
    }

    @Test
    void embeddingReadIsMasked() {
        JSONObject data = JSONObject.from(controller.getConfig().get("data"));
        assertFalse(data.toJSONString().contains("sk-embedding-9876"));
        assertEquals("******9876", data.getJSONObject("embeddingModelProperties").getString("apiKey"));
        assertFalse(data.containsKey("models"));
        assertFalse(data.containsKey("agents"));
    }

    @Test
    void shortKeysShowNoTailAndTheEmbeddingMaskKeepsItsKey() {
        assertEquals("******", SecretMask.mask("sk-12345", SecretMask.Style.TAIL));
        assertEquals("short", ModelKeyMask.restoreEmbedding("******", "short"));
    assertEquals(
        "sk-embedding-9876", ModelKeyMask.restoreEmbedding("******9876", "sk-embedding-9876"));
    assertEquals("sk-replaced", ModelKeyMask.restoreEmbedding("sk-replaced", "sk-embedding-9876"));
    assertThrows(
        IllegalArgumentException.class, () -> ModelKeyMask.restoreEmbedding("******9876", null));
    }

}
