package io.ontomato.dataengine.controller;

import io.ontomato.dataengine.service.authorization.ManagementRequestAccess.Owned;

import io.ontomato.dataengine.service.DataSandboxService;
import io.ontomato.dataengine.service.WriteFunctionOperationService;
import io.ontomato.dataengine.service.IdentityService;
import io.ontomato.dataengine.service.ExecutionTarget;
import io.ontomato.dataengine.service.QueryGrantService;
import io.ontomato.dataengine.service.authorization.ManagementEndpoint;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.nio.file.Path;
import java.io.InputStream;
import java.util.ArrayList;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.VectorResource;
import io.ontomato.dataengine.core.bean.User;
import io.ontomato.dataengine.service.VectorResourceService;
import io.ontomato.dataengine.util.SystemUtils;

@RestController
@Owned
public class VectorResourceController {
    @Autowired private WriteFunctionOperationService writes;
    @Autowired private IdentityService identity;


	@Autowired
	private VectorResourceService vectorResourceService;
	
	@ManagementEndpoint(BusinessConfigController.VECTORS_CHANGE)
	@PostMapping("/vectorResource/rebuildIndex")
	@ResponseBody
	public JSONObject rebuildIndex(@RequestBody JSONObject param) {
		User user = SystemUtils.getCurUser();
		JSONObject ret = new JSONObject();
		String className = param.getString("className");
		String attrName = param.getString("attrName");
		vectorResourceService.rebuildIndex(className, attrName, user.getDomainId());
		ret.put("success", true);
		return ret;
	}
	@PreviewAccess
	@PostMapping("/vectorResource/delete")
	@ResponseBody
	public JSONObject delete(@RequestBody JSONObject param, HttpServletRequest request) throws Exception {
        var execution = vectorWrite(request);
        String className = requiredText(param, "className");
        String attrName = requiredText(param, "attrName");
        String objectId = requiredText(param, "objectId");
        String path = requiredText(param, "path");
        execution.target().requireClasses(List.of(className));
        if (execution.target().testing()) {
            writes.deleteVector(className, attrName, objectId, Path.of(path).getFileName().toString(),
                    execution.target().sandboxId(), execution.domainId());
        } else {
            vectorResourceService.deleteAndDetach(className, attrName, objectId, path, execution.domainId());
        }
        return JSONObject.of("success", true);
    }
	@PreviewAccess
	@PostMapping("/vectorResource/upload")
	@ResponseBody
	public JSONObject upload(
			@RequestParam(value = "file", required = false) MultipartFile file,
			@RequestParam(value = "content", required = false) String content,
			@RequestParam(value = "className", required = false) String className,
			@RequestParam(value = "attrName", required = false) String attrName,
			@RequestParam(value = "objectId", required = false) String objectId,
			@RequestParam(value = "suffix", required = false) String suffix,
			@RequestParam(value = "items", required = false) String items, HttpServletRequest request) throws Exception {
        var execution = vectorWrite(request);
        var target = execution.target();
        if (items != null) {
            if (target.testing()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Only single-resource uploads are supported in a sandbox");
            if (file != null || content != null || className != null || attrName != null || objectId != null || suffix != null)
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Batch uploads accept only items");
            return uploadAll(items, execution);
        }
        if (content == null || className == null || attrName == null || objectId == null)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "content, className, attrName and objectId are required");
        target.requireClasses(List.of(className));
        if (file != null && file.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Uploaded file cannot be empty");
        try (InputStream stream = file == null ? null : file.getInputStream()) {
            VectorResource saved;
            if (target.testing()) {
                saved = writes.appendVectorAndReturn(className, attrName, objectId, content, stream, suffix,
                        target.sandboxId(), execution.domainId());
            } else {
                var resource = new VectorResource();
                resource.setContent(content);
                resource.setClassName(className);
                resource.setAttrName(attrName);
                resource.setObjectId(objectId);
                saved = vectorResourceService.saveAndAttach(resource, stream, suffix, execution.domainId());
            }
            return JSONObject.of("success", true, "data", saved);
        }
    }

    private record VectorWrite(String domainId, ExecutionTarget target) {}

    private VectorWrite vectorWrite(HttpServletRequest request) {
        if (request.getAttribute(QueryGrantService.ATTRIBUTE) instanceof JSONObject claims) {
            if (!QueryGrantService.isActionExecution(claims))
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "An action execution grant is required");
            return new VectorWrite(claims.getString("domainId"), QueryGrantService.target(claims));
        }
        var target = ExecutionTarget.LIVE;
        if (!target.testing())
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "An action execution grant is required for live writes");
        return new VectorWrite(identity.getCurrentUser().getDomainId(), target);
    }

	/**
	 * The batch form of {@code /vectorResource/upload}: {@code items} is a JSON array of text-only
	 * resources {@code {content, className, attrName, objectId}}. Each one succeeds or fails on its
	 * own; {@code data} lists one result per item in order and {@code failed} counts the failures.
	 */
    private JSONObject uploadAll(String items, VectorWrite execution) {
        JSONArray array;
        try {
            array = JSON.parseArray(items);
        } catch (com.alibaba.fastjson2.JSONException invalid) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "items must be a non-empty JSON array", invalid);
        }
        if (array == null || array.isEmpty())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "items must be a non-empty JSON array");
        List<VectorResource> resources = new ArrayList<>(array.size());
        for (int i = 0; i < array.size(); i++) {
            if (!(array.get(i) instanceof java.util.Map<?, ?>))
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Each item must be an object");
            JSONObject item = array.getJSONObject(i);
            var resource = new VectorResource();
            resource.setContent(requiredText(item, "content"));
            resource.setClassName(requiredText(item, "className"));
            resource.setAttrName(requiredText(item, "attrName"));
            resource.setObjectId(requiredText(item, "objectId"));
            execution.target().requireClasses(List.of(resource.getClassName()));
            resources.add(resource);
        }
        List<JSONObject> results = vectorResourceService.saveAndAttachAll(resources, execution.domainId());
        return JSONObject.of("success", true, "data", results,
                "failed", results.stream().filter(result -> !result.getBooleanValue("success")).count());
    }

    private String requiredText(JSONObject body,String key) {
      if(!(body.get(key) instanceof String value) || value.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, key + ": expected a nonempty string");
      return value;
    }

	@GetMapping("/vectorResource/resource/{indexName}/{fileName}")
	public ResponseEntity<Resource> download(@PathVariable String indexName, @PathVariable String fileName) {
		User user = identity.getCurrentUser();
        if (user == null || user.getDomainId() == null)
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "A domain credential is required");
        identity.getCurrentCredentialExpiresAt();
        Resource resource = new FileSystemResource(vectorResourceService.getFile(indexName, fileName,
                user.getDomainId(), identity.getCurrentUserDataPermission()));
		if (resource.exists() && resource.isReadable()) {
            return ResponseEntity.ok()
                    .contentType(determineContentType(fileName))
                    .body(resource);
        } else {
            return ResponseEntity.notFound().build();
        }
	}
	
	private MediaType determineContentType(String filename) {
        String extension = filename.substring(filename.lastIndexOf(".") + 1).toLowerCase();
        return switch (extension) {
            case "txt" -> MediaType.parseMediaType("text/plain; charset=UTF-8");
            case "jpg", "jpeg" -> MediaType.IMAGE_JPEG;
            case "png" -> MediaType.IMAGE_PNG;
            case "gif" -> MediaType.IMAGE_GIF;
            case "pdf" -> MediaType.APPLICATION_PDF;
            default -> MediaType.APPLICATION_OCTET_STREAM;
        };
    }
	
	
}
