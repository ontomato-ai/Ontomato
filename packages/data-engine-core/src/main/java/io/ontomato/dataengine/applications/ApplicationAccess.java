package io.ontomato.dataengine.applications;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/** Edition-owned authorization and permission declarations. */
public interface ApplicationAccess {
    User entryUser(String credential);
    boolean administrator(User user);
    void requireConnectedRegistration(User user);
    boolean canMaintain(JSONObject application, User user);
    boolean canEnter(JSONObject application, User user);
    default Set<String> enterableApplicationIds(List<JSONObject> apps, User user) {
        return apps.stream().filter(app -> canEnter(app, user))
            .map(app -> app.getString("id")).collect(Collectors.toSet());
    }
    /** Catalog reads reuse one subject's authorization facts for the duration of the projection. */
    default <T> T withPageSkillAuthorization(User user, java.util.function.Supplier<T> read) {
        return read.get();
    }
    java.util.List<PageSkills.Mapping> pageSkills(java.util.List<PageSkills.Mapping> mappings, User user);
    java.util.List<ApplicationPanelUse> panelUses(java.util.List<ApplicationPanelUse> uses, User user);
    /** Edition-owned declarations contribute codes without moving menu metadata into the catalog. */
    default java.util.List<ApplicationCatalog.Permission> builtinPermissions(String applicationId) {
        return java.util.List.of();
    }
    /** Edition-owned entries appended to a built-in application (panel or native entries). */
    default java.util.List<ApplicationPanelUse> builtinEntries(String applicationId) {
        return java.util.List.of();
    }
    void declare(JSONObject application, ApplicationCatalog.Declaration declaration, boolean created);
    /** Remove edition-owned facts for a domain application within its catalog transaction. */
    void retire(JSONObject application);
}
