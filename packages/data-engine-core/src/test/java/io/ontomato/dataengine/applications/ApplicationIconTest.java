package io.ontomato.dataengine.applications;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.ProductGrantService;
import java.util.List;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

class ApplicationIconTest {
    @Test void metadataUpdatesRequireApplicationMaintenanceAndKeepThePublishedRelease() {
        var db = mock(JdbcTemplate.class);
        var tx = mock(TransactionTemplate.class);
        doAnswer(call -> {
            call.<Consumer<TransactionStatus>>getArgument(0).accept(null);
            return null;
        }).when(tx).executeWithoutResult(any());
        var access = mock(ApplicationAccess.class);
        var panels = mock(PanelResources.class);
        var user = mock(User.class);
        when(user.getDomainId()).thenReturn("domain");
        var catalog = spy(new ApplicationCatalog(db, tx, access, "{}", panels, mock(ProductGrantService.class)));
        var app = JSONObject.of("id", "app-example", "domainId", "domain", "releaseId", "release", "icon", "ontology");
        doReturn(app).when(catalog).require("app-example");

        assertThrows(ResponseStatusException.class, () -> catalog.updateIcon("app-example", "users", user));
        verify(db, never()).update(anyString(), any(Object[].class));
        verifyNoInteractions(panels);

        when(access.canMaintain(app, user)).thenReturn(true);
        catalog.updateIcon("app-example", "ontology", user);
        verifyNoInteractions(panels);
        catalog.updateIcon("app-example", "users", user);
        verify(panels).requireCurrent("domain", null, List.of(), null, null, "users", null);
        verify(db).update("UPDATE sys_application SET icon=?,updated_at=now() WHERE id=?", "users", "app-example");
        assertEquals("release", app.getString("releaseId"));

        doThrow(ApplicationCatalog.bad("Invalid application icon")).when(panels)
            .requireCurrent("domain", null, List.of(), null, null, "https://external/icon.svg", null);
        assertThrows(ResponseStatusException.class, () -> catalog.updateIcon("app-example", "https://external/icon.svg", user));
        verify(db, never()).update("UPDATE sys_application SET icon=?,updated_at=now() WHERE id=?", "https://external/icon.svg", "app-example");
    }
}
