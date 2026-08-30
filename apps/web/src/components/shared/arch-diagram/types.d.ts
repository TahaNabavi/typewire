import { NODES } from "./data/nodes";

export type NodeKey = keyof typeof NODES;

export type NodeVariant =
  | "primary"
  | "secondary"
  | "package"
  | "group"
  | "integration";

export type NodeSpec = {
  x: number;
  y: number;

  label: string;
  description?: string;

  color: string;
  section: string;

  variant?: NodeVariant;

  width?: number;
  height?: number;
  radius?: number;

  muted?: boolean;
};
export type SectionStyle = {
  background?: string;
  border?: string;
  borderWidth?: number;
  radius?: number;
  opacity?: number;

  hoverBackground?: string;
  hoverBorder?: string;
  hoverBorderWidth?: number;
  hoverOpacity?: number;

  padding?: number;

  titleColor?: string;
  hoverTitleColor?: string;

  descColor?: string;
  hoverDescColor?: string;

  titleSize?: number;
  descSize?: number;
};

export interface SectionSpec {
  id: string;
  start: [number, number];
  end: [number, number];

  title: string;
  desc?: string;

  style?: SectionStyle;
}

export type EdgeKind =
  | "dependency"
  | "transport"
  | "integration"
  | "optional"
  | "runtime";

export interface EdgeSpec {
  from: NodeKey;
  to: NodeKey;

  kind?: EdgeKind;

  color?: string;
  width?: number;

  dashed?: boolean;

  pulse?: boolean;
  dur?: number;

  opacity?: number;
}

export interface SplitEdgeSpec {
  from: NodeKey;
  to: NodeKey[];

  kind?: EdgeKind;

  color?: string;
  width?: number;

  dashed?: boolean;

  pulse?: boolean;
  dur?: number;

  opacity?: number;
}