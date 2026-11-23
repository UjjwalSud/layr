export interface Declaration {
  property: string;
  value: string;
  important: boolean;
  status?: "active" | "overridden" | "unknown";
  variableReferences?: VariableReference[];
  computedValue?: string | null;
}
export interface VariableReference {
  name: string;
  fallback?: string;
}
export interface VariableDefinition {
  value: string;
  important: boolean;
  selector: string;
  element: string;
  inherited: boolean;
  origin: string;
  context: string[];
  status: "nearest" | "overridden" | "candidate";
  references: (VariableReference & { computedValue: string | null })[];
}
export interface CSSVariable {
  name: string;
  computedValue: string | null;
  definitions: VariableDefinition[];
}
export interface ElementLink {
  key: number;
  label: string;
}
export interface ElementTree extends ElementLink {
  text: string;
  children: ElementTree[];
  truncated: boolean;
}
export interface ImageDetails {
  kind: "img" | "background" | "svg-reference";
  url: string;
  src?: string;
  currentSrc?: string;
  srcset?: string;
  sources?: string[];
  alt?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  width: number;
  height: number;
  format?: string;
}
export interface IconDetails {
  kind: "Inline SVG" | "SVG reference" | "Icon font" | "Pseudo-element" | "Image icon";
  html: string;
  svg?: string;
  truncated?: boolean;
  url?: string;
  glyph?: string;
  font?: string;
  classes: string[];
  color: string;
  width?: number;
  height?: number;
}
export interface PseudoDetails {
  selector: "::before" | "::after";
  computed: Record<string, string>;
}
export interface InheritedStyles {
  element: string;
  inline: Declaration[];
  rules: SourceRule[];
}
export interface SourceRule {
  selector: string;
  origin: string;
  context: string[];
  declarations: Declaration[];
  active?: boolean;
  states?: string[];
  pseudo?: string;
}
export interface Inspection {
  variables?: CSSVariable[];
  navigationAvailable?: boolean;
  tree?: ElementTree;
  images?: ImageDetails[];
  icons?: IconDetails[];
  stateRules?: SourceRule[];
  inactiveRules?: SourceRule[];
  states?: Record<string, boolean>;
  pseudos?: PseudoDetails[];
  hoverState?: { hovered: boolean; focusWithin: boolean; expanded: string | null; state: string | null };
  tag: string;
  text: string;
  id: string;
  classes: string[];
  attributes: [string, string][];
  html: string;
  htmlTruncated: boolean;
  selector: string;
  scope: string;
  computed: Record<string, string>;
  inline: Declaration[];
  rules: SourceRule[];
  inaccessible: string[];
  notes: string[];
  inherited: InheritedStyles[];
  breadcrumb: ElementLink[];
  children: ElementLink[];
  rect: { width: number; height: number; x: number; y: number };
  capturedAt: string;
}
export interface InspectorState {
  enabled: boolean;
  frozen: boolean;
  temporaryTargets: TemporaryTarget[];
  inspection: Inspection | null;
  selectionStatus: "live" | "captured" | "detached" | "saved" | null;
}
export interface TemporaryTarget {
  key: number;
  tag: string;
  text: string;
  classes: string[];
  role: string;
  status: "live" | "captured";
}
export type ContentCommand =
  | { type: "LAYR_GET_STATE" }
  | { type: "LAYR_ENABLE"; enabled: boolean }
  | { type: "LAYR_CLEAR" }
  | { type: "LAYR_REFRESH" }
  | { type: "LAYR_FREEZE"; frozen: boolean }
  | { type: "LAYR_TOGGLE_FREEZE" }
  | { type: "LAYR_SELECT_TEMPORARY"; key: number }
  | { type: "LAYR_NAVIGATE"; key: number };
export interface StateEvent {
  type: "LAYR_STATE";
  state: InspectorState;
  snapshotChanged: boolean;
}
export type SnapshotCommand =
  | { type: "LAYR_GET_SNAPSHOT"; tabId?: number }
  | { type: "LAYR_CLEAR_SNAPSHOT"; tabId: number };
