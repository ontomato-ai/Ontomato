package io.ontomato.dataengine.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import io.ontomato.dataengine.schedules.ScheduleJson;
import io.ontomato.dataengine.service.OntologyModelService.AttributeView;
import io.ontomato.dataengine.service.OntologyModelService.FormRequest;
import io.ontomato.dataengine.service.OntologyModelService.ObjectTypeView;
import io.ontomato.dataengine.service.OntologyModelService.RelationshipView;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/** The model owner's class checks for an already authenticated read. */
public record OntologyModelReadScope(ExecutionTarget target) {
    public boolean applies() {
        return target.testing() || !target.classNames().isEmpty();
    }

    public Map<String, Integer> countMetadata(OntologyModelService model, String domainId) {
        return model.countMetadata(domainId, applies() ? target.classNames() : null);
    }

    public List<ObjectTypeView> visibleObjectTypes(List<ObjectTypeView> views) {
        return applies() ? views.stream().filter(view -> target.classNames().contains(view.className())).toList() : views;
    }

    public List<AttributeView> visibleAttributes(List<AttributeView> views) {
        return applies() ? views.stream().filter(view -> target.classNames().contains(view.className())).toList() : views;
    }

    public List<RelationshipView> visibleRelationships(List<RelationshipView> views) {
        return OntologyModelService.visibleRelationships(views, target);
    }

    public void requireRequestedClass(String className) {
        if (className != null && !className.isBlank()) requireClasses(className);
    }

    public void requireClasses(String... classNames) {
        if (!applies()) return;
        var requested = new ArrayList<String>(classNames.length);
        for (String name : classNames) {
            if (name == null || name.isBlank()) {
                target.requireClasses(List.of());
                return;
            }
            requested.add(name);
        }
        target.requireClasses(requested);
    }

    public void requireObjectTypeForm(FormRequest form) {
        if (!applies() || form == null) return;
        if (isObjectTarget(form)) requireClasses(form.target().primaryKey());
        requireValue(form.values(), "className");
    }

    public void requireAttributeForm(FormRequest form) {
        if (!applies() || form == null) return;
        if (isObjectTarget(form)) {
            String ownerClass = attributeOwnerClass(form.target().primaryKey());
            if (ownerClass != null) requireClasses(ownerClass);
        }
        requireValue(form.values(), "className");
    }

    public void requireRelationshipForm(FormRequest form, Function<String, RelationshipView> relationship) {
        if (!applies() || form == null) return;
        if (isObjectTarget(form) && form.target().primaryKey() != null && !form.target().primaryKey().isBlank()) {
            var view = relationship.apply(form.target().primaryKey().trim());
            requireClasses(view.fromclass(), view.toclass());
        }
        requireValue(form.values(), "fromclass");
        requireValue(form.values(), "toclass");
    }

    private static boolean isObjectTarget(FormRequest form) {
        return form.target() != null && "object".equals(form.target().kind());
    }

    private static String attributeOwnerClass(String primaryKey) {
        if (primaryKey == null || primaryKey.isBlank()) return null;
        try {
            var node = ScheduleJson.JSON.readTree(primaryKey);
            if (node != null && node.isArray() && node.size() == 2 && node.get(0).isTextual() && node.get(1).isTextual())
                return node.get(0).asText();
        } catch (JsonProcessingException invalidKey) {
            // The form reader reports malformed keys.
            return null;
        }
        return null;
    }

    private void requireValue(Map<String, Object> values, String key) {
        if (values != null && values.get(key) instanceof String className && !className.isBlank())
            requireClasses(className.trim());
    }
}
