package io.ontomato.dataengine.service;

/** Grant records carried by the edition principal lookup. */
public final class ProductGrants {
    private ProductGrants() {}
    public record Grant(String principalKind,String principalId,String verb) {}
}
