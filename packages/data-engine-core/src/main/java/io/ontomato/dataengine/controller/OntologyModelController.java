package io.ontomato.dataengine.controller;

import java.util.List;
import java.util.Map;

import org.apache.logging.log4j.ThreadContext;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.ServletRequestBindingException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.fasterxml.jackson.databind.JsonNode;

import io.ontomato.dataengine.config.ControllerConst;
import io.ontomato.dataengine.schedules.ScheduleJson;
import io.ontomato.dataengine.service.OntologyModelException;
import io.ontomato.dataengine.service.OntologyModelService;
import io.ontomato.dataengine.service.OntologyModelService.AttributeCreate;
import io.ontomato.dataengine.service.OntologyModelService.AttributeUpdate;
import io.ontomato.dataengine.service.OntologyModelService.AttributeView;
import io.ontomato.dataengine.service.OntologyModelService.ClassDeletion;
import io.ontomato.dataengine.service.OntologyModelService.DeletionImpact;
import io.ontomato.dataengine.service.OntologyModelService.FieldLabels;
import io.ontomato.dataengine.service.OntologyModelService.FormDescription;
import io.ontomato.dataengine.service.OntologyModelService.FormRequest;
import io.ontomato.dataengine.service.OntologyModelService.ObjectTypeCreate;
import io.ontomato.dataengine.service.OntologyModelService.ObjectTypeUpdate;
import io.ontomato.dataengine.service.OntologyModelService.ObjectTypeView;
import io.ontomato.dataengine.service.OntologyModelService.RelationshipCreate;
import io.ontomato.dataengine.service.OntologyModelService.RelationshipUpdate;
import io.ontomato.dataengine.service.OntologyModelService.RelationshipView;
import io.ontomato.dataengine.util.SystemUtils;

/**
 * The ontology model's resource interface; every operation is one typed read or one saved rule.
 *
 * <p>Paths are fixed and the identifier travels in the query or the body: the enterprise API-permission
 * catalog grants routes by exact path, so a path variable could never be granted to a regular user.</p>
 */
@RestController
@RequestMapping("/ontology/model")
public class OntologyModelController {

	public record ObjectTypeUpdateRequest(String className, String showName, String classDesc) {
	}

	public record ObjectTypeDeleteRequest(String className) {
	}

	public record AttributeCreateRequest(String className, String name, String showName, String type, String attrDesc,
			Boolean enable, Boolean businessKey, Boolean primaryKey) {
	}

	public record AttributeUpdateRequest(String className, String name, String showName, String attrDesc,
			Boolean enable, Boolean businessKey) {
	}

	public record AttributeDeleteRequest(String className, String name) {
	}

	public record PrimaryKeyRequest(String className, String name) {
	}

	public record RelationshipUpdateRequest(String relationship, String desc, String fromField, String toField) {
	}

	public record RelationshipDeleteRequest(String relationship) {
	}

	@Autowired
	private OntologyModelService service;

	@ExceptionHandler(Exception.class)
	public ResponseEntity<JsonNode> failure(Exception error) {
		int status = 500;
		String code = "INTERNAL_ERROR";
		String message = "Ontology model service unavailable";
		Map<String, Object> details = Map.of();
		if (error instanceof OntologyModelException refused) {
			status = refused.status();
			code = refused.code();
			message = refused.getMessage();
			details = refused.details();
		} else if (error instanceof IllegalArgumentException invalid) {
			// The whole-model primary-key check refuses a write while a stored class breaks the rule.
			status = 409;
			code = "MODEL_INVALID";
			message = invalid.getMessage();
		} else if (error instanceof HttpMessageNotReadableException
				|| error instanceof ServletRequestBindingException) {
			status = 400;
			code = "INVALID_REQUEST";
			message = "Invalid request";
		} else if (error instanceof org.springframework.web.ErrorResponse problem) {
			// The deployment's API permission check refuses an ungranted reader with 403.
			status = problem.getStatusCode().value();
			code = switch (status) {
				case 403 -> "FORBIDDEN";
				case 404 -> "NOT_FOUND";
				default -> "INVALID_REQUEST";
			};
			message = status == 403 ? "Permission denied" : "Invalid request";
		}
		var detail = ScheduleJson.object("code", code, "message", message);
		details.forEach((key, value) -> detail.set(key, ScheduleJson.JSON.valueToTree(value)));
		return ResponseEntity.status(status)
				.body(ScheduleJson.object("error", detail, "correlationId",
						java.util.Objects.toString(ThreadContext.get("correlationId"), "ontology")));
	}

	@GetMapping("/object-types")
	public List<ObjectTypeView> objectTypes(@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		return service.objectTypes(SystemUtils.getCurUser(), lang);
	}

	@GetMapping("/object-type")
	public ObjectTypeView objectType(@RequestParam String className,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		return service.objectType(className, SystemUtils.getCurUser(), lang);
	}

	@GetMapping("/object-type/deletion-impact")
	public DeletionImpact deletionImpact(@RequestParam String className,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		return service.deletionImpact(className, SystemUtils.getCurUser(), lang);
	}

	@GetMapping("/attributes")
	public List<AttributeView> attributes(@RequestParam(required = false) String className,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		return service.attributes(className, SystemUtils.getCurUser(), lang);
	}

	@GetMapping("/relationships")
	public List<RelationshipView> relationships(@RequestParam(required = false) String className,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		return service.relationships(className, SystemUtils.getCurUser(), lang);
	}

	@GetMapping("/relationship")
	public RelationshipView relationship(@RequestParam String relationship,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		return service.relationship(relationship, SystemUtils.getCurUser(), lang);
	}

	/** Field labels for catalogs that list model objects; readers get them under the same permission as the lists. */
	@GetMapping("/field-labels")
	public FieldLabels fieldLabels(@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		return service.fieldLabels(lang);
	}

	@PostMapping("/object-type/create")
	public ResponseEntity<ObjectTypeView> createObjectType(@RequestBody ObjectTypeCreate body,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		return ResponseEntity.status(201)
				.body(service.createObjectType(body, SystemUtils.getCurUser(), lang));
	}

	@PostMapping("/object-type/update")
	public ObjectTypeView updateObjectType(@RequestBody ObjectTypeUpdateRequest body,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		return service.updateObjectType(body.className(),
				new ObjectTypeUpdate(body.showName(), body.classDesc()), SystemUtils.getCurUser(), lang);
	}

	@PostMapping("/object-type/delete")
	public ClassDeletion deleteObjectType(@RequestBody ObjectTypeDeleteRequest body,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		return service.deleteObjectType(body.className(), SystemUtils.getCurUser(), lang);
	}

	@PostMapping("/attribute/create")
	public ResponseEntity<AttributeView> createAttribute(@RequestBody AttributeCreateRequest body,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		return ResponseEntity.status(201).body(service.createAttribute(body.className(),
				new AttributeCreate(body.name(), body.showName(), body.type(), body.attrDesc(), body.enable(),
						body.businessKey(), body.primaryKey()),
				SystemUtils.getCurUser(), lang));
	}

	@PostMapping("/attribute/update")
	public AttributeView updateAttribute(@RequestBody AttributeUpdateRequest body,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		return service.updateAttribute(body.className(), body.name(),
				new AttributeUpdate(body.showName(), body.attrDesc(), body.enable(), body.businessKey()),
				SystemUtils.getCurUser(), lang);
	}

	@PostMapping("/attribute/primary-key")
	public List<AttributeView> setPrimaryKey(@RequestBody PrimaryKeyRequest body,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		return service.setPrimaryKey(body.className(), body.name(), SystemUtils.getCurUser(), lang);
	}

	@PostMapping("/attribute/delete")
	public ResponseEntity<Map<String, Object>> deleteAttribute(@RequestBody AttributeDeleteRequest body,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		service.deleteAttribute(body.className(), body.name(), SystemUtils.getCurUser(), lang);
		return ResponseEntity.ok(Map.of());
	}

	@PostMapping("/relationship/create")
	public ResponseEntity<RelationshipView> createRelationship(@RequestBody RelationshipCreate body,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		return ResponseEntity.status(201)
				.body(service.createRelationship(body, SystemUtils.getCurUser(), lang));
	}

	@PostMapping("/relationship/update")
	public RelationshipView updateRelationship(@RequestBody RelationshipUpdateRequest body,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		return service.updateRelationship(body.relationship(),
				new RelationshipUpdate(body.desc(), body.fromField(), body.toField()),
				SystemUtils.getCurUser(), lang);
	}

	@PostMapping("/relationship/delete")
	public ResponseEntity<Map<String, Object>> deleteRelationship(@RequestBody RelationshipDeleteRequest body,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		service.deleteRelationship(body.relationship(), SystemUtils.getCurUser(), lang);
		return ResponseEntity.ok(Map.of());
	}

	@PostMapping("/object-type/form")
	public FormDescription objectTypeForm(@RequestBody FormRequest body,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		return service.objectTypeForm(body, SystemUtils.getCurUser(), lang);
	}

	@PostMapping("/attribute/form")
	public FormDescription attributeForm(@RequestBody FormRequest body,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		return service.attributeForm(body, SystemUtils.getCurUser(), lang);
	}

	@PostMapping("/relationship/form")
	public FormDescription relationshipForm(@RequestBody FormRequest body,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang) {
		return service.relationshipForm(body, SystemUtils.getCurUser(), lang);
	}
}
