package io.ontomato.dataengine;

import io.ontomato.dataengine.util.ProductFileSync;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

// All model calls go through the domain-scoped agent runtime.
@SpringBootApplication
@EnableScheduling
public class RAGMain {
    public static void main(String[] arg) throws java.io.IOException {
        ProductFileSync.syncFromEnvironment();
        SpringApplication application = new SpringApplication(RAGMain.class);
        application.setBannerMode(org.springframework.boot.Banner.Mode.OFF);
        application.run(arg);
    }
}
