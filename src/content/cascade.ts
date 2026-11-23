import type { Declaration, SourceRule } from "../shared/types";

// Deliberately restrict specificity to plain type/class/id selectors and combinators.
// Advanced selectors, layers, incomplete CSSOM, and animations stay unclassified.
function specificity(selector: string, element: Element): number[] | null {
  const matches: number[][] = [];
  for (const part of selector.split(",")) {
    if (!/^[\w\s.#*>+~-]+$/.test(part)) return null;
    if (!element.matches(part)) continue;
    matches.push([
      (part.match(/#/g) || []).length,
      (part.match(/\./g) || []).length,
      (part.replace(/[#.][\w-]+/g, "").match(/[a-zA-Z][\w-]*/g) || []).length,
    ]);
  }
  return matches.sort(compare).at(-1) || null;
}
function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export function classifyDeclarations(element: Element, inline: Declaration[], rules: SourceRule[], complete: boolean) {
  const computed = getComputedStyle(element);
  const animated = computed.animationName !== "none" ||
    computed.transitionDuration.split(",").some((duration) => parseFloat(duration) > 0);
  const candidates = rules.flatMap((rule, order) => rule.declarations.map((item) => ({
    item, rank: specificity(rule.selector, element), order, inline: 0,
  })));
  candidates.push(...inline.map((item) => ({ item, rank: [0, 0, 0], order: rules.length, inline: 1 })));
  const uncertain = !complete || animated || rules.some((rule) => rule.context.some((heading) => /@layer|@import/.test(heading)));
  const probe = document.createElement("div").style;
  const names = Array.from(computed);
  const entries = candidates.map((candidate) => {
    probe.cssText = "";
    probe.setProperty(candidate.item.property, candidate.item.value);
    // Pending var() shorthands expose empty longhands in CSSOM. "initial"
    // reveals the affected property names without resolving a page variable.
    if (!candidate.item.property.startsWith("--") && /\bvar\(/i.test(candidate.item.value)) probe.setProperty(candidate.item.property, "initial");
    const affected = candidate.item.property.startsWith("--") ? [candidate.item.property] :
      names.filter((name) => !!probe.getPropertyValue(name));
    candidate.item.status = "unknown";
    return { ...candidate, affected };
  });
  if (uncertain || candidates.some(({ item }) => item.property === "all" ||
      /(^|-)(inline|block)(-|$)/.test(item.property) ||
      /\b(revert|revert-layer)\b/.test(item.value))) return;
  const winners = new Map<string, typeof entries[number]>();
  const unknown = new Set<string>();
  for (const entry of entries) {
    for (const property of entry.affected) {
      if (!entry.rank) { unknown.add(property); continue; }
      const previous = winners.get(property);
      const rank = (item: typeof entry) => [Number(item.item.important), item.inline, ...item.rank!, item.order];
      if (!previous || compare(rank(entry), rank(previous)) >= 0) winners.set(property, entry);
    }
  }
  for (const entry of entries) {
    if (!entry.rank || !entry.affected.length || entry.affected.some((key) => unknown.has(key))) continue;
    const wins = entry.affected.filter((key) => winners.get(key) === entry).length;
    entry.item.status = wins === entry.affected.length ? "active" : wins === 0 ? "overridden" : "unknown";
  }
}
