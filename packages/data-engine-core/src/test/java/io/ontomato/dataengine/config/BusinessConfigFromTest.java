package io.ontomato.dataengine.config;
import static org.junit.jupiter.api.Assertions.*;
import com.alibaba.fastjson2.JSONObject;
import org.junit.jupiter.api.Test;
class BusinessConfigFromTest {
    @Test void newDomainsDoNotCreateJavaModelConfiguration() {
        var config = JSONObject.from(BusinessConfig.from(new DataRagConfig()));
        assertFalse(config.containsKey("embeddingModelProperties"));
        assertFalse(config.containsKey("embeddingVectorSource"));
    }
}
