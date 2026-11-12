package io.ontomato.dataengine.controller;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Declares whether an HTTP entry may receive a build-test execution context.
 *
 * <p>The declaration only states what this entry does; the existing build-test context service,
 * query grant and execution services still own identity, ownership, lifetime and data routing.
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface BuildTestAccess {
  Access value();

  enum Access {
    /** Every executable business branch uses the resolved test target or fails before side effects. */
    TEST_DATA,
    /** Reads definitions or metadata, converts parameters, or verifies identity; never business data. */
    NO_BUSINESS_DATA
  }
}
