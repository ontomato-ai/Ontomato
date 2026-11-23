package io.ontomato.dataengine.applications;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.fasterxml.jackson.databind.json.JsonMapper;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.ProductGrantService;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;

class ApplicationStandaloneToggleTest {

    @Test
    void builtinDefaultsToAllowStandaloneTrueAndRespectsExplicitFalse() throws Exception {
        var mapper = JsonMapper.builder().build();
        var defaulted = mapper.readValue("""
            {
              "id": "demo",
              "kind": "native",
              "rail": "top",
              "category": "business",
              "sort": 1,
              "entry": {"path": "/demo", "renderer": "demo"},
              "entryAccess": ["domain-member"],
              "scheduleAdapter": null,
              "declaration": {"names": {"en": "Demo"}, "descriptions": {}, "icon": "pages", "groups": [], "permissions": []}
            }
            """, ApplicationCatalog.Builtin.class);
        assertTrue(defaulted.allowsStandalone());

        var disabled = mapper.readValue("""
            {
              "id": "sys-demo",
              "kind": "native",
              "rail": "bottom",
              "category": "admin",
              "sort": 2,
              "entry": {"path": "/sys-demo", "renderer": "sys-demo"},
              "entryAccess": ["domain-member"],
              "scheduleAdapter": null,
              "allowStandalone": false,
              "declaration": {"names": {"en": "Sys Demo"}, "descriptions": {}, "icon": "settings", "groups": [], "permissions": []}
            }
            """, ApplicationCatalog.Builtin.class);
        assertFalse(disabled.allowsStandalone());
    }

    @Test
    void identityAndCreateFormsExposeAllowStandaloneSwitchAndValidateType() {
        var form = new ApplicationCatalogueForm(Locale.ENGLISH);
        var defaultApp = JSONObject.of(
            "id", "app-one",
            "names", JSONObject.of("en", "One"),
            "descriptions", new JSONObject(),
            "icon", "pages");
        var identityForm = form.identity(defaultApp, null);
        assertEquals(true, identityForm.getJSONObject("values").get("allowStandalone"));
        var identityField = findField(identityForm.getJSONArray("fields"), "/allowStandalone");
        assertNotNull(identityField);
        assertEquals("switch", identityField.getJSONObject("control").getString("kind"));
        assertEquals("Allow standalone open", identityField.getString("label"));

        var disabledApp = new JSONObject(defaultApp);
        disabledApp.put("allowStandalone", false);
        assertEquals(false, form.identity(disabledApp, null).getJSONObject("values").get("allowStandalone"));

        var invalidDraft = JSONObject.of(
            "names", JSONObject.of("en", "One"),
            "descriptions", new JSONObject(),
            "icon", "pages",
            "allowStandalone", "nope");
        var errors = ApplicationCatalogueForm.identityErrors(invalidDraft);
        assertEquals(1, errors.size());
        assertEquals("/allowStandalone", errors.getFirst().get("field").asText());

        var createForm = form.create("app-two", null, ignored -> null);
        assertEquals(true, createForm.getJSONObject("values").get("allowStandalone"));
        var createField = findField(createForm.getJSONArray("fields"), "/allowStandalone");
        assertNotNull(createField);
        assertEquals("switch", createField.getJSONObject("control").getString("kind"));

        var zhForm = new ApplicationCatalogueForm(Locale.SIMPLIFIED_CHINESE);
        var zhField = findField(zhForm.identity(defaultApp, null).getJSONArray("fields"), "/allowStandalone");
        assertNotNull(zhField);
        assertEquals("允许单独打开", zhField.getString("label"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void updateIdentityPersistsAllowStandaloneAndPreservesExistingWhenOmitted() {
        var db = mock(JdbcTemplate.class);
        var transactions = mock(TransactionTemplate.class);
        when(transactions.execute(any())).thenAnswer(inv -> {
            TransactionCallback<Object> callback = inv.getArgument(0);
            return callback.doInTransaction(mock(TransactionStatus.class));
        });
        var access = mock(ApplicationAccess.class);
        var panels = mock(PanelResources.class);
        var grants = mock(ProductGrantService.class);
        var catalog = spy(new ApplicationCatalog(db, transactions, access, "{}", panels, grants));

        var user = mock(User.class);
        when(user.getId()).thenReturn("u-1");
        when(user.getDomainId()).thenReturn("d-1");
        var app = JSONObject.of(
            "id", "app-one",
            "domainId", "d-1",
            "names", JSONObject.of("en", "One"),
            "descriptions", new JSONObject(),
            "icon", "pages",
            "entry", JSONObject.of("path", "/applications/app-one", "renderer", "panels"),
            "panelUses", List.of(),
            "groups", List.of(),
            "permissions", List.of(),
            "panelSettings", new JSONObject(),
            "allowStandalone", true);
        doReturn(List.of(app)).when(catalog).all();
        when(access.canMaintain(app, user)).thenReturn(true);

        var updated = catalog.updateIdentity("app-one",
            new ApplicationController.IdentityUpdate(Map.of("en", "One"), Map.of(), "pages", false), user);
        assertEquals(false, updated.allowStandalone());
        verify(db).update(contains("allow_standalone=?"), any(), any(), eq("pages"), eq(false), eq("app-one"), eq("d-1"));

        app.put("allowStandalone", false);
        var preserved = catalog.updateIdentity("app-one",
            new ApplicationController.IdentityUpdate(Map.of("en", "One"), Map.of(), "pages"), user);
        assertEquals(false, preserved.allowStandalone());
        verify(db, times(2)).update(contains("allow_standalone=?"), any(), any(), eq("pages"), eq(false), eq("app-one"), eq("d-1"));
    }

    @Test
    void jacksonDeserializesAllowStandaloneOnIdentityUpdateAndPanelRegistration() throws Exception {
        var mapper = JsonMapper.builder().build();
        var identity = mapper.readValue(
            "{\"names\":{\"en\":\"One\"},\"descriptions\":{},\"icon\":\"pages\",\"allowStandalone\":false}",
            ApplicationController.IdentityUpdate.class);
        assertEquals(false, identity.allowStandalone());

        var registration = mapper.readValue("""
            {
              "entry": {"path": "/applications/app-one", "renderer": "panels"},
              "panelUses": [],
              "allowStandalone": false
            }
            """, ApplicationController.PanelRegistration.class);
        assertEquals(false, registration.allowStandalone());
    }

    private static JSONObject findField(JSONArray fields, String path) {
        for (int i = 0; i < fields.size(); i++) {
            var field = fields.getJSONObject(i);
            if (path.equals(field.getString("path"))) return field;
        }
        return null;
    }
}
