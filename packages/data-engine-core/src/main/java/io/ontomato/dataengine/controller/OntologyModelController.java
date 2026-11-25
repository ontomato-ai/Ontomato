package io.ontomato.dataengine.controller;

import java.util.ArrayList;
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
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.schedules.ScheduleJson;
import io.ontomato.dataengine.service.ExecutionTarget;
import io.ontomato.dataengine.service.IdentityService;
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
import io.ontomato.dataengine.service.agent.AgentExecutionScope;
import io.ontomato.dataengine.service.agent.AgentHttpException;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.util.SystemUtils;
import jakarta.servlet.http.HttpServletRequest;

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
			Boolean enable, Boolean businessKey, Boolean primaryKey) {
		public AttributeUpdateRequest(String className, String name, String showName, String attrDesc,
				Boolean enable, Boolean businessKey) {
			this(className, name, showName, attrDesc, enable, businessKey, null);
		}
	}

	public record AttributeDeleteRequest(String className, String name) {
	}

	public record PrimaryKeyRequest(String className, String name) {
	}

	public record RelationshipUpdateRequest(String relationship, String desc, String fromField, String toField) {
	}

	public record RelationshipDeleteRequest(String relationship) {
	}

	private final AgentExecutionScope agentExecutionScope;

	public OntologyModelController(AgentExecutionScope agentExecutionScope) {
		this.agentExecutionScope = agentExecutionScope;
	}

	@Autowired
	private IdentityService identityService;

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
		} else if (error instanceof AgentHttpException refused) {
			status = refused.status();
			code = refused.code();
			message = refused.getMessage();
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
	public List<ObjectTypeView> objectTypes(
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang,
			HttpServletRequest executionRequest) {
		User user = SystemUtils.getCurUser();
		ExecutionTarget target = executionTarget(executionRequest, user);
		List<ObjectTypeView> types = service.objectTypes(user, lang);
		if (isClassScoped(target)) {
			return types.stream().filter(type -> target.classNames().contains(type.className())).toList();
		}
		return types;
	}

	@GetMapping("/object-type")
	public ObjectTypeView objectType(@RequestParam String className,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang,
			HttpServletRequest executionRequest) {
		User user = SystemUtils.getCurUser();
		requireClassScope(executionTarget(executionRequest, user), className);
		return service.objectType(className, user, lang);
	}

	@GetMapping("/object-type/deletion-impact")
	public DeletionImpact deletionImpact(@RequestParam String className,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang,
			HttpServletRequest executionRequest) {
		User user = SystemUtils.getCurUser();
		requireClassScope(executionTarget(executionRequest, user), className);
		return service.deletionImpact(className, user, lang);
	}

	@GetMapping("/attributes")
	public List<AttributeView> attributes(@RequestParam(required = false) String className,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang,
			HttpServletRequest executionRequest) {
		User user = SystemUtils.getCurUser();
		ExecutionTarget target = executionTarget(executionRequest, user);
		if (className != null && !className.isBlank()) {
			requireClassScope(target, className);
			return service.attributes(className, user, lang);
		}
		List<AttributeView> attrs = service.attributes(className, user, lang);
		if (isClassScoped(target)) {
			return attrs.stream().filter(attr -> target.classNames().contains(attr.className())).toList();
		}
		return attrs;
	}

	@GetMapping("/relationships")
	public List<RelationshipView> relationships(@RequestParam(required = false) String className,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang,
			HttpServletRequest executionRequest) {
		User user = SystemUtils.getCurUser();
		ExecutionTarget target = executionTarget(executionRequest, user);
		if (className != null && !className.isBlank()) {
			requireClassScope(target, className);
		}
		List<RelationshipView> relations = service.relationships(className, user, lang);
		if (isClassScoped(target)) {
			// A relationship is visible only when both endpoints are inside the caller's class scope.
			return relations.stream()
					.filter(rel -> target.classNames().contains(rel.fromclass())
							&& target.classNames().contains(rel.toclass()))
					.toList();
		}
		return relations;
	}

	@GetMapping("/relationship")
	public RelationshipView relationship(@RequestParam String relationship,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang,
			HttpServletRequest executionRequest) {
		User user = SystemUtils.getCurUser();
		ExecutionTarget target = executionTarget(executionRequest, user);
		RelationshipView view = service.relationship(relationship, user, lang);
		requireClassScope(target, view.fromclass(), view.toclass());
		return view;
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
				new AttributeUpdate(body.showName(), body.attrDesc(), body.enable(), body.businessKey(),
						body.primaryKey()),
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
			@RequestParam(value = "mode", required = false) String mode,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang,
			HttpServletRequest executionRequest) {
		User user = SystemUtils.getCurUser();
		ExecutionTarget target = executionTarget(executionRequest, user);
		if (isClassScoped(target) && body != null) {
			if (isObjectTarget(body)) {
				requireClassScope(target, body.target().primaryKey());
			}
			requireBodyValueClassScope(target, body.values(), "className");
		}
		if ("inline".equals(mode)) {
			return service.objectTypeInlineForm(body, user, lang);
		}
		return service.objectTypeForm(body, user, lang);
	}

	@PostMapping("/attribute/form")
	public FormDescription attributeForm(@RequestBody FormRequest body,
			@RequestParam(value = "mode", required = false) String mode,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang,
			HttpServletRequest executionRequest) {
		User user = SystemUtils.getCurUser();
		ExecutionTarget target = executionTarget(executionRequest, user);
		if (isClassScoped(target) && body != null) {
			if (isObjectTarget(body)) {
				String ownerClass = attributeTargetClass(body.target().primaryKey());
				if (ownerClass != null) {
					requireClassScope(target, ownerClass);
				}
			}
			requireBodyValueClassScope(target, body.values(), "className");
		}
		if ("inline".equals(mode)) {
			return service.attributeInlineForm(body, user, lang);
		}
		return service.attributeForm(body, user, lang);
	}

	@PostMapping("/relationship/form")
	public FormDescription relationshipForm(@RequestBody FormRequest body,
			@RequestHeader(value = ControllerConst.LANG_HEADER_KEY, required = false) String lang,
			HttpServletRequest executionRequest) {
		User user = SystemUtils.getCurUser();
		ExecutionTarget target = executionTarget(executionRequest, user);
		if (isClassScoped(target) && body != null) {
			if (isObjectTarget(body) && body.target().primaryKey() != null && !body.target().primaryKey().isBlank()) {
				RelationshipView existing = service.relationship(body.target().primaryKey().trim(), user, lang);
				requireClassScope(target, existing.fromclass(), existing.toclass());
			}
			requireBodyValueClassScope(target, body.values(), "fromclass");
			requireBodyValueClassScope(target, body.values(), "toclass");
		}
		return service.relationshipForm(body, user, lang);
	}

	private ExecutionTarget executionTarget(HttpServletRequest executionRequest, User user) {
		if (executionRequest == null || executionRequest.getHeader("X-Ontomato-Retrieval-Caller-Id") == null) {
			return ExecutionTarget.LIVE;
		}
		UserDataPermission permission = identityService == null ? null : identityService.getCurrentUserDataPermission();
		return agentExecutionScope.target(executionRequest, user, permission, ExecutionTarget.LIVE);
	}

	private static boolean isClassScoped(ExecutionTarget target) {
		return target.testing() || !target.classNames().isEmpty();
	}

	private static boolean isObjectTarget(FormRequest body) {
		return body.target() != null && "object".equals(body.target().kind());
	}

	private static String attributeTargetClass(String primaryKey) {
		if (primaryKey == null || primaryKey.isBlank()) {
			return null;
		}
		try {
			JsonNode node = ScheduleJson.JSON.readTree(primaryKey);
			if (node.isArray() && node.size() == 2 && node.get(0).isTextual() && node.get(1).isTextual()) {
				return node.get(0).asText();
			}
		} catch (Exception ignored) {
			// Let the service report malformed keys as 400.
		}
		return null;
	}

	private static void requireBodyValueClassScope(ExecutionTarget target, Map<String, Object> values, String key) {
		if (values != null && values.get(key) instanceof String className && !className.isBlank()) {
			requireClassScope(target, className.trim());
		}
	}

	private static void requireClassScope(ExecutionTarget target, String... classNames) {
		if (!isClassScoped(target)) {
			return;
		}
		List<String> requested = new ArrayList<>(classNames.length);
		for (String name : classNames) {
			if (name == null || name.isBlank()) {
				target.requireClasses(List.of());
				return;
			}
			requested.add(name);
		}
		target.requireClasses(requested);
	}
}
