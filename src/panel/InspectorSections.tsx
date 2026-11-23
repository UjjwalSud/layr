import { useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { availableCSS, computedCSS, cssDeclarations, ruleCSS } from "../shared/format";
import { resourceURL } from "../shared/resources";
import type { CSSVariable, Declaration, ElementTree, Inspection, SourceRule } from "../shared/types";
import { CodeBlock, ColorSwatch, CopyButton, Properties, Section, type CopyHandler } from "./components";

type Props = { data: Inspection; onCopy: CopyHandler };
const number = (value: number) => Number(value.toFixed(2)).toString();
const path = (data: Inspection) => data.breadcrumb.map((item) => item.label).join(" > ");

function TreeNode({ node, canNavigate, navigate, root = false }: { node: ElementTree; canNavigate: boolean; navigate: (key: number) => void; root?: boolean }) {
  const [expanded, setExpanded] = useState(root);
  const hasChildren = node.children.length > 0 || node.truncated;
  return <div className="tree-node">
    <div className={`tree-row ${root ? "selected" : ""}`}>
      {hasChildren ? <button className="tree-expander" aria-label={`${expanded ? "Collapse" : "Expand"} ${node.label}`} aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}><ChevronRight size={12} className={expanded ? "rotated" : ""} /></button> : <span className="tree-spacer" />}
      <button className="tree-select" disabled={root || !canNavigate} onClick={() => navigate(node.key)} title={canNavigate ? `Select ${node.label}` : "Captured hierarchy; select a live element to navigate"}><code>{node.label}</code></button>
    </div>
    {expanded && hasChildren && <div className="tree-children">
      {node.text && <div className="tree-text">{node.text}</div>}
      {node.children.map((child) => <TreeNode key={child.key} node={child} canNavigate={canNavigate} navigate={navigate} />)}
      {node.truncated && <p className="hint">More children omitted. Select a live child to explore deeper.</p>}
    </div>}
    {!hasChildren && node.text && <div className="tree-text">{node.text}</div>}
  </div>;
}

export function ElementDetails({ data, onCopy, canNavigate, navigate }: Props & { canNavigate: boolean; navigate: (key: number) => void }) {
  return <Section title="HTML / Element details" open={false}>
    <Section title="DOM navigation" action={<CopyButton text={path(data)} label="Copy element path" onCopy={onCopy} />}>
      <nav className="breadcrumbs" aria-label="DOM breadcrumb path">{data.breadcrumb.map((item, index) => <button key={item.key}
        aria-label={item.label} disabled={!canNavigate || index === data.breadcrumb.length - 1} aria-current={index === data.breadcrumb.length - 1 ? "location" : undefined}
        onClick={() => navigate(item.key)}>{item.label}</button>)}</nav>
      <button className="text-button" disabled={!canNavigate || data.breadcrumb.length < 2} onClick={() => navigate(data.breadcrumb.at(-2)!.key)}>Select parent</button>
      {data.tree && <div className="element-tree" aria-label="Captured element hierarchy"><TreeNode key={data.tree.key} node={data.tree} root canNavigate={canNavigate} navigate={navigate} /></div>}
      <details className="children-navigation"><summary>Child elements ({data.children.length})</summary><div className="child-list">{data.children.map((item) => <button className="text-button" key={item.key} disabled={!canNavigate} onClick={() => navigate(item.key)}>{item.label}</button>)}</div></details>
      {!canNavigate && <p className="hint">Captured hierarchy remains available. Navigation requires a live selection with Inspector ON.</p>}
    </Section>
    <Properties entries={[["tag", data.tag], ["id", data.id || "(none)"], ["classes", data.classes.join(" ") || "(none)"], ["text", data.text || "(empty)"], ["scope", data.scope]]} onCopy={onCopy} />
    <Section title="Attributes" count={data.attributes.length} open={false} action={<CopyButton text={data.attributes.map(([name, value]) => `${name}=${JSON.stringify(value)}`).join("\n")} label="Copy attributes" onCopy={onCopy} />}>
      <Properties entries={data.attributes} onCopy={onCopy} />
    </Section>
    <Section title="Element HTML" open={false}>
      <CodeBlock text={data.html} label="Copy HTML" onCopy={onCopy} />
      {data.htmlTruncated && <p className="hint">HTML capture truncated (60,000 characters or bounded subtree limit).</p>}
    </Section>
  </Section>;
}

function SourceLink({ origin, onCopy }: { origin: string; onCopy: CopyHandler }) {
  const url = resourceURL(origin);
  let label = origin || "Source unavailable";
  if (url) { try { const parsed = new URL(url); label = parsed.pathname.split("/").pop() || parsed.hostname; } catch { /* Keep origin. */ } }
  return <div className="origin">{url ? <><a href={url} target="_blank" rel="noreferrer" title={origin}>{label}</a><CopyButton text={origin} label="Copy stylesheet URL" onCopy={onCopy} /></> : <span title={origin}>{label}</span>}</div>;
}

function VariableDetails({ variable, onCopy }: { variable: CSSVariable; onCopy: CopyHandler }) {
  const [expanded, setExpanded] = useState(false);
  return <details className="css-variable" data-variable={variable.name} open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary><code>{variable.name}</code><span className="variable-current">{variable.computedValue !== null && <ColorSwatch value={variable.computedValue} />}<code>{variable.computedValue ?? "Empty or unresolved"}</code></span></summary>
    {expanded && <div className="variable-details">
      <div className="variable-copy"><span className="hint">Selected element · computed value</span><CopyButton text={`var(${CSS.escape(variable.name)})`} label={`Copy variable reference ${variable.name}`} onCopy={onCopy} />{variable.computedValue !== null && <CopyButton text={variable.computedValue} label={`Copy resolved ${variable.name}`} onCopy={onCopy} />}</div>
      {variable.computedValue === null && <p className="hint">Empty, missing or invalid at capture (including circular references). No value is inferred.</p>}
      {!variable.definitions.length && <p className="hint">Declaration unavailable in accessible styles. Source unavailable.</p>}
      {variable.definitions.map((definition, index) => <div className={`variable-definition ${definition.status}`} key={index}>
        <div className="variable-copy"><code className="variable-original">{variable.name}: <ColorSwatch value={definition.value} />{definition.value || "(empty)"}{definition.important ? " !important" : ""};</code><CopyButton text={`${variable.name}: ${definition.value}${definition.important ? " !important" : ""};`} label={`Copy variable declaration ${variable.name}`} onCopy={onCopy} /></div>
        <p className="hint" title={definition.element}>Defined on: <code>{definition.selector === "element.style" ? definition.element : definition.selector}</code>{definition.inherited ? " · ancestor" : " · selected element"}</p>
        <p className="variable-source-status">{definition.status === "nearest" ? "Nearest winning accessible declaration" : definition.status === "overridden" ? "Overridden among accessible declarations" : "Candidate · winning source unverified"}</p>
        <SourceLink origin={definition.origin} onCopy={onCopy} />
        {/^(https?:|file:)/.test(definition.origin) && <span className="hint">Source line unavailable</span>}
        {definition.context.length > 0 && <p className="rule-context">{definition.context.join(" → ")}</p>}
        {!!definition.references.length && <div className="variable-dependencies"><p className="hint">Dependencies on {definition.element} at capture:</p>{definition.references.map((reference, i) => <div key={i}><code>{reference.name}: {reference.computedValue ?? "empty or unresolved"}</code>{reference.fallback !== undefined && <p className="hint">Declared fallback: <code>{reference.fallback || "(empty)"}</code></p>}</div>)}</div>}
      </div>)}
    </div>}
  </details>;
}

function VariableUsage({ item, variables, onCopy }: { item: Declaration; variables: CSSVariable[]; onCopy: CopyHandler }) {
  const names = [...new Set([...(item.property.startsWith("--") ? [item.property] : []), ...(item.variableReferences || []).map((reference) => reference.name)])];
  return <div className="variable-usage" data-property={item.property}>
    <div className="variable-resolved" title="Actual selected-element value at capture, not an evaluation of an overridden declaration"><span>Selected · computed</span>{item.computedValue != null ? <><ColorSwatch value={item.computedValue} /><code>{item.computedValue}</code><CopyButton text={item.computedValue} label={`Copy resolved ${item.property}`} onCopy={onCopy} /></> : <span className="hint">Empty or unavailable</span>}<CopyButton text={item.value} label={`Copy original value for ${item.property}`} onCopy={onCopy} /></div>
    {(item.variableReferences || []).filter((reference) => reference.fallback !== undefined).map((reference, index) => <p className="hint" key={index}>Fallback for <code>{reference.name}</code>: <code>{reference.fallback || "(empty)"}</code> (declared)</p>)}
    {names.map((name) => <VariableDetails key={name} variable={variables.find((variable) => variable.name === name) || { name, computedValue: null, definitions: [] }} onCopy={onCopy} />)}
  </div>;
}

function Declarations({ selector, items, onCopy, mode, variables }: { selector: string; items: Declaration[]; onCopy: CopyHandler; mode?: string; variables?: CSSVariable[] }) {
  return <div className="source-code"><code className="source-selector">{selector} {"{"}</code>
    <div className="declaration-statuses">{items.map((item) => {
      const status = mode || (item.status === "active" ? "applied" : item.status || "unknown");
      return <div className="declaration-entry" key={item.property}><div className={`declaration-status ${status}`}>
        <code><span className="syntax-property">{item.property}</span>: <span className="syntax-value">{item.value}</span>{item.important && <strong className="important"> !important</strong>};</code>
        <span className="declaration-label" title={status === "unknown" ? "Cascade cannot be resolved reliably from available author styles" : status}>{status}</span>
        <CopyButton text={`${item.property}: ${item.value}${item.important ? " !important" : ""};`} label={`Copy declaration ${item.property}`} onCopy={onCopy} />
      </div>{variables && item.computedValue !== undefined && <VariableUsage item={item} variables={variables} onCopy={onCopy} />}</div>;
    })}</div><code>{"}"}</code>
  </div>;
}

function Rule({ rule, onCopy, mode, filter, variables }: { rule: SourceRule; onCopy: CopyHandler; mode?: string; filter?: (item: Declaration) => boolean; variables?: CSSVariable[] }) {
  return <div className={`source-rule ${rule.active === false ? "inactive-rule" : ""}`}>
    <div className="rule-toolbar"><SourceLink origin={rule.origin} onCopy={onCopy} /><CopyButton text={ruleCSS(rule)} label="Copy CSS rule" onCopy={onCopy} /></div>
    {rule.context.length > 0 && <div className="rule-context">{rule.context.join(" → ")}</div>}
    <Declarations selector={rule.selector} items={filter ? rule.declarations.filter(filter) : rule.declarations} onCopy={onCopy} mode={mode || (rule.active === false ? "inactive" : undefined)} variables={variables} />
  </div>;
}

const computedGroups: Record<string, (key: string) => boolean> = {
  All: () => true,
  Typography: (key) => /^(font|line-height|letter-spacing|text-|word-|white-space|color$)/.test(key),
  Colors: (key) => /color|background|fill$|stroke/.test(key),
  Layout: (key) => /^(display|position|inset|top$|right$|bottom$|left$|width|height|min-|max-|margin|padding|box-sizing|flex|grid|gap|row-gap|column-gap|align-|justify-|order|overflow)/.test(key),
  Effects: (key) => /border|shadow|opacity|filter|transform|transition|animation|outline|blend|clip/.test(key),
  Variables: (key) => key.startsWith("--"),
};

export function CSSStyles({ data, onCopy }: Props) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("All");
  const matches = (item: Declaration) => `${item.property} ${item.value}`.toLowerCase().includes(query.toLowerCase());
  const filterRules = (rules: SourceRule[]) => rules.filter((rule) => rule.declarations.some(matches));
  const inline = data.inline.filter(matches);
  const rules = filterRules(data.rules);
  const inactive = filterRules(data.inactiveRules || []);
  const inherited = data.inherited.map((ancestor) => ({ ...ancestor, originalInline: ancestor.inline, inline: ancestor.inline.filter(matches), rules: filterRules(ancestor.rules) })).filter((ancestor) => ancestor.inline.length || ancestor.rules.length);
  const entries = Object.entries(data.computed).sort(([a], [b]) => a.localeCompare(b)).filter(([key, value]) => computedGroups[group](key) && matches({ property: key, value, important: false }));
  const variables = data.variables?.filter((variable) => `${variable.name} ${variable.computedValue || ""} ${variable.definitions.map((definition) => `${definition.value} ${definition.selector} ${definition.origin}`).join(" ")}`.toLowerCase().includes(query.toLowerCase())) || [];
  return <Section title="CSS styles" action={<CopyButton text={availableCSS(data)} label="Copy all available CSS" onCopy={onCopy} />}>
    <label className="search"><Search size={13} /><input aria-label="Filter CSS properties" placeholder="Search properties or values…" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>/</kbd></label>
    <p className="hint css-legend"><span className="applied">Applied</span><span className="overridden">Overridden</span><span>Unknown = unresolved cascade</span></p>
    {data.variables?.length ? <p className="hint">Variable annotations show the selected element's final value; an overridden source declaration may differ.</p> : null}
    {inline.length > 0 && <div className="source-rule"><div className="rule-toolbar"><span className="origin">Inline Style</span><CopyButton text={`element.style {\n${cssDeclarations(data.inline)}\n}`} label="Copy inline CSS" onCopy={onCopy} /></div><Declarations selector="element.style" items={inline} onCopy={onCopy} variables={data.variables} /></div>}
    {rules.map((rule, index) => <Rule key={index} rule={rule} onCopy={onCopy} filter={matches} variables={data.variables} />)}
    {!inline.length && !rules.length && <p className="hint">No accessible matching declarations{query ? " for this search" : ""}.</p>}
    {!!data.variables?.length && <Section title="CSS variables" count={variables.length} open={false}><p className="hint">Actual computed values on the selected element. Accessible definitions appear when expanded; unknown sources stay candidates.</p>{variables.map((variable) => <VariableDetails key={variable.name} variable={variable} onCopy={onCopy} />)}</Section>}
    <Section title="Inherited styles" count={inherited.length} open={false}>
      <p className="hint">Common inherited properties and variables from ancestors, nearest first. Candidates only; declarations may not reach this element.</p>
      {inherited.map((ancestor, index) => <div className="inherited-group" key={index}><p className="rule-context">Inherited from {ancestor.element}</p>
        {ancestor.inline.length > 0 && <><div className="rule-toolbar"><span className="origin">Inline Style</span><CopyButton text={`element.style {\n${cssDeclarations(ancestor.originalInline)}\n}`} label="Copy inherited inline CSS" onCopy={onCopy} /></div><Declarations selector="element.style" items={ancestor.inline} onCopy={onCopy} mode="inherited" variables={data.variables} /></>}
        {ancestor.rules.map((rule, i) => <Rule rule={rule} key={i} onCopy={onCopy} mode="inherited" filter={matches} variables={data.variables} />)}
      </div>)}
    </Section>
    {inactive.length > 0 && <Section title="Inactive conditional rules" count={inactive.length} open={false}>{inactive.map((rule, index) => <Rule rule={rule} key={index} onCopy={onCopy} filter={matches} variables={data.variables} />)}</Section>}
    <Section title="Computed properties" count={entries.length} open={false} action={<CopyButton text={computedCSS(data)} label="Copy all computed CSS" onCopy={onCopy} />}>
      <div className="computed-toolbar"><span className="hint">Final browser values</span><select aria-label="Computed property group" value={group} onChange={(event) => setGroup(event.target.value)}>{Object.keys(computedGroups).map((name) => <option key={name}>{name}</option>)}</select></div>
      <Properties entries={entries} onCopy={onCopy} css />
    </Section>
    {data.inaccessible.length > 0 && <Section title="Unreadable stylesheets" count={data.inaccessible.length} open={false}><p className="hint">Source unavailable — browser access restriction. Effects remain included in computed values.</p>{data.inaccessible.map((origin) => <SourceLink key={origin} origin={origin} onCopy={onCopy} />)}</Section>}
  </Section>;
}

export function SourceCoverage({ data }: { data: Inspection }) {
  return <Section title="Source coverage" open={false}>{data.notes.map((note) => <p className="hint" key={note}>{note}</p>)}</Section>;
}

export function ElementStates({ data, onCopy }: Props) {
  const activeStates = Object.entries(data.states || {}).filter(([, value]) => value).map(([name]) => name);
  return <Section title="States & pseudo-elements" count={data.stateRules?.length || 0} open={false}>
    <p className="hint">At capture: <span className="syntax-value">{activeStates.join(", ") || "normal (no tracked states active)"}</span>. States are never forced.</p>
    {data.hoverState && <Section title="Captured interaction state" open={false}><Properties entries={Object.entries(data.hoverState).map(([key, value]) => [key, String(value ?? "(unset)")])} onCopy={onCopy} /></Section>}
    {(data.stateRules || []).map((rule, index) => <div key={index}><p className="state-status">{rule.active ? "Active at capture" : "Defined · inactive at capture"}{rule.pseudo ? ` · ${rule.pseudo}` : ""}</p><Rule rule={rule} onCopy={onCopy} mode={rule.active ? "defined" : "inactive"} /></div>)}
    {!data.stateRules?.length && <p className="hint">No accessible state selectors found. Inaccessible stylesheets and complex selectors may define additional states.</p>}
    {(data.pseudos || []).map((pseudo) => <Section key={pseudo.selector} title={`${pseudo.selector} computed values`} open={false}><Properties entries={Object.entries(pseudo.computed)} onCopy={onCopy} css /></Section>)}
  </Section>;
}

function BoxModel({ data }: { data: Inspection }) {
  const value = (name: string) => data.computed[name]?.replace(/px$/, "") ?? "—";
  const contentSize = (axis: "width" | "height") => {
    const size = data.computed[axis];
    if (!size?.endsWith("px") || data.computed["box-sizing"] !== "border-box") return value(axis);
    const sides = axis === "width" ? ["left", "right"] : ["top", "bottom"];
    const edges = sides.reduce((sum, side) => sum + (parseFloat(data.computed[`padding-${side}`]) || 0) + (parseFloat(data.computed[`border-${side}-width`]) || 0), 0);
    return number(Math.max(0, parseFloat(size) - edges));
  };
  const sides = (prefix: string, suffix = "") => <>{["top", "right", "bottom", "left"].map((side) => <span className={`side ${side}`} key={side} title={`${prefix}-${side}${suffix}: ${data.computed[`${prefix}-${side}${suffix}`]}`}>{value(`${prefix}-${side}${suffix}`)}</span>)}</>;
  return <div className="box-model" role="img" aria-label="CSS box model: margin, border, padding, and content dimensions"><div className="box-margin"><span className="box-label">margin</span>{sides("margin")}<div className="box-border"><span className="box-label">border</span>{sides("border", "-width")}<div className="box-padding"><span className="box-label">padding</span>{sides("padding")}<div className="box-content">{contentSize("width")}<span>×</span>{contentSize("height")}</div></div></div></div></div>;
}

export function Layout({ data, onCopy }: Props) {
  const entries = (keys: string[]): [string, string][] => keys.filter((key) => data.computed[key] !== undefined).map((key) => [key, data.computed[key]]);
  return <Section title="Layout & box model"><BoxModel data={data} /><p className="hint">Captured CSS box in px; content excludes padding and borders. Visual bounds include transforms.</p>
    <Properties entries={[["visual dimensions", `${number(data.rect.width)} × ${number(data.rect.height)} px`], ...entries(["display", "position", "box-sizing"]) ]} onCopy={onCopy} />
    <Section title="Dimensions & position" open={false}><Properties entries={entries(["width", "height", "min-width", "max-width", "min-height", "max-height", "top", "right", "bottom", "left", "z-index", "overflow-x", "overflow-y"])} onCopy={onCopy} /></Section>
    <Section title="Flex & grid" open={false}><Properties entries={entries(["flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "align-items", "align-self", "justify-content", "gap", "grid-template-columns", "grid-template-rows", "grid-column", "grid-row"])} onCopy={onCopy} /></Section>
    <Section title="Appearance & typography" open={false}><Properties entries={entries(["background", "color", "font-family", "font-size", "font-weight", "line-height", "border-radius", "border-top", "border-right", "border-bottom", "border-left", "box-shadow", "text-shadow"])} onCopy={onCopy} /></Section>
  </Section>;
}
