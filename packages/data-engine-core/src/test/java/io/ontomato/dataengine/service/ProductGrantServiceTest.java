package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import io.ontomato.dataengine.core.bean.User;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

class ProductGrantServiceTest {
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
