package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.core.bean.User;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The value side of "only mine": a declared reference is filled from the authenticated request, and an
 * unresolvable one refuses the run instead of matching nothing.
 *
 * <p>These cases are the difference between a query that filters by the caller and a query that quietly
 * returns no rows. Both look the same on the screen, so the behaviour is pinned here rather than trusted
 * to each definition.</p>
 */
class SubjectValueResolverTest {

  private SubjectAttributeLookup subjects;
  private SubjectValueResolver resolver;
  private User user;

  @BeforeEach
  void setUp() {
    subjects = mock(SubjectAttributeLookup.class);
    resolver = new SubjectValueResolver(subjects);
    user = mock(User.class);
    when(subjects.supportedAccountFields()).thenReturn(List.of("id", "loginCode", "userName"));
    when(subjects.attribute(any(), any(), any())).thenReturn(null);
    when(subjects.attribute(user, "account", "id")).thenReturn("U1");
    when(subjects.attribute(user, "account", "loginCode")).thenReturn("zhong");
    when(subjects.attribute(user, "principal", "dept")).thenReturn(List.of("D1"));
    when(subjects.attribute(user, "principal", "many")).thenReturn(List.of("a", "b"));
  }

  @Test
  void aLiteralPassesThroughUnchanged() {
    assertEquals("待办", resolver.resolve("待办", user));
    assertEquals(7, resolver.resolve(7, user));
  }

  @Test
  void anAccountReferenceIsFilledFromTheAuthenticatedSubject() {
    assertEquals("U1", resolver.resolve("{{account.id}}", user));
    assertEquals("zhong", resolver.resolve("{{account.loginCode}}", user));
  }

  @Test
  void aSingleValuedPrincipalAttributeIsFilled() {
    assertEquals("D1", resolver.resolve("{{principal.dept}}", user));
  }

  @Test
  void anUnresolvableReferenceIsRefusedRatherThanBecomingNull() {
    IllegalArgumentException error =
        assertThrows(IllegalArgumentException.class, () -> resolver.resolve("{{principal.unknown}}", user));

    // Null would compare equal to nothing and read as "you have no pending items".
    assertTrue(error.getMessage().contains("could not be resolved"), error.getMessage());
  }

  @Test
  void aMultiValuedAttributeIsRefusedForAScalarComparison() {
    IllegalArgumentException error =
        assertThrows(IllegalArgumentException.class, () -> resolver.resolve("{{principal.many}}", user));

    assertTrue(error.getMessage().contains("exactly one"), error.getMessage());
  }

  @Test
  void anUnknownSourceIsRefused() {
    IllegalArgumentException error =
        assertThrows(IllegalArgumentException.class, () -> resolver.resolve("{{user.id}}", user));

    assertTrue(error.getMessage().contains("Unknown subject source"), error.getMessage());
  }

  @Test
  void aListValueResolvesEachElement() {
    Object resolved = resolver.resolve(List.of("{{account.id}}", "literal"), user);

    assertEquals(List.of("U1", "literal"), ((List<?>) resolved).stream().toList());
  }

  @Test
  void resolvingValuesDoesNotMutateTheDeclaredMap() {
    JSONObject declared = JSONObject.of("assignee", "{{account.id}}", "status", "待办");

    JSONObject resolved = resolver.resolveValues(declared, user);

    assertEquals("U1", resolved.getString("assignee"));
    // The definition is the stored, reviewable artifact; resolution happens on a copy.
    assertEquals("{{account.id}}", declared.getString("assignee"));
  }

  @Test
  void publishTimeValidationRefusesAMisspeltReference() {
    IllegalArgumentException error =
        assertThrows(IllegalArgumentException.class, () -> resolver.validate("{{account.id}"));

    // Without this the metric publishes and then answers "no rows" forever.
    assertTrue(error.getMessage().contains("Malformed subject reference"), error.getMessage());
  }

  @Test
  void publishTimeValidationRefusesAnAccountFieldThisEditionDoesNotOffer() {
    IllegalArgumentException error =
        assertThrows(IllegalArgumentException.class, () -> resolver.validate("{{account.salary}}"));

    assertTrue(error.getMessage().contains("Unknown account field"), error.getMessage());
    assertTrue(error.getMessage().contains("id"), error.getMessage());
  }

  @Test
  void publishTimeValidationAcceptsAWellFormedReference() {
    resolver.validate("{{account.id}}");
    resolver.validate("{{principal.dept}}");
    resolver.validate("待办");
  }
}
