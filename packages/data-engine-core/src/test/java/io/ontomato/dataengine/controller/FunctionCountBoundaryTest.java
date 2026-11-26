package io.ontomato.dataengine.controller;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.FunctionDao;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationStore;
import io.ontomato.dataengine.service.authorization.AuthorizationSubjects;
import io.ontomato.dataengine.service.authorization.CapabilityDefinitions;
import io.ontomato.dataengine.service.impl.FunctionServiceImpl;
import io.ontomato.dataengine.util.SpringBeanUtil;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class FunctionCountBoundaryTest {
    private final FunctionDao dao = mock(FunctionDao.class);
    private final AuthorizationStore policies = mock(AuthorizationStore.class);
    private MockMvc mvc;

    @BeforeEach
    void wire() {
        var user = mock(User.class);
        when(user.getId()).thenReturn("reader");
        when(user.getDomainId()).thenReturn("domain-a");
        var identity = mock(IdentityService.class);
        when(identity.getCurrentUser()).thenReturn(user);
        var context = new GenericApplicationContext();
        context.registerBean(IdentityService.class, () -> identity);
        context.refresh();
        new SpringBeanUtil().setApplicationContext(context);

        var subjects = mock(AuthorizationSubjects.class);
        var roles = Set.of("member");
        when(subjects.resolveRoles("domain-a", "reader"))
                .thenReturn(new RoleResolution(roles, roles, List.of(), Set.of(), Map.of(), false));
        when(policies.policies("domain-a", roles)).thenReturn(List.of(new PolicyRef("member", "p1", PolicyKind.OBJECT)));
        var definitions = new CapabilityDefinitions(new AuthorizationService(subjects, policies, null, null, null), identity);
        var service = new FunctionServiceImpl();
        ReflectionTestUtils.setField(service, "definitions", definitions);
        ReflectionTestUtils.setField(service, "functionDao", dao);
        var controller = new FunctionController();
        ReflectionTestUtils.setField(controller, "functionService", service);
        mvc = MockMvcBuilders.standaloneSetup(controller)
                .setMessageConverters(new MappingJackson2HttpMessageConverter()).build();
    }

    @Test
    void countsOnlyVisibleFunctionsUsingTheOriginalOwnershipAndGrantRules() throws Exception {
        when(dao.queryReadCandidates("domain-a")).thenReturn(List.of(
                candidate("product", Function.OPERATION_PRODUCT, "other", false),
                candidate("own-draft", Function.OPERATION_READ, "reader", false),
                candidate("readable", Function.OPERATION_READ, "other", true),
                candidate("editable", Function.OPERATION_WRITE, "other", true),
                candidate("private-draft", Function.OPERATION_WRITE, "other", false),
                candidate("ungranted", Function.OPERATION_READ, "other", true)));
        grant("readable", Kind.READ_FUNCTION, Verb.VIEW);
        grant("editable", Kind.WRITE_FUNCTION, Verb.EDIT);
        grant("private-draft", Kind.WRITE_FUNCTION, Verb.USE);
        var visible = Set.of("product", "own-draft", "readable", "editable");
        when(dao.countByIds(eq("domain-a"), argThat(ids -> Set.copyOf(ids).equals(visible)))).thenReturn(4L);

        mvc.perform(post("/function/queryList").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"countOnly\":true,\"domainId\":\"other-domain\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.total").value(4));
        verify(dao, never()).queryList(any(), any(), any());
    }

    @Test
    void countOnlyRejectsFiltersInsteadOfCountingOutsideTheirScope() throws Exception {
        for (String filter : List.of("\"operation\":\"OPERATION_READ\"", "\"className\":\"Room\"")) {
            mvc.perform(post("/function/queryList").contentType(MediaType.APPLICATION_JSON)
                            .content("{\"countOnly\":true," + filter + "}"))
                    .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(dao);
    }

    private void grant(String id, Kind kind, Verb verb) {
        var target = new ObjectTarget("domain-a", kind, id);
        when(policies.objectGrants(target, verb, Set.of("p1")))
                .thenReturn(List.of(new ObjectGrant("p1", target, verb, null)));
    }

    private static Function candidate(String id, String operation, String owner, boolean published) {
        var function = new Function();
        function.setDomainId("domain-a");
        function.setId(id);
        function.setOperation(operation);
        function.setCreatedBy(owner);
        function.setPublished(published);
        return function;
    }
}
