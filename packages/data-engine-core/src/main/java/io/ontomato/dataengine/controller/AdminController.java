package io.ontomato.dataengine.controller;

import static io.ontomato.dataengine.service.OntologyNeighborFacts.ID_PADDING;

import io.ontomato.dataengine.service.authorization.ManagementEndpoint;

import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.BiPredicate;
import java.util.function.Predicate;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.dao.KnowledgeEntity;
import io.ontomato.dataengine.service.KnowledgeService;
import io.ontomato.dataengine.service.KnowledgeTagConfig;
import io.ontomato.dataengine.panelreads.WorkbenchPanelRead;
import io.ontomato.dataengine.service.OwnerRefusal;
import io.ontomato.dataengine.service.authorization.ManagementRequestAccess;
import io.ontomato.dataengine.service.authorization.ManagementOperations;
import io.ontomato.dataengine.util.SystemUtils;

import lombok.extern.slf4j.Slf4j;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.service.AdminService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.LangService;
import io.ontomato.dataengine.service.sys.bean.permission.UserDataPermission;
import io.ontomato.dataengine.config.ControllerConst;
import org.springframework.web.bind.annotation.RequestHeader;

@Slf4j
@RestController
@Owned
public class AdminController {

    @Component
    static final class Operations implements ManagementOperations.Contributor {
        static final String KNOWLEDGE_READ = "business-knowledge.read";
        static final String KNOWLEDGE_CHANGE = "business-knowledge.change";
        @Override
        public java.util.List<ManagementOperations.Operation> managementOperations() {
            return java.util.List.of(
                    new ManagementOperations.Operation(KNOWLEDGE_READ, "Read business knowledge", ManagementOperations.Access.READ),
                    new ManagementOperations.Operation(KNOWLEDGE_CHANGE, "Change business knowledge", ManagementOperations.Access.CHANGE));
        }
    }


	@Autowired
	private AdminService adminService;

	@Autowired
	private KnowledgeService knowledgeService;

	@Autowired
	private IdentityService identityService;

	@Autowired
	private LangService langService;

	@Autowired
	private KnowledgeTagConfig knowledgeTagConfig;

	@ManagementEndpoint(OntologyModelController.Operations.CHANGE)
	@PostMapping("/admin/editdatasetdesc")
	@ResponseBody
	public JSONObject editDataSetDesc(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String strDataSetDesc = param.getString("datasetdesc").trim();
			if (strDataSetDesc !=null && !"".equals(strDataSetDesc)) {
				User user = SystemUtils.getCurUser();
				adminService.setDataSetDesc(strDataSetDesc, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@ManagementEndpoint(OntologyModelController.Operations.CHANGE)
	@PostMapping("/admin/editClassInStarChart")
    @ResponseBody
    public JSONObject editClassInStarChart(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			boolean inStarChart = param.getBoolean("inStarChart");
			if (!"".equals(className)) {
				User user = SystemUtils.getCurUser();
				adminService.setClassInStarChart(className, inStarChart, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@ManagementEndpoint(OntologyModelController.Operations.CHANGE)
	@PostMapping("/admin/editClassAttrTimeFormat")
    @ResponseBody
    public JSONObject editClassAttrTimeFormat(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			String attr = param.getString("attr").trim();
			String format = param.getString("format").trim();
			if (!"".equals(className) && !"".equals(attr) && !"".equals(format)) {
				User user = SystemUtils.getCurUser();
				adminService.setClassAttrTimeFormat(className, attr, format, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@ManagementEndpoint(OntologyModelController.Operations.CHANGE)
	@PostMapping("/admin/addBucketIndicator")
    @ResponseBody
    public JSONObject addBucketIndicator(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			String attrName = param.getString("attrName").trim();
			String indicatorName = param.getString("indicatorName").trim();
			String indicatorDesc = param.getString("indicatorDesc").trim();
			String indicatorUnit = param.getString("indicatorUnit").trim();
			if (!"".equals(className) && !"".equals(attrName) && !"".equals(indicatorName) && !"".equals(indicatorDesc) && !"".equals(indicatorUnit)) {
				User user = SystemUtils.getCurUser();
				adminService.addBucketIndicator(className, attrName, indicatorName, indicatorDesc, indicatorUnit, lang, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@ManagementEndpoint(OntologyModelController.Operations.CHANGE)
	@PostMapping("/admin/delBucketIndicator")
    @ResponseBody
    public JSONObject delBucketIndicator(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			String attrName = param.getString("attrName").trim();
			String indicatorName = param.getString("indicatorName").trim();
			if (!"".equals(className) && !"".equals(attrName) && !"".equals(indicatorName)) {
				User user = SystemUtils.getCurUser();
				adminService.delBucketIndicator(className, attrName, indicatorName, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@ManagementEndpoint(OntologyModelController.Operations.CHANGE)
	@PostMapping("/admin/editBucketIndicatorDesc")
    @ResponseBody
    public JSONObject editBucketIndicatorDesc(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			String attr = param.getString("attr").trim();
			String indicator = param.getString("indicator").trim();
			String desc = param.getString("desc").trim();
			if (!"".equals(className) && !"".equals(attr) && !"".equals(indicator) && !"".equals(desc)) {
				User user = SystemUtils.getCurUser();
				adminService.setBucketIndicatorDesc(className, attr, indicator, desc, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@ManagementEndpoint(OntologyModelController.Operations.CHANGE)
	@PostMapping("/admin/editBucketIndicatorUnit")
    @ResponseBody
    public JSONObject editBucketIndicatorUnit(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String className = param.getString("className").trim();
			String attr = param.getString("attr").trim();
			String indicator = param.getString("indicator").trim();
			String unit = param.getString("unit").trim();
			if (!"".equals(className) && !"".equals(attr) && !"".equals(indicator)) {
				User user = SystemUtils.getCurUser();
				adminService.setBucketIndicatorUnit(className, attr, indicator, unit, user);
			}
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	@ManagementEndpoint(OntologyModelController.Operations.READ)
	@PostMapping("/admin/getMetas")
    @ResponseBody
    public JSONObject getMetas(@RequestBody JSONObject param) {
		if (param.getBooleanValue("countOnly")) {
			User user = SystemUtils.getCurUser();
			return JSONObject.of("success", true, "data", adminService.countOntologyMetadata(user.getDomainId()));
		}
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			ret.put("success", true);
			ret.put("data", adminService.getJSONRule(user.getDomainId()));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

    @Bean
    WorkbenchPanelRead ontologyMetadataCounts(ManagementRequestAccess management) {
        return new WorkbenchPanelRead("platform:OntologyType", "metadataCounts", (subject, parameters) -> {
            management.require(subject, OntologyModelController.Operations.READ);
            return adminService.countOntologyMetadata(subject.identity().domainId());
        });
    }

    private static final String ONTOLOGY_TYPE = "platform:OntologyType";
    private static final String OBJECT_TYPE = "platform:ObjectType";
    private static final String ATTRIBUTE = "platform:Attribute";
    private static final String RELATIONSHIP = "platform:Relationship";

    // Match the graph's trimmed rule IDs when selecting persisted metadata.
    private static final Pattern RULE_ID_PADDING = Pattern.compile("^[" + ID_PADDING + "]+|[" + ID_PADDING + "]+$");

    @Bean
    WorkbenchPanelRead ontologyModelInstanceDirectory(ManagementRequestAccess management) {
        return new WorkbenchPanelRead(ONTOLOGY_TYPE, "modelInstanceDirectory", (subject, parameters) -> {
            if (!(parameters.get("type") instanceof String type)
                    || !List.of(OBJECT_TYPE, ATTRIBUTE, RELATIONSHIP).contains(type)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected a model instance directory type");
            }
            management.require(subject, OntologyModelController.Operations.READ);
            var rule = adminService.getJSONRule(subject.identity().domainId());
            if (RELATIONSHIP.equals(type)) {
                return JSONObject.of("relationDef", modelRelationships(rule, (id, row) -> true));
            }
            var classes = ruleRows(rule.get("classDef")).map(row -> OBJECT_TYPE.equals(type) ? objectTypeFields(row)
                    : JSONObject.of("className", row.get("className"), "attrs", attributeFields(row, name -> true))).toList();
            return JSONObject.of("classDef", classes);
        });
    }

    record ModelScopeFacts(List<JSONObject> classDef, Object relationDef) {}

    record ModelNeighborFacts(ModelScopeFacts center, Map<String, ModelScopeFacts> relations) {}

    private static final String HAS_ATTRIBUTE = "object-type.has-attribute";

    @Bean
    WorkbenchPanelRead ontologyModelNeighbors(ManagementRequestAccess management) {
        return new WorkbenchPanelRead(ONTOLOGY_TYPE, "modelNeighbors", (subject, parameters) -> {
            if (!(parameters.get("primaryKey") instanceof String id) || id.isEmpty()
                    || !(parameters.get("className") instanceof String type)
                    || !List.of(OBJECT_TYPE, ATTRIBUTE, RELATIONSHIP).contains(type)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid ontology model center");
            }
            var attribute = ATTRIBUTE.equals(type) ? attributeCenterKey(parameters) : null;
            var requested = modelRelations(parameters.get("relations"), type);
            management.require(subject, OntologyModelController.Operations.READ);
            var rule = adminService.getJSONRule(subject.identity().domainId());
            var center = switch (type) {
                case OBJECT_TYPE -> new ModelScopeFacts(modelClasses(rule, id::equals), List.of());
                case ATTRIBUTE -> new ModelScopeFacts(modelAttributes(rule, attribute, false), List.of());
                case RELATIONSHIP -> new ModelScopeFacts(List.of(), modelRelationships(rule, (key, row) -> id.equals(key)));
                default -> throw new IllegalStateException("Unexpected ontology model type");
            };

            var relations = new LinkedHashMap<String, ModelScopeFacts>();
            for (var relation : requested) {
                var facts = HAS_ATTRIBUTE.equals(relation.name())
                        ? modelAttributeEdge(rule, id, attribute, relation.outgoing())
                        : modelRelationshipEdge(rule, id, relation.endpoint(), relation.outgoing());
                relations.put(relation.name(), facts);
            }
            return new ModelNeighborFacts(center, relations);
        });
    }

    private record ModelRelation(String name, boolean outgoing, String endpoint) {}

    private static List<ModelRelation> modelRelations(Object value, String centerType) {
        if (!(value instanceof List<?> relations)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected ontology model relations");
        }
        var selected = new ArrayList<ModelRelation>();
        for (var relation : relations) {
            if (!(relation instanceof Map<?, ?> request) || !(request.get("kind") instanceof String kind)) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid ontology model relation");
            }
            var direction = request.get("direction");
            var scope = switch (kind) {
                case HAS_ATTRIBUTE -> new ModelRelation(kind, modelOutgoing(centerType, direction, OBJECT_TYPE, ATTRIBUTE), null);
                case "relationship.from-object-type" ->
                    new ModelRelation(kind, modelOutgoing(centerType, direction, RELATIONSHIP, OBJECT_TYPE), "fromclass");
                case "relationship.to-object-type" ->
                    new ModelRelation(kind, modelOutgoing(centerType, direction, RELATIONSHIP, OBJECT_TYPE), "toclass");
                default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid ontology model relation");
            };
            selected.add(scope);
        }
        return selected;
    }

    private static boolean modelOutgoing(String centerType, Object direction, String from, String to) {
        if (from.equals(centerType) && "outgoing".equals(direction)) return true;
        if (to.equals(centerType) && "incoming".equals(direction)) return false;
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid ontology relation center");
    }

    private static ModelScopeFacts modelAttributeEdge(Map<String, Object> rule, String id,
            AttributeCenterKey attribute, boolean outgoing) {
        var classes = outgoing
                ? classRows(rule, id::equals).map(row -> {
                    var fields = objectTypeFields(row);
                    fields.put("attrs", attributeFields(row, name -> true));
                    return fields;
                }).toList()
                : modelAttributes(rule, attribute, true);
        return new ModelScopeFacts(classes, List.of());
    }

    private static ModelScopeFacts modelRelationshipEdge(Map<String, Object> rule, String id, String endpoint, boolean outgoing) {
        var endpointIds = new LinkedHashSet<String>();
        var relationships = modelRelationships(rule, (key, row) -> {
            var target = ruleId(row.get(endpoint));
            if (!outgoing) return id.equals(target);
            if (!id.equals(key) || target.isEmpty()) return false;
            endpointIds.add(target);
            return true;
        });
        var classes = outgoing ? modelClasses(rule, endpointIds::contains) : List.<JSONObject>of();
        return new ModelScopeFacts(classes, relationships);
    }

    private record AttributeCenterKey(String className, String name) {}

    private static AttributeCenterKey attributeCenterKey(Map<String, Object> parameters) {
        var key = parameters.get("attributeKey");
        if (key == null) return null;
        if (key instanceof List<?> parts && parts.size() == 2
                && parts.get(0) instanceof String className && parts.get(1) instanceof String name) {
            return new AttributeCenterKey(className, name);
        }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected an attribute key tuple");
    }

    private static Stream<Map<?, ?>> classRows(Map<String, Object> rule, Predicate<String> select) {
        return ruleRows(rule.get("classDef")).filter(row -> select.test(ruleId(row.get("className"))));
    }

    private static List<JSONObject> modelClasses(Map<String, Object> rule, Predicate<String> select) {
        return classRows(rule, select).map(AdminController::objectTypeFields).toList();
    }

    ModelScopeFacts modelObjectTypeEndpoints(String domainId, Set<String> ids) {
        return new ModelScopeFacts(ids.isEmpty() ? List.of() : modelClasses(adminService.getJSONRule(domainId), ids::contains), List.of());
    }

    private static List<JSONObject> modelAttributes(Map<String, Object> rule, AttributeCenterKey key, boolean includeClassLabel) {
        if (key == null) return List.of();
        return classRows(rule, key.className()::equals).map(row -> {
            var fields = includeClassLabel ? objectTypeFields(row) : directoryFields(row, "className");
            fields.put("attrs", attributeFields(row, key.name()::equals));
            return fields;
        }).toList();
    }

    private static JSONObject objectTypeFields(Map<?, ?> row) {
        return directoryFields(row, "className", "showName", "classDesc");
    }

    private static List<JSONObject> attributeFields(Map<?, ?> row, Predicate<String> select) {
        return ruleRows(row.get("attrs")).filter(attr -> select.test(ruleId(attr.get("name"))))
                .map(attr -> directoryFields(attr, "name", "showName")).toList();
    }

    private static Object modelRelationships(Map<String, Object> rule, BiPredicate<String, Map<?, ?>> select) {
        var relationships = rule.get("relationDef");
        if (relationships == null) relationships = rule.get("relations");
        if (relationships == null) relationships = rule.get("relationship_rule");
        if (relationships instanceof Map<?, ?> keyed) {
            var selected = new JSONObject();
            keyed.forEach((id, row) -> {
                if (row instanceof Map<?, ?> fields) {
                    var encoded = ruleId(fields.get("relationship"));
                    if (select.test(encoded.isEmpty() ? ruleId(id) : encoded, fields)) {
                        selected.put((String) id, relationshipFields(fields));
                    }
                }
            });
            return selected;
        }
        return ruleRows(relationships).filter(row -> select.test(ruleId(row.get("relationship")), row))
                .map(AdminController::relationshipFields).toList();
    }

    private static JSONObject relationshipFields(Map<?, ?> row) {
        return directoryFields(row, "relationship", "showName", "relationShowName", "relationshipShowName",
                "desc", "fromclass", "toclass");
    }

    private static Stream<Map<?, ?>> ruleRows(Object value) {
        return value instanceof List<?> rows ? rows.stream().mapMulti((row, select) -> {
            if (row instanceof Map<?, ?> fields) select.accept(fields);
        }) : Stream.empty();
    }

    private static String ruleId(Object value) {
        return value instanceof String id ? RULE_ID_PADDING.matcher(id).replaceAll("") : "";
    }

    private static JSONObject directoryFields(Map<?, ?> source, String... fields) {
        var row = new JSONObject();
        for (String field : fields) {
            if (source.containsKey(field)) row.put(field, source.get(field));
        }
        return row;
    }
	@ManagementEndpoint(OntologyModelController.Operations.READ)
	@PostMapping("/admin/getschemamarkdown")
	@ResponseBody
	public JSONObject getSchemaMarkdown(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			ret.put("success", true);
			ret.put("data", adminService.getSchemaMarkdown(param.getList("classNames", String.class), user.getDomainId()));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	@ManagementEndpoint(OntologyModelController.Operations.READ)
	@PostMapping("/admin/getschemamarkdown-v2")
	@ResponseBody
	public JSONObject getSchemaMarkdownV2(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			ret.put("success", true);
			ret.put("data", adminService.getSchemaMarkdownV2(param.getList("classNames", String.class), user.getDomainId()));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	@ManagementEndpoint(OntologyModelController.Operations.READ)
	@GetMapping("/admin/getDatasetDesc")
	@ResponseBody
	public JSONObject getDatasetDesc() {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			JSONObject rule = adminService.getPrettyJSONRule(user.getDomainId());
			ret.put("success", true);
			ret.put("data", rule.getString("datasetDesc"));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	@ManagementEndpoint(OntologyModelController.Operations.READ)
	@GetMapping("/admin/getAllClassNames")
	@ResponseBody
	public JSONObject getAllClassNames() {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			JSONObject rule = adminService.getPrettyJSONRule(user.getDomainId());
			List<String> classNames = new ArrayList<String>();
			JSONArray classDefs = rule.getJSONArray("classDefs");
			for (int i = 0; i < classDefs.size(); i++) {
				JSONObject classDef = classDefs.getJSONObject(i);
				classNames.add(classDef.getString("name"));
			}
			ret.put("success", true);
			ret.put("data", classNames);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	@ManagementEndpoint(OntologyModelController.Operations.READ)
	@PostMapping("/admin/getSchemaByClassName")
	@ResponseBody
	public JSONObject getSchemaByClassName(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			List<String> classNames = param.getList("classNames", String.class);
			ret.put("success", true);
			ret.put("data", adminService.getSchemaByClassName(classNames, user.getDomainId()));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	@ManagementEndpoint(OntologyModelController.Operations.READ)
	@PostMapping("/admin/getRelationshipByClassNames")
	@ResponseBody
	public JSONObject getRelationshipByClassNames(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			List<String> classNames = param.getList("classNames", String.class);
			ret.put("success", true);
			ret.put("data", adminService.getRelationshipByClassNames(classNames, user.getDomainId()));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@PostMapping("/admin/queryDistinctAttrValue")
	@ResponseBody
	public JSONObject queryDistinctAttrValue(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			UserDataPermission permission = identityService.getCurrentUserDataPermission();
			String className = param.getString("className");
			String attrName = param.getString("attrName");
			String like = param.getString("like");
			Integer limit = param.getInteger("limit");
			ret.put("success", true);
			ret.put("data", adminService.queryDistinctAttrValue(className, attrName, like, limit == null ? 0 : limit, permission, user.getDomainId()));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@ManagementEndpoint(Operations.KNOWLEDGE_CHANGE)
	@PostMapping("/admin/addBussinessKnowledge")
    @ResponseBody
    public JSONObject addBussinessKnowledge(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			// Fields the request leaves out take a new entry's defaults.
			JSONObject values = BussinessKnowledgeForm.values(null, param);
			String knowledgeID = values.getString("knowledgeID");
			String knowledgeTitle = values.getString("knowledgeTitle").trim();
			String bk = values.getString("knowledgeText").trim();
			int status = values.getInteger("status");
			List<String> listknowledgeTags = values.getList("knowledgeTags", String.class);
			// The content is what gets embedded and recalled; an entry without it is refused instead of reported as saved.
			if ("".equals(bk)) {
				throw new Exception(langService.get(lang, "Admin.knowledge.textRequired"));
			}
			User user = SystemUtils.getCurUser();
			String storedID = knowledgeService.addBussinessKnowledge(knowledgeID, knowledgeTitle,bk,status,listknowledgeTags, user);
			ret.put("success", true);
			// A create answers the entry it stored: a page that filled a draft of it records that object for the draft.
			ret.put("data", new JSONObject().fluentPut("id", storedID));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@ManagementEndpoint(Operations.KNOWLEDGE_CHANGE)
	@PostMapping("/admin/editBussinessKnowledge")
    @ResponseBody
    public JSONObject editBussinessKnowledge(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String knowledgeID = param.getString("knowledgeID");
			// Without an ID there is nothing to edit; it is refused instead of reported as saved.
			if (knowledgeID == null || knowledgeID.isBlank()) {
				throw new Exception(langService.get(lang, "Admin.knowledge.idRequired"));
			}
			User user = SystemUtils.getCurUser();
			KnowledgeEntity current = knowledgeService.getBussinessKnowledge(user.getDomainId()).get(knowledgeID);
			if (current == null) {
				throw new Exception("Business knowledge not found in the current domain");
			}
			// Fields the request leaves out keep the entry's current values.
			JSONObject values = BussinessKnowledgeForm.values(current, param);
			String knowledgeTitle = values.getString("knowledgeTitle").trim();
			String bk = values.getString("knowledgeText").trim();
			int status = values.getInteger("status");
			List<String> listknowledgeTags = values.getList("knowledgeTags", String.class);
			if ("".equals(bk)) {
				throw new Exception(langService.get(lang, "Admin.knowledge.textRequired"));
			}
			knowledgeService.editBussinessKnowledge(knowledgeID,knowledgeTitle, bk,status,listknowledgeTags, user);
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@ManagementEndpoint(Operations.KNOWLEDGE_CHANGE)
	@PostMapping("/admin/delBussinessKnowledge")
    @ResponseBody
    public JSONObject delBussinessKnowledge(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang, @RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			String knowledgeID = param.getString("knowledgeID");
			if (knowledgeID == null || knowledgeID.isBlank()) {
				throw new Exception(langService.get(lang, "Admin.knowledge.idRequired"));
			}
			User user = SystemUtils.getCurUser();
			knowledgeService.delBussinessKnowledge(knowledgeID, user);
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@Bean
	WorkbenchPanelRead businessKnowledgePanelCount(ManagementRequestAccess management) {
		return new WorkbenchPanelRead(BussinessKnowledgeForm.OBJECT_TYPE, "count", (subject, parameters) -> {
			management.require(subject, Operations.KNOWLEDGE_READ);
			return Map.of("rows", List.of(), "total", knowledgeService.countBusinessKnowledge(subject.identity().domainId()));
		});
	}

    @Bean
    WorkbenchPanelRead businessKnowledgePanelQuery(ManagementRequestAccess management) {
        return new WorkbenchPanelRead(BussinessKnowledgeForm.OBJECT_TYPE, "query", (subject, parameters) -> {
            management.require(subject, Operations.KNOWLEDGE_READ);
            var entries = new JSONObject();
            readKnowledgeEntries(subject.identity().domainId())
                    .forEach((id, entry) -> entries.put(id, knowledgeEntryFacts(entry)));
            String lang = LocaleContextHolder.getLocale().toLanguageTag();
            return JSONObject.of("entries", entries, "text", BussinessKnowledgeForm.entryText(lang, langService));
        });
    }

    @Bean
    WorkbenchPanelRead businessKnowledgePanelCounts(ManagementRequestAccess management) {
        return new WorkbenchPanelRead(BussinessKnowledgeForm.OBJECT_TYPE, "counts", (subject, parameters) -> {
            management.require(subject, Operations.KNOWLEDGE_READ);
            var entries = readKnowledgeEntries(subject.identity().domainId()).values().stream()
                    .map(AdminController::knowledgeSearchFacts).toList();
            String lang = LocaleContextHolder.getLocale().toLanguageTag();
            return JSONObject.of("entries", entries, "labels", BussinessKnowledgeForm.statusLabels(lang, langService));
        });
    }

    @Bean
    WorkbenchPanelRead businessKnowledgePanelRecord(ManagementRequestAccess management) {
        return new WorkbenchPanelRead(BussinessKnowledgeForm.OBJECT_TYPE, "record", (subject, parameters) -> {
            management.require(subject, Operations.KNOWLEDGE_READ);
            String id = (String) parameters.get("primaryKey");
            var entry = readKnowledgeEntries(subject.identity().domainId()).get(id);
            if (entry == null) throw new OwnerRefusal("KNOWLEDGE_UNAVAILABLE", "Business knowledge " + id + " is not in this domain");
            String lang = LocaleContextHolder.getLocale().toLanguageTag();
            return JSONObject.of("entry", knowledgeEntryFacts(entry), "text", BussinessKnowledgeForm.entryText(lang, langService));
        });
    }

    @Bean
    WorkbenchPanelRead businessKnowledgePanelApprovalStatuses(ManagementRequestAccess management) {
        return new WorkbenchPanelRead(BussinessKnowledgeForm.OBJECT_TYPE, "approvalStatuses", (subject, parameters) -> {
            management.require(subject, Operations.KNOWLEDGE_READ);
            if (!(parameters.get("ids") instanceof List<?> ids) || ids.isEmpty()
                    || ids.stream().anyMatch(id -> !(id instanceof String key) || key.isEmpty()))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Expected nonempty business knowledge ids");
            return knowledgeService.approvalStatuses(subject.identity().domainId(), ids.stream().map(String.class::cast).toList());
        });
    }

    @Bean
    WorkbenchPanelRead businessKnowledgePanelForm(ManagementRequestAccess management) {
        return businessKnowledgeFormRead(management, false);
    }

    @Bean
    WorkbenchPanelRead businessKnowledgePanelCreateForm(ManagementRequestAccess management) {
        return businessKnowledgeFormRead(management, true);
    }

    private WorkbenchPanelRead businessKnowledgeFormRead(ManagementRequestAccess management, boolean draft) {
        return WorkbenchPanelRead.form(BussinessKnowledgeForm.OBJECT_TYPE, draft, (request, lang, subject) -> {
            management.require(subject, Operations.KNOWLEDGE_READ);
            return readKnowledgeForm(lang, subject.identity().domainId(), request);
        });
    }

    private Map<String, KnowledgeEntity> readKnowledgeEntries(String domainId) {
        return knowledgeService.getBussinessKnowledge(domainId);
    }

    private JSONObject readKnowledgeForm(String lang, String domainId, Map<String, Object> request) {
        return BussinessKnowledgeForm.describe(lang, domainId, request, knowledgeService, langService, knowledgeTagConfig);
    }

    private static JSONObject knowledgeSearchFacts(KnowledgeEntity entry) {
        return JSONObject.of("knowledgeTitle", entry.getKnowledgeTitle(), "knowledgeText", entry.getKnowledgeText(),
                "knowledgeTags", entry.getKnowledgeTags(), "status", entry.getStatus());
    }

    private static JSONObject knowledgeEntryFacts(KnowledgeEntity entry) {
        return knowledgeSearchFacts(entry).fluentPut("knowledgeID", entry.getKnowledgeID());
    }
	@ManagementEndpoint(Operations.KNOWLEDGE_READ)
	@PostMapping("/admin/getBussinessKnowledge")
    @ResponseBody
    public JSONObject getBussinessKnowledge(@RequestBody JSONObject param) {
		if (param.getBooleanValue("countOnly")) {
			User user = SystemUtils.getCurUser();
			return JSONObject.of("success", true, "data",
					JSONObject.of("total", knowledgeService.countBusinessKnowledge(user.getDomainId())));
		}
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			Map<String, KnowledgeEntity> bussinessKnowledges = readKnowledgeEntries(user.getDomainId());
			ret.put("success", true);
			ret.put("data", bussinessKnowledges);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	@ManagementEndpoint(Operations.KNOWLEDGE_READ)
	@PostMapping("/admin/bussinessKnowledge/form")
	@ResponseBody
	public JSONObject bussinessKnowledgeForm(@RequestHeader(ControllerConst.LANG_HEADER_KEY) String lang,
			@RequestBody Map<String, Object> param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			ret.put("success", true);
			ret.put("data", readKnowledgeForm(lang, user.getDomainId(), param));
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	@ManagementEndpoint(Operations.KNOWLEDGE_READ)
	@PostMapping("/admin/getbussinessknowledgemarkdown")
	@ResponseBody
	public JSONObject getBussinessKnowledgeMarkdown(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String bussinessKnowledgeMarkdown = adminService.getBussinessKnowledgeMarkdown(user.getDomainId());
			ret.put("success", true);
			ret.put("data", bussinessKnowledgeMarkdown);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	@ManagementEndpoint(OntologyModelController.Operations.READ)
	@GetMapping("/admin/getSchema")
	@ResponseBody
	public JSONObject getSchema() {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			JSONObject rule = adminService.getPrettyJSONRule(user.getDomainId());
			ret.put("success", true);
			ret.put("data", rule);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
	@ManagementEndpoint(OntologyModelController.Operations.CHANGE)
	@PostMapping("/admin/setSchema")
	@ResponseBody
	public JSONObject setSchema(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			adminService.setPrettyJSONRule(param, user.getDomainId());
			ret.put("success", true);
		} catch (Exception e) {
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}
	
}
