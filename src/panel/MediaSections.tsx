import { useEffect, useState } from "react";
import { Download, ExternalLink, ImageOff } from "lucide-react";
import type { ImageDetails, Inspection } from "../shared/types";
import { resourceURL } from "../shared/resources";
import { CodeBlock, CopyButton, Properties, Section, type CopyHandler } from "./components";

const number = (value: number) => Number(value.toFixed(2)).toString();
function Preview({ url, alt }: { url?: string; alt: string }) {
  const safe = resourceURL(url);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <div className="media-preview">{safe && !failed ? <img src={safe} alt={alt} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <div className="preview-unavailable"><ImageOff size={20} /><span>Preview unavailable</span></div>}</div>;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function ResourceActions({ url, svg, name, onCopy, notify }: { url?: string; svg?: string; name: string; onCopy: CopyHandler; notify: (message: string) => void }) {
  const safe = resourceURL(url);
  const [downloading, setDownloading] = useState(false);
  async function download() {
    if (svg) { saveBlob(new Blob([svg], { type: "image/svg+xml" }), "layr-icon.svg"); return; }
    if (!safe) return;
    setDownloading(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      // Only a deliberate Download click fetches original bytes. No canvas or re-encoding.
      const response = await fetch(safe, { credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal });
      if (!response.ok || response.type === "opaque") throw new Error("Unavailable resource");
      const blob = await response.blob();
      if (!blob.type.startsWith("image/") && !blob.type.startsWith("application/octet-stream")) throw new Error("Not an image resource");
      let filename = "layr-image";
      try { filename = new URL(safe).pathname.split("/").pop() || filename; } catch { /* Use fallback. */ }
      if (safe.startsWith("data:")) filename = `layr-image.${blob.type.split("/")[1]?.replace("svg+xml", "svg") || "bin"}`;
      saveBlob(blob, filename.replace(/[^\w. -]/g, "_").slice(0, 120));
    } catch { notify("Download unavailable. Open the original image to save it from the browser."); }
    finally { clearTimeout(timer); setDownloading(false); }
  }
  return <div className="resource-actions">
    {safe && <a className="text-button" href={safe} target="_blank" rel="noreferrer"><ExternalLink size={12} />Open {name}</a>}
    {url && <CopyButton text={url} label={`Copy ${name.toLowerCase()} URL`} onCopy={onCopy} />}
    {(safe || svg) && <button className="text-button" disabled={downloading} onClick={() => void download()}><Download size={12} />{downloading ? "Downloading…" : `Download ${svg ? "SVG" : name}`}</button>}
    {url && !safe && <p className="hint">Resource address is redacted or unavailable; preview and download are disabled.</p>}
  </div>;
}

function ImageInfo({ image, onCopy, notify }: { image: ImageDetails; onCopy: CopyHandler; notify: (message: string) => void }) {
  const entries: [string, string][] = [["source type", image.kind], ["resource URL", image.url]];
  if (image.src) entries.push(["src", image.src]);
  if (image.currentSrc) entries.push(["currentSrc", image.currentSrc]);
  entries.push(["original dimensions", image.naturalWidth && image.naturalHeight ? `${image.naturalWidth} × ${image.naturalHeight} px` : "Unavailable at capture"],
    ["displayed dimensions", `${number(image.width)} × ${number(image.height)} px`], ["format", image.format ? `${image.format} (URL hint)` : "Unknown"]);
  if (image.alt !== undefined) entries.push(["alt", image.alt || "(empty)"]);
  if (image.srcset) entries.push(["srcset", image.srcset]);
  if (image.sources?.length) entries.push(["picture sources", image.sources.join("\n")]);
  return <div className="media-item"><Preview url={image.url} alt={image.alt || "Captured image resource"} /><ResourceActions url={image.url} name="Image" onCopy={onCopy} notify={notify} /><Properties entries={entries} onCopy={onCopy} /></div>;
}

export function MediaSections({ data, onCopy, notify }: { data: Inspection; onCopy: CopyHandler; notify: (message: string) => void }) {
  return <>
    {!!data.images?.length && <Section title="Images" count={data.images.length}>{data.images.map((image, index) => <ImageInfo key={`${image.url}-${index}`} image={image} onCopy={onCopy} notify={notify} />)}</Section>}
    {!!data.icons?.length && <Section title="Icons" count={data.icons.length}>{data.icons.map((icon, index) => <div className="media-item" key={`${data.capturedAt}-${index}`}>
      {icon.svg ? <><Preview url={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon.svg)}`} alt="Captured SVG icon" /><p className="hint">Markup preview. External styles and references may be unavailable.</p></> : icon.url ? <Preview url={icon.url} alt="Captured icon resource" /> : <p className="hint">{icon.glyph ? `Captured glyph: ${icon.glyph}. The page font may be unavailable in this panel.` : "No standalone preview available."}</p>}
      <Properties entries={[["icon type", icon.kind], ["dimensions", icon.width !== undefined && icon.height !== undefined ? `${number(icon.width)} × ${number(icon.height)} px` : "Unavailable at capture"], ["color", icon.color], ["classes", icon.classes.join(" ") || "(none)"], ...(icon.font ? [["font", icon.font] as [string, string]] : []), ...(icon.url ? [["source URL", icon.url] as [string, string]] : [])]} onCopy={onCopy} />
      {!icon.url && <p className="hint">Rendered in the page; no separate resource URL was identified.</p>}
      {icon.truncated && <p className="hint">SVG exceeds capture limits. Icon HTML is truncated; select a smaller SVG to preview or export it.</p>}
      <div className="resource-actions">{icon.svg && <CopyButton text={icon.svg} label="Copy SVG" onCopy={onCopy} />}<CopyButton text={icon.html} label="Copy icon HTML" onCopy={onCopy} /></div>
      <ResourceActions url={icon.url} svg={icon.svg} name="Icon" onCopy={onCopy} notify={notify} />
      {icon.svg && <Section title="SVG markup" open={false}><CodeBlock text={icon.svg} label="Copy SVG markup" onCopy={onCopy} /></Section>}
    </div>)}</Section>}
  </>;
}
