package io.ontomato.dataengine.service;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;

/**
 * The identity a running program is allowed to see about its caller.
 *
 * <p>This is a <em>snapshot</em>, not an input: it is computed by the server from the authenticated
 * request and written by the runtime host next to the program, so a caller cannot forge it the way it
 * can forge a parameter. A program may use it for business decisions ("is this my pending item"),
 * and must not treat it as authorization — every read and write is still decided by the token the
 * server issued.</p>
 *
 * <p>Because it is a convenience for the program and never a permission, an edition without identities
 * supplies only what it actually knows rather than inventing values.</p>
 */
public interface IdentitySnapshotLookup {

    /** The snapshot handed to the program for this subject, in this domain. Never null. */
    JSONObject snapshot(User user, String domainId);
}
