package io.ontomato.dataengine.panelreads;

import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** The registered relation's two endpoint classes and its one center. */
public record OntologyNeighborScope(String centerId, boolean outgoing, boolean incoming) {
    public static OntologyNeighborScope parse(Map<String, Object> parameters, String from, String to) {
        if (!(parameters.get("primaryKey") instanceof String id) || id.isBlank()
                || !from.equals(parameters.get("from")) || !to.equals(parameters.get("to"))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid ontology relation scope");
        }
        if ("outgoing".equals(parameters.get("direction")) && from.equals(parameters.get("className")))
            return new OntologyNeighborScope(id, true, false);
        if ("incoming".equals(parameters.get("direction")) && to.equals(parameters.get("className")))
            return new OntologyNeighborScope(id, false, true);
        if ("both".equals(parameters.get("direction")) && from.equals(to) && from.equals(parameters.get("className")))
            return new OntologyNeighborScope(id, true, true);
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid ontology relation center");
    }
}
