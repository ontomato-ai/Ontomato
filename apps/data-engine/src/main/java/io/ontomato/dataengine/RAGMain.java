package io.ontomato.dataengine;

import io.ontomato.dataengine.util.ProductFileSync;
import dev.langchain4j.openai.spring.AutoConfig;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

// Models are created per domain by business configuration; no global OpenAI model bean is used.
@SpringBootApplication(exclude = AutoConfig.class)
@EnableScheduling
public class RAGMain {
    public static void main(String[] arg) throws java.io.IOException {
        ProductFileSync.syncFromEnvironment();
        SpringApplication application = new SpringApplication(RAGMain.class);
        application.setBannerMode(org.springframework.boot.Banner.Mode.OFF);
        application.run(arg);
    }
}
