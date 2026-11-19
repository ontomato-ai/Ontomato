import { ATTRIBUTE, OBJECT_TYPE, RELATIONSHIP } from "@ontomato/contracts/platform-object-types";
import type { PlatformObjectAdapterFactory } from "./platform-objects";

interface AttributeMetadata {
  name: string;
  showName?: string;
}
interface ClassMetadata {
  className: string;
  showName?: string;
  classDesc?: string;
  attrs?: AttributeMetadata[];
}
interface RelationshipMetadata {
  fromclass: string;
  toclass: string;
  showName?: string;
  desc?: string;
}

/** Classes, attributes and relationships use the same owner request and their native identities. */
export const ontologyMetadataAdapters: PlatformObjectAdapterFactory = requests => {
  async function readMetadata() {
    const response = await requests.request("/admin/getMetas", { method: "POST", body: "{}" }, "/data-query");
    const body: { success: true; data: { classDef: ClassMetadata[]; relationship_rule?: Record<string, RelationshipMetadata> } }
      | { success: false; message: string } = await response.json();
    if (!body.success) throw new Error(body.message);
    return body.data;
  }

  // The graph asks for nodes and edges together. Share that in-flight read and let a later load reach the owner.
  let pending: ReturnType<typeof readMetadata> | undefined;
  const metadata = () => pending ??= readMetadata().finally(() => { pending = undefined; });
  const classes = async () => (await metadata()).classDef.map(({ className, showName, classDesc }) => ({
    primaryKey: className, label: showName || classDesc || className,
    fields: { className, showName: showName ?? "", classDesc: classDesc ?? "" },
  }));
  const relationships = async () => Object.entries((await metadata()).relationship_rule ?? {})
    .map(([primaryKey, relation]) => ({
      primaryKey, label: relation.showName || relation.desc || primaryKey,
      fields: { fromclass: relation.fromclass, toclass: relation.toclass },
    }));

  return [{
    objectType: OBJECT_TYPE,
    list: classes,
    options: {
      async list() {
        return { options: (await classes()).map(({ primaryKey, label }) => ({ primaryKey, label, value: primaryKey })) };
      },
      async resolve(values) {
        const labels = new Map((await classes()).map(({ primaryKey, label }) => [primaryKey, label]));
        return values.map(value => {
          const primaryKey = String(value);
          const label = labels.get(primaryKey);
          return label === undefined
            ? { primaryKey, value, label: primaryKey, unavailable: { reason: "assistant.unavailable" } }
            : { primaryKey, value, label };
        });
      },
    },
  }, {
    objectType: ATTRIBUTE,
    async list() {
      return (await metadata()).classDef.flatMap(({ className, attrs = [] }) => attrs.map(({ name, showName }) => ({
        primaryKey: JSON.stringify([className, name]), label: showName || name, fields: { className, name },
      })));
    },
  }, {
    objectType: RELATIONSHIP,
    // A graph reads the two classes a relationship joins from these fields, as its projection's `graph` names them.
    list: relationships,
  }];
};
