package io.ontomato.dataengine.service.impl;

import io.ontomato.dataengine.service.CapabilityGrantLookup;
import org.springframework.stereotype.Component;

/**
 * The open-source answer: there are no roles to authorize against, so every capability is usable.
 *
 * <p>Like {@link AnonymousDataPermissionLookup}, this belongs to the open-source application rather
 * than to the shared core, so each edition assembles exactly one implementation.</p>
 */
@Component
public class AnonymousCapabilityGrantLookup implements CapabilityGrantLookup {

    @Override
    public boolean allows(String userId, String domainId, String kind, String capabilityId) {
        return true;
    }
}
