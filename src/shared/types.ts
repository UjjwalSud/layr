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
  inspection: Inspection | null;
}
export type ContentCommand =
  | { type: "LAYR_GET_STATE" }
  | { type: "LAYR_ENABLE"; enabled: boolean }
  | { type: "LAYR_CLEAR" }
  | { type: "LAYR_REFRESH" }
  | { type: "LAYR_NAVIGATE"; key: number };
export interface StateEvent {
  type: "LAYR_STATE";
  state: InspectorState;
}
