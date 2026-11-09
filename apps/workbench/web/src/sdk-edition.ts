import type { SdkEdition } from "@ontomato/apps-sdk";
import { ossBrand } from "@ontomato/design-tokens/oss";
import { ossLanguage } from "./language";
import { ossProfile } from "./manager/profile";

/** The open-source build of the apps SDK: the brand, languages and words the platform itself starts with. */
export default {
  brand: ossBrand,
  language: ossLanguage,
  managerMessages: ossProfile.messages,
} satisfies SdkEdition;
