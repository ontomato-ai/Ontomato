package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.server.ResponseStatusException;

class AgentPrincipalServiceTest {
    @Test void userScopedCredentialsBindTheHumanAndRecheckRevocation(){
        var db=mock(JdbcTemplate.class);var identities=mock(io.ontomato.dataengine.schedules.ScheduleIdentity.class);var grants=mock(ProductGrantService.class);
        var user=mock(io.ontomato.dataengine.core.bean.User.class);when(user.getId()).thenReturn("human");when(user.getDomainId()).thenReturn("domain");when(user.isEnable()).thenReturn(true);
        when(identities.creator("domain","human")).thenReturn(user);
        when(db.query(anyString(),any(RowMapper.class),eq("domain"),eq("agent"))).thenReturn(List.of(new AgentPrincipalService.Principal("agent","domain","Agent",1)));
        when(db.queryForObject(anyString(),eq(Boolean.class),eq("domain"),eq("agent"))).thenReturn(true);
        when(grants.allowedFor("domain","human","agent","use")).thenReturn(true);
        when(grants.allowedFor("domain","human","default-agent-profile-agent","use")).thenReturn(true);
        var service=new AgentPrincipalService(db,"signing-key");org.springframework.test.util.ReflectionTestUtils.setField(service,"identities",identities);org.springframework.test.util.ReflectionTestUtils.setField(service,"grants",grants);
        String token=service.issueUserScoped("domain","agent","human",System.currentTimeMillis()+60_000);
        var execution=service.verifyUserScoped(token);assertSame(user,execution.user());assertEquals("agent",execution.principal().id());
        assertThrows(ResponseStatusException.class,()->service.verifyUserScoped(token+"tampered"));
        when(grants.allowedFor("domain","human","default-agent-profile-agent","use")).thenReturn(false);
        assertThrows(ResponseStatusException.class,()->service.verifyUserScoped(token));
        when(grants.allowedFor("domain","human","default-agent-profile-agent","use")).thenReturn(true);
        when(grants.allowedFor("domain","human","agent","use")).thenReturn(false);
        assertThrows(ResponseStatusException.class,()->service.verifyUserScoped(token));
    }
    @Test void credentialsTrackPrincipalRevisionAndRequireExplicitRoles(){
        var db=mock(JdbcTemplate.class);
        var revision=new java.util.concurrent.atomic.AtomicLong(1);
        var enabled=new java.util.concurrent.atomic.AtomicBoolean(true);
        when(db.query(anyString(),any(RowMapper.class),eq("domain"),eq("agent"))).thenAnswer(call->enabled.get()?List.of(new AgentPrincipalService.Principal("agent","domain","Agent",revision.get())):List.of());
        when(db.queryForList(anyString(),eq(String.class),eq("domain"),eq("agent"))).thenReturn(List.of("reader"));
        var service=new AgentPrincipalService(db,"test-signing-key");
        String token=service.issue("domain","agent",System.currentTimeMillis()+60_000);
        assertEquals("agent",service.verify(token).principal().id());
        assertThrows(ResponseStatusException.class,()->service.verify(token+"tampered"));
        revision.incrementAndGet();
        assertThrows(ResponseStatusException.class,()->service.verify(token));
        when(db.queryForList(anyString(),eq(String.class),eq("domain"),eq("agent"))).thenReturn(List.of());
        assertThrows(ResponseStatusException.class,()->service.issue("domain","agent",System.currentTimeMillis()+60_000));
        enabled.set(false);
        assertThrows(ResponseStatusException.class,()->service.verify(token));
    }
}
