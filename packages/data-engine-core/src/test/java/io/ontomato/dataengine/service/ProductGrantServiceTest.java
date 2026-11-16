package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

class ProductGrantServiceTest {
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
}
