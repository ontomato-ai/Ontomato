package io.ontomato.dataengine.controller;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.*;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class ObjectViewBoundaryTest {
    @Test void jacksonBoundDocumentsReachCapabilityAdmissionBeforePersistence() throws Exception {
        var store = mock(ObjectViewStore.class);
        var identity = mock(IdentityService.class);
        var user = mock(User.class);
        when(user.getDomainId()).thenReturn("domain");
        when(identity.getCurrentUser()).thenReturn(user);
        var metrics = mock(MetricViewService.class);
        var mvc = MockMvcBuilders.standaloneSetup(new ObjectViewController(store, identity, metrics, mock(ActionService.class)))
                .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
        String document = """
                {"className":"Order","form":"full","expectedRevision":0,"description":"","document":{
                  "schemaVersion":1,"className":"Order","title":"Order","tabs":[{"id":"t","title":"t",
                    "sections":[{"id":"s","title":"","widgets":[{"id":"details","kind":"properties",
                      "title":"Details","span":12,"resourceId":"metric","parameters":{"id":{"source":"context","path":"primaryKey"}}}]}]}]}}
                """;
        mvc.perform(post("/objectView/save").contentType(MediaType.APPLICATION_JSON).content(document)).andExpect(status().isOk());
        verify(metrics).requireExecutable("metric", user);
        verify(store).save(eq("domain"), any(), eq("Order"), eq("full"), eq(0), any(JSONObject.class), eq(""));
        clearInvocations(store);
        mvc.perform(post("/objectView/save").contentType(MediaType.APPLICATION_JSON)
                .content(document.replace("\"source\":\"context\",\"path\":\"primaryKey\"", "\"source\":\"object\",\"path\":\"amount\""))).andExpect(status().isBadRequest());
        verifyNoInteractions(store);
    }
}
