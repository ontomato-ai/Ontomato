package io.ontomato.dataengine.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.JSONRuleDao;
import io.ontomato.dataengine.dao.KnowledgeEntity;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.KnowledgeService;
import io.ontomato.dataengine.service.impl.AdminServiceImpl;
import io.ontomato.dataengine.util.SpringBeanUtil;
import jakarta.servlet.ServletException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class AdminCountBoundaryTest {
    private final AdminService admin = mock(AdminService.class);
    private final KnowledgeService knowledge = mock(KnowledgeService.class);
    private MockMvc mvc;

    @BeforeEach
    void wire() {
        var user = mock(User.class);
        when(user.getDomainId()).thenReturn("current-domain");
        var identity = mock(IdentityService.class);
        when(identity.getCurrentUser()).thenReturn(user);
        var context = new GenericApplicationContext();
        context.registerBean(IdentityService.class, () -> identity);
        context.refresh();
        new SpringBeanUtil().setApplicationContext(context);

        var controller = new AdminController();
        ReflectionTestUtils.setField(controller, "adminService", admin);
        ReflectionTestUtils.setField(controller, "knowledgeService", knowledge);
        mvc = MockMvcBuilders.standaloneSetup(controller)
                .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    }

    @Test
    void countsUseTheAuthenticatedDomainWithoutLoadingDefinitionsOrEntries() throws Exception {
        when(admin.countOntologyMetadata("current-domain"))
                .thenReturn(Map.of("objectTypes", 2, "attributes", 4, "relationships", 1));
        when(knowledge.countBusinessKnowledge("current-domain")).thenReturn(3);
        var payload = "{\"countOnly\":true,\"domainId\":\"other-domain\"}";

        mvc.perform(post("/admin/getMetas").contentType(MediaType.APPLICATION_JSON).content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.objectTypes").value(2))
                .andExpect(jsonPath("$.data.attributes").value(4))
                .andExpect(jsonPath("$.data.relationships").value(1));
        mvc.perform(post("/admin/getBussinessKnowledge").contentType(MediaType.APPLICATION_JSON).content(payload))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.total").value(3));

        verify(admin, never()).getJSONRule("current-domain");
        verify(knowledge, never()).getBussinessKnowledge("current-domain");
    }

    @Test
    void absentOrFalseCountOnlyStillReturnsTheOriginalData() throws Exception {
        when(admin.getJSONRule("current-domain")).thenReturn(Map.of("classDef", List.of(Map.of("className", "Room"))));
        var entry = new KnowledgeEntity();
        entry.setKnowledgeID("k1");
        when(knowledge.getBussinessKnowledge("current-domain")).thenReturn(Map.of("k1", entry));

        mvc.perform(post("/admin/getMetas").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.classDef[0].className").value("Room"));
        mvc.perform(post("/admin/getBussinessKnowledge").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"countOnly\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.k1.knowledgeID").value("k1"));
    }

    @Test
    void aMissingOntologyRuleFailsTheSameWayInBothOwnerReads() {
        var dao = mock(JSONRuleDao.class);
        when(dao.query("current-domain")).thenReturn(null);
        when(dao.countMetadata("current-domain")).thenReturn(null);
        var service = new AdminServiceImpl();
        ReflectionTestUtils.setField(service, "jsonRuleDao", dao);

        var original = assertThrows(IllegalStateException.class, () -> service.getJSONRule("current-domain"));
        when(admin.countOntologyMetadata("current-domain")).thenAnswer(call -> service.countOntologyMetadata("current-domain"));
        var failure = assertThrows(ServletException.class, () -> mvc.perform(post("/admin/getMetas")
                .contentType(MediaType.APPLICATION_JSON).content("{\"countOnly\":true}")));
        assertEquals(original.getClass(), failure.getCause().getClass());
        assertEquals(original.getMessage(), failure.getCause().getMessage());
    }

    @Test
    void knowledgeCountDoesNotCatchStorageFailures() {
        var storageFailure = new IllegalStateException("Storage failed");
        when(knowledge.countBusinessKnowledge("current-domain")).thenThrow(storageFailure);

        var failure = assertThrows(ServletException.class, () -> mvc.perform(post("/admin/getBussinessKnowledge")
                .contentType(MediaType.APPLICATION_JSON).content("{\"countOnly\":true}")));
        assertSame(storageFailure, failure.getCause());
    }
}
