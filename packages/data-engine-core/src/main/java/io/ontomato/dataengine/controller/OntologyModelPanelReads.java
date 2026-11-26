package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.panelreads.WorkbenchPanelRead;
import io.ontomato.dataengine.service.ExecutionTarget;
import io.ontomato.dataengine.service.OntologyModelException;
import io.ontomato.dataengine.service.OntologyModelService;
import io.ontomato.dataengine.service.OntologyModelReadScope;
import io.ontomato.dataengine.service.OntologyModelService.AttributeView;
import io.ontomato.dataengine.service.OntologyModelService.RelationshipView;
import io.ontomato.dataengine.service.OntologyModelService.ObjectTypeView;
import io.ontomato.dataengine.service.OntologyModelService.FormDescription;
import io.ontomato.dataengine.service.OntologyModelService.FormRequest;
import io.ontomato.dataengine.service.OntologyModelService.FormTarget;
import io.ontomato.dataengine.service.authorization.AuthorizationService;
import io.ontomato.dataengine.service.authorization.AuthorizationService.Management;
import io.ontomato.dataengine.service.authorization.AuthorizationService.SubjectContext;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.dao.DataAccessException;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@Configuration(proxyBeanMethods = false)
class OntologyModelPanelReads {
    private static final String OBJECT_TYPE = "platform:ObjectType";
    private static final String ATTRIBUTE = "platform:Attribute";
    private static final String RELATIONSHIP = "platform:Relationship";

    private final OntologyModelService model;
    private final AuthorizationService authorization;

    OntologyModelPanelReads(OntologyModelService model, AuthorizationService authorization) {
        this.model = model;
        this.authorization = authorization;
    }

    @Bean
    WorkbenchPanelRead objectTypeList() {
        return scopedRead(OBJECT_TYPE, "list", (domain, lang, p, scope) -> Map.of(
                "views", scope.visibleObjectTypes(model.objectTypes(domain, lang)), "fieldLabels", model.fieldLabels(lang).objectType()));
    }

    @Bean
    WorkbenchPanelRead objectTypeCount() {
        return count(OBJECT_TYPE, "objectTypes");
    }

    @Bean
    WorkbenchPanelRead objectTypeRecord() {
        return scopedRead(OBJECT_TYPE, "record", (domain, lang, p, scope) -> {
            String className = (String) p.get("primaryKey");
            scope.requireClasses(className);
            return Map.of("view", model.objectType(className, domain, lang),
                    "fieldLabels", model.fieldLabels(lang).objectType());
        });
    }

    @Bean
    WorkbenchPanelRead objectTypeForm() {
        return form(OBJECT_TYPE, "form", (body, domain, lang, scope) -> {
            scope.requireObjectTypeForm(body);
            return model.objectTypeForm(body, domain, lang, false, true);
        });
    }

    @Bean
    WorkbenchPanelRead objectTypeCreateForm() {
        return form(OBJECT_TYPE, "createForm", (body, domain, lang, scope) -> {
            scope.requireObjectTypeForm(body);
            return model.objectTypeForm(body, domain, lang, false, true);
        });
    }

    @Bean
    WorkbenchPanelRead objectTypeInlineForm() {
        return form(OBJECT_TYPE, "inlineForm", (body, domain, lang, scope) -> {
            scope.requireObjectTypeForm(body);
            return model.objectTypeForm(body, domain, lang, true, true);
        });
    }

    @Bean
    WorkbenchPanelRead objectTypeOptions() {
        return scopedRead(OBJECT_TYPE, "options", (domain, lang, p, scope) ->
                scope.visibleObjectTypes(model.objectTypes(domain, lang)));
    }

    @Bean
    WorkbenchPanelRead objectTypeResolve() {
        return scopedRead(OBJECT_TYPE, "resolve", (domain, lang, p, scope) ->
                scope.visibleObjectTypes(model.objectTypes(domain, lang)));
    }

    @Bean
    WorkbenchPanelRead attributeList() {
        return scopedRead(ATTRIBUTE, "list", (domain, lang, p, scope) -> {
            String className = (String) p.get("className");
            scope.requireRequestedClass(className);
            var result = model.attributeRows(className, domain, lang);
            var views = scope.visibleAttributes(result.views());
            var labels = result.classLabels();
            if (scope.applies()) {
                labels = new LinkedHashMap<>();
                for (var view : views) labels.put(view.className(), result.classLabels().get(view.className()));
            }
            var facts = new LinkedHashMap<String, Object>();
            facts.put("views", views);
            facts.put("classLabels", labels);
            facts.put("fieldLabels", model.fieldLabels(lang).attribute());
            if (Boolean.TRUE.equals(p.get("includeDeleteFacts")))
                facts.put("relationshipFacts", attributeDeleteFacts(domain, lang, className, scope));
            return facts;
        });
    }

    @Bean
    WorkbenchPanelRead attributeCount() {
        return count(ATTRIBUTE, "attributes");
    }

    @Bean
    WorkbenchPanelRead attributeRecord() {
        return read(ATTRIBUTE, "record", (domain, lang, p) -> {
            var result = model.attributeRecord((String) p.get("primaryKey"), domain, lang);
            return Map.of("view", result.view(), "classLabels", result.classLabels(),
                    "fieldLabels", model.fieldLabels(lang).attribute());
        });
    }

    @Bean
    WorkbenchPanelRead attributeForm() {
        return form(ATTRIBUTE, "form", (body, domain, lang, scope) -> {
            scope.requireAttributeForm(body);
            return model.attributeForm(body, domain, lang, false, true);
        });
    }

    @Bean
    WorkbenchPanelRead attributeCreateForm() {
        return form(ATTRIBUTE, "createForm", (body, domain, lang, scope) -> {
            scope.requireAttributeForm(body);
            return model.attributeForm(body, domain, lang, false, true);
        });
    }

    @Bean
    WorkbenchPanelRead attributeInlineForm() {
        return form(ATTRIBUTE, "inlineForm", (body, domain, lang, scope) -> {
            scope.requireAttributeForm(body);
            return model.attributeForm(body, domain, lang, true, true);
        });
    }

    @Bean
    WorkbenchPanelRead relationshipList() {
        return scopedRead(RELATIONSHIP, "list", (domain, lang, p, scope) -> Map.of(
                "views", relationshipViews(domain, lang, (String) p.get("className"), scope),
                "fieldLabels", model.fieldLabels(lang).relationship()));
    }

    private List<RelationshipView> relationshipViews(String domain, String language, String className, OntologyModelReadScope scope) {
        scope.requireRequestedClass(className);
        return scope.visibleRelationships(model.relationships(className, domain, language));
    }

    private Map<String, ?> attributeDeleteFacts(String domain, String language, String className, OntologyModelReadScope scope) {
        try {
            return Map.of("views", relationshipViews(domain, language, className, scope));
        } catch (ResponseStatusException refused) {
            return Map.of("error", java.util.Objects.requireNonNullElse(refused.getReason(),
                    "Owner read returned HTTP " + refused.getStatusCode().value()));
        } catch (OntologyModelException failure) {
            return Map.of("error", failure.getMessage());
        } catch (DataAccessException failure) {
            return Map.of("error", "The owner read failed");
        }
    }

    @Bean
    WorkbenchPanelRead relationshipCount() {
        return count(RELATIONSHIP, "relationships");
    }

    @Bean
    WorkbenchPanelRead relationshipRecord() {
        return scopedRead(RELATIONSHIP, "record", (domain, lang, p, scope) -> {
            var view = model.relationship((String) p.get("primaryKey"), domain, lang);
            scope.requireClasses(view.fromclass(), view.toclass());
            return Map.of("view", view, "fieldLabels", model.fieldLabels(lang).relationship());
        });
    }

    @Bean
    WorkbenchPanelRead relationshipForm() {
        return form(RELATIONSHIP, "form", (body, domain, lang, scope) -> {
            scope.requireRelationshipForm(body, id -> model.relationship(id, domain, lang));
            return model.relationshipForm(body, domain, lang, true);
        });
    }

    @Bean
    WorkbenchPanelRead relationshipCreateForm() {
        return form(RELATIONSHIP, "createForm", (body, domain, lang, scope) -> {
            scope.requireRelationshipForm(body, id -> model.relationship(id, domain, lang));
            return model.relationshipForm(body, domain, lang, true);
        });
    }

    private WorkbenchPanelRead count(String type, String field) {
        return read(type, "count", (domain, lang, p) ->
                Map.of("rows", List.of(), "total", model.countMetadata(domain, null).get(field)));
    }

    private WorkbenchPanelRead form(String type, String name, FormReader reader) {
        return scopedRead(type, name, (domain, lang, parameters, scope) -> {
            var target = "createForm".equals(name) ? new FormTarget("draft", null, null)
                    : new FormTarget("object", type, (String) parameters.get("primaryKey"));
            @SuppressWarnings("unchecked")
            var values = (Map<String, Object>) parameters.get("values");
            return reader.read(new FormRequest(target, values, (String) parameters.get("changedField")), domain, lang, scope);
        });
    }

    private WorkbenchPanelRead read(String type, String name, ModelReader reader) {
        return new WorkbenchPanelRead(type, name, (subject, parameters) -> {
            requireRead(subject);
            return reader.read(subject.identity().domainId(), LocaleContextHolder.getLocale().toLanguageTag(), parameters);
        });
    }

    private WorkbenchPanelRead scopedRead(String type, String name, ScopedModelReader reader) {
        return WorkbenchPanelRead.callerScopedMetadata(type, name, (subject, parameters, target) -> {
            requireRead(subject);
            return reader.read(subject.identity().domainId(), LocaleContextHolder.getLocale().toLanguageTag(),
                    parameters, new OntologyModelReadScope(target));
        });
    }

    List<AttributeView> classAttributes(SubjectContext subject, String className, String language) {
        requireRead(subject);
        return model.attributes(className, subject.identity().domainId(), language);
    }

    List<RelationshipView> classRelationships(SubjectContext subject, String className, String language, ExecutionTarget target) {
        requireRead(subject);
        return OntologyModelService.visibleRelationships(model.relationships(className, subject.identity().domainId(), language), target);
    }

    record InstanceModel(List<AttributeView> attributes, ObjectTypeView type) {}

    InstanceModel instanceModel(SubjectContext subject, String className, String language) {
        requireRead(subject);
        var domain = subject.identity().domainId();
        return new InstanceModel(model.attributes(className, domain, language), model.objectType(className, domain, language));
    }

    private void requireRead(SubjectContext subject) {
        var decision = authorization.decide(subject, new Management(OntologyModelController.Operations.READ));
        if (!decision.allowed()) throw new ResponseStatusException(HttpStatus.FORBIDDEN, decision.reason());
    }

    private interface ModelReader {
        Object read(String domainId, String lang, Map<String, Object> parameters);
    }

    private interface ScopedModelReader {
        Object read(String domainId, String lang, Map<String, Object> parameters, OntologyModelReadScope scope);
    }

    private interface FormReader {
        FormDescription read(FormRequest body, String domainId, String lang, OntologyModelReadScope scope);
    }
}
