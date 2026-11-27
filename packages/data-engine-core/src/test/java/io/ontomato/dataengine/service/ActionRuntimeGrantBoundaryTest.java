package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.PythonExecuteResult;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.ReturnDef;
import io.ontomato.dataengine.controller.QueryGrantFilter;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.agent.AgentExecutionAccess;
import io.ontomato.dataengine.service.impl.ABCProgramServiceImpl;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import jakarta.servlet.FilterChain;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

class ActionRuntimeGrantBoundaryTest {
    private static final String QUERY = "/ontology/query/execute-dsl";
    private static final String WRITE = "/writeFunctionOperation/update";
    private static final ActionRuntimeGrant.Row ROW = new ActionRuntimeGrant.Row("Order", "order-7");
    private static final User ACTOR = new QueryAccessService.GrantUser("operator", "domain");

    private final UUID run = UUID.randomUUID();
    private final long deadline = System.currentTimeMillis() + 60_000;
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final QueryGrantService grants = new QueryGrantService(jdbc, "test-key", new WorkbenchServiceAuthentication("internal"));
    private final ActionRuntimeGrant.Owner owner = mock(ActionRuntimeGrant.Owner.class);
    private final AgentExecutionAccess identities = mock(AgentExecutionAccess.class);
    private final QueryGrantFilter filter = new QueryGrantFilter(grants, identities, mock(IdentityService.class));

    @BeforeEach
    void bindVerifiedRequestBoundary() {
        when(jdbc.queryForObject(contains("id=? AND run_id=?"), eq(Integer.class),
                anyString(), anyString(), anyString(), anyLong())).thenReturn(1);
        when(identities.requireMember("domain", "operator")).thenReturn(ACTOR);
        var beans = new DefaultListableBeanFactory();
        beans.registerSingleton("actionOwner", owner);
        ReflectionTestUtils.setField(filter, "actionOwners", beans.getBeanProvider(ActionRuntimeGrant.Owner.class));
    }

    @Test
    void abcRuntimeCallbacksRecheckTheDeclaredActionAndCurrentTargetBeforeBothReadsAndWrites() throws Exception {
        var action = new ActionRuntimeGrant("domain", "operator", "approve", ROW, null);
        var token = start(action, ExecutionTarget.LIVE, List.of("Order"));
        for (String path : List.of(QUERY, WRITE)) {
            var request = request(path, token);
            var response = new MockHttpServletResponse();
            var chain = mock(FilterChain.class);
            filter.doFilter(request, response, chain);
            verify(chain).doFilter(request, response);
        }
        verify(owner, times(2)).requireCurrent(same(ACTOR), eq(action),
                argThat(execution -> execution.mode() == ExecutionTarget.Mode.LIVE
                        && execution.classNames().equals(List.of("Order"))));

        doThrow(new OwnerRefusal("ACTION_TARGET_OUT_OF_SCOPE", "The target no longer belongs to this actor"))
                .when(owner).requireCurrent(same(ACTOR), eq(action), any());
        for (String path : List.of(QUERY, WRITE)) {
            var response = reject(request(path, token), 403);
            assertTrue(response.getContentAsString().contains("ACTION_TARGET_OUT_OF_SCOPE"));
        }

        reject(request("/ontology/query/metrics/execute", token), 403);
        reject(request(WRITE, null), 401);

        when(identities.requireMember("domain", "operator"))
                .thenReturn(new QueryAccessService.GrantUser("other", "domain"));
        assertTrue(reject(request(QUERY, token), 403).getContentAsString().contains("ACTION_SUBJECT_MISMATCH"));
    }

    @Test
    void frozenWorkflowContextSurvivesSigningAndCannotBecomeStandaloneOrMoveToASandbox() throws Exception {
        var step = new ActionRuntimeGrant.Step("approval", 3, 2, "case-run", ROW);
        var action = new ActionRuntimeGrant("domain", "operator", "approve", ROW, step);
        var token = start(action, ExecutionTarget.LIVE, List.of("Order"));
        doThrow(new OwnerRefusal("WORKFLOW_STEP_FORBIDDEN", "The workflow step is closed"))
                .when(owner).requireCurrent(same(ACTOR), eq(action), any());
        assertTrue(reject(request(WRITE, token), 403).getContentAsString().contains("WORKFLOW_STEP_FORBIDDEN"));

        var sandbox = ExecutionTarget.actionTrial("sample", List.of("Order"), deadline);
        var authority = PythonAuthority.write("operator", "domain", "sample").withTarget(sandbox).withAction(action);
        assertEquals(HttpStatus.FORBIDDEN,
                assertThrows(ResponseStatusException.class, () -> grants.issueExecution(authority, run.toString(), deadline)).getStatusCode());

        var parent = new PythonAuthority.ParentGrant(token, run.toString(), deadline);
        assertEquals(HttpStatus.FORBIDDEN, assertThrows(ResponseStatusException.class,
                () -> grants.issueExecution(PythonAuthority.read("operator", "domain").withParent(parent),
                        UUID.randomUUID().toString(), deadline)).getStatusCode());
    }

    @Test
    void sandboxCallbacksUseTheBoundSandboxAndAnEmptyActionScopeGrantsNoDataOperation() throws Exception {
        var sandbox = ExecutionTarget.actionTrial("sample", List.of("Order"), deadline);
        var contexts = mock(DataSandboxService.class);
        when(contexts.requireActionTrial("sample", "operator", "domain")).thenReturn(sandbox);
        ReflectionTestUtils.setField(grants, "contexts", contexts);
        var action = new ActionRuntimeGrant("domain", "operator", "approve", ROW, null);
        var token = start(action, sandbox, List.of("Order"));

        var request = request(WRITE, token);
        var response = new MockHttpServletResponse();
        var chain = mock(FilterChain.class);
        filter.doFilter(request, response, chain);
        verify(chain).doFilter(request, response);
        verify(owner).requireCurrent(same(ACTOR), eq(action), eq(sandbox));

        request = request(QUERY, token);
        request.addHeader(PreviewExecution.HEADER, "preview");
        // The preview identity never affects reads; the grant still owns the execution target.
        var previewResponse = new MockHttpServletResponse();
        filter.doFilter(request, previewResponse, mock(FilterChain.class));
        assertEquals(200, previewResponse.getStatus());

        var computation = new ActionRuntimeGrant("domain", "operator", "compute", null, null);
        var computeToken = start(computation, ExecutionTarget.LIVE, List.of());
        reject(request(QUERY, computeToken), 403);
    }

    private String start(ActionRuntimeGrant grant, ExecutionTarget target, List<String> classes) throws Exception {
        var tokens = new AtomicReference<String>();
        var python = mock(PythonExecuteService.class);
        when(python.execute(anyString(), anyString(), anyInt(), anyString(), any(), any(), anyMap()))
                .thenAnswer(call -> {
                    PythonAuthority authority = call.getArgument(4);
                    tokens.set(grants.issueExecution(authority, authority.executionId(), deadline));
                    return new PythonExecuteResult();
                });
        var abc = new ABCProgramServiceImpl();
        ReflectionTestUtils.setField(abc, "pythonExecuteService", python);
        var function = new Function();
        function.setDomainId("domain");
        function.setOperation(Function.OPERATION_WRITE);
        function.setCode("# ontomato-python:2\nprint('done')");
        var returns = new ReturnDef();
        returns.setClassNames(classes);
        function.setReturnDef(returns);
        abc.execute(run.toString(), function, "operator", new UserDataPermission(), target.sandboxId(), "en",
                1, "domain", new ABCProgramService.ExecutionContext(run, new JSONObject(), target, grant));
        return tokens.get();
    }

    private MockHttpServletRequest request(String path, String token) {
        var request = new MockHttpServletRequest("POST", path);
        request.addHeader("X-Ontomato-Run-Id", run.toString());
        request.addHeader(WorkbenchServiceAuthentication.HEADER, "internal");
        if (token != null) request.addHeader("tk", token);
        return request;
    }

    private MockHttpServletResponse reject(MockHttpServletRequest request, int status) throws Exception {
        var response = new MockHttpServletResponse();
        var chain = mock(FilterChain.class);
        filter.doFilter(request, response, chain);
        assertEquals(status, response.getStatus());
        assertNull(request.getAttribute(QueryGrantService.ATTRIBUTE));
        verifyNoInteractions(chain);
        return response;
    }
}
