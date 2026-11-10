package io.ontomato.dataengine.service.impl;

import java.util.List;

import org.springframework.stereotype.Component;

import io.ontomato.dataengine.service.PlatformAccessQuery;

/**
 * The open-source answer: there are no roles, so there is no per-role platform authority to report.
 *
 * <p>An empty list, not a wildcard: the open-source edition lets every caller through its interceptor
 * because it has no roles at all, and inventing a synthetic "everyone" role here would make the
 * interface claim authority that was never granted.</p>
 */
@Component
public class AnonymousPlatformAccessQuery implements PlatformAccessQuery {

    @Override
    public List<RoleAccess> rolesInDomain(String domainId) {
        return List.of();
    }
}
