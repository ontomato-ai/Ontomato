/*
 * A rule of the page's stylesheets that composes a value on the root from the brand's colours — a focus ring of the
 * brand's soft fill, a shadow, a gradient — is worked out there once, and every element below inherits the value as it
 * came out. An area that recolours the brand (an application's theme) therefore has to declare such a rule again, as it
 * is written, so it is worked out from the area's own colours. That holds for every such rule, the edition's and any
 * added later: they are read from the stylesheets, never listed here.
 */

type Specificity = readonly [number, number, number];

/** The specificity of one simple selector of the root (`:root`, `html:root`, `html.dark`): ids, classes, types. */
function specificity(selector: string): Specificity {
  const ids = selector.match(/#[\w-]+/g)?.length ?? 0;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+(?:\([^)]*\))?/g) ?? []).length;
  const types = selector.match(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g)?.length ?? 0;
  return [ids, classes, types];
}

const higher = (a: Specificity, b: Specificity) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** The selectors of a list, cut at its own commas only: one inside `:is(…)`, `:not(…)` or `[…]` belongs to its selector. */
function selectorsOf(list: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let at = 0; at < list.length; at += 1) {
    const char = list[at];
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(list.slice(start, at).trim());
      start = at + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts;
}

/** The rules a stylesheet applies now: its own, and those inside a group whose condition holds. */
function* rulesOf(rules: CSSRuleList): Generator<CSSStyleRule> {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) yield rule;
    else if (rule instanceof CSSMediaRule) { if (matchMedia(rule.media.mediaText).matches) yield* rulesOf(rule.cssRules); }
    else if (rule instanceof CSSSupportsRule) { if (CSS.supports(rule.conditionText)) yield* rulesOf(rule.cssRules); }
    else if ("cssRules" in rule && rule.constructor.name === "CSSLayerBlockRule") yield* rulesOf((rule as CSSGroupingRule).cssRules);
  }
}

/** Every custom property the stylesheets declare on the root as the page is now, by the rule that wins, as written. */
function rootDeclarations(doc: Document): Map<string, string> {
  const root = doc.documentElement;
  const winning = new Map<string, { value: string; specificity: Specificity }>();
  for (const sheet of Array.from(doc.styleSheets)) {
    // Another origin's stylesheet cannot be read (a web font's); it declares no rule of the platform's.
    if (sheet.href && new URL(sheet.href, doc.baseURI).origin !== new URL(doc.baseURI).origin) continue;
    for (const rule of rulesOf(sheet.cssRules)) {
      const matched = selectorsOf(rule.selectorText).filter((part) => root.matches(part));
      if (!matched.length) continue;
      const weight = matched.map(specificity).sort(higher).at(-1)!;
      for (const name of Array.from(rule.style)) {
        if (!name.startsWith("--")) continue;
        const current = winning.get(name);
        // Later wins at equal specificity, as the cascade has it.
        if (!current || higher(weight, current.specificity) >= 0)
          winning.set(name, { value: rule.style.getPropertyValue(name).trim(), specificity: weight });
      }
    }
  }
  return new Map([...winning].map(([name, { value }]) => [name, value]));
}

const references = (value: string) => [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]!);

/**
 * The root's custom properties an area that declares `recoloured` must declare again, as written: each one that reads
 * one of them, or reads another such property, however deep.
 */
export function rootComposites(recoloured: Iterable<string>, doc: Document = document): Record<string, string> {
  const declared = rootDeclarations(doc);
  const reached = new Set(recoloured);
  const composites: Record<string, string> = {};
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, value] of declared) {
      if (reached.has(name) || !references(value).some((used) => reached.has(used))) continue;
      composites[name] = value;
      reached.add(name);
      grew = true;
    }
  }
  return composites;
}
