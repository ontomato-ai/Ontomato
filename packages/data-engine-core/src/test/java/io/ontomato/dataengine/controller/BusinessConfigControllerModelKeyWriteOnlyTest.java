package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.any;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import io.ontomato.dataengine.config.AgentConfig;
import io.ontomato.dataengine.config.AgentRole;
import io.ontomato.dataengine.config.BusinessConfig;
import io.ontomato.dataengine.config.ModelConfig;
import io.ontomato.dataengine.config.ModelKeyMask;
import io.ontomato.dataengine.config.ModelKeySeal;
import io.ontomato.dataengine.config.SecretMask;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dataAdapter.SecretCipher;
import io.ontomato.dataengine.service.BusinessConfigService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.util.SpringBeanUtil;

/** Saved model keys are write-only: reads show masks, saves keep stored keys, and the workbench server gets them sealed. */
class BusinessConfigControllerModelKeyWriteOnlyTest {

    private static final String KEY_A = "sk-first-key-0001";
    private static final String KEY_B = "sk-second-key-0001";
    private static final String TOKEN = "synthetic-runtime-token";
    /**
     * Sealed by Java for token {@code fixture-runtime-token}; the workbench server's model key seal test opens the same
     * value, so the two implementations cannot drift apart.
     */
    static final String FIXTURE_SEALED = "enc:v1:mzjUpW4OVVjLMPmxcmMcyop5LFN8VSJ_7lUGPppYXDK_UDNjyKAlYAL7vVwOMOI";

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
        ModelConfig model = new ModelConfig();
        model.setName("main");
        model.setBaseUrl("http://llm.test/v1");
        // Two keys with the same tail: each must map back to itself.
        model.setApiKeys(new ArrayList<>(List.of(KEY_A, KEY_B)));
        model.setModelName("m");
        stored.setModels(new ArrayList<>(List.of(model)));
        Map<String, AgentConfig> agents = new LinkedHashMap<>();
        for (String role : AgentRole.ALL) {
            AgentConfig agent = new AgentConfig();
            agent.setModel("main");
            agents.put(role, agent);
        }
        stored.setAgents(agents);
        BusinessConfig.EmbeddingModelProperties embedding = stored.new EmbeddingModelProperties();
        embedding.setApiKey("sk-embedding-9876");
        stored.setEmbeddingModelProperties(embedding);
        storedJson = JSON.toJSONString(stored, Feature.WriteMapNullValue);

        // Every read gets its own record, as the DAO does.
        when(businessConfigService.get("d1"))
                .thenAnswer(invocation -> JSON.parseObject(storedJson, BusinessConfig.class));
        ReflectionTestUtils.setField(controller, "businessConfigService", businessConfigService);
        ReflectionTestUtils.setField(controller, "modelKeySeal", new ModelKeySeal(TOKEN));
    }

    @Test
    void readsShowMasksAndTheKeysOnlySealed() {
        JSONObject data = controller.getModelSettings().getJSONObject("data");
        assertEquals(List.of("******0001", "******0001"),
                data.getJSONArray("models").getJSONObject(0).getJSONArray("apiKeys").toJavaList(String.class));
        assertFalse(data.toJSONString().contains(KEY_A));
        List<String> sealed = data.getJSONObject("sealedApiKeys").getJSONArray("main").toJavaList(String.class);
        assertEquals(List.of(KEY_A, KEY_B), sealed.stream().map(cipherFor(TOKEN)::decrypt).toList());

        JSONObject config = JSONObject.from(controller.getConfig().get("data"));
        assertFalse(config.toJSONString().contains(KEY_A));
        assertEquals("******0001", config.getJSONArray("models").getJSONObject(0).getJSONArray("apiKeys").getString(0));
        assertEquals("******9876", config.getJSONObject("embeddingModelProperties").getString("apiKey"));
    }

    @Test
    void savingMasksBackKeepsTheStoredKeysAndTheResponseStaysMasked() {
        JSONObject response = controller.saveModelSettings(input(List.of("******0001", "sk-new-key-5555", "******0001")));

        assertTrue(response.getBooleanValue("success"), response.toJSONString());
        ArgumentCaptor<BusinessConfig> saved = ArgumentCaptor.forClass(BusinessConfig.class);
        verify(businessConfigService).set(saved.capture(), eq("d1"));
        assertEquals(List.of(KEY_A, "sk-new-key-5555", KEY_B), saved.getValue().getModels().get(0).getApiKeys());
        assertEquals(List.of("******0001", "******5555", "******0001"), response.getJSONObject("data")
                .getJSONArray("models").getJSONObject(0).getJSONArray("apiKeys").toJavaList(String.class));
    }

    @Test
    void aMaskWithNoStoredKeyBehindItIsRefusedInsteadOfSaved() {
        JSONObject response = controller.saveModelSettings(input(List.of("******0001", "******0001", "******0001")));

        assertFalse(response.getBooleanValue("success"));
        verify(businessConfigService, never()).set(any(), any());
    }

    @Test
    void shortKeysShowNoTailAndTheEmbeddingMaskKeepsItsKey() {
        assertEquals("******", SecretMask.mask("sk-12345", SecretMask.Style.TAIL));
        assertEquals("short", ModelKeyMask.restoreEmbedding("******", "short"));
        assertEquals("sk-embedding-9876", ModelKeyMask.restoreEmbedding("******9876", "sk-embedding-9876"));
        assertEquals("sk-replaced", ModelKeyMask.restoreEmbedding("sk-replaced", "sk-embedding-9876"));
        assertThrows(IllegalArgumentException.class, () -> ModelKeyMask.restoreEmbedding("******9876", null));
    }

    @Test
    void theSealOpensOnlyWithTheSameTokenAndNeedsOne() {
        assertEquals("sk-fixture-key-1234", cipherFor("fixture-runtime-token").decrypt(FIXTURE_SEALED));
        assertThrows(IllegalStateException.class, () -> cipherFor("another-token").decrypt(FIXTURE_SEALED));
        for (String missing : new String[] { null, "", " \t " }) {
            assertThrows(IllegalStateException.class, () -> new ModelKeySeal(missing));
        }
    }

    /** The workbench server's side of the seal: AES-256-GCM with key = SHA-256 of the token. */
    private static SecretCipher cipherFor(String token) {
        try {
            byte[] key = java.security.MessageDigest.getInstance("SHA-256")
                    .digest(token.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return new SecretCipher(java.util.Base64.getEncoder().encodeToString(key), SecretCipher.Mode.DUAL);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static JSONObject input(List<String> keys) {
        JSONObject model = new JSONObject();
        model.put("name", "main");
        model.put("baseUrl", "http://llm.test/v1");
        model.put("apiKeys", keys);
        model.put("modelName", "m");
        JSONObject agents = new JSONObject();
        for (String role : AgentRole.ALL) {
            agents.put(role, "main");
        }
        JSONObject input = new JSONObject();
        input.put("models", new JSONArray(List.of(model)));
        input.put("agents", agents);
        return input;
    }
}
