package io.ontomato.dataengine.service;

public interface LangService {

    java.util.Set<String> installedLanguages();
	
	public String get(String lang, String key);
	
}
