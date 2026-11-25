package io.ontomato.dataengine.service.vector;

public class VectorNotReadyException extends IllegalStateException {
    public static final String MESSAGE_KEY = "Vector.rebuildRequired";

    public VectorNotReadyException(String message) {
        super(message);
    }
}
