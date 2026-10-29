package io.ontomato.dataengine.dao;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONArray;
import com.alibaba.fastjson2.JSONObject;
import com.alibaba.fastjson2.JSONWriter.Feature;
import com.pgvector.PGvector;
import io.ontomato.dataengine.bean.function.Function;
import io.ontomato.dataengine.bean.function.Parameter;
import io.ontomato.dataengine.bean.metricView.MetricView;
import io.ontomato.dataengine.bean.metricView.MetricViewBinding;
import io.ontomato.dataengine.bean.metricView.OriginCheckResult;
import io.ontomato.dataengine.service.ai.EmbeddingService;
import io.ontomato.dataengine.service.vector.VectorRetrievalGate;
import io.ontomato.dataengine.util.AutoKMeansClusteringUtil;

import dev.langchain4j.data.embedding.Embedding;
import dev.langchain4j.model.output.Response;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component("metricViewDao")
public class MetricViewDao extends BaseDao {

	@Autowired
	private JdbcTemplate jdbcTemplate;

	@Autowired
	private AssetLookupPolicy assetLookupPolicy;

	@Autowired
	private EmbeddingService embeddingService;

	@Autowired
	private VectorRetrievalGate retrievalGate;

	private static final String TABLE_NAME = "metric_view";

	private static final String COLUMNS = "id, name, origin, type, function_id, description, status, match_questions, class_names, domain_id, create_timestamp, modify_timestamp, origin_check_result, origin_question";

	@PostConstruct
	public void initIndex() {
		try {
			jdbcTemplate.execute("CREATE EXTENSION IF NOT EXISTS vector");
		} catch (Exception e) {
			log.warn(">>>Cannot create pgvector extension: {}", e.getMessage());
		}
		jdbcTemplate.execute(
				"CREATE TABLE IF NOT EXISTS " + TABLE_NAME + " ("
						+ "id VARCHAR(64) PRIMARY KEY, "
						+ "name VARCHAR(255), "
						+ "origin VARCHAR(32), "
						+ "type VARCHAR(32) DEFAULT 'GENERAL', "
						+ "function_id VARCHAR(64), "
						+ "description TEXT, "
						+ "status VARCHAR(64), "
						+ "match_questions TEXT, "
						+ "class_names TEXT, "
						+ "domain_id VARCHAR(64), "
						+ "create_timestamp BIGINT, "
						+ "modify_timestamp BIGINT, "
						+ "origin_check_result TEXT, "
						+ "origin_question TEXT, "
						+ "brief TEXT, "
						+ "brief_vector vector"
						+ ")");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_" + TABLE_NAME + "_domain_id ON " + TABLE_NAME + "(domain_id)");
        jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS metric_view_binding ("
            + "id VARCHAR(64) PRIMARY KEY, metric_view_id VARCHAR(64) NOT NULL REFERENCES metric_view(id) ON DELETE CASCADE, "
            + "name VARCHAR(255), description TEXT, parameters JSONB NOT NULL CHECK(jsonb_typeof(parameters)='object'), "
            + "match_questions TEXT, brief TEXT, brief_vector vector)");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_metric_view_binding_owner ON metric_view_binding(metric_view_id)");
	}

	public MetricView save(MetricView metricView) {
		if (metricView.getId() == null) {
			metricView.setId(UUID.randomUUID().toString());
		}
		Long now = System.currentTimeMillis();
		if (metricView.getCreateTimestamp() == null) {
			metricView.setCreateTimestamp(now);
		}
		metricView.setModifyTimestamp(now);
		Function function = metricView.getFunction();
		String domainId = function.getDomainId();

		String classNamesStr = buildClassNamesStr(function);
		String brief = buildBrief(metricView.getName(), metricView.getDescription(), metricView.getMatchQuestions());

		retrievalGate.write(domainId, () -> {
			PGvector pgVector = new PGvector(embeddingService.embedding(brief, domainId).content().vector());
			int changed = jdbcTemplate.update(
				"INSERT INTO " + TABLE_NAME + " (" + COLUMNS + ", brief, brief_vector) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::vector) "
						+ "ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, origin = EXCLUDED.origin, type = EXCLUDED.type, "
						+ "function_id = EXCLUDED.function_id, description = EXCLUDED.description, status = EXCLUDED.status, "
						+ "match_questions = EXCLUDED.match_questions, class_names = EXCLUDED.class_names, "
						+ "domain_id = EXCLUDED.domain_id, create_timestamp = EXCLUDED.create_timestamp, "
						+ "modify_timestamp = EXCLUDED.modify_timestamp, origin_check_result = EXCLUDED.origin_check_result, "
						+ "origin_question = EXCLUDED.origin_question, brief = EXCLUDED.brief, brief_vector = EXCLUDED.brief_vector WHERE metric_view.domain_id = EXCLUDED.domain_id",
				metricView.getId(), metricView.getName(), metricView.getOrigin(), "GENERAL",
				function.getId(), metricView.getDescription(), metricView.getStatus(),
				JSON.toJSONString(metricView.getMatchQuestions(), Feature.WriteMapNullValue),
				classNamesStr, metricView.getDomainId(), metricView.getCreateTimestamp(), metricView.getModifyTimestamp(),
				metricView.getOriginCheckResult() == null ? null : JSON.toJSONString(metricView.getOriginCheckResult(), Feature.WriteMapNullValue),
				metricView.getOriginQuestion(), brief, pgVector);
            if (changed != 1) throw new IllegalArgumentException("MetricView not found");
            saveBindings(metricView);
            return null;
		});
		return metricView;
	}

	private String buildClassNamesStr(Function function) {
		Set<String> classNames = new HashSet<String>();
		if (function != null) {
			List<Parameter> parameters = function.getParameters();
			if (parameters != null) {
				for (Parameter parameter : parameters) {
					if (parameter.getClassNames() != null && parameter.getClassNames().size() > 0) {
						classNames.addAll(parameter.getClassNames());
					}
				}
			}
			if (function.getReturnDef() != null && function.getReturnDef().getClassNames() != null) {
				classNames.addAll(function.getReturnDef().getClassNames());
			}
		}
		StringBuilder sb = new StringBuilder(",");
		for (String className : classNames) {
			sb.append(className).append(",");
		}
		return sb.toString();
	}

	/** The single source of the embedded text, shared by the write path and the vector rebuild. */
	private static String buildBrief(String name, String description, Collection<String> matchQuestions) {
		StringBuilder brief = new StringBuilder();
		brief.append(name).append("\n");
		if (description != null) {
			brief.append(description).append("\n");
		}
		if (matchQuestions != null) {
			for (String q : matchQuestions) {
				brief.append(q).append("\n");
			}
		}
		return brief.toString();
	}

	public void delete(String id, String domainId) {
		jdbcTemplate.update("DELETE FROM " + TABLE_NAME + " WHERE id = ? AND domain_id = ? AND type = 'GENERAL'", id, domainId);
	}

	public int countDomainRows(String domainId) {
		return jdbcTemplate.queryForObject(
				"SELECT (SELECT COUNT(*) FROM metric_view WHERE domain_id=?) + (SELECT COUNT(*) FROM metric_view_binding b JOIN metric_view m ON m.id=b.metric_view_id WHERE m.domain_id=?)", Integer.class, domainId, domainId);
	}

	public int countDomainPending(String domainId) {
		return jdbcTemplate.queryForObject(
				"SELECT (SELECT COUNT(*) FROM metric_view WHERE domain_id=? AND brief_vector IS NULL) + (SELECT COUNT(*) FROM metric_view_binding b JOIN metric_view m ON m.id=b.metric_view_id WHERE m.domain_id=? AND b.brief_vector IS NULL)",
                Integer.class, domainId, domainId);
	}

    public List<VectorRebuildItem> listDomainPending(String domainId) {
        return jdbcTemplate.query("SELECT 'metric:' || id AS id,name,description,match_questions FROM metric_view WHERE domain_id=? AND brief_vector IS NULL "
            + "UNION ALL SELECT 'binding:' || b.id,b.name,b.description,b.match_questions FROM metric_view_binding b JOIN metric_view m ON m.id=b.metric_view_id "
            + "WHERE m.domain_id=? AND b.brief_vector IS NULL",
            (rs,n) -> new VectorRebuildItem(rs.getString("id"), buildBrief(rs.getString("name"), rs.getString("description"), parseMatchQuestions(rs.getString("match_questions")))), domainId, domainId);
    }

    public void clearDomainVectors(String domainId) {
        jdbcTemplate.update("UPDATE metric_view SET brief_vector=NULL WHERE domain_id=?", domainId);
        jdbcTemplate.update("UPDATE metric_view_binding SET brief_vector=NULL WHERE metric_view_id IN (SELECT id FROM metric_view WHERE domain_id=?)", domainId);
    }

    public void fillDomainVector(String id, String brief, float[] vector) {
        boolean binding = id.startsWith("binding:");
        String table = binding ? "metric_view_binding" : "metric_view";
        String key = id.substring(binding ? 8 : 7);
        jdbcTemplate.update("UPDATE " + table + " SET brief=?,brief_vector=?::vector WHERE id=? AND brief_vector IS NULL", brief, new PGvector(vector), key);
    }

	private static List<String> parseMatchQuestions(String matchQuestionsJson) {
		if (matchQuestionsJson == null) {
			return new ArrayList<>();
		}
		List<String> matchQuestions = JSONArray.parseArray(matchQuestionsJson, String.class);
		return matchQuestions == null ? new ArrayList<>() : matchQuestions;
	}

	public Object[] queryById(String id, String domainId) {
        java.util.Objects.requireNonNull(domainId, "Current domain is required");
		if (!assetLookupPolicy.shouldQuery(jdbcTemplate, TABLE_NAME)) {
			return null;
		}
		MetricView metricView = null;
		String functionId = null;
		try {
			List<Object[]> list = jdbcTemplate.query(
					"SELECT " + COLUMNS + " FROM " + TABLE_NAME + " WHERE id = ? AND domain_id = ? AND type = 'GENERAL'",
					(rs, rowNum) -> mapRowWithFunctionId(rs), id, domainId);
			if (!list.isEmpty()) {
				Object[] row = list.get(0);
				metricView = (MetricView) row[0];
				functionId = (String) row[1];
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		if (metricView == null) {
			return null;
		} else {
			metricView.setBindings(bindings(metricView.getId()));
            return new Object[] { metricView, functionId };
		}
	}

	public List<Object[]> queryList(String status, String functionId, String className, String domainId) {
		List<Object[]> oList = new ArrayList<Object[]>();
		if (!assetLookupPolicy.shouldQuery(jdbcTemplate, TABLE_NAME)) {
			return oList;
		}
		try {
			StringBuilder whereSql = new StringBuilder("type = 'GENERAL'");
			List<Object> params = new ArrayList<>();
			if (status != null && !"".equals(status.trim())) {
				whereSql.append(" AND status = ?");
				params.add(status.trim());
			}
			if (functionId != null && !"".equals(functionId.trim())) {
				whereSql.append(" AND function_id = ?");
				params.add(functionId.trim());
			}
			if (className != null && !"".equals(className.trim())) {
				whereSql.append(" AND class_names LIKE ?");
				params.add("%," + className.trim() + ",%");
			}
			if (domainId != null && !"".equals(domainId.trim())) {
				whereSql.append(" AND domain_id = ?");
				params.add(domainId.trim());
			}

			oList = jdbcTemplate.query(
					"SELECT " + COLUMNS + " FROM " + TABLE_NAME + " WHERE " + whereSql + " ORDER BY modify_timestamp DESC",
					(rs, rowNum) -> mapRowWithFunctionId(rs), params.toArray());
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
		for (Object[] row : oList) {
            MetricView metric = (MetricView) row[0];
            metric.setBindings(bindings(metric.getId()));
        }
        return oList;
	}


    /** Model-free published read lookup. Database failures remain failures. */
    public List<Object[]> queryForRetrieval(String domainId,String query,String cursor,List<String> classes,int limit) {
        if(!assetLookupPolicy.shouldQuery(jdbcTemplate,TABLE_NAME))return List.of();
        StringBuilder sql=new StringBuilder("SELECT "+java.util.Arrays.stream(COLUMNS.split(", ")).map(c->"m."+c).collect(java.util.stream.Collectors.joining(","))+" FROM metric_view m JOIN function f ON f.id=m.function_id AND f.domain_id=m.domain_id WHERE m.type='GENERAL' AND m.domain_id=? AND m.status=? AND f.operation=?");
        List<Object> args=new ArrayList<>(List.of(domainId,MetricView.STATUS_PUBLISHED,Function.OPERATION_READ));
        if(cursor!=null){sql.append(" AND m.id>?");args.add(cursor);}
        if(query!=null&&!query.isBlank()) {
            sql.append(" AND (strpos(lower(m.name),?)>0 OR strpos(lower(coalesce(m.description,'')),?)>0 OR strpos(lower(coalesce(m.match_questions,'')),?)>0 OR strpos(?,lower(m.name))>0)");
            String normalized=query.toLowerCase(java.util.Locale.ROOT);args.add(normalized);args.add(normalized);args.add(normalized);args.add(normalized);
        }
        if(classes!=null&&!classes.isEmpty()) {
            sql.append(" AND (");
            for(int i=0;i<classes.size();i++){if(i>0)sql.append(" OR ");sql.append("strpos(m.class_names,?)>0");args.add(","+classes.get(i)+",");}
            sql.append(")");
        }
        sql.append(" ORDER BY m.id LIMIT ?");args.add(limit);
        List<Object[]> rows = jdbcTemplate.query(sql.toString(),(rs,n)->mapRowWithFunctionId(rs),args.toArray());
        for (Object[] row : rows) {
            MetricView metric = (MetricView) row[0];
            metric.setBindings(bindings(metric.getId()));
        }
        return rows;
    }

	public List<Object[]> find(String question, String className, int maxResult, double minScore, String domainId) {
		return retrievalGate.read(domainId, () -> search(question, className, maxResult, minScore, domainId));
	}

	/** Runs inside the read boundary: the query vector and the rows belong to one generation. */
	private List<Object[]> search(String question, String className, int maxResult, double minScore, String domainId) {
		List<Object[]> oList = new ArrayList<Object[]>();
		try {
			Response<Embedding> embeddingResponse = embeddingService.embedding(question, domainId);
			float[] findVector = embeddingResponse.content().vector();
			PGvector pgVector = new PGvector(findVector);

			StringBuilder whereSql = new StringBuilder("type = 'GENERAL' AND status = ?");
			List<Object> params = new ArrayList<>();
			params.add(MetricView.STATUS_PUBLISHED);
			if (className != null && !"".equals(className.trim())) {
				whereSql.append(" AND class_names LIKE ?");
				params.add("%," + className.trim() + ",%");
			}
			if (domainId != null && !"".equals(domainId.trim())) {
				whereSql.append(" AND domain_id = ?");
				params.add(domainId.trim());
			}

			String sql = "SELECT " + COLUMNS + ", brief_vector <-> ?::vector AS distance FROM " + TABLE_NAME
					+ " WHERE " + whereSql + " AND brief_vector IS NOT NULL ORDER BY distance LIMIT ?";
			// Bind in placeholder order: the SELECT's vector comes before the WHERE filters.
			List<Object> queryParams = new ArrayList<>();
			queryParams.add(pgVector);
			queryParams.addAll(params);
			queryParams.add(maxResult);

			List<Object[]> rows = jdbcTemplate.query(sql,
					(rs, rowNum) -> {
						Object[] row = mapRowWithFunctionId(rs);
						return new Object[] { row[0], row[1], rs.getDouble("distance") };
					}, queryParams.toArray());

			if (rows != null && !rows.isEmpty()) {
				double dMinScore = 0;
				if (minScore > 0) {
					dMinScore = minScore;
				} else {
					List<Double> listScores = new ArrayList<>();
					for (Object[] row : rows) {
						listScores.add(distanceToScore((Double) row[2]));
					}
					log.info("listScores:" + JSON.toJSONString(listScores));
					AutoKMeansClusteringUtil autoKMeansClusteringUtil = new AutoKMeansClusteringUtil(listScores);
					autoKMeansClusteringUtil.runAutoKMeans();
					dMinScore = autoKMeansClusteringUtil.getHighClustersMinX();
					log.info("dMinScore:" + dMinScore);
				}

				for (Object[] row : rows) {
					double dScore = distanceToScore((Double) row[2]);
					if (dScore >= dMinScore) {
						oList.add(new Object[] { row[0], row[1] });
					}
				}
			}
		} catch (Exception e) {
			log.error(e.getMessage(), e);
		}
        for (Object[] row : oList) {
            MetricView metric = (MetricView) row[0];
            metric.setBindings(bindings(metric.getId()));
        }
		return oList;
	}

    /** Includes unconverted legacy rows so deferred data is never orphan-cleaned. */
    public Set<String> referencedFunctionIds() {
        return new HashSet<>(jdbcTemplate.queryForList("SELECT function_id FROM metric_view", String.class));
    }

    public boolean exists(String id) {
        return jdbcTemplate.queryForObject("SELECT count(*) FROM metric_view WHERE id=?", Integer.class, id) > 0;
    }

    public void lock(String id, String domainId) {
        jdbcTemplate.queryForList("SELECT id FROM metric_view WHERE id=? AND domain_id=? FOR UPDATE", String.class, id, domainId);
    }

    public List<MetricViewBinding> bindings(String metricId) {
        return jdbcTemplate.query("SELECT id,name,description,parameters,match_questions FROM metric_view_binding WHERE metric_view_id=? ORDER BY id",
            (rs,n) -> bindingRow(rs), metricId);
    }

    private MetricViewBinding bindingRow(java.sql.ResultSet rs) throws java.sql.SQLException {
        MetricViewBinding binding = new MetricViewBinding();
        binding.setId(rs.getString("id"));
        binding.setName(rs.getString("name"));
        binding.setDescription(rs.getString("description"));
        binding.setParameters(JSON.parseObject(rs.getString("parameters")));
        binding.setMatchQuestions(new HashSet<>(parseMatchQuestions(rs.getString("match_questions"))));
        return binding;
    }

    private void saveBindings(MetricView metric) {
        Set<String> retained = new HashSet<>();
        for (MetricViewBinding binding : metric.getBindings()) {
            if (binding.getId() == null) binding.setId(UUID.randomUUID().toString());
            retained.add(binding.getId());
            String brief = buildBrief(binding.getName(), binding.getDescription(), binding.getMatchQuestions());
            PGvector vector = new PGvector(embeddingService.embedding(brief, metric.getDomainId()).content().vector());
            int changed = jdbcTemplate.update("INSERT INTO metric_view_binding(id,metric_view_id,name,description,parameters,match_questions,brief,brief_vector) "
                + "VALUES(?,?,?,?,?::jsonb,?,?,?::vector) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,"
                + "parameters=EXCLUDED.parameters,match_questions=EXCLUDED.match_questions,brief=EXCLUDED.brief,brief_vector=EXCLUDED.brief_vector "
                + "WHERE metric_view_binding.metric_view_id=EXCLUDED.metric_view_id", binding.getId(), metric.getId(), binding.getName(), binding.getDescription(),
                JSON.toJSONString(binding.getParameters(), Feature.WriteMapNullValue), JSON.toJSONString(binding.getMatchQuestions()), brief, vector);
            if (changed != 1) throw new IllegalArgumentException("Binding belongs to another metric");
        }
        for (String id : jdbcTemplate.queryForList("SELECT id FROM metric_view_binding WHERE metric_view_id=?", String.class, metric.getId()))
            if (!retained.contains(id)) jdbcTemplate.update("DELETE FROM metric_view_binding WHERE id=? AND metric_view_id=?", id, metric.getId());
    }

    public record BindingMatch(String metricId, MetricViewBinding binding) {}

    public List<BindingMatch> findBindings(String question, int maxResult, double minScore, String domainId) {
        return retrievalGate.read(domainId, () -> {
            List<BindingMatch> found = new ArrayList<>();
            try {
                PGvector vector = new PGvector(embeddingService.embedding(question, domainId).content().vector());
                List<Object[]> rows = jdbcTemplate.query("SELECT b.*,b.brief_vector <-> ?::vector AS distance FROM metric_view_binding b "
                    + "JOIN metric_view m ON m.id=b.metric_view_id WHERE m.type='GENERAL' AND m.domain_id=? AND m.status=? "
                    + "AND b.brief_vector IS NOT NULL ORDER BY distance LIMIT ?",
                    (rs,n) -> new Object[]{new BindingMatch(rs.getString("metric_view_id"), bindingRow(rs)), rs.getDouble("distance")},
                    vector, domainId, MetricView.STATUS_PUBLISHED, maxResult);
                if (rows.isEmpty()) return found;
                double cutoff = minScore;
                if (cutoff <= 0) {
                    List<Double> scores = rows.stream().map(row -> distanceToScore((Double) row[1])).toList();
                    AutoKMeansClusteringUtil clusters = new AutoKMeansClusteringUtil(scores);
                    clusters.runAutoKMeans();
                    cutoff = clusters.getHighClustersMinX();
                }
                for (Object[] row : rows)
                    if (distanceToScore((Double) row[1]) >= cutoff) found.add((BindingMatch) row[0]);
            } catch (Exception e) {
                log.error(e.getMessage(), e);
            }
            return found;
        });
    }

	private Object[] mapRowWithFunctionId(java.sql.ResultSet rs) throws java.sql.SQLException {
		MetricView metricView = new MetricView();
		metricView.setId(rs.getString("id"));
		metricView.setName(rs.getString("name"));
		metricView.setOrigin(rs.getString("origin"));
		metricView.setDescription(rs.getString("description"));
		metricView.setStatus(rs.getString("status"));
		metricView.setCreateTimestamp(rs.getObject("create_timestamp") == null ? null : rs.getLong("create_timestamp"));
		metricView.setModifyTimestamp(rs.getObject("modify_timestamp") == null ? null : rs.getLong("modify_timestamp"));
		metricView.setDomainId(rs.getString("domain_id"));
		String matchQuestionsStr = rs.getString("match_questions");
		Set<String> matchQuestions = new HashSet<String>();
		if (matchQuestionsStr != null && !"null".equals(matchQuestionsStr)) {
			List<String> parsed = JSONArray.parseArray(matchQuestionsStr, String.class);
			if (parsed != null) {
				matchQuestions.addAll(parsed);
			}
		}
		metricView.setMatchQuestions(matchQuestions);
		String originCheckResultStr = rs.getString("origin_check_result");
		metricView.setOriginCheckResult(originCheckResultStr == null ? null : JSONObject.parseObject(originCheckResultStr, OriginCheckResult.class));
		metricView.setOriginQuestion(rs.getString("origin_question"));
		String functionId = rs.getString("function_id");
		return new Object[] { metricView, functionId };
	}

}
