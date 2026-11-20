import { Check, ChevronDown, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";

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
  async function copy() {
    if (await onCopy(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
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
  return (
    <details className="section" open={open}>
      <summary>
        <ChevronDown size={13} />
        <span>{title}</span>
        {count !== undefined && <span className="count">{count}</span>}
      </summary>
      {action && <div className="section-action">{action}</div>}
      <div className="section-body">{children}</div>
    </details>
  );
}

export type CopyHandler = (text: string) => Promise<boolean>;
export function Properties({
  entries,
  onCopy,
}: {
  entries: [string, string][];
  onCopy: CopyHandler;
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
            {CSS.supports("color", value) && (
              <span className="swatch" style={{ backgroundColor: value }} />
            )}
            <span>{value || "—"}</span>
          </span>
          <CopyButton text={value} label={`Copy ${key}`} onCopy={onCopy} />
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
      <pre>{text}</pre>
    </div>
  );
}
