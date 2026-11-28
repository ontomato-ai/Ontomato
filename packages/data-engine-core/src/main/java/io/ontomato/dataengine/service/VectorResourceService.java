package io.ontomato.dataengine.service;

import java.io.File;
import java.io.InputStream;
import java.util.List;

import com.alibaba.fastjson2.JSONObject;

import io.ontomato.dataengine.bean.VectorResource;

public interface VectorResourceService {

	public void rebuildIndex(String className, String attrName, String domainId);
	
	public VectorResource save(VectorResource vectorResource, InputStream is, String suffix, String domainId);
	
	/**
	 * Save the vector resource and attach it to the business object's vector attribute.
	 *
	 * <p>In addition to {@link #save} (write the file + vector table), this reads the object's
	 * current vector attribute, appends a new {@code {"path":...,"text":...}} entry (deduplicated
	 * by path) and writes it back via {@code updateObjects}.</p>
	 */
	public VectorResource saveAndAttach(VectorResource vectorResource, InputStream is, String suffix, String domainId);

	/**
	 * Save and attach several text-only resources, as {@link #saveAndAttach} does for each one, with
	 * the vectors embedded in batches. Each resource succeeds or fails on its own: the result has one
	 * entry per input, in input order, either {@code {index, success:true, data}} or
	 * {@code {index, success:false, message}}; a failed one leaves nothing stored.
	 */
	public List<JSONObject> saveAndAttachAll(List<VectorResource> vectorResources, String domainId);

	/**
	 * Delete a vector resource (by object id + path) and detach it from the business object's vector attribute.
	 *
	 * <p>Removes the vector table record and file, then drops the matching {@code {"path":...,"text":...}}
	 * entry from the object's vector attribute and writes it back.</p>
	 */
	public void deleteAndDetach(String className, String attrName, String objectId, String path, String domainId);

	public File getFile(String indexName, String fileName);
	
}
