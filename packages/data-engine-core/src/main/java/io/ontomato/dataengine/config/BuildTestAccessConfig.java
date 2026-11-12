package io.ontomato.dataengine.config;

import io.ontomato.dataengine.controller.BuildTestAccessInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Installs the build-test entry check in both editions; the interceptor owns the rule itself. */
@Configuration
public class BuildTestAccessConfig implements WebMvcConfigurer {
  private final BuildTestAccessInterceptor interceptor;

  public BuildTestAccessConfig(BuildTestAccessInterceptor interceptor) {
    this.interceptor = interceptor;
  }

  @Override
  public void addInterceptors(InterceptorRegistry registry) {
    registry.addInterceptor(interceptor).order(-100);
  }
}
