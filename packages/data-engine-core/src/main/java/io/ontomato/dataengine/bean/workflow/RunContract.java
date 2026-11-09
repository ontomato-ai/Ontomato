package io.ontomato.dataengine.bean.workflow;

import java.util.List;

import lombok.Data;

/**
 * How a process's runs are read, declared by the process instead of assumed by the platform.
 *
 * <p>A run is an ordinary fact-layer object: each business defines its own class, with its own fields.
 * The platform must not force one shape on them — an approval chain, a task queue and a parallel review
 * do not share a schema, and a single fixed table would either be too narrow to describe them or
 * dissolve into attribute-per-row storage nothing can index.</p>
 *
 * <p>What the platform does need is a way to ask the same few questions of any run: which object is it,
 * which step is it at, is it open, and who owns it. This contract is that answer — a <em>projection</em>,
 * not a schema. It names where those four things live in the business's own class; it does not dictate
 * what else the class contains.</p>
 *
 * <p>Declaring it is optional. A process without a contract still runs; it simply is not offered the
 * generic read capabilities (a "my pending items" view, progress inspection) that need to know where the
 * lifecycle lives. Declaring it and getting a field name wrong is worse than not declaring it, which is
 * why activation verifies every name against the class definition.</p>
 */
@Data
public class RunContract {

    /** The fact-layer class a run of this process is stored as. */
    private String className;

    /** The attribute holding the run's identity. Defaults to {@code id}; declared when it differs. */
    private String idField;

    /** The attribute naming the step the run currently waits at. */
    private String stepField;

    /** The attribute holding the run's lifecycle state. */
    private String statusField;

    /** The values of {@link #statusField} that mean "still open, someone may act". */
    private List<String> statusOpen;

    /** The values that mean the run finished successfully. */
    private List<String> statusDone;

    /** The values that mean the run was refused or abandoned. */
    private List<String> statusRejected;

    /** The attribute holding the single subject the run is assigned to, when it is assigned to one. */
    private String assigneeField;

    /** The attribute holding a claimable pool, when work waits for someone to take it instead. */
    private String candidateField;

    /** The attribute naming the process a run belongs to, when several processes share one class. */
    private String workflowRefField;

    /**
     * Fill in what may be defaulted, and treat blanks as absent.
     *
     * <p>Normalising here rather than at every read site keeps one rule: a blank field name is the same
     * as an undeclared one, and a missing identity field means {@code id}. Every consumer can then rely
     * on non-blank values without repeating the fallbacks.</p>
     */
    public RunContract normalized() {
        if (idField == null || idField.isBlank()) idField = "id";
        else idField = idField.trim();
        className = trimToNull(className);
        stepField = trimToNull(stepField);
        statusField = trimToNull(statusField);
        assigneeField = trimToNull(assigneeField);
        candidateField = trimToNull(candidateField);
        workflowRefField = trimToNull(workflowRefField);
        statusOpen = normalizeValues(statusOpen);
        statusDone = normalizeValues(statusDone);
        statusRejected = normalizeValues(statusRejected);
        return this;
    }

    /** The statuses that mean the run still needs someone to act. */
    public List<String> openStatuses() {
        return statusOpen == null ? List.of() : statusOpen;
    }

    private static String trimToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static List<String> normalizeValues(List<String> values) {
        if (values == null) return List.of();
        return values.stream()
                .map(RunContract::trimToNull)
                .filter(value -> value != null)
                .distinct()
                .toList();
    }
}
