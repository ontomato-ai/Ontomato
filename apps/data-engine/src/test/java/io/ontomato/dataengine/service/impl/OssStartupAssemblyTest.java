package io.ontomato.dataengine.service.impl;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.core.db.jdbc.SuperAdminSeed;
import io.ontomato.dataengine.service.DataPermissionLookup;
import io.ontomato.dataengine.service.DomainSvc;
import io.ontomato.dataengine.service.IdentityRuntimeSettings;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.OrganizationDirectory;
import io.ontomato.dataengine.service.PermissionPolicyDirectory;
import io.ontomato.dataengine.service.ProductGrantService;
import io.ontomato.dataengine.service.ProductGrants;
import io.ontomato.dataengine.service.ProductPrincipalLookup;
import io.ontomato.dataengine.service.SchemaImportAuthorization;
import io.ontomato.dataengine.service.SchemaPermissionService;
import io.ontomato.dataengine.service.authorization.PresetAgentPolicies;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class OssStartupAssemblyTest {
    @Test
    void presetInstallationPreservesAnonymousAgentAccessWithoutRolePolicies() {
        var jdbc = mock(JdbcTemplate.class);
        var legacy = mock(ProductGrantService.class);
        var authorization = new AnonymousAuthorization(legacy, jdbc);
        var presets = new PresetAgentPolicies(authorization, authorization);
        var target = new ObjectTarget("1", Kind.AGENT, "preset");

        presets.initialize("1", List.of(target.id()));

        for (Verb verb : List.of(Verb.USE, Verb.VIEW, Verb.EDIT)) {
            assertTrue(authorization.objectEntitlement("system", target, verb));
        }
        verify(jdbc).update(contains("INSERT INTO object_policy_grant"), eq("1"), eq("AGENT"), eq("preset"), eq("USE"));
        verifyNoMoreInteractions(jdbc);
        verifyNoInteractions(legacy);
    }

    @Test
    void applicationEditUsesObjectPolicyAndKeepsLegacyUse() {
        var products = mock(ProductGrantService.class);
        var jdbc = mock(JdbcTemplate.class);
        var anonymous = new AnonymousAuthorization(products, jdbc);
        var target = new ObjectTarget("1", Kind.APPLICATION, "app-example");
        when(products.allowedFor("1", "admin", "app-example", "edit")).thenReturn(true);
        when(products.allowedFor("1", "admin", "app-example", "use")).thenReturn(true);

        assertFalse(anonymous.objectEntitlement("admin", target, Verb.EDIT));
        assertTrue(anonymous.objectEntitlement("admin", target, Verb.USE));
        var edit = new ObjectGrant(anonymous.domainPolicy("1").policyId(), target, Verb.EDIT, null);
        anonymous.grantObject(edit);
        verify(jdbc).update(contains("INSERT INTO object_policy_grant"), eq("1"), eq("APPLICATION"), eq("app-example"), eq("EDIT"));
        when(jdbc.query(anyString(), org.mockito.ArgumentMatchers.<RowMapper<ObjectGrant>>any(),
                eq("1"), eq("APPLICATION"), eq("app-example"), eq("EDIT"))).thenReturn(List.of(edit));
        assertTrue(anonymous.objectEntitlement("admin", target, Verb.EDIT));
        verify(products, never()).allowedFor("1", "admin", "app-example", "edit");
    }

    @Test
    void fullApplicationStartsWithoutLazyBeansOrCircularReferences(
            @org.junit.jupiter.api.io.TempDir java.nio.file.Path directory) throws Exception {
        org.junit.jupiter.api.Assumptions.assumeTrue(
                System.getenv("STARTUP_TEST_DATABASE_URL") != null,
                "Set STARTUP_TEST_DATABASE_URL to a disposable local pgvector PostgreSQL server");
        String classpath =
                java.util.Arrays.stream(
                                System.getProperty("java.class.path")
                                        .split(java.util.regex.Pattern.quote(java.io.File.pathSeparator)))
                        .filter(entry -> !entry.replace('\\', '/').endsWith("/test-classes"))
                        .map(entry -> java.nio.file.Path.of(entry).toAbsolutePath().toString())
                        .collect(java.util.stream.Collectors.joining(java.io.File.pathSeparator));
    classpath +=
        java.io.File.pathSeparator
            + java.nio.file.Path.of("../../packages/data-engine-core/conf-defaults").toRealPath();
        java.nio.file.Path log = directory.resolve("startup.log");
    Process child =
        new ProcessBuilder(
                java.nio.file.Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                "-cp",
                classpath,
                java.nio.file.Path.of("../../scripts/data-engine/StartupContextProbe.java")
                    .toRealPath()
                    .toString(),
                "io.ontomato.dataengine.service.impl.AnonymousIdentityService",
                "io.ontomato.dataengine.service.impl.AnonymousDataPermissionLookup")
            .directory(directory.toFile())
            .redirectErrorStream(true)
            .redirectOutput(log.toFile())
            .start();
        try {
            assertTrue(
                    child.waitFor(90, java.util.concurrent.TimeUnit.SECONDS),
                    "Application startup timed out");
            String output = java.nio.file.Files.readString(log);
            assertEquals(0, child.exitValue(), output);
            assertTrue(output.contains("FULL_CONTEXT_STARTED"), output);
            System.out.println(output);
        } finally {
            if (child.isAlive()) {
                child.destroyForcibly();
                child.waitFor();
            }
        }
    }



    @Test
    void ossBeansAreTheOnlyIdentityAndToolChoices() {
        try (AnnotationConfigApplicationContext ctx = new AnnotationConfigApplicationContext()) {
      ctx.register(
          AnonymousIdentityService.class,
          SingleDomainSvc.class,
          NoopSchemaPermissionService.class,
          OssSuperAdminSeed.class,
          AnonymousDataPermissionLookup.class,
          OssIdentityRuntimeSettings.class,
          AnonymousOrganizationDirectory.class,
          AnonymousPermissionPolicyDirectory.class,
          AnonymousProductPrincipalLookup.class);
            ctx.refresh();

            assertEquals(1, ctx.getBeansOfType(IdentityService.class).size());
            assertEquals(1, ctx.getBeansOfType(DomainSvc.class).size());
            assertEquals(1, ctx.getBeansOfType(SchemaPermissionService.class).size());
            assertEquals(1, ctx.getBeansOfType(SuperAdminSeed.class).size());
            assertEquals(1, ctx.getBeansOfType(DataPermissionLookup.class).size());
            assertEquals(1, ctx.getBeansOfType(IdentityRuntimeSettings.class).size());
            assertTrue(ctx.getBeansOfType(JdbcTemplate.class).isEmpty());

            IdentityService identity = ctx.getBean(IdentityService.class);
            User user = identity.getCurrentUser();
            assertEquals("admin", user.getId());
            assertEquals("admin", identity.getCurrentUserId());
            assertEquals("1", user.getDomainId());
            assertTrue(identity.getCurrentUserDataPermission().isFullData());
      assertTrue(
          ctx.getBean(DataPermissionLookup.class).getDataPermission("other", "9").isFullData());

            var organizations = ctx.getBean(OrganizationDirectory.class);
            assertEquals(new OrganizationDirectory.Snapshot(List.of(), List.of(), List.of(), List.of(), List.of()),
                organizations.snapshot(user.getDomainId()));
            var policies = ctx.getBean(PermissionPolicyDirectory.class);
            assertEquals(List.of(), policies.listPolicies(user.getDomainId()));
            assertEquals(List.of(), policies.listRolePolicies(user.getDomainId()));
            assertEquals(List.of(), policies.listPolicyDataPermissions(user.getDomainId()));
            var productPrincipals = ctx.getBean(ProductPrincipalLookup.class);
            assertEquals(List.of(
                new ProductGrants.Grant("principal", productPrincipals.productPrincipalId(user.getId()), "use"),
                new ProductGrants.Grant("principal", productPrincipals.productPrincipalId(user.getId()), "view"),
                new ProductGrants.Grant("principal", productPrincipals.productPrincipalId(user.getId()), "edit")
            ), productPrincipals.defaultAdminGrants(user.getDomainId(), List.of("use", "view", "edit")));

            DomainSvc domains = ctx.getBean(DomainSvc.class);
            assertEquals("1", domains.list().get(0).getId());
            assertThrows(UnsupportedOperationException.class, () -> domains.create("n", "d", "a"));
            assertThrows(UnsupportedOperationException.class, () -> domains.update("1", "n", "d"));
            assertThrows(UnsupportedOperationException.class, () -> domains.delete("1"));

            SchemaPermissionService permissions = ctx.getBean(SchemaPermissionService.class);
            SchemaImportAuthorization prepared = permissions.prepareImport(user);
            assertTrue(prepared.postIds().isEmpty());
      permissions.grantImport(
          new SchemaImportAuthorization(List.of("post-1")), List.of(Map.of("name", "Order")));

            ctx.getBean(SuperAdminSeed.class).initSuperAdmin();

            IdentityRuntimeSettings settings = ctx.getBean(IdentityRuntimeSettings.class);
            assertEquals(Map.of(), settings.ssoSettings());
            assertEquals(Map.of(), settings.ldapSettings());

        }
    }

    @Test
    void enterpriseIdentityAndLicenseAreAbsentFromTheOssClasspath() {
        for (String name : new String[] {
                "cn.dev33.satoken.stp.StpUtil",
                "io.ontomato.dataengine.service.sys.impl.SaTokenIdentityService",
                "io.ontomato.dataengine.service.sys.impl.SuperAdminSeedImpl",
                "io.ontomato.dataengine.service.sys.impl.SchemaPermissionServiceImpl",
                "io.ontomato.dataengine.service.sys.impl.EnterpriseIdentityRuntimeSettings",
                "io.ontomato.dataengine.config.LicenseConfig"}) {
            assertThrows(ClassNotFoundException.class, () -> Class.forName(name), name);
        }
    }

}
