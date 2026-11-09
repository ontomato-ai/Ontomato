package io.ontomato.dataengine.service.impl;

import java.util.List;

import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.IdentitySnapshotLookup;

/**
 * The open-source snapshot: the anonymous principal and its domain, and nothing else.
 *
 * <p>There are no roles and no membership here, so none are reported. Listing an empty {@code roles}
 * array would be a claim about authority ("this subject has no roles") that the caller might rely on;
 * the absent key only says this edition has nothing to say about roles. The enterprise edition
 * supplies its own bean with the member's membership and role codes.</p>
 */
@Component
public class AnonymousIdentitySnapshotLookup implements IdentitySnapshotLookup {

    @Override
    public JSONObject snapshot(User user, String domainId) {
        JSONObject snapshot = new JSONObject();
        snapshot.put("principalId", user == null ? null : user.getId());
        snapshot.put("domainId", domainId);
        snapshot.put("roles", List.of());
        return snapshot;
    }
}
