package io.ontomato.dataengine.applications;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import java.util.List;
import java.util.Set;

/** Edition-owned identity and application lifecycle integration. */
public interface ApplicationAccess {
    User entryUser(String credential);
    default List<ApplicationPanelUse> builtinEntries(String applicationId) { return List.of(); }
    default void declare(JSONObject app, ApplicationCatalog.Declaration declaration, boolean created) {}
    default void retire(JSONObject app) {}
    void initialOpenEntries(User user, Set<String> targetKeys);
    void requestDomainEntryOpening(User user, String targetKey, boolean open);
    void retireEntries(String domainId, Set<String> targetKeys);
}
