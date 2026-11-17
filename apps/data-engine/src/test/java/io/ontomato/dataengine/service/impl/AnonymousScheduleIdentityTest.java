package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class AnonymousScheduleIdentityTest {
  @Test void workbenchOwnerRecoversTheAnonymousJavaUser() {
    var identities = new AnonymousIdentityService();
    var schedules = new AnonymousScheduleIdentity(identities);
    assertSame(identities.getCurrentUser(), schedules.creator("1", "system"));
    assertSame(identities.getCurrentUser(), schedules.creator("1", "admin"));
    assertNull(schedules.creator("other-domain", "system"));
    assertNull(schedules.creator("1", "other-user"));
  }
}
