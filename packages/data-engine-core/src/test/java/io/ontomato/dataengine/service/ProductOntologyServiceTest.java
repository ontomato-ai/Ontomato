package io.ontomato.dataengine.service;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import org.springframework.jdbc.core.JdbcTemplate;
import java.util.List;

class ProductOntologyServiceTest {
    @Test void onlyProjectionAndBundleIdentitiesEnterTheOntology(){
        assertDoesNotThrow(()->ProductOntologyService.validate(new ProductOntologyService.Registration("view","object-projection","Person",1,"ObjectType","Person",true)));
        assertThrows(IllegalArgumentException.class,()->ProductOntologyService.validate(new ProductOntologyService.Registration("view","object-projection","Person",1,"MetricView","count",true)));
        assertThrows(IllegalArgumentException.class,()->ProductOntologyService.validate(new ProductOntologyService.Registration("page","page","Page",1,null,null,false)));
        assertDoesNotThrow(()->ProductOntologyService.validate(new ProductOntologyService.Registration("profile","agent-profile","Profile",1,"AgentDefinition","agent",false)));
    }
    @Test void aRetriedOlderRegistrationCannotResurrectADeletedGraphNode(){
        var db=mock(JdbcTemplate.class);var service=new ProductOntologyService(db,mock(ProductGrantService.class));
        when(db.queryForList(contains("tombstone"),eq(Long.class),eq("domain"),eq("view"))).thenReturn(List.of(3L));
        service.register("domain",List.of(new ProductOntologyService.Registration("view","metric-widget","Count",2,"MetricView","count",false)));
        verify(db,never()).update(startsWith("INSERT INTO ontology_product_node"),any(),any(),any(),any(),any());
    }
}
