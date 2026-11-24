package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import io.ontomato.dataengine.core.bean.User;
import java.sql.ResultSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.web.server.ResponseStatusException;

class ProductGrantServiceTest {
    @Test void aMixedBatchResolvesTheSubjectOnceAndUsesOneDomainQuery() throws Exception {
        var db = mock(JdbcTemplate.class);
        var identity = mock(IdentityService.class);
        var principals = mock(ProductPrincipalLookup.class);
        var member = mock(User.class);
        when(member.getId()).thenReturn("member");
        when(member.getDomainId()).thenReturn("domain-a");
        when(identity.getCurrentUser()).thenReturn(member);
        when(principals.productPrincipalId("member")).thenReturn("mapped-member");
        when(principals.effectiveRoles("member", "domain-a")).thenReturn(Set.of("reader"));

        var rows = mock(ResultSet.class);
        when(rows.next()).thenReturn(true, true, true, true, false);
        when(rows.getString(1)).thenReturn("owned", "role-read", "shared", "edit-only");
        when(rows.getString(2)).thenReturn("principal", "role", "domain", "principal");
        when(rows.getString(3)).thenReturn("mapped-member", "reader", "*", "mapped-member");
        when(rows.getString(4)).thenReturn("use", "use", "use", "edit");
        Object[] parameters = {"domain-a", "owned", "role-read", "shared", "edit-only", "missing"};
        when(db.query(anyString(), any(ResultSetExtractor.class), eq(parameters)))
            .thenAnswer(call -> call.<ResultSetExtractor<?>>getArgument(1).extractData(rows));

        var service = new ProductGrantService(db, identity, principals);
        assertEquals(Map.of(
            "builtin-product-frame", true, "builtin-product-", false,
            "owned", true, "role-read", true, "shared", true, "edit-only", false, "missing", false
        ), service.allowedBatch(List.of(
            "owned", "builtin-product-frame", "role-read", "shared", "edit-only", "missing", "builtin-product-", "owned"
        ), "use"));
        verify(identity).getCurrentUser();
        verify(principals).productPrincipalId("member");
        verify(principals).effectiveRoles("member", "domain-a");
        verify(db).query(anyString(), any(ResultSetExtractor.class), eq(parameters));
        verifyNoMoreInteractions(db, identity, principals);
    }

    @Test void builtinOnlyAndInvalidBatchesNeverQueryGrants() {
        var db = mock(JdbcTemplate.class);
        var identity = mock(IdentityService.class);
        var principals = mock(ProductPrincipalLookup.class);
        var member = mock(User.class);
        when(member.getId()).thenReturn("member");
        var service = new ProductGrantService(db, identity, principals);
        var ids = List.of("builtin-product-frame", "builtin-product-", "builtin-product-frame");
        var denied = Map.of("builtin-product-frame", false, "builtin-product-", false);

        assertEquals(denied, service.allowedBatch(ids, "use"));
        when(identity.getCurrentUser()).thenReturn(member);
        assertEquals(denied, service.allowedBatch(ids, "use"));
        when(member.getDomainId()).thenReturn("domain-a");
        assertEquals(Map.of("builtin-product-frame", true, "builtin-product-", false), service.allowedBatch(ids, "use"));
        assertEquals(denied, service.allowedBatch(ids, "edit"));
        assertEquals(Map.of("builtin-product-frame", false, "projection", false),
            service.allowedBatch(List.of("builtin-product-frame", "projection"), "delete"));
        verifyNoInteractions(db, principals);
    }

    @Test void platformIdsCanBeUsedAcrossDomainsWithoutGrantsAndCannotBeEdited() {
        var db = mock(JdbcTemplate.class);
        var identity = mock(IdentityService.class);
        var principals = mock(ProductPrincipalLookup.class);
        var member = mock(User.class);
        when(member.getId()).thenReturn("member");
        when(member.getDomainId()).thenReturn("domain-a");
        when(identity.getCurrentUser()).thenReturn(member);
        var service = new ProductGrantService(db, identity, principals);

        assertAll(
            () -> assertTrue(service.allowed("builtin-product-example", "use")),
            () -> assertTrue(service.allowedFor("domain-b", "other-member", "builtin-product-example", "use")),
            () -> assertFalse(service.allowed("builtin-product-example", "edit")),
            () -> assertFalse(service.allowed("builtin-product-", "use")),
            () -> assertFalse(service.allowed("builtin-product-" + "a".repeat(200), "use")),
            () -> assertFalse(service.allowedFor(null, "member", "builtin-product-example", "use")));
        verifyNoInteractions(db, principals);

        when(identity.getCurrentUser()).thenReturn(null);
        assertFalse(service.allowed("builtin-product-example", "use"));
    }

    @Test void theReservedNamespaceCannotReceiveDomainGrantsEvenForMalformedBuiltinIds() {
        var db = mock(JdbcTemplate.class);
        var service = new ProductGrantService(db, mock(IdentityService.class), mock(ProductPrincipalLookup.class));
        for (String id : List.of("builtin-product-", "builtin-product-example", "builtin-product-" + "a".repeat(200))) {
            assertAll(
                () -> assertThrows(ResponseStatusException.class, () -> service.register("domain", id, "owner", true)),
                () -> assertThrows(ResponseStatusException.class, () -> service.unregister("domain", id)),
                () -> assertThrows(ResponseStatusException.class, () -> service.migrateApplication("domain", id)),
                () -> assertThrows(ResponseStatusException.class, () -> service.grant(id,
                    new ProductGrants.Grant("principal", "other", "use"), false)),
                () -> assertThrows(ResponseStatusException.class, () -> service.share(id, true)));
        }
        verifyNoInteractions(db);
    }

    @Test void domainGrantEnumerationDoesNotEmitReservedIds() {
        var db = mock(JdbcTemplate.class);
        var principals = mock(ProductPrincipalLookup.class);
        when(principals.productPrincipalId("member")).thenReturn("member");
        when(db.queryForList(anyString(), eq("domain"), eq("use"))).thenReturn(List.of(
            Map.of("resource_id", "builtin-product-legacy", "principal_kind", "principal", "principal_id", "member"),
            Map.of("resource_id", "Builtin-product-domain", "principal_kind", "principal", "principal_id", "member")));
        var service = new ProductGrantService(db, mock(IdentityService.class), principals);

        assertEquals(List.of("Builtin-product-domain"), service.resourcesFor("domain", "member", "use"));
    }

    @Test void repeatedApplicationMigrationDoesNotRestoreRevokedLegacyAuthority() {
        var db=mock(JdbcTemplate.class);var principals=mock(ProductPrincipalLookup.class);
        when(db.queryForObject("SELECT EXISTS(SELECT 1 FROM product_application_grant_migration WHERE domain_id=? AND id=?)",Boolean.class,"domain","app-example")).thenReturn(true);
        var service=new ProductGrantService(db,mock(IdentityService.class),principals);
        service.migrateApplication("domain","app-example");
        verifyNoInteractions(principals);
        verify(db,never()).update(anyString(),org.mockito.ArgumentMatchers.<Object[]>any());
    }
    @Test void repeatedImportsDoNotRestoreRevokedPrincipalOrDomainGrants() {
        var db=mock(JdbcTemplate.class);
        when(db.queryForList("SELECT owner_id FROM product_resource WHERE domain_id=? AND id=?",String.class,"domain","profile")).thenReturn(java.util.List.of("author"));
        var service=new ProductGrantService(db,mock(IdentityService.class),mock(ProductPrincipalLookup.class));
        service.register("domain","profile","author",true);
        verify(db,never()).update(eq("INSERT INTO product_grant(domain_id,resource_id,principal_kind,principal_id,verb) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING"),any(),any(),any(),any(),any());
        verify(db,never()).update(eq("DELETE FROM product_grant WHERE domain_id=? AND resource_id=? AND principal_kind='domain'"),any(),any());
    }
    @Test void anUnauthenticatedSubjectCannotUseOrDelegateAProduct() {
        var db=mock(JdbcTemplate.class);
        var identity=mock(IdentityService.class);
        var principals=mock(ProductPrincipalLookup.class);
        var service=new ProductGrantService(db,identity,principals);
        assertFalse(service.allowed("profile","use"));
        assertThrows(ResponseStatusException.class,()->service.grant("profile",new ProductGrants.Grant("principal","other","edit"),false));
        verifyNoInteractions(db,principals);
    }

    @Test void unregisterRemovesOnlyTheRequestedResourceAndItsGrants() {
        var db = mock(JdbcTemplate.class);
        var service = new ProductGrantService(db, mock(IdentityService.class), mock(ProductPrincipalLookup.class));
        service.unregister("domain", "projection");
        verify(db).update("DELETE FROM product_grant WHERE domain_id=? AND resource_id=?", "domain", "projection");
        verify(db).update("DELETE FROM product_resource WHERE domain_id=? AND id=?", "domain", "projection");
    }
}
