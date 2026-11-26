package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class PraxisDomainProvisionerTest {

    private final PraxisDomainProvisioner provisioner = new PraxisDomainProvisioner();

    @Test
    void requestCarriesTheDomainAdminAndInternalToken() {
        var request = provisioner.buildRequest(
                "http://praxis:18600/",
                "admin-token",
                "domain/a",
                "domain-admin");

        assertEquals("PUT", request.method());
        assertEquals(
                "http://praxis:18600/internal/domains/domain%2Fa",
                request.uri().toString());
        assertEquals(
                "admin-token",
                request.headers().firstValue("x-ontopraxis-admin-token").orElseThrow());
        assertEquals("domain-admin", provisioner.buildBody("domain-admin").getString("loginCode"));
        assertEquals("admin", provisioner.buildBody("domain-admin").getString("password"));
    }
}
