import type { CSSVariable, Declaration, SourceRule, VariableDefinition } from "../shared/types";
import { variableReferences } from "../shared/variables";
import { isSensitiveName } from "./privacy";

export interface VariableScope {
  element: Element;
  label: string;
  inline: Declaration[];
  rules: SourceRule[];
}
const compare = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

// A deliberately small specificity grammar handles ordinary theme selectors,
// including :root and attributes. Unsupported syntax keeps provenance uncertain.
function specificity(selector: string, element: Element): number[] | null {
  const ranks: number[][] = [];
  // A comma in an attribute string must not be mistaken for a selector list.
  if (/[\\()|]/.test(selector) || /\[[^\]]*,/.test(selector)) return null;
  for (const part of selector.split(",")) {
    let text = part;
    let attributes = 0, pseudos = 0;
    text = text.replace(/\[(?:[^\]"']|"[^"]*"|'[^']*')*\]/g, () => { attributes++; return ""; });
    text = text.replace(/:(root|hover|focus-visible|focus-within|focus|active|disabled|checked|enabled|first-child|last-child|only-child|empty)\b/g, () => { pseudos++; return ""; });
    if (!/^[\w\s.#*>+~-]+$/.test(text.trim() || "*")) return null;
    if (!element.matches(part)) continue;
    ranks.push([(text.match(/#/g) || []).length, (text.match(/\./g) || []).length + attributes + pseudos,
      (text.replace(/[#.][\w-]+/g, "").match(/[a-zA-Z][\w-]*/g) || []).length]);
  }
  return ranks.sort(compare).at(-1) || null;
}

export function captureVariables(computed: CSSStyleDeclaration, scopes: VariableScope[], complete: boolean): CSSVariable[] {
  const names = new Set(Array.from(computed).filter((name) => name.startsWith("--")));
  const definitions = new Map<string, VariableDefinition[]>();
  const nearest = new Map<string, "known" | "unknown">();
  for (const [index, scope] of scopes.entries()) {
    const style = index === 0 ? computed : getComputedStyle(scope.element);
    const animated = style.animationName !== "none" || style.transitionDuration.split(",").some((part) => parseFloat(part) > 0);
    const candidates = scope.rules.flatMap((rule, order) => rule.declarations.map((item) => ({ item, rule, order, inline: false })));
    candidates.push(...scope.inline.map((item) => ({ item, rule: { selector: "element.style", origin: "Inline Style", context: [], declarations: scope.inline }, order: scope.rules.length, inline: true })));
    const grouped = new Map<string, { definition: VariableDefinition; rank: number[] | null }[]>();
    for (const { item, rule, order, inline } of candidates) {
      const references = variableReferences(item.value);
      references.forEach(({ name }) => names.add(name));
      if (!item.property.startsWith("--")) continue;
      const name = item.property;
      names.add(name);
      const rank = inline ? [0, 0, 0] : specificity(rule.selector, scope.element);
      const definition: VariableDefinition = {
        value: item.value, important: item.important, selector: rule.selector, element: scope.label, inherited: index > 0,
        origin: rule.origin, context: rule.context, status: "candidate",
        // Inherited custom properties resolve dependencies on their defining
        // element. A child's later --base override must not rewrite that history.
        references: references.map((reference) => ({ ...reference, computedValue: isSensitiveName(reference.name) ? "[redacted]" : style.getPropertyValue(reference.name).trim() || null })),
      };
      const entries = grouped.get(name) || [];
      entries.push({ definition, rank: rank ? [Number(item.important), Number(inline), ...rank, order] : null });
      grouped.set(name, entries);
    }
    for (const [name, entries] of grouped) {
      const uncertain = nearest.get(name) === "unknown" || !complete || animated ||
        (!nearest.has(name) && style.getPropertyValue(name).trim() !== computed.getPropertyValue(name).trim()) ||
        entries.some(({ rank, definition }) => !rank || definition.context.some((heading) => /@layer|@import/.test(heading)) || /^(inherit|initial|unset|revert|revert-layer)$/i.test(definition.value.trim()));
      if (!uncertain) {
        const winner = [...entries].sort((a, b) => compare(a.rank!, b.rank!)).at(-1)!;
        entries.forEach(({ definition }) => { definition.status = !nearest.has(name) && definition === winner.definition ? "nearest" : "overridden"; });
      }
      if (!nearest.has(name)) nearest.set(name, uncertain ? "unknown" : "known");
      definitions.set(name, [...(definitions.get(name) || []), ...entries.map(({ definition }) => definition)]);
    }
  }
  return [...names].sort().map((name) => ({ name,
    computedValue: isSensitiveName(name) ? "[redacted]" : computed.getPropertyValue(name).trim() || null,
    definitions: definitions.get(name) || [],
  }));
}

export function annotateVariableValues(items: Declaration[], computed: CSSStyleDeclaration) {
  for (const item of items) {
    const references = variableReferences(item.value);
    if (!references.length && !item.property.startsWith("--")) continue;
    item.variableReferences = references;
    // Read the selected element's final value, even for overridden declarations;
    // this is not a hypothetical evaluation of that particular source rule.
    item.computedValue = isSensitiveName(item.property) ? "[redacted]" : computed.getPropertyValue(item.property).trim() || null;
  }
}
