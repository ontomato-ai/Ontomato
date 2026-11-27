package io.ontomato.dataengine.config;

import io.ontomato.dataengine.controller.PreviewWriteGuard;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Installs the preview write boundary in both editions; the guard owns the rule itself. */
@Configuration
public class PreviewWriteGuardConfig implements WebMvcConfigurer {
  private final PreviewWriteGuard guard;

  public PreviewWriteGuardConfig(PreviewWriteGuard guard) {
    this.guard = guard;
  }

  @Override
  public void addInterceptors(InterceptorRegistry registry) {
    registry.addInterceptor(guard).order(-100);
  }
}
