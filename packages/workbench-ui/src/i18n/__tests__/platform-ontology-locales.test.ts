import { describe, expect, it } from "vitest";
import { createI18n } from "vue-i18n";
import {
  platformObjectTypes,
  platformOntologyLayers,
  platformRelationKinds,
} from "@ontomato/contracts/platform-object-types";
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
  });
});
