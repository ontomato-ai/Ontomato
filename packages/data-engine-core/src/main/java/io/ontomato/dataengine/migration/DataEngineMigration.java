package io.ontomato.dataengine.migration;

/**
 * One change to the data engine's own tables that runs once per database. {@link DataEngineMigrationRunner}
 * runs the pending ones at startup in {@link #id()} order and records each one after it succeeds, so a
 * later start skips it. A migration must be safe to run again: a failure before the record is written
 * runs it again on the next start.
 */
public interface DataEngineMigration {

	/** Unique and sortable, such as {@code 20261106-vector-resource-hnsw-index}. */
	String id();

	void run();
}
