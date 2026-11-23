import type { VariableReference } from "./types";

// Read references, never evaluate or substitute CSS. Strings and comments may
// contain literal "var(...)" text; commas inside functions belong to fallback values.
export function variableReferences(input: string): VariableReference[] {
  const value = input.slice(0, 20000);
  const result: VariableReference[] = [];
  function skipToken(index: number): number {
    if (value.startsWith("/*", index)) {
      const end = value.indexOf("*/", index + 2);
      return end < 0 ? value.length : end + 2;
    }
    const quote = value[index];
    if (quote !== '"' && quote !== "'") return index;
    for (let i = index + 1; i < value.length; i++) {
      if (value[i] === "\\") i++;
      else if (value[i] === quote) return i + 1;
    }
    return value.length;
  }
  for (let i = 0; i < value.length && result.length < 64;) {
    const skipped = skipToken(i);
    if (skipped !== i) { i = skipped; continue; }
    if (value[i] === "\\") { i += 2; continue; }
    if (value.slice(i, i + 4).toLowerCase() !== "var(" || (i > 0 && /[\w-]/.test(value[i - 1]))) { i++; continue; }
    let depth = 1, comma = -1, end = i + 4;
    for (; end < value.length; end++) {
      const tokenEnd = skipToken(end);
      if (tokenEnd !== end) { end = tokenEnd - 1; continue; }
      if (value[end] === "\\") { end++; continue; }
      if (value[end] === "(") depth++;
      else if (value[end] === ")" && --depth === 0) break;
      else if (value[end] === "," && depth === 1 && comma < 0) comma = end;
    }
    if (depth !== 0) { i += 4; continue; }
    const rawName = value.slice(i + 4, comma < 0 ? end : comma).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const name = rawName.replace(/\\([0-9a-f]{1,6})(?:\r\n|[ \t\r\n\f])?|\\([^\r\n\f])/gi, (_, hex: string | undefined, literal: string | undefined) => {
      if (!hex) return literal || "";
      const point = parseInt(hex, 16);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : "\ufffd";
    });
    if (name.startsWith("--") && name.length > 2) {
      const reference: VariableReference = { name, ...(comma >= 0 ? { fallback: value.slice(comma + 1, end).trim() } : {}) };
      if (!result.some((item) => item.name === name && item.fallback === reference.fallback)) result.push(reference);
    }
    i += 4; // Visit nested var() functions in fallbacks as independent references.
  }
  return result;
}
