package io.ontomato.dataengine.dao;

import static org.junit.jupiter.api.Assertions.*;
import java.io.IOException;
import java.nio.file.DirectoryNotEmptyException;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;
import io.ontomato.dataengine.test.PostgresTestDatabase;

class VectorResourcePostgresBoundaryTest extends PostgresTestDatabase {
    @TempDir Path directory;
    private final Path conf = Path.of("conf");
    private boolean createdConf;

    @BeforeEach
    void prepareFileRoot() throws IOException {
        // The DAO prefixes dirName with conf/. Even a path containing ../ needs that parent to exist.
        try {
            Files.createDirectory(conf);
            createdConf = true;
        } catch (FileAlreadyExistsException existing) {
            if (!Files.isDirectory(conf)) throw existing;
        }
    }

    @AfterEach
    void removeOwnedFileRoot() throws IOException {
        if (createdConf) {
            try {
                Files.deleteIfExists(conf);
            } catch (DirectoryNotEmptyException occupied) {
                // Another test's files are not ours to remove.
            }
        }
    }

    @Test
    void clearAndClearDomainRemoveOnlyTheirTablesAndFiles() throws Exception {
        VectorResourceDao dao = wire(new VectorResourceDao());
        String relativeDirectory = conf.toAbsolutePath().relativize(directory).toString();
        assertTrue(Files.isSameFile(conf.resolve(relativeDirectory), directory), "The DAO must reach the temporary file root");
        ReflectionTestUtils.setField(dao, "dirName", relativeDirectory);
        for (String table : List.of("vector-_one-photos-d1", "vector-_two-photos-d1", "vector-_one-photos-d2")) {
            jdbc.execute("CREATE TABLE \"" + table + "\" (id TEXT)");
            jdbc.update("INSERT INTO \"" + table + "\" VALUES ('kept')");
            Files.writeString(Files.createDirectory(directory.resolve(table)).resolve("one.txt"), "kept");
        }
        dao.clear("/one", "photos", "d1");
        assertFalse(tableExists("vector-_one-photos-d1"), "clear must remove the target table");
        assertFalse(Files.exists(directory.resolve("vector-_one-photos-d1")), "clear must remove the target directory");
        assertTrue(tableExists("vector-_two-photos-d1"));
        dao.clearByDomain("d1");
        assertFalse(tableExists("vector-_two-photos-d1"));
        assertFalse(Files.exists(directory.resolve("vector-_two-photos-d1")));
        assertEquals("kept", Files.readString(directory.resolve("vector-_one-photos-d2/one.txt")));
        assertEquals("kept", jdbc.queryForObject("SELECT id FROM \"vector-_one-photos-d2\"", String.class));
    }

    boolean tableExists(String name) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?",
                Integer.class, name) > 0;
    }
}
