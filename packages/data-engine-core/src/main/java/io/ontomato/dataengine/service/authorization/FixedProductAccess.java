package io.ontomato.dataengine.service.authorization;

import static io.ontomato.dataengine.service.authorization.AuthorizationTypes.*;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.Map;
import org.springframework.core.io.ClassPathResource;

final class FixedProductAccess {
    private static final Map<Kind, Verb> VERBS = declarations();

    private FixedProductAccess() {}

    static boolean allows(Kind kind, Verb verb) {
        return verb.equals(VERBS.get(kind));
    }

    private static Map<Kind, Verb> declarations() {
        try (var input = new ClassPathResource("ontology-contracts/fixed-product-access.json").getInputStream()) {
            return new ObjectMapper().readValue(input, new TypeReference<Map<Kind, Verb>>() {});
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
