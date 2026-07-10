import { ChartType } from 'chart.js';
import { KeyOfUnion } from './common';
export interface BaseWidgetConfig {
  dataset: string;
  type: WidgetType;
  chartTitle?: string;
  showInfo?: boolean;
  infoText?: string;
  height?: number;
}

export interface ChartDataConfig {
  labelKey: string;
  dataKey: string;
  displayLegend?: boolean;
  clickAction?: boolean;
  clickActionDataPath?: string;
  headers: { label: string; value: string }[];
}

export interface PieChartConfig {
  cutout?: number;
  radius?: number;
  arcPointerPlugin?: boolean;
  arcLineLength?: number;
  centerTextPlugin?: boolean;
  aggregationMode?: 'total' | 'count';
  centerSubText?: string;
}

export interface WordCloudConfig {
  rotate?: number;
  minRotation?: number;
  maxRotation?: number;
  rotationSteps?: number;
  maxFontSize?: number;
  minFontSize?: number;
}

export interface TreeMapConfig {
  borderColor?: string;
  borderWidth?: number;
  spacing?: number;
  labelPosition?: 'top' | 'middle' | 'bottom';
  displayLabel?: boolean;
}

export interface BarChartConfig {
  indexAxis?: 'x' | 'y';
  displayScaleX?: boolean;
  displayScaleY?: boolean;
  displayGridX?: boolean;
  displayGridY?: boolean;
  xBeginAtZero?: boolean;
  labelBelowPlugin?: boolean;
  labelBelowPluginFont?: string;
}

export interface ChartWidgetConfig
  extends
    BaseWidgetConfig,
    ChartDataConfig,
    Partial<PieChartConfig>,
    Partial<WordCloudConfig>,
    Partial<TreeMapConfig>,
    Partial<BarChartConfig> {
  type: ChartType;
}

export interface AccordionWidgetConfig extends BaseWidgetConfig {
  type: 'accordion';
  title: string;
  count: string;
  columns?: number;
  bodySource?: 'self' | string;
  body: string;
}

export interface CardWidgetConfig extends BaseWidgetConfig {
  type: 'card';
  title: string;
  body: string;
  caption: string;
  tag: string;
  color?: Record<string, string>;
}

export interface TableWidgetConfig extends BaseWidgetConfig {
  type: 'table';
  title: string;
  headers: { label: string; value: string }[];
}

export type WidgetConfig =
  | ChartWidgetConfig
  | AccordionWidgetConfig
  | CardWidgetConfig
  | TableWidgetConfig;

export type WidgetKeys = KeyOfUnion<WidgetConfig>;

export type WidgetType = ChartType | 'accordion' | 'card' | 'table';

export interface WidgetData<T = unknown> {
  config: WidgetConfig;
  data: T[];
}

export interface SelectOption<T = string> {
  label: string;
  value: T;
}
