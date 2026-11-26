package io.ontomato.dataengine.service;

import static io.ontomato.dataengine.service.OntologyNeighborFacts.ID_PADDING;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/** A definition's authorship facts, after its owner has admitted the definition to the reader. */
public record UserDefinitionProvenance(String id, String name, String createdBy, String reviewedBy) {
    private static final Pattern EDGE_PADDING = Pattern.compile("^[" + ID_PADDING + "]+|[" + ID_PADDING + "]+$");

    public record Names(List<String> names, int total) {}
    public record Summary(Names created, Names reviewed) {}

    public static Map<String, Summary> summarize(Stream<UserDefinitionProvenance> visible, Set<String> members, int limit) {
        var builders = new HashMap<String, SummaryBuilder>();
        for (var member : members) builders.put(member, new SummaryBuilder());
        visible.forEach(row -> {
            var id = trim(row.id);
            if (id.isEmpty()) return;
            var name = trim(row.name);
            var title = name.isEmpty() ? id : name;
            var creator = builders.get(trim(row.createdBy));
            if (creator != null) creator.created.add(title, limit);
            var reviewer = builders.get(trim(row.reviewedBy));
            if (reviewer != null) reviewer.reviewed.add(title, limit);
        });
        var result = new HashMap<String, Summary>();
        builders.forEach((member, builder) ->
            result.put(member, new Summary(builder.created.result(), builder.reviewed.result())));
        return result;
    }

    private static String trim(String value) {
        return value == null ? "" : EDGE_PADDING.matcher(value).replaceAll("");
    }

    private static final class SummaryBuilder {
        private final Bucket created = new Bucket();
        private final Bucket reviewed = new Bucket();
    }

    private static final class Bucket {
        private final List<String> names = new ArrayList<>();
        private int total;

        private void add(String title, int limit) {
            if (names.size() < limit) names.add(title);
            total++;
        }

        private Names result() {
            return new Names(names, total);
        }
    }
}
