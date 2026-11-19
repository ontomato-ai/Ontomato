package io.ontomato.dataengine.applications;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;

/** Edition-owned authorization and permission declarations. */
public interface ApplicationAccess {
    User entryUser(String credential);
    boolean administrator(User user);
    void requireConnectedRegistration(User user);
    boolean canMaintain(JSONObject application, User user);
    boolean canEnter(JSONObject application, User user);
    java.util.List<PageSkills.Mapping> pageSkills(java.util.List<PageSkills.Mapping> mappings, User user);
    java.util.List<ApplicationPanelUse> panelUses(java.util.List<ApplicationPanelUse> uses, User user);
    void declare(JSONObject application, ApplicationCatalog.Declaration declaration, boolean created);
    /** Remove edition-owned facts for a domain application within its catalog transaction. */
    void retire(JSONObject application);
}
