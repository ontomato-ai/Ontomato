package io.ontomato.dataengine.service;

import java.util.List;
import io.ontomato.dataengine.service.authorization.DefinitionFirstPublication.Selection;

import com.alibaba.fastjson2.JSONObject;
import io.ontomato.dataengine.bean.function.Function;

public interface FunctionService {

	default Function save(Function function, String lang) throws Exception {
        return save(function, lang, null);
    }

    Function save(Function function, String lang, Selection publication) throws Exception;
	
	/** Deletes a Function of this domain; one that is not in it is left alone, as a missing one is. */
	public void delete(String id, String domainId, String lang) throws Exception;

	/**
	 * Why the owner would refuse to delete this domain's Function, in the reader's language, or null when it may be deleted.
	 * The same rule the delete applies; a Function not in this domain does not exist.
	 */
	public String deleteRefusal(String id, String domainId, String lang);
	
	public Function queryById(String id);
	
	public List<Function> queryList(String operation, String className, String domainId);

	/** The owner's form description for a Function, or a field error for an incoming draft. */
	public JSONObject form(JSONObject request, String lang, String domainId);
	
}
