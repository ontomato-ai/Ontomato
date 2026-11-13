package io.ontomato.dataengine.migration;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import io.ontomato.dataengine.dao.VectorResourceDao;

/** Add binary HNSW indexes for previously stored resource vectors above 4000 dimensions. */
@Component
public class VectorResourceBinaryIndexMigration implements DataEngineMigration {

    @Autowired
    private VectorResourceDao vectorResourceDao;

    @Override
    public String id() {
        return "20261113-vector-resource-binary-hnsw-index";
    }

    @Override
    public void run() {
        for (String table : vectorResourceDao.listAllTables()) {
            for (Integer dimensions : vectorResourceDao.storedDimensions(table)) {
                if (dimensions != null && dimensions > VectorResourceDao.HNSW_MAX_DIMENSIONS) {
                    vectorResourceDao.ensureVectorIndex(table, dimensions);
                }
            }
        }
    }
}
