package io.ontomato.dataengine.service.agent;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.LangService;
import org.junit.jupiter.api.Test;

class OntologyAgentLabelsTest {
  @Test void shippedMetadataUsesTheProviderLocaleWithoutChangingTheDefinition() {
    var language=mock(LangService.class);
    when(language.get("zh-CN","OntologyAgent.retrieval.name")).thenReturn("取数员");
    when(language.get("zh-CN","OntologyAgent.retrieval.description")).thenReturn("回答业务数据问题");
    var labels=new OntologyAgentLabels(language);
    var definition=JSONObject.of("id",OntologyAgentStore.RETRIEVER,"name","Data retrieval","description","Query");
    var translated=labels.localize(OntologyAgentStore.RETRIEVER,definition,"zh-CN");
    assertEquals("取数员",translated.getString("name"));assertEquals("回答业务数据问题",translated.getString("description"));
    assertEquals("Data retrieval",definition.getString("name"));
  }
  @Test void namesAuthoredInTheDomainAreNotTranslated() {
    var language=mock(LangService.class);var labels=new OntologyAgentLabels(language);
    var custom=JSONObject.of("id","56a15178-1111-4111-8111-111111111111","name","My governance","description","My scope");
    assertSame(custom,labels.localize(custom.getString("id"),custom,"zh-CN"));verifyNoInteractions(language);
  }
}
