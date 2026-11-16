package io.ontomato.dataengine.service.impl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import com.alibaba.fastjson2.JSONObject;
import java.util.List;
import org.junit.jupiter.api.Test;

class ActionEffectsTest {
    @Test void affectedTypesIncludeBothRelationEndsWithoutDuplicates() {
        assertEquals(List.of("Person", "Department"), ActionDefinitionProjector.affectedTypes(List.of(
            JSONObject.of("className", "Person"),
            JSONObject.of("sourceClass", "Person", "targetClass", "Department"),
            JSONObject.of("className", " "))));
    }
}
