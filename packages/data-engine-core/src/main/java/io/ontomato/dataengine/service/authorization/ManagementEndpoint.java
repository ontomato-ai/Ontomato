package io.ontomato.dataengine.service.authorization;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** Binds a handler to the management operation registered by its owner. */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface ManagementEndpoint {
    String value();
    boolean systemAdministrator() default false;
}
