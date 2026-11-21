import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Braces,
  Check,
  Code2,
  Crosshair,
  FileCode2,
  Globe2,
  Layers2,
  LockKeyhole,
  MousePointer2,
  Moon,
  RefreshCw,
  ScanLine,
  Search,
  Sun,
  X,
} from "lucide-react";
import { computedCSS, cssDeclarations, inspectionText } from "../shared/format";
import type { Declaration, Inspection } from "../shared/types";
import {
  CodeBlock,
  CopyButton,
  Properties,
  Section,
  type CopyHandler,
} from "./components";
import { useInspector } from "./useInspector";
import { useTheme } from "./useTheme";

type Tab = "Overview" | "Styles" | "Layout" | "Source";
const tabs: { name: Tab; icon: typeof Code2 }[] = [
  { name: "Overview", icon: ScanLine },
  { name: "Styles", icon: Braces },
  { name: "Layout", icon: Layers2 },
  { name: "Source", icon: FileCode2 },
];
const number = (value: number) => Number(value.toFixed(2)).toString();

function Overview({ data, onCopy }: { data: Inspection; onCopy: CopyHandler }) {
  return (
    <>
      <Section title="Element">
        <Properties
          entries={[
            ["tag", `<${data.tag}>`],
            ["id", data.id || "—"],
            ["text", data.text || "—"],
          ]}
          onCopy={onCopy}
        />
      </Section>
      <Section
        title="CSS selector"
        action={
          <CopyButton
            text={data.selector}
            label="Copy CSS selector"
            onCopy={onCopy}
          />
        }
      >
        <code className="selector">{data.selector}</code>
        {data.scope !== "Document" && <p className="hint">{data.scope}</p>}
      </Section>
      <Section
        title="Classes"
        count={data.classes.length}
        action={
          data.classes.length ? (
            <CopyButton
              text={data.classes.join(" ")}
              label="Copy CSS classes"
              onCopy={onCopy}
            />
          ) : undefined
        }
      >
        {data.classes.length ? (
          <div className="class-list">
            {data.classes.map((name) => (
              <span className="class-chip" key={name}>
                {name}
              </span>
            ))}
          </div>
        ) : (
          <p className="muted empty-small">No CSS classes.</p>
        )}
      </Section>
      <Section title="Attributes" count={data.attributes.length}>
        <Properties entries={data.attributes} onCopy={onCopy} />
      </Section>
      <Section title="HTML snippet">
        <CodeBlock text={data.html} label="Copy HTML" onCopy={onCopy} />
        {data.htmlTruncated && (
          <p className="hint">Truncated at 60,000 characters.</p>
        )}
      </Section>
    </>
  );
}

const groups: Record<string, (property: string) => boolean> = {
  All: () => true,
  Typography: (key) =>
    /^(font|line-height|letter-spacing|text-|word-|white-space|color$)/.test(
      key,
    ),
  Colors: (key) => /color|background|fill$|stroke/.test(key),
  Layout: (key) =>
    /^(display|position|inset|top$|right$|bottom$|left$|width|height|min-|max-|margin|padding|box-sizing|flex|grid|gap|row-gap|column-gap|align-|justify-|order|overflow)/.test(
      key,
    ),
  Effects: (key) =>
    /border|shadow|opacity|filter|transform|transition|animation|outline|blend|clip/.test(
      key,
    ),
  Variables: (key) => key.startsWith("--"),
};

function Styles({ data, onCopy }: { data: Inspection; onCopy: CopyHandler }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("All");
  const entries = Object.entries(data.computed)
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(
      ([key, value]) =>
        groups[group](key) &&
        `${key} ${value}`.toLowerCase().includes(query.toLowerCase()),
    );
  return (
    <>
      <div className="styles-toolbar">
        <label className="search">
          <Search size={14} />
          <input
            aria-label="Filter CSS properties"
            placeholder="Filter properties or values…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>/</kbd>
        </label>
        <div className="filter-chips">
          {Object.keys(groups).map((name) => (
            <button
              className={group === name ? "filter active" : "filter"}
              key={name}
              onClick={() => setGroup(name)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="info-line">
        <span className="blue-dot" />
        Computed values<span className="muted">Resolved by the browser</span>
      </div>
      <Section
        title={group === "Variables" ? "CSS variables" : "Computed properties"}
        count={entries.length}
        action={
          <CopyButton
            text={computedCSS(data)}
            label="Copy all computed CSS"
            onCopy={onCopy}
          />
        }
      >
        <Properties entries={entries} onCopy={onCopy} />
      </Section>
      <Section
        title="Inline declarations"
        count={data.inline.length}
        open={false}
      >
        <Properties
          entries={data.inline.map((item) => [
            item.property,
            `${item.value}${item.important ? " !important" : ""}`,
          ])}
          onCopy={onCopy}
        />
      </Section>
    </>
  );
}

function BoxModel({ data }: { data: Inspection }) {
  const value = (name: string) =>
    data.computed[name]?.replace(/px$/, "") ?? "0";
  const contentSize = (axis: "width" | "height") => {
    const size = data.computed[axis];
    if (!size?.endsWith("px") || data.computed["box-sizing"] !== "border-box") return value(axis);
    const sides = axis === "width" ? ["left", "right"] : ["top", "bottom"];
    const edges = sides.reduce((sum, side) => sum +
      (parseFloat(data.computed[`padding-${side}`]) || 0) +
      (parseFloat(data.computed[`border-${side}-width`]) || 0), 0);
    return number(Math.max(0, parseFloat(size) - edges));
  };
  const sides = (prefix: string, suffix = "") => (
    <>
      <span className="side top">{value(`${prefix}-top${suffix}`)}</span>
      <span className="side right">{value(`${prefix}-right${suffix}`)}</span>
      <span className="side bottom">{value(`${prefix}-bottom${suffix}`)}</span>
      <span className="side left">{value(`${prefix}-left${suffix}`)}</span>
    </>
  );
  return (
    <div className="box-model" role="img" aria-label="CSS box model: margin, border, padding, and content dimensions">
      <div className="box-margin">
        <span className="box-label">margin</span>
        {sides("margin")}
        <div className="box-border">
          <span className="box-label">border</span>
          {sides("border", "-width")}
          <div className="box-padding">
            <span className="box-label">padding</span>
            {sides("padding")}
            <div className="box-content">
              {contentSize("width")}
              <span>×</span>
              {contentSize("height")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Layout({ data, onCopy }: { data: Inspection; onCopy: CopyHandler }) {
  const entries = (keys: string[]): [string, string][] =>
    keys.map((key) => [key, data.computed[key] || "—"]);
  return (
    <>
      <Section title="Box model">
        <BoxModel data={data} />
        <p className="hint">CSS dimensions in px. Center shows the content box; borders and padding are subtracted for border-box sizing. Transforms are excluded.</p>
      </Section>
      <Section title="Dimensions">
        <Properties
          entries={[
            ["visual width", `${number(data.rect.width)}px`],
            ["visual height", `${number(data.rect.height)}px`],
            ...entries([
              "width",
              "height",
              "min-width",
              "max-width",
              "min-height",
              "max-height",
              "box-sizing",
            ]),
          ]}
          onCopy={onCopy}
        />
        <p className="hint">Visual bounds include transforms.</p>
      </Section>
      <Section title="Position & display">
        <Properties
          entries={entries([
            "display",
            "position",
            "top",
            "right",
            "bottom",
            "left",
            "z-index",
            "overflow-x",
            "overflow-y",
          ])}
          onCopy={onCopy}
        />
      </Section>
      <Section title="Spacing & borders">
        <Properties
          entries={entries([
            "margin-top",
            "margin-right",
            "margin-bottom",
            "margin-left",
            "padding-top",
            "padding-right",
            "padding-bottom",
            "padding-left",
            "border-top",
            "border-right",
            "border-bottom",
            "border-left",
          ])}
          onCopy={onCopy}
        />
      </Section>
      <Section title="Flex & grid">
        <Properties
          entries={entries([
            "flex-direction",
            "flex-wrap",
            "flex-grow",
            "flex-shrink",
            "flex-basis",
            "align-items",
            "align-self",
            "justify-content",
            "gap",
            "grid-template-columns",
            "grid-template-rows",
            "grid-column",
            "grid-row",
          ])}
          onCopy={onCopy}
        />
      </Section>
    </>
  );
}

function Source({ data, onCopy }: { data: Inspection; onCopy: CopyHandler }) {
  return (
    <>
      <div className="source-note">
        <Code2 size={15} />
        <p>
          Matching source rules are separate from <strong>Styles</strong>, which
          shows final computed values. Status labels apply to accessible author
          declarations where the cascade can be resolved. Unknown means there
          is insufficient information.
        </p>
      </div>
      <Section title="Inline style" count={data.inline.length}>
        {data.inline.length ? (
          <SourceDeclarations
            selector="element.style"
            items={data.inline}
            label="Copy inline CSS"
            onCopy={onCopy}
          />
        ) : (
          <p className="muted empty-small">No inline declarations.</p>
        )}
      </Section>
      <Section title="Matching rules" count={data.rules.length}>
        {data.rules.length ? (
          data.rules.map((rule, index) => (
            <div className="source-rule" key={index}>
              <div className="origin" title={rule.origin}>
                <FileCode2 size={12} />
                <span>{rule.origin}</span>
              </div>
              {rule.context.length > 0 && (
                <div className="rule-context">{rule.context.join(" → ")}</div>
              )}
              <SourceDeclarations
                selector={rule.selector}
                items={rule.declarations}
                label="Copy CSS rule"
                onCopy={onCopy}
              />
            </div>
          ))
        ) : (
          <p className="muted empty-small">
            No accessible rules directly match this element.
          </p>
        )}
      </Section>
      <Section title="Inherited styles" count={data.inherited.length}>
        <p className="hint">Common inherited properties and CSS variables declared on ancestors, nearest first. These are candidates; the selected element may override them.</p>
        {data.inherited.map((ancestor, index) => (
          <div className="source-rule" key={index}>
            <p className="rule-context">From {ancestor.element}</p>
            {ancestor.inline.length > 0 && <CodeBlock text={`element.style {\n${cssDeclarations(ancestor.inline)}\n}`} label="Copy inherited inline CSS" onCopy={onCopy} />}
            {ancestor.rules.map((rule, index) => (
              <div key={index}>
                <p className="hint">{rule.origin} {rule.context.join(" → ")}</p>
                <CodeBlock text={`${rule.selector} {\n${cssDeclarations(rule.declarations)}\n}`} label="Copy inherited CSS rule" onCopy={onCopy} />
              </div>
            ))}
          </div>
        ))}
        {!data.inherited.length && <p className="hint">No accessible ancestor declarations found.</p>}
      </Section>
      {data.inaccessible.length > 0 && (
        <Section
          title="Unreadable stylesheets"
          count={data.inaccessible.length}
        >
          <p className="hint">
            Chrome blocked access to these rules. Their effects are still
            included in computed styles.
          </p>
          {data.inaccessible.map((origin) => (
            <p className="restricted-source" key={origin}>
              <LockKeyhole size={12} />
              <span>{origin}</span>
            </p>
          ))}
        </Section>
      )}
      <Section title="Source coverage" open={false}>
        <p className="hint">
          Pseudo-elements and browser default declarations are not listed.
          Inactive media and support queries are excluded. Final inherited
          values and CSS variables appear in Styles.
        </p>
        {data.notes.map((note) => (
          <p className="hint" key={note}>
            {note}
          </p>
        ))}
      </Section>
    </>
  );
}

function SourceDeclarations({ selector, items, label, onCopy }: {
  selector: string;
  items: Declaration[];
  label: string;
  onCopy: CopyHandler;
}) {
  return (
    <div className="code-block source-code">
      <CopyButton text={`${selector} {\n${cssDeclarations(items)}\n}`} label={label} onCopy={onCopy} />
      <code className="source-selector">{selector} {"{"}</code>
      <div className="declaration-statuses">
        {items.map((item) => (
          <div className={`declaration-status ${item.status || "unknown"}`} key={item.property}>
            <code>{item.property}: {item.value}{item.important ? " !important" : ""};</code>
            <span>{item.status || "unknown"}</span>
          </div>
        ))}
      </div>
      <code>{"}"}</code>
    </div>
  );
}

export function App() {
  const { theme, toggleTheme } = useTheme();
  const { enabled, inspection, selectionStatus, tab, error, busy, run } = useInspector();
  const liveSelection = enabled && selectionStatus === "live";
  const [active, setActive] = useState<Tab>("Overview");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2200);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && inspection) void run({ type: "LAYR_CLEAR" });
      if (
        event.key === "/" &&
        active === "Styles" &&
        !(event.target instanceof HTMLInputElement)
      ) {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".search input")?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const onCopy: CopyHandler = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied to clipboard");
      return true;
    } catch {
      setNotice("Copy failed. Focus the panel and try again.");
      return false;
    }
  };
  let domain = "No website selected";
  try {
    domain = tab?.url
      ? new URL(tab.url).hostname || "Local file"
      : tab?.title || "Current tab";
  } catch {
    /* Keep default label. */
  }
  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img src="/icons/layr.svg" alt="" width="29" height="29" />
          <div>
            <span className="wordmark">
              layr<span className="brand-dot">.</span>
            </span>
            <span className="tagline">Look beyond the pixels.</span>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="icon-button theme-toggle"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <div className="power">
            <span className={enabled ? "power-label on" : "power-label"}>
              {enabled ? "ON" : "OFF"}
            </span>
            <button
              className={`toggle ${enabled ? "enabled" : ""}`}
              role="switch"
              aria-label="Inspection mode"
              aria-checked={enabled}
              aria-describedby={error ? "page-access-help" : undefined}
              title={
                error || (enabled ? "Turn inspection off" : "Turn inspection on")
              }
              disabled={busy || !tab}
              onClick={() => void run({ type: "LAYR_ENABLE", enabled: !enabled })}
            >
              <span />
            </button>
          </div>
        </div>
      </header>
      <div className="connection">
        <Globe2 size={12} />
        <span className="domain" title={domain}>
          {domain}
        </span>
        <span className={`status-dot ${enabled ? "live" : ""}`} />
        <span>{enabled ? "Inspecting" : "Inspector OFF"}</span>
      </div>
      {error && (
        <div className="error activation-help" id="page-access-help" role="status">
          <AlertCircle size={16} />
          <div>
            <strong>
              {tab?.url && !/^(https?:|file:)/.test(tab.url)
                ? "Inspection unavailable on this page"
                : "Page access needed"}
            </strong>
            <p>{error}</p>
          </div>
        </div>
      )}
      <nav className="tabs" aria-label="Inspector sections">
        {tabs.map(({ name, icon: Icon }) => (
          <button
            key={name}
            aria-current={active === name ? "page" : undefined}
            className={`tab ${active === name ? "active" : ""}`}
            onClick={() => setActive(name)}
          >
            <Icon size={14} />
            <span>{name}</span>
          </button>
        ))}
      </nav>
      {inspection ? (
        <>
          <div className="selection">
            <div className="selection-heading">
              <span className="eyebrow">SELECTED ELEMENT</span>
              <div className="selection-actions">
                <button
                  className="icon-button"
                  aria-label="Refresh inspection"
                  title={liveSelection ? "Refresh inspection" : "Select an element while inspection is ON to refresh"}
                  disabled={busy || !liveSelection}
                  onClick={() => void run({ type: "LAYR_REFRESH" })}
                >
                  <RefreshCw size={13} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Clear selection"
                  title="Clear selection (Esc)"
                  disabled={busy}
                  onClick={() => void run({ type: "LAYR_CLEAR" })}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="selected-name">
              <code>
                &lt;{inspection.tag}
                <span>
                  {inspection.id
                    ? `#${inspection.id}`
                    : inspection.classes[0]
                      ? `.${inspection.classes[0]}`
                      : ""}
                </span>
                &gt;
              </code>
              <span className="dimension">
                {number(inspection.rect.width)} <span>×</span>{" "}
                {number(inspection.rect.height)}
              </span>
            </div>
            <div className="snapshot-controls">
              <span className="snapshot-status" title={`Captured ${new Date(inspection.capturedAt).toLocaleString()}`}>
                {liveSelection ? "Snapshot captured" : "Saved inspection"}
              </span>
              <button className="filter" disabled={busy || !tab}
                onClick={() => void run({ type: "LAYR_ENABLE", enabled: true })}>Select another element</button>
            </div>
            {selectionStatus === "detached" && <p className="hint" role="status">Element no longer on page — showing captured details</p>}
          </div>
          <main className="inspector-content">
            <Section title="DOM navigation">
              <nav className="breadcrumbs" aria-label="DOM breadcrumb path">
                {inspection.breadcrumb.map((item, index) => (
                  <button key={item.key} disabled={busy || !liveSelection || index === inspection.breadcrumb.length - 1}
                    aria-current={index === inspection.breadcrumb.length - 1 ? "location" : undefined}
                    onClick={() => void run({ type: "LAYR_NAVIGATE", key: item.key })}>
                    {item.label}
                  </button>
                ))}
              </nav>
              <button className="filter" disabled={busy || !liveSelection || inspection.breadcrumb.length < 2}
                onClick={() => void run({ type: "LAYR_NAVIGATE", key: inspection.breadcrumb.at(-2)!.key })}>Select parent</button>
              <details className="children-navigation">
                <summary>Child elements ({inspection.children.length})</summary>
                <div className="child-list">{inspection.children.map((item) => (
                  <button className="filter" key={item.key} disabled={busy || !liveSelection}
                    onClick={() => void run({ type: "LAYR_NAVIGATE", key: item.key })}>{item.label}</button>
                ))}</div>
              </details>
            </Section>
            {active === "Overview" && (
              <Overview data={inspection} onCopy={onCopy} />
            )}
            {active === "Styles" && (
              <Styles data={inspection} onCopy={onCopy} />
            )}
            {active === "Layout" && (
              <Layout data={inspection} onCopy={onCopy} />
            )}
            {active === "Source" && (
              <Source data={inspection} onCopy={onCopy} />
            )}
          </main>
          <div className="copy-bar">
            <button
              className="primary-button"
              onClick={() => void onCopy(inspectionText(inspection))}
            >
              <CopyIcon />
              <span>Copy inspection</span>
              <ArrowUpRight size={14} />
            </button>
            <button className="primary-button ai-copy" onClick={() => void onCopy(inspectionText(inspection))}>
              <Code2 size={15} /><span>Copy for AI</span>
            </button>
            <span>Redacted details. Clipboard only. Review before sharing.</span>
          </div>
        </>
      ) : (
        <main className="empty-state">
          <div className={`empty-art ${enabled ? "ready" : ""}`}>
            <div className="art-grid" />
            <div className="art-layer layer-back" />
            <div className="art-layer layer-front">
              <Code2 size={30} strokeWidth={1.2} />
            </div>
            <div className="art-cursor">
              <MousePointer2 size={19} fill="currentColor" />
            </div>
          </div>
          <span className="eyebrow">YOUR PAGE, UNDER THE SURFACE</span>
          <h1>
            {enabled
              ? "Point. Pick. Understand."
              : "A closer look starts here."}
          </h1>
          <p>
            {enabled
              ? "Hover over any element on the page, then click the blue inspect icon to explore its HTML, styles, and layout."
              : error
                ? "Layr can inspect HTML and CSS on regular websites."
                : "Turn on the toggle above to resume inspecting this page."}
          </p>
          <div className="steps">
            <div>
              <span>01</span>
              <Crosshair size={15} />
              <p>Hover to highlight an element</p>
            </div>
            <div>
              <span>02</span>
              <ScanLine size={15} />
              <p>Click its inspect icon to select</p>
            </div>
            <div>
              <span>03</span>
              <Braces size={15} />
              <p>Explore the details. Copy what matters.</p>
            </div>
          </div>
          <div className="local-note">
            <LockKeyhole size={12} />
            On your browser. On your terms.<span>No uploads. No tracking.</span>
          </div>
        </main>
      )}
      <footer>
        <span className="footer-brand">
          <Layers2 size={12} />
          LAYR <span>v1.0</span>
        </span>
        <span>
          {enabled ? (
            <>
              <kbd>esc</kbd> clear selection
            </>
          ) : (
            "Built for curious eyes."
          )}
        </span>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <Check size={14} />
          {notice}
        </div>
      )}
    </div>
  );
}

function CopyIcon() {
  return <Code2 size={15} />;
}
