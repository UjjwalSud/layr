import type { IconDetails, ImageDetails, PseudoDetails } from "../shared/types";
import { redactInspection, sanitizedElement, sensitiveValues } from "./privacy";

const dimensions = (element: Element) => {
  const { width, height } = element.getBoundingClientRect();
  return { width, height };
};
const absolute = (value: string) => {
  try { return new URL(value, document.baseURI).href; } catch { return value; }
};
const format = (url: string) => {
  const mime = url.match(/^data:image\/([\w.+-]+)/i)?.[1];
  if (mime) return mime;
  try { return new URL(url).pathname.match(/\.(avif|webp|png|jpe?g|gif|svg|ico|bmp)$/i)?.[1].toLowerCase(); } catch { return undefined; }
};
const pseudoKeys = ["content", "display", "color", "background-image", "font-family", "font-size", "width", "height", "position", "opacity"];
export function capturePseudos(element: Element): PseudoDetails[] {
  return (["::before", "::after"] as const).flatMap((selector) => {
    const style = getComputedStyle(element, selector);
    return style.content && !["none", "normal"].includes(style.content)
      ? [{ selector, computed: Object.fromEntries(pseudoKeys.map((key) => [key, style.getPropertyValue(key)])) }] : [];
  });
}

export function captureAssets(element: Element, computed: CSSStyleDeclaration) {
  const images: ImageDetails[] = [];
  const icons: IconDetails[] = [];
  const referencedSecrets: string[] = [];
  // Search only a small neighborhood under the selection, never the document.
  const nearby: Element[] = [element];
  const queue = [{ node: element, depth: 0 }];
  for (let index = 0; index < queue.length && nearby.length < 80; index++) {
    const { node, depth } = queue[index];
    if (depth >= 4) continue;
    for (const child of node.children) {
      if (nearby.length >= 80) break;
      nearby.push(child); queue.push({ node: child, depth: depth + 1 });
    }
  }
  const img = nearby.find((node): node is HTMLImageElement => node instanceof HTMLImageElement);
  if (img) {
    const url = img.currentSrc || img.src;
    if (url) images.push({ kind: "img", url, src: img.src, currentSrc: img.currentSrc, srcset: img.srcset,
      sources: img.closest("picture") ? Array.from(img.closest("picture")!.querySelectorAll("source")).slice(0, 12)
        .map((source) => `${source.media || "all"}: ${source.srcset}${source.type ? ` (${source.type})` : ""}`) : [],
      alt: img.alt, naturalWidth: img.naturalWidth || undefined, naturalHeight: img.naturalHeight || undefined,
      ...dimensions(img), format: format(url) });
    if (/icon|logo|symbol/i.test(`${img.className} ${img.getAttribute("role") || ""}`)) icons.push({
      kind: "Image icon", html: sanitizedElement(img).outerHTML, url,
      classes: Array.from(img.classList), color: getComputedStyle(img).color, ...dimensions(img),
    });
  }
  for (const match of computed.backgroundImage.matchAll(/url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s)]+))\s*\)/g)) {
    if (images.length >= 6) break;
    const url = absolute(match[1] ?? match[2] ?? match[3]);
    images.push({ kind: "background", url, ...dimensions(element), format: format(url) });
  }
  const svg = element.closest("svg") ?? nearby.find((node) => node.localName === "svg");
  if (svg) {
    let truncated = false;
    const safe = sanitizedElement(svg, () => { truncated = true; });
    safe.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const html = safe.outerHTML.slice(0, 60000);
    // Make local <use> symbols portable without cloning the surrounding page.
    for (const use of Array.from(safe.querySelectorAll("use")).slice(0, 8)) {
      const href = use.getAttribute("href") || use.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      if (!href?.startsWith("#") || href.length === 1 || safe.querySelector(`#${CSS.escape(href.slice(1))}`)) continue;
      const target = (svg.getRootNode() as Document | ShadowRoot).getElementById(href.slice(1));
      if (!target || !["symbol", "path", "g", "rect", "circle", "ellipse", "polygon", "polyline"].includes(target.localName)) continue;
      const defs = safe.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "defs");
      defs.appendChild(sanitizedElement(target, () => { truncated = true; })); safe.prepend(defs);
      referencedSecrets.push(...sensitiveValues(target));
    }
    const markup = safe.outerHTML;
    truncated ||= markup.length > 60000;
    const ref = element.matches("use, image") ? element : svg.querySelector("use, image");
    const href = ref?.getAttribute("href") || ref?.getAttributeNS("http://www.w3.org/1999/xlink", "href");
    // A local symbol is part of this document, not a standalone image URL.
    const url = href && !href.startsWith("#") ? absolute(href) : undefined;
    icons.push({ kind: ref ? "SVG reference" : "Inline SVG", svg: truncated ? undefined : markup, html, url, truncated,
      classes: Array.from(svg.classList), color: getComputedStyle(svg).color, ...dimensions(svg) });
    if (ref?.localName === "image" && url) images.push({ kind: "svg-reference", url, ...dimensions(ref), format: format(url) });
  }
  if (!svg && !img) {
    const glyph = (element.textContent || "").trim();
    // A private-use glyph is an observable font icon; class names alone do not identify a library.
    if (/^[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]$/u.test(glyph)) icons.push({
      kind: "Icon font", glyph, font: computed.fontFamily, html: sanitizedElement(element).outerHTML.slice(0, 60000),
      classes: Array.from(element.classList), color: computed.color, ...dimensions(element),
    });
    for (const pseudo of capturePseudos(element)) {
      const content = pseudo.computed.content;
      const text = content.match(/^["'](.*)["']$/)?.[1];
      const urlMatch = content.match(/url\(["']?(.*?)["']?\)/) || pseudo.computed["background-image"].match(/url\(["']?(.*?)["']?\)/);
      if (!urlMatch && (!text || text.length > 4)) continue;
      icons.push({ kind: "Pseudo-element", glyph: text, url: urlMatch ? absolute(urlMatch[1]) : undefined,
        font: pseudo.computed["font-family"], html: sanitizedElement(element).outerHTML.slice(0, 60000),
        classes: Array.from(element.classList), color: pseudo.computed.color,
        width: Number.isFinite(parseFloat(pseudo.computed.width)) ? parseFloat(pseudo.computed.width) : undefined,
        height: Number.isFinite(parseFloat(pseudo.computed.height)) ? parseFloat(pseudo.computed.height) : undefined });
    }
  }
  return redactInspection({ images, icons }, referencedSecrets);
}
