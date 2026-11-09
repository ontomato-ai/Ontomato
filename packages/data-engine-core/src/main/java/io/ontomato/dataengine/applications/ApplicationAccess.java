package io.ontomato.dataengine.applications;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;

/** Edition-owned authorization and permission declarations. */
public interface ApplicationAccess {
    User entryUser(String credential);
    boolean administrator(User user);
    boolean canEnter(JSONObject application, User user);
    void declare(JSONObject application, ApplicationCatalog.Declaration declaration, boolean created);
}
