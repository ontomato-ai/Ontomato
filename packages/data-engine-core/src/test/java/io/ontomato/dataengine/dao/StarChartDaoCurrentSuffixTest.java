package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The record of a domain's last complete star chart generation is a file beside the data files: a new process reads
 * what an earlier one recorded, and a domain that never completed a generation has no record.
 */
class StarChartDaoCurrentSuffixTest {

	/** A domain no real data uses, so the record below is this test's own. */
	private final String domainId = "test-" + UUID.randomUUID();
	private final Path dir = Paths.get("conf", "starChart").toAbsolutePath();
	private final Path record = dir.resolve("current-" + domainId + ".txt");
	/** Directories this test had to create, outermost first; removed afterwards when empty. */
	private final List<Path> createdDirs = new ArrayList<>();

	@BeforeEach
	void noteMissingDirectories() {
		for (Path path = dir; !Files.exists(path); path = path.getParent()) {
			createdDirs.add(0, path);
		}
	}

	@AfterEach
	void removeOnlyWhatThisTestCreated() throws IOException {
		Files.deleteIfExists(record);
		Files.deleteIfExists(dir.resolve(record.getFileName() + ".tmp"));
		for (int i = createdDirs.size() - 1; i >= 0; i--) {
			Path path = createdDirs.get(i);
			if (!Files.isDirectory(path)) {
				continue;
			}
			try (var entries = Files.list(path)) {
				if (entries.findAny().isEmpty()) {
					Files.delete(path);
				}
			}
		}
	}

	@Test
	void aDomainWithoutACompleteGenerationHasNoRecord() {
		assertNull(new StarChartDao().readCurrentSuffix(domainId));
	}

	@Test
	void aNewProcessReadsTheLastRecordedSuffix() {
		new StarChartDao().writeCurrentSuffix("A", domainId);
		new StarChartDao().writeCurrentSuffix("B", domainId);

		assertEquals("B", new StarChartDao().readCurrentSuffix(domainId));
		// The record is replaced by a rename: nothing of the write is left beside it.
		assertFalse(Files.exists(dir.resolve(record.getFileName() + ".tmp")));
	}
}
