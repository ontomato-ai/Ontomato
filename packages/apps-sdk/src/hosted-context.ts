import edition from "apps-sdk:edition";
import { connectAppHost, createContext, currentAppHost, type AppContext } from "./context";

/** Connects a hosted app to the platform shell and prepares its language, theme and data clients. */
export function createAppContext(): AppContext {
  const { brand, language, managerMessages } = edition;
  return createContext(currentAppHost(), {
    brand,
    defaultLocale: language.defaultLocale,
    messages: Object.fromEntries(
      language.supported.map(locale => [locale, { ...language.messages[locale], ontology: managerMessages[locale].ontology }]),
    ),
    elementLocale: language.elementLocale,
  });
}

/** Connects a hosted app to the shell, including when the app only has access to the message bridge. */
export async function connectAppContext(): Promise<AppContext> {
  await connectAppHost();
  return createAppContext();
}
