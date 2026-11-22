package io.ontomato.dataengine.service;

@FunctionalInterface
public interface LangService {

    default java.util.Set<String> installedLanguages() {
        throw new UnsupportedOperationException("This translator does not load language packs");
    }
	
	public String get(String lang, String key);
	
}
