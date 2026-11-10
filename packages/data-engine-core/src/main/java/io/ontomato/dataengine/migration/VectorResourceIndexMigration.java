package io.ontomato.dataengine.migration;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import io.ontomato.dataengine.dao.VectorResourceDao;

/**
 * Give the vector resource tables created before searches used HNSW their index. A table gets one
 * index per dimension count it stores (a pending rebuild leaves two); an empty table gets its index on
 * its first write, as new tables do.
 */
@Component
public class VectorResourceIndexMigration implements DataEngineMigration {

	@Autowired
	private VectorResourceDao vectorResourceDao;

	@Override
	public String id() {
		return "20261106-vector-resource-hnsw-index";
	}

	@Override
	public void run() {
		for (String table : vectorResourceDao.listAllTables()) {
			for (Integer dimensions : vectorResourceDao.storedDimensions(table)) {
				vectorResourceDao.ensureVectorIndex(table, dimensions);
			}
		}
	}
}
