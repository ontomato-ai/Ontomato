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
