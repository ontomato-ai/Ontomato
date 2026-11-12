package io.ontomato.dataengine.controller;
import static org.junit.jupiter.api.Assertions.*;
import com.alibaba.fastjson2.JSON;
import io.ontomato.dataengine.config.BusinessConfig;
import org.junit.jupiter.api.Test;
class BusinessConfigControllerModelKeyWriteOnlyTest {
    @Test void legacyModelSecretsAreNotPartOfTheBusinessConfigurationView() {
        var config = JSON.parseObject("{\"embeddingModelProperties\":{\"apiKey\":\"old-secret\"}}", BusinessConfig.class);
        assertFalse(JSON.toJSONString(config).contains("old-secret"));
    }
}
