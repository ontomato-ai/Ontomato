package io.ontomato.dataengine.service;

/** The platform panel and projection ID namespace defined by the product record contract. */
public final class BuiltinProductIds {
    private static final String PREFIX = "builtin-product-";
    private static final int MAX_LENGTH = 200;

    private BuiltinProductIds() {}

    public static boolean isReserved(String id) {
        return id != null && id.startsWith(PREFIX);
    }

    public static boolean isValid(String id) {
        return isReserved(id) && id.length() > PREFIX.length() && id.length() <= MAX_LENGTH;
    }
}
