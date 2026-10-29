import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import com.sun.net.httpserver.HttpServer;
import io.ontomato.dataengine.controller.OntologyQueryController;
import io.ontomato.dataengine.dataAdapter.SecretCipher;
import io.ontomato.dataengine.service.DataPermissionLookup;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.PythonExecuteService;
import io.ontomato.dataengine.service.QueryGrantService;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.DriverManager;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.beans.factory.support.AbstractBeanDefinition;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;

/**
 * Shared full-application startup probe. Run in a child JVM with production classes and test
 * libraries.
 */
class StartupContextProbe {
  public static void main(String[] args) {
    int status = 1;
    try {
      check(args);
      status = 0;
    } catch (Throwable error) {
      error.printStackTrace();
    }
    // Legacy maintenance threads do not stop with the Spring context. Contain them in this JVM.
    System.exit(status);
  }

  private static void check(String[] args) throws Exception {
    URI source = URI.create(System.getenv("STARTUP_TEST_DATABASE_URL"));
    if (!java.util.Set.of("localhost", "127.0.0.1", "[::1]").contains(source.getHost()))
      throw new IllegalArgumentException(
          "Startup checks require a disposable local PostgreSQL server");
    String[] account = source.getUserInfo().split(":", 2);
    String server = "jdbc:postgresql://" + source.getHost() + ":" + source.getPort();
    String database = "startup_" + UUID.randomUUID().toString().replace("-", "");
    HttpServer runtime = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    AtomicInteger publications = new AtomicInteger();
    runtime.createContext(
        "/v1/skills",
        exchange -> {
          exchange.getRequestBody().readAllBytes();
          publications.incrementAndGet();
          byte[] body = "{}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
          exchange.sendResponseHeaders(201, body.length);
          exchange.getResponseBody().write(body);
          exchange.close();
        });
    runtime.start();
    try (var admin =
            DriverManager.getConnection(server + source.getPath(), account[0], account[1]);
        var statement = admin.createStatement()) {
      statement.execute("CREATE DATABASE " + database);
      try {
        SpringApplication application =
            new SpringApplication(Class.forName("io.ontomato.dataengine.RAGMain"));
        application.setWebApplicationType(WebApplicationType.SERVLET);
        application.setLazyInitialization(false);
        application.setAllowCircularReferences(false);
        application.addInitializers(
            context ->
                context.addBeanFactoryPostProcessor(
                    factory -> {
                      // Test-only constructor selection for the known unrelated SecretCipher
                      // annotation defect.
                      // The actual cipher instance and its dependencies are retained, not mocked or
                      // made lazy.
                      ((AbstractBeanDefinition) factory.getBeanDefinition("secretCipher"))
                          .setInstanceSupplier(() -> new SecretCipher(context.getEnvironment()));
                      if (args.length == 4) {
                        try {
                          Class<?> externalType = Class.forName(args[3]);
                          ((AbstractBeanDefinition) factory.getBeanDefinition(args[2]))
                              .setInstanceSupplier(() -> org.mockito.Mockito.mock(externalType));
                        } catch (ClassNotFoundException error) {
                          throw new IllegalStateException(error);
                        }
                      }
                    }));
        application.setDefaultProperties(Map.of("logging.level.root", "WARN"));
        try (var context =
            (ServletWebServerApplicationContext)
                application.run(
                    "--spring.config.location=optional:classpath:/startup-test-no-site-config.yml",
                    "--spring.main.allow-circular-references=false",
                    "--spring.main.lazy-initialization=false",
                    "--server.address=127.0.0.1",
                    "--server.port=0",
                    "--ontomato.data-engine.jdbc.url=" + server + "/" + database,
                    "--ontomato.data-engine.jdbc.username=" + account[0],
                    "--ontomato.data-engine.jdbc.password=" + account[1],
                    "--ontomato.data-engine.data-adapter=postgresql",
                    "--ontomato.data-engine.node-id=startup-fixture",
                    "--ONTOMATO_MODEL_RUNTIME_TOKEN=startup-model-fixture",
                    "--ONTOMATO_QUERY_SIGNING_KEY=startup-signing-fixture",
                    "--ONTOMATO_QUERY_SERVICE_TOKEN=startup-query-fixture",
                    "--AGENT_RUNTIME_ONTOLOGY_TOKEN=startup-runtime-fixture",
                    "--AGENT_RUNTIME_URL=http://127.0.0.1:" + runtime.getAddress().getPort())) {
          if (context.getEnvironment().getActiveProfiles().length != 0)
            throw new AssertionError(
                "The startup check must not change the edition with a profile");
          if (context.getDefaultListableBeanFactory().isAllowCircularReferences())
            throw new AssertionError("Circular references must remain disabled");
          Object identity = context.getBean(IdentityService.class),
              permissions = context.getBean(DataPermissionLookup.class);
          if (!Class.forName(args[0]).isInstance(identity)
              || !Class.forName(args[1]).isInstance(permissions))
            throw new AssertionError("Wrong edition identity/permission implementation");
          for (Object bean :
              new Object[] {
                identity,
                permissions,
                context.getBean(QueryGrantService.class),
                context.getBean(PythonExecuteService.class),
                context.getBean(OntologyQueryController.class)
              })
            if (org.mockito.Mockito.mockingDetails(bean).isMock())
              throw new AssertionError("Application dependency was mocked: " + bean.getClass());
          for (int i = 0; i < 100 && publications.get() == 0; i++) Thread.sleep(20);
          if (publications.get() == 0)
            throw new AssertionError("ApplicationReadyEvent did not publish the ontology skill");
          int port = context.getWebServer().getPort();
          var response =
              HttpClient.newHttpClient()
                  .send(
                      HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/health"))
                          .timeout(Duration.ofSeconds(5))
                          .build(),
                      HttpResponse.BodyHandlers.ofString());
          if (response.statusCode() != 200)
            throw new AssertionError(
                "Health HTTP " + response.statusCode() + ": " + response.body());
          System.out.println(
              "FULL_CONTEXT_STARTED identity="
                  + identity.getClass().getName()
                  + " permissions="
                  + permissions.getClass().getName()
                  + " beans="
                  + context.getBeanDefinitionCount()
                  + " health=200");
        }
      } finally {
        statement.execute("DROP DATABASE IF EXISTS " + database + " WITH (FORCE)");
      }
    } finally {
      runtime.stop(0);
    }
  }
}
