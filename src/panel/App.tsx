import { useEffect, useState } from "react";
import { AlertCircle, Braces, Check, Copy, Globe2, Layers2, LockKeyhole, Moon, MousePointer2, Pause, Play, RefreshCw, Sun, X } from "lucide-react";
import { inspectionText } from "../shared/format";
import { CopyButton, type CopyHandler } from "./components";
import { ElementDetails, CSSStyles, ElementStates, Layout, SourceCoverage } from "./InspectorSections";
import { MediaSections } from "./MediaSections";
import { useInspector } from "./useInspector";
import { useTheme } from "./useTheme";

export const number = (value: number) => Number(value.toFixed(2)).toString();

export function App() {
  const { theme, toggleTheme } = useTheme();
  const { enabled, frozen, temporaryTargets, inspection, selectionStatus, tab, error, busy, run } = useInspector();
  const liveSelection = enabled && selectionStatus === "live";
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2600);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && frozen) void run({ type: "LAYR_FREEZE", frozen: false });
      if (event.altKey && event.shiftKey && event.code === "KeyF" && enabled) {
        event.preventDefault();
        if (!event.repeat) void run({ type: "LAYR_TOGGLE_FREEZE" });
      }
      if (event.key === "/" && !(event.target instanceof HTMLInputElement)) {
        const input = document.querySelector<HTMLInputElement>(".search input");
        if (input) { event.preventDefault(); input.focus(); input.scrollIntoView({ block: "center" }); }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const onCopy: CopyHandler = async (text) => {
    try { await navigator.clipboard.writeText(text); setNotice("Copied to clipboard"); return true; }
    catch { setNotice("Copy failed. Focus the panel and try again."); return false; }
  };
  let domain = "No website selected";
  try { domain = tab?.url ? new URL(tab.url).hostname || "Local file" : tab?.title || "Current tab"; } catch { /* Keep default label. */ }
  return <div className="app">
    <header className="header">
      <div className="brand">
        <img src="/icons/layr.svg" alt="" width="27" height="27" />
        <div><span className="wordmark">layr<span className="brand-dot">.</span></span><span className="tagline">Look beyond the pixels.</span></div>
      </div>
      <div className="header-actions">
        <button className="icon-button" aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={toggleTheme}>
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button className="icon-button" aria-label="Clear selection" title="Clear selection" disabled={busy || !inspection} onClick={() => void run({ type: "LAYR_CLEAR" })}><X size={16} /></button>
      </div>
    </header>
    <div className="inspector-controls">
      <div className="power"><span>Inspector <strong className={enabled ? "on" : ""}>{enabled ? "ON" : "OFF"}</strong></span>
        <button className={`toggle ${enabled ? "enabled" : ""}`} role="switch" aria-label="Inspection mode" aria-checked={enabled}
          aria-describedby={error ? "page-access-help" : undefined} title={error || (enabled ? "Turn inspection off" : "Turn inspection on")}
          disabled={busy || !tab} onClick={() => void run({ type: "LAYR_ENABLE", enabled: !enabled })}><span /></button>
      </div>
      <button className={`freeze-button ${frozen ? "active" : ""}`} disabled={!enabled || busy}
        aria-label={frozen ? "Unfreeze hover" : "Freeze hover"} aria-pressed={frozen}
        title="Freeze visible or recently captured hover targets (Alt+Shift+F)" onClick={() => void run({ type: "LAYR_FREEZE", frozen: !frozen })}>
        {frozen ? <Play size={12} /> : <Pause size={12} />}{frozen ? "Unfreeze" : "Freeze hover"}
      </button>
    </div>
    <div className="connection"><Globe2 size={11} /><span className="domain" title={domain}>{domain}</span><span className={`status-dot ${enabled ? "live" : ""}`} /><span>{enabled ? "Inspecting" : "Inspector OFF"}</span></div>
    {error && <div className="error activation-help" id="page-access-help" role="status"><AlertCircle size={16} /><div>
      <strong>{tab?.url && !/^(https?:|file:)/.test(tab.url) ? "Inspection unavailable on this page" : "Page access needed"}</strong><p>{error}</p>
    </div></div>}
    <main className="inspector-content">
      {frozen && <section className="temporary-targets" aria-label="Temporary inspection targets">
        <div className="eyebrow">Hover frozen</div><p className="hint">Choose a captured target. Page hover events continue normally.</p>
        {temporaryTargets.length ? temporaryTargets.map((target) => <button className="temporary-target" key={target.key} disabled={busy}
          onClick={() => void run({ type: "LAYR_SELECT_TEMPORARY", key: target.key })}>
          <code>&lt;{target.tag}&gt;{target.classes.map((name) => `.${name}`).join("")}{target.role ? ` [${target.role}]` : ""}</code>
          <span>{target.text || "(no text)"}</span><small>{target.status === "live" ? "Live" : "Captured"}</small>
        </button>) : <p className="hint">No temporary targets captured. Unfreeze, hover the trigger, then press Alt+Shift+F while the element is visible.</p>}
      </section>}
      {inspection ? <>
        <section className="selection" aria-label="Selected element summary">
          <div className="selection-heading"><span className="eyebrow">SELECTED ELEMENT</span><div className="selection-actions">
            <CopyButton text={inspection.html} label="Copy element HTML" onCopy={onCopy} />
            <button className="icon-button" aria-label="Refresh inspection" title={liveSelection ? "Refresh inspection" : "Select an element while inspection is ON to refresh"}
              disabled={busy || !liveSelection} onClick={() => void run({ type: "LAYR_REFRESH" })}><RefreshCw size={13} /></button>
          </div></div>
          <div className="selected-name"><code>&lt;{inspection.tag}<span>{inspection.id ? `#${inspection.id}` : ""}{inspection.classes.map((name) => `.${name}`).join("")}</span>&gt;</code>
            <span className="dimension">{number(inspection.rect.width)} × {number(inspection.rect.height)}</span></div>
          {inspection.text && <p className="selected-text" title={inspection.text}>“{inspection.text.slice(0, 180)}{inspection.text.length > 180 ? "…" : ""}”</p>}
          <div className="summary-selector"><code>{inspection.selector}</code><CopyButton text={inspection.selector} label="Copy CSS selector" onCopy={onCopy} /></div>
          <div className="snapshot-controls"><span className="snapshot-status" title={`Captured ${new Date(inspection.capturedAt).toLocaleString()}`}>
            <span>{liveSelection ? "Snapshot captured" : "Saved inspection"}</span> · {inspection.attributes.find(([name]) => name === "role")?.[1] || inspection.attributes.find(([name]) => name === "type")?.[1] || `${inspection.tag} element`}
          </span><button className="text-button" disabled={busy || !tab} onClick={() => void run({ type: "LAYR_ENABLE", enabled: true })}>Select another element</button></div>
          {selectionStatus === "detached" && <p className="hint" role="status">Element no longer on page — showing captured details</p>}
          {selectionStatus === "captured" && <p className="hint" role="status">Captured temporary element — read-only inspection preview</p>}
        </section>
        <ElementDetails data={inspection} onCopy={onCopy} canNavigate={liveSelection && !busy && inspection.navigationAvailable !== false} navigate={(key) => void run({ type: "LAYR_NAVIGATE", key })} />
        <CSSStyles data={inspection} onCopy={onCopy} />
        <ElementStates data={inspection} onCopy={onCopy} />
        <MediaSections data={inspection} onCopy={onCopy} notify={setNotice} />
        <Layout data={inspection} onCopy={onCopy} />
        <SourceCoverage data={inspection} />
      </> : <div className="empty-state">
        <div className="empty-symbol"><MousePointer2 size={30} strokeWidth={1.3} /></div>
        <span className="eyebrow">ELEMENT INSPECTOR</span><h1>{enabled ? "Point. Pick. Understand." : "A closer look starts here."}</h1>
        <p>{enabled ? "Hover over an element, then click the blue inspect icon to see its HTML, styles, and layout." : error ? "Layr can inspect HTML and CSS on regular websites." : "Turn on the inspector to explore this page."}</p>
        <div className="empty-instructions"><MousePointer2 size={14} /><span>Select an element on the page</span><Braces size={14} /><span>Explore all its details in one place</span><Copy size={14} /><span>Copy what you need</span></div>
        <div className="local-note"><LockKeyhole size={11} /> Local to your browser. No uploads.</div>
      </div>}
    </main>
    {inspection && <div className="copy-bar"><button className="primary-button" onClick={() => void onCopy(inspectionText(inspection))}><Copy size={14} /><span>Copy All Details</span></button><span>Redacted snapshot · Clipboard only</span></div>}
    <footer><span className="footer-brand"><Layers2 size={11} /> LAYR <span>v1.0</span></span><span>{enabled ? <><kbd>Alt Shift F</kbd> freeze · <kbd>esc</kbd> unfreeze</> : "Inspection stays on your device"}</span></footer>
    {notice && <div className="toast" role="status"><Check size={14} />{notice}</div>}
  </div>;
}
