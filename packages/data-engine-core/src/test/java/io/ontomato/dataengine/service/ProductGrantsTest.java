package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class ProductGrantsTest {
    @Test void useDoesNotImplyEditAndRoleRemovalRevokesAccess() {
        var grants=List.of(new ProductGrants.Grant("role","reviewers","use"));
        assertTrue(ProductGrants.allows(grants,"alice",Set.of("reviewers"),"use"));
        assertFalse(ProductGrants.allows(grants,"alice",Set.of(),"use"));
        assertFalse(ProductGrants.allows(grants,"alice",Set.of("reviewers"),"edit"));
        assertFalse(ProductGrants.allows(grants,"alice",Set.of("reviewers"),"execute"));
    }
    @Test void principalAndDomainGrantsRequireAnAuthenticatedSubject() {
        var grants=List.of(new ProductGrants.Grant("principal","author","edit"),new ProductGrants.Grant("domain","*","use"));
        assertTrue(ProductGrants.allows(grants,"author",Set.of(),"edit"));
        assertFalse(ProductGrants.allows(grants,"other",Set.of(),"edit"));
        assertTrue(ProductGrants.allows(grants,"other",Set.of(),"use"));
        assertFalse(ProductGrants.allows(grants,null,Set.of(),"use"));
    }
}
