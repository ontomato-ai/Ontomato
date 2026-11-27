package io.ontomato.dataengine.controller;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Declares that an HTTP entry may serve a preview execution request.
 *
 * <p>An annotated entry reads definitions, metadata or live data, or converts parameters, or
 * writes only inside an action-trial or generation sandbox bound by its own grant; it never
 * writes live business or management state. Entries without this declaration refuse preview
 * requests at the boundary.
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface PreviewAccess {}
