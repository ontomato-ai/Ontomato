package io.ontomato.dataengine.config;

import io.ontomato.dataengine.service.authorization.ManagementEndpoint;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class ManagementEndpointConfig implements WebMvcConfigurer {
    private final ObjectProvider<ManagementRequestAccess> authorization;

    public ManagementEndpointConfig(ObjectProvider<ManagementRequestAccess> authorization) {
        this.authorization = authorization;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new HandlerInterceptor() {
            @Override
            public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
                if (handler instanceof HandlerMethod method) {
                    var operation = method.getMethodAnnotation(ManagementEndpoint.class);
                    if (operation != null) {
                        var access = authorization.getObject();
                        if (operation.systemAdministrator()) access.requireSystemOrDomain(operation.value());
                        else access.require(operation.value());
                    }
                }
                return true;
            }
        }).addPathPatterns("/**");
    }
}
