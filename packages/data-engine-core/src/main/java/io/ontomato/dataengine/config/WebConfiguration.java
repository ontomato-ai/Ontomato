package io.ontomato.dataengine.config;

import io.ontomato.dataengine.filter.CorsFilter;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class WebConfiguration {
  @Bean
  public FilterRegistrationBean<CorsFilter> corsFilter() {
    var registration = new FilterRegistrationBean<CorsFilter>();
    registration.setFilter(new CorsFilter());
    registration.addUrlPatterns("/*");
    registration.setOrder(-1001);
    return registration;
  }
}
