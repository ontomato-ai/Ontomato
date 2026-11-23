/** Hosts resolve the edition's UI locale before admission; user text never selects process language. */
export function processLanguageInstruction(language: string): string {
  const names: Record<string, string> = {
    en: "English", "zh-CN": "Simplified Chinese", zh: "Simplified Chinese",
    "zh-TW": "Traditional Chinese", ja: "Japanese", ar: "Arabic", fr: "French",
    de: "German", it: "Italian",
  };
  const name = names[language] ?? "English";
  return `Process display language: ${name}. Write all user-visible progress notes, planning explanations and reasoning/thinking text in ${name}, including delegated work. Follow this process language even when the question, skill instructions or tool output use another language. Preserve object names, quoted source values, code and identifiers as written. This rule concerns process text; retain the agent's answer-language instructions for the final answer.`;
}
