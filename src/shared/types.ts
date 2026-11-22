export interface Declaration {
  property: string;
  value: string;
  important: boolean;
  status?: "active" | "overridden" | "unknown";
}
export interface ElementLink {
  key: number;
  label: string;
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
}
export interface Inspection {
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
