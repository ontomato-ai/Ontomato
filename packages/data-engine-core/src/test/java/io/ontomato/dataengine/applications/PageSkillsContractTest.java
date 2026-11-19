package io.ontomato.dataengine.applications;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.mock.http.MockHttpInputMessage;
import org.springframework.mock.http.MockHttpOutputMessage;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

class PageSkillsContractTest {
    private static final PageSkills.Skill SKILL = new PageSkills.Skill(new PageSkills.Namespace("provider","ontology",null),"knowledge-governance");
    private static PageSkills.Mapping menu(String permission) { return new PageSkills.Mapping(permission,null,null,SKILL,null); }
    private static PageSkills.Mapping member() { return new PageSkills.Mapping(null,"domain-member","dashboard",SKILL,null); }

    @Test void jacksonBoundaryKeepsTheSharedWireShapeWithoutNullAlternativeFields() throws Exception {
        var converter = new MappingJackson2HttpMessageConverter();
        var input = new MockHttpInputMessage("""
            {"applications":[{"id":"example","kind":"native","rail":"apps","category":"build","sort":1,
            "entry":{"path":"/example","renderer":"example"},"entryAccess":["business-knowledge"],"scheduleAdapter":null,
            "declaration":{"names":{"en":"Example"},"descriptions":{},"icon":"knowledge","groups":[],"permissions":[],
            "pageSkills":[{"permissionCode":"business-knowledge","skill":{"namespace":{"kind":"provider","provider":"ontology"},"name":"knowledge-governance"},
            "defaults":[{"pageKey":"governance-report","defaultAgent":{"kind":"preset","agentKind":"knowledge-governance"}}]}]}}]}
            """.getBytes(StandardCharsets.UTF_8));
        input.getHeaders().setContentType(MediaType.APPLICATION_JSON);
        var batch = (ApplicationController.Batch)converter.read(ApplicationController.Batch.class,input);
        var mappings = batch.applications().getFirst().declaration().pageSkills();
        PageSkills.validate(mappings);
        assertEquals(SKILL,mappings.getFirst().skill());
        var output = new MockHttpOutputMessage();
        converter.write(new PageSkills.Projection(mappings,List.of(SKILL)),MediaType.APPLICATION_JSON,output);
        var body = JSONObject.parseObject(output.getBodyAsString());
        var mapping = body.getJSONArray("pageSkills").getJSONObject(0);
        assertFalse(mapping.containsKey("access"));
        assertFalse(mapping.getJSONObject("skill").getJSONObject("namespace").containsKey("domainId"));
        assertEquals("governance-report",mapping.getJSONArray("defaults").getJSONObject(0).getString("pageKey"));
        assertEquals(SKILL.name(),body.getJSONArray("registeredSkills").getJSONObject(0).getString("name"));
    }

    @Test void rejectsAmbiguousLocatorsAtTheDeclarationBoundary() {
        assertThrows(ResponseStatusException.class,()->PageSkills.validate(List.of(menu("menu"),menu("menu"))));
        assertThrows(ResponseStatusException.class,()->PageSkills.validate(List.of(member(),member())));
        assertThrows(ResponseStatusException.class,()->PageSkills.validate(List.of(new PageSkills.Mapping("menu","domain-member","dashboard",SKILL,null))));
    }

    @Test void projectionRetainsDeniedIdentitiesButNeverTheirMappingsOrDefaults() {
        var access=mock(ApplicationAccess.class); var user=mock(User.class);
        when(user.getDomainId()).thenReturn("domain");
        var catalog=spy(new ApplicationCatalog(mock(JdbcTemplate.class),mock(TransactionTemplate.class),access,"{}",mock(PanelResources.class),mock(io.ontomato.dataengine.service.ProductGrantService.class)));
        var allowed=menu("allowed");var denied=menu("denied");
        doReturn(List.of(JSONObject.of("id","example","entry",JSONObject.of("renderer","native"),"pageSkills",List.of(allowed,denied)),
            JSONObject.of("id","other-domain","domainId","other","pageSkills",List.of(member())))).when(catalog).all();
        when(access.pageSkills(List.of(allowed,denied),user)).thenReturn(List.of(allowed));
        var projection=catalog.pageSkills(user);
        assertEquals(List.of(allowed),projection.pageSkills());
        assertEquals(List.of(SKILL),projection.registeredSkills());
    }

    @Test void duplicateLocatorsAcrossApplicationsFailBeforeAnyWrite() {
        var db=mock(JdbcTemplate.class);var transactions=mock(TransactionTemplate.class);
        doAnswer(call->{ ((java.util.function.Consumer<org.springframework.transaction.TransactionStatus>)call.getArgument(0)).accept(null);return null; })
            .when(transactions).executeWithoutResult(any());
        var catalog=spy(new ApplicationCatalog(db,transactions,mock(ApplicationAccess.class),"{}",mock(PanelResources.class),mock(io.ontomato.dataengine.service.ProductGrantService.class)));
        doReturn(List.of(JSONObject.of("id","existing","entry",JSONObject.of("renderer","native"),"pageSkills",List.of(member())))).when(catalog).all();
        var declaration=new ApplicationCatalog.Declaration(java.util.Map.of("en","Example"),java.util.Map.of(),"knowledge",List.of(),List.of(),List.of(member()),List.of());
        var builtin=new ApplicationCatalog.Builtin("new-app","native","apps","build",0,JSONObject.of("path","/example"),List.of("domain-member"),null,declaration);
        assertThrows(ResponseStatusException.class,()->catalog.builtins("workbench",List.of(builtin)));
        verify(db,never()).update(anyString(),any(Object[].class));
    }
}
