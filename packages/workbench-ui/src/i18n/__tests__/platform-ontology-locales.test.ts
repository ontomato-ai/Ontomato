import { describe, expect, it } from "vitest";
import { createI18n } from "vue-i18n";
import {
  AGENT_DEFINITION,
  APPLICATION,
  PRODUCT_PANEL,
  PRODUCT_PROJECTION,
  platformObjectTypes,
  platformOntologyLayers,
  platformRelationKinds,
} from "@ontomato/contracts/platform-object-types";
import { platformTypeDetails } from "@ontomato/contracts/platform-type-details";
import en from "../../locales/en";

describe("platformOntology English locale coverage", () => {
  it("resolves every layer, declared object type labelKey, and relation kind labelKey through vue-i18n", () => {
    const i18n = createI18n({
      legacy: false,
      locale: "en",
      fallbackLocale: "en",
      missingWarn: false,
      fallbackWarn: false,
      messages: { en },
    });

    for (const layer of platformOntologyLayers) {
      const key = `platformOntology.layers.${layer}`;
      expect(i18n.global.te(key), key).toBe(true);
      expect(i18n.global.t(key), key).not.toBe(key);
    }

    for (const [id, decl] of Object.entries(platformObjectTypes)) {
      if (!decl.labelKey) continue;
      expect(i18n.global.te(decl.labelKey), `${id} (${decl.labelKey})`).toBe(true);
      expect(i18n.global.t(decl.labelKey), `${id} (${decl.labelKey})`).not.toBe(decl.labelKey);
    }

    for (const relation of platformRelationKinds) {
      expect(i18n.global.te(relation.labelKey), `${relation.id} (${relation.labelKey})`).toBe(true);
      expect(i18n.global.t(relation.labelKey), `${relation.id} (${relation.labelKey})`).not.toBe(relation.labelKey);
    }

    const typeBySlug = new Map(
      Object.entries(platformObjectTypes).flatMap(([id, decl]) =>
        decl.labelKey?.startsWith("platformOntology.types.")
          ? [[decl.labelKey.slice("platformOntology.types.".length), id] as const]
          : [],
      ),
    );
    const localizedDetails = en.platformOntology.typeDetails;
    expect(Object.keys(localizedDetails)).toEqual(
      expect.arrayContaining([
        "agentDefinition",
        "application",
        "productProjection",
        "productPanel",
      ]),
    );
    for (const expectedId of [AGENT_DEFINITION, APPLICATION, PRODUCT_PROJECTION, PRODUCT_PANEL]) {
      expect(platformTypeDetails[expectedId], expectedId).toBeDefined();
    }

    for (const [slug, entry] of Object.entries(localizedDetails)) {
      const typeId = typeBySlug.get(slug);
      expect(typeId, `type slug ${slug}`).toBeDefined();
      const contractDetail = typeId ? platformTypeDetails[typeId] : undefined;
      expect(contractDetail, `contract detail for ${typeId}`).toBeDefined();
      if (!contractDetail) continue;

      const defKey = `platformOntology.typeDetails.${slug}.definition`;
      const rulesKey = `platformOntology.typeDetails.${slug}.rules`;
      expect(i18n.global.te(defKey), defKey).toBe(true);
      expect(i18n.global.t(defKey), defKey).toBe(contractDetail.definition);
      expect(i18n.global.te(rulesKey), rulesKey).toBe(true);
      expect(i18n.global.t(rulesKey), rulesKey).toBe(contractDetail.rules);

      expect(Object.keys(entry.properties).sort()).toEqual(
        contractDetail.properties.map((p) => p.name).sort(),
      );
      for (const prop of contractDetail.properties) {
        const propKey = `platformOntology.typeDetails.${slug}.properties.${prop.name}`;
        expect(i18n.global.te(propKey), propKey).toBe(true);
        expect(i18n.global.t(propKey), propKey).toBe(prop.description);
      }
    }
  });
});
