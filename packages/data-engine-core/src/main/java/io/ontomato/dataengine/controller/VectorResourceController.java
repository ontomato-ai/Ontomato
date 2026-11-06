package io.ontomato.dataengine.controller;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

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

import lombok.extern.slf4j.Slf4j;

@Slf4j
@RestController
public class VectorResourceController {

	@Autowired
	private VectorResourceService vectorResourceService;
	
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
	
	@PostMapping("/vectorResource/delete")
	@ResponseBody
	public JSONObject delete(@RequestBody JSONObject param) {
		JSONObject ret = new JSONObject();
		try {
			User user = SystemUtils.getCurUser();
			String className = param.getString("className");
			String attrName = param.getString("attrName");
			String objectId = param.getString("objectId");
			String path = param.getString("path");
			vectorResourceService.deleteAndDetach(className, attrName, objectId, path, user.getDomainId());
			ret.put("success", true);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@PostMapping("/vectorResource/upload")
	@ResponseBody
	public JSONObject upload(
			@RequestParam(value = "file", required = false) MultipartFile file,
			@RequestParam(value = "content", required = false) String content,
			@RequestParam(value = "className", required = false) String className,
			@RequestParam(value = "attrName", required = false) String attrName,
			@RequestParam(value = "objectId", required = false) String objectId,
			@RequestParam(value = "suffix", required = false) String suffix,
			@RequestParam(value = "items", required = false) String items) {
		if (items != null) {
			if (file != null || content != null || className != null || attrName != null || objectId != null || suffix != null) {
				JSONObject ret = new JSONObject();
				ret.put("success", false);
				ret.put("message", "items uploads text-only resources in a batch and cannot be combined with file, content, className, attrName, objectId or suffix");
				return ret;
			}
			return uploadAll(items);
		}
		JSONObject ret = new JSONObject();
		if (content == null || className == null || attrName == null || objectId == null) {
			ret.put("success", false);
			ret.put("message", "content, className, attrName and objectId are required");
			return ret;
		}
		InputStream is = null;
		try {
			User user = SystemUtils.getCurUser();
			VectorResource resource = new VectorResource();
			resource.setContent(content);
			resource.setClassName(className);
			resource.setAttrName(attrName);
			resource.setObjectId(objectId);
			if (file != null) {
				if (file.isEmpty()) {
					ret.put("success", false);
					ret.put("message", "Uploaded file cannot be empty");
					return ret;
				}
				is = file.getInputStream();
			}
			VectorResource save = vectorResourceService.saveAndAttach(resource, is, suffix, user.getDomainId());
			ret.put("success", true);
			ret.put("data", save);
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		} finally {
			if (is != null) {
				try {
					is.close();
				} catch (Exception e) {
					log.error(e.getMessage(), e);
				}
			}
		}
		return ret;
	}
	
	/**
	 * The batch form of {@code /vectorResource/upload}: {@code items} is a JSON array of text-only
	 * resources {@code {content, className, attrName, objectId}}. Each one succeeds or fails on its
	 * own; {@code data} lists one result per item in order and {@code failed} counts the failures.
	 */
	private JSONObject uploadAll(String items) {
		JSONObject ret = new JSONObject();
		try {
			JSONArray array = JSON.parseArray(items);
			if (array == null || array.isEmpty()) {
				ret.put("success", false);
				ret.put("message", "items must be a non-empty JSON array");
				return ret;
			}
			List<VectorResource> resources = new ArrayList<>(array.size());
			for (int i = 0; i < array.size(); i++) {
				JSONObject item = array.getJSONObject(i);
				VectorResource resource = new VectorResource();
				resource.setContent(item.getString("content"));
				resource.setClassName(item.getString("className"));
				resource.setAttrName(item.getString("attrName"));
				resource.setObjectId(item.getString("objectId"));
				resources.add(resource);
			}
			User user = SystemUtils.getCurUser();
			List<JSONObject> results = vectorResourceService.saveAndAttachAll(resources, user.getDomainId());
			ret.put("success", true);
			ret.put("data", results);
			ret.put("failed", results.stream().filter(result -> !result.getBooleanValue("success")).count());
		} catch (Exception e) {
			log.error(e.getMessage(), e);
			ret.put("success", false);
			ret.put("message", e.getMessage());
		}
		return ret;
	}

	@GetMapping("/vectorResource/resource/{indexName}/{fileName}")
	public ResponseEntity<Resource> download(@PathVariable String indexName, @PathVariable String fileName) {
		Resource resource = new FileSystemResource(vectorResourceService.getFile(indexName, fileName));
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
