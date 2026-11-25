package io.ontomato.dataengine.applications;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import java.util.List;
import java.util.Set;

/** Edition-owned identity, maintenance and entry policy writes. */
public interface ApplicationAccess {
    User entryUser(String credential);
    boolean administrator(User user);
    void requireConnectedRegistration(User user);
    boolean canMaintain(JSONObject application, User user);
    default void requireLegacyProductAuthor(User publisher, String authorId) {}
    default List<ApplicationPanelUse> builtinEntries(String applicationId) { return List.of(); }
    default void declare(JSONObject app, ApplicationCatalog.Declaration declaration, boolean created) {}
    default void retire(JSONObject app) {}
    void initialOpenEntries(User user, Set<String> targetKeys);
    void requestDomainEntryOpening(User user, String targetKey, boolean open);
    void retireEntries(String domainId, Set<String> targetKeys);
}
