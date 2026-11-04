package io.ontomato.dataengine.service.vector;

import io.ontomato.dataengine.dao.VectorRebuildState;

import lombok.Data;

/** The vectorRebuildStatus response data: the domain's vector state as the page shows it. */
@Data
public class VectorRebuildStatus {

    public enum State {
        READY, PENDING, RUNNING,
        /** A pause was requested; the run stops after its current item. */
        PAUSING,
        PAUSED, FAILED,
        /** The round was running when the service stopped; nothing resumes it automatically. */
        INTERRUPTED
    }

    private boolean configured = true;
    private State state;
    /** Rows of this domain that need a vector. */
    private Integer total;
    /** Rows that already hold a vector of the current round. */
    private Integer done;
    /** Where and why the latest round failed; null unless FAILED. */
    private VectorRebuildState.Failure error;

    /** No model is a valid domain state, with no rebuild progress to report. */
    public static VectorRebuildStatus unconfigured() {
        VectorRebuildStatus status = new VectorRebuildStatus();
        status.setConfigured(false);
        return status;
    }

}
