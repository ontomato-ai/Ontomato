package io.ontomato.dataengine.migration;

import java.util.Comparator;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import lombok.extern.slf4j.Slf4j;

/**
 * Runs the pending {@link DataEngineMigration}s once at startup and records each in
 * {@code data_engine_migration}. A failing migration fails the startup, as an unmet schema would fail
 * the requests that need it. Each migration runs in one transaction holding an advisory lock, so two
 * instances starting together run it once.
 */
@Slf4j
@Component
public class DataEngineMigrationRunner implements ApplicationRunner {

	static final String TABLE = "data_engine_migration";

	private static final long LOCK_KEY = 0x6f6e746f6d69L;

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Autowired
	private TransactionTemplate transactions;

	@Autowired(required = false)
	private List<DataEngineMigration> migrations = List.of();

	@Override
	public void run(ApplicationArguments args) {
		jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS " + TABLE
				+ " (id VARCHAR(128) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
		List<DataEngineMigration> ordered = migrations.stream().sorted(Comparator.comparing(DataEngineMigration::id)).toList();
		for (DataEngineMigration migration : ordered) {
			transactions.executeWithoutResult(status -> {
				jdbcTemplate.execute("SELECT pg_advisory_xact_lock(" + LOCK_KEY + ")");
				Integer applied = jdbcTemplate.queryForObject("SELECT count(*) FROM " + TABLE + " WHERE id = ?",
						Integer.class, migration.id());
				if (applied != null && applied > 0) {
					return;
				}
				long start = System.currentTimeMillis();
				log.info("Running data engine migration {}", migration.id());
				migration.run();
				jdbcTemplate.update("INSERT INTO " + TABLE + " (id) VALUES (?)", migration.id());
				log.info("Data engine migration {} done in {} ms", migration.id(), System.currentTimeMillis() - start);
			});
		}
	}
}
