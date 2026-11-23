import { Check, ChevronDown, Copy } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function CopyButton({
  text,
  label = "Copy",
  onCopy,
}: {
  text: string;
  label?: string;
  onCopy: (text: string) => Promise<boolean>;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    if (await onCopy(text)) {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1400);
    }
  }
  return (
    <button
      className="icon-button copy-button"
      title={copied ? "Copied" : label}
      aria-label={label}
      onClick={() => void copy()}
    >
      {copied ? <Check size={13} className="success" /> : <Copy size={13} />}
    </button>
  );
}

export function Section({
  title,
  count,
  children,
  open = true,
  action,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  open?: boolean;
  action?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(open);
  return (
    <details className="section" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>
        <ChevronDown size={13} />
        <span>{title}</span>
        {count !== undefined && <span className="count">{count}</span>}
      </summary>
      {expanded && action && <div className="section-action">{action}</div>}
      {expanded && <div className="section-body">{children}</div>}
    </details>
  );
}

export type CopyHandler = (text: string) => Promise<boolean>;
export function ColorSwatch({ value }: { value: string }) {
  // Never resolve a page variable or context-dependent color against the panel.
  if (!CSS.supports("color", value) || /\b(var|env|attr|light-dark)\s*\(|\b(currentcolor|inherit|initial|unset|revert|revert-layer|canvas|canvastext|linktext|visitedtext|activetext|buttonface|buttontext|buttonborder|field|fieldtext|highlight|highlighttext|selecteditem|selecteditemtext|mark|marktext|graytext|accentcolor|accentcolortext)\b/i.test(value)) return null;
  return <span className="swatch" style={{ backgroundColor: value }} title={value} role="img" aria-label={`Color ${value}`} />;
}
export function Properties({
  entries,
  onCopy,
  css = false,
}: {
  entries: [string, string][];
  onCopy: CopyHandler;
  css?: boolean;
}) {
  if (!entries.length)
    return <p className="muted empty-small">No properties match.</p>;
  return (
    <div className="properties">
      {entries.map(([key, value]) => (
        <div className="property" key={key}>
          <span className="property-name" title={key}>
            {key}
          </span>
          <span className="property-value">
            <ColorSwatch value={value} />
            <span>{value || "—"}</span>
          </span>
          <CopyButton text={css ? `${key}: ${value};` : value} label={`Copy ${key}`} onCopy={onCopy} />
        </div>
      ))}
    </div>
  );
}

export function CodeBlock({
  text,
  label,
  onCopy,
}: {
  text: string;
  label: string;
  onCopy: CopyHandler;
}) {
  return (
    <div className="code-block">
      <CopyButton text={text} label={label} onCopy={onCopy} />
      <pre>{text.split(/(<\/?[a-zA-Z][^>]*>)/g).map((part, index) => part.startsWith("<")
        ? <span className="syntax-tag" key={index}>{part.split(/("[^"]*"|'[^']*')/g).map((token, i) => <span className={/^["']/.test(token) ? "syntax-value" : undefined} key={i}>{token}</span>)}</span>
        : part)}</pre>
    </div>
  );
}
