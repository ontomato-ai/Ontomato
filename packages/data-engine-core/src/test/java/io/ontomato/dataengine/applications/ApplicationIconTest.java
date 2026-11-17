package io.ontomato.dataengine.applications;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

class ApplicationIconTest {
    @Test void metadataUpdatesRequireApplicationMaintenanceAndKeepThePublishedRelease(){
        var db=mock(JdbcTemplate.class);var access=mock(ApplicationAccess.class);var user=mock(User.class);when(user.getDomainId()).thenReturn("domain");
        var catalog=spy(new ApplicationCatalog(db,mock(TransactionTemplate.class),access,"{}"));
        var app=JSONObject.of("id","app-example","domainId","domain","releaseId","release");doReturn(app).when(catalog).require("app-example");
        assertThrows(org.springframework.web.server.ResponseStatusException.class,()->catalog.updateIcon("app-example","users",user));verifyNoInteractions(db);
        when(access.canMaintain(app,user)).thenReturn(true);catalog.updateIcon("app-example","users",user);
        verify(db).update("UPDATE sys_application SET icon=?,updated_at=now() WHERE id=?","users","app-example");
        assertEquals("release",app.getString("releaseId"));
        assertThrows(org.springframework.web.server.ResponseStatusException.class,()->catalog.updateIcon("app-example","https://external/icon.svg",user));
    }
}
