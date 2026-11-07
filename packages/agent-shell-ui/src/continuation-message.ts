const MARKER = "\n\n<agent-context>\n";

/** Presentation boundaries are preserved in history; the runtime still receives the complete message. */
export function continuationMessage(question: string, context: string) {
  return `${question}${MARKER}${context}\n</agent-context>`;
}

export function splitContinuationMessage(text: string) {
  const marker = text.indexOf(MARKER);
  if (marker >= 0 && text.endsWith("\n</agent-context>")) return {
    text: text.slice(0, marker), context: text.slice(marker + MARKER.length, -"\n</agent-context>".length),
  };
  // Keep previously saved follow-up messages readable as well.
  const legacy = text.search(/\n\n(?:Continue from this answer using the referenced datasets|Use only the selected records below\.)/);
  return legacy >= 0 ? { text: text.slice(0, legacy), context: text.slice(legacy + 2) } : { text, context: "" };
}
