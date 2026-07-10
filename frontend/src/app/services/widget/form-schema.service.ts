import { Injectable } from '@angular/core';
import { FormField, FormSection, SelectOption, WidgetType } from '../../types';
import { ChartType } from 'chart.js';
import { CHART_TYPES } from '../../utils';
import { ChartWidgetConfig } from '../../types';

const templatePlaceholder = `<h4>Hello {{name}}</h2>\n<p>Welcome to {{company}}</p>`;
const templateHelpText = 'Supports HTML and placeholders like {{name}}';

const schema = [
  {
    widgets: ['pie', 'doughnut'],
    fields: [
      {
        type: 'number',
        name: 'cutout',
        label: 'Cutout (%)',
        defaultValue: 70,
        min: 0,
        max: 100,
      },
      {
        type: 'number',
        name: 'radius',
        label: 'Radius',
        defaultValue: 110,
        min: 0,
      },
      {
        type: 'checkbox',
        name: 'arcPointerPlugin',
        label: 'Arc Pointer Plugin',
        defaultValue: false,
        column: 2,
      },
      {
        type: 'number',
        name: 'arcLineLength',
        label: 'Arc Line Length',
        defaultValue: 30,
      },
      {
        type: 'checkbox',
        name: 'centerTextPlugin',
        label: 'Center Text Plugin',
        column: 2,
        defaultValue: false,
      },
      {
        type: 'select',
        name: 'aggregationMode',
        label: 'Aggregation Mode',
        defaultValue: 'sum',
        optionKey: 'aggregationModeOptions',
      },
      {
        type: 'text',
        name: 'centerSubText',
        label: 'Center Sub Text',
        defaultValue: 'Total',
      },
    ],
  },
  {
    widgets: ['wordCloud'],
    fields: [
      { type: 'number', name: 'rotate', label: 'Rotation', defaultValue: 0 },
      {
        type: 'number',
        name: 'minRotation',
        label: 'Min Rotation',
        defaultValue: 0,
      },
      {
        type: 'number',
        name: 'maxRotation',
        label: 'Max Rotation',
        defaultValue: 0,
      },
      {
        type: 'number',
        name: 'rotationSteps',
        label: 'Rotation Steps',
        defaultValue: 0,
      },
      {
        type: 'number',
        name: 'minFontSize',
        label: 'Min Font Size',
        defaultValue: 28,
        min: 8,
      },
      {
        type: 'number',
        name: 'maxFontSize',
        label: 'Max Font Size',
        defaultValue: 64,
        min: 8,
      },
    ],
  },
  {
    widgets: ['treemap'],
    fields: [
      {
        type: 'color',
        name: 'borderColor',
        label: 'Border Color',
        defaultValue: '#ffffff',
      },
      {
        type: 'number',
        name: 'borderWidth',
        label: 'Border Width',
        defaultValue: 1,
        min: 0,
      },
      {
        type: 'number',
        name: 'spacing',
        label: 'Spacing',
        defaultValue: 0,
        min: 0,
      },
      {
        type: 'select',
        name: 'labelPosition',
        label: 'Label Position',
        defaultValue: 'top',
        optionKey: 'treemapLabelPosition',
      },
      {
        type: 'checkbox',
        name: 'displayLabel',
        label: 'Display Label',
        defaultValue: true,
      },
    ],
  },
  {
    widgets: ['bar'],
    fields: [
      {
        type: 'select',
        name: 'indexAxis',
        label: 'Orientation',
        defaultValue: 'y',
        optionKey: 'barChartOrientation',
        column: 2,
      },
      {
        type: 'checkbox',
        name: 'displayScaleX',
        label: 'Display X Scale',
        defaultValue: true,
      },
      {
        type: 'checkbox',
        name: 'displayScaleY',
        label: 'Display Y Scale',
        defaultValue: false,
      },
      {
        type: 'checkbox',
        name: 'displayGridX',
        label: 'Display X Grid',
        defaultValue: false,
      },
      {
        type: 'checkbox',
        name: 'displayGridY',
        label: 'Display Y Grid',
        defaultValue: false,
      },
      {
        type: 'checkbox',
        name: 'xBeginAtZero',
        label: 'Begin from Zero',
        defaultValue: true,
      },
      {
        type: 'checkbox',
        name: 'labelBelowPlugin',
        label: 'Label Below Plugin',
        defaultValue: true,
      },
      {
        type: 'text',
        name: 'labelBelowPluginFont',
        label: 'Label Font',
        defaultValue: '500 14px Fira Sans',
      },
    ],
  },
  {
    widgets: ['accordion'],
    fields: [
      {
        type: 'select',
        name: 'title',
        label: 'Title Field',
        optionKey: 'stringFields',
        isDataSection: true,
      },
      {
        type: 'select',
        name: 'count',
        label: 'Count Field',
        optionKey: 'stringFields',
        isDataSection: true,
      },
      {
        type: 'number',
        name: 'columns',
        label: 'Body Columns',
        defaultValue: 1,
        min: 1,
        max: 4,
      },
      {
        type: 'select',
        name: 'bodySource',
        label: 'Nested Array Fields',
        optionKey: 'arrayFields',
        isDataSection: true,
      },
      {
        type: 'textarea',
        name: 'body',
        label: 'Body Template',
        variablesKey: 'variables',
        column: 2,
        rows: 4,
        isDataSection: true,
        defaultValue: templatePlaceholder,
        helpText: templateHelpText,
      },
    ],
  },
  {
    widgets: ['card'],
    fields: [
      {
        type: 'select',
        name: 'title',
        label: 'Title Field',
        optionKey: 'stringFields',
        isDataSection: true,
      },
      {
        type: 'select',
        name: 'tag',
        label: 'Tag Field',
        optionKey: 'stringFields',
        isDataSection: true,
      },
      {
        type: 'color-map',
        name: 'color',
        label: 'Color',
        mapKey: 'tagColorMapOptions',
        column: 2,
      },
      {
        type: 'textarea',
        name: 'body',
        label: 'Body Template',
        variablesKey: 'variables',
        column: 2,
        rows: 3,
        isDataSection: true,
        defaultValue: templatePlaceholder,
        helpText: templateHelpText,
      },
      {
        type: 'textarea',
        name: 'caption',
        label: 'Caption Template',
        variablesKey: 'variables',
        column: 2,
        rows: 2,
        isDataSection: true,
        defaultValue: templatePlaceholder,
        helpText: templateHelpText,
      },
    ],
  },
  {
    widgets: ['table'],
    fields: [
      {
        type: 'table',
        name: 'headers',
        label: 'Table Fields',
        variablesKey: 'variables',
        column: 2,
        defaultValue: [{ label: '', value: '' }],
        isDataSection: true,
      },
    ],
  },
] as const satisfies { widgets: WidgetType[]; fields: FormField[] }[];

const CHART_LABEL_AND_DATA = [
  {
    type: 'select',
    name: 'labelKey',
    label: 'Category Label Field',
    required: true,
    optionKey: 'labelOptions',
  },
  {
    type: 'select',
    name: 'dataKey',
    label: 'Data Count',
    required: true,
    optionKey: 'dataOptions',
  },
] as const satisfies FormField[];

const ROOT_SECTION = {
  title: '',
  columns: 2,
  fields: [
    {
      type: 'select',
      name: 'dataset',
      label: 'Field To Display',
      required: true,
      optionKey: 'dataset',
      column: 2,
    },
    {
      type: 'radio',
      name: 'type',
      label: 'Chart Type',
      required: true,
      optionKey: 'widgetTypes',
      column: 2,
    },
  ],
} as const satisfies FormSection;

const WIDGET_TITLE_AND_INFO = [
  {
    type: 'text',
    name: 'chartTitle',
    label: 'Chart Title',
    placeholder: 'Chart Title',
    required: true,
  },
  {
    type: 'textarea',
    name: 'infoText',
    label: 'Chart Info',
    placeholder: '',
  },
] as const satisfies FormField[];

const ADVANCED_SECTION = {
  title: 'Advanced Customization',
  columns: 2,
  fields: [
    {
      type: 'checkbox',
      name: 'displayLegend',
      label: 'Display Legend',
      defaultValue: false,
      column: 2,
      display: ({ type }) =>
        !!(type && CHART_TYPES.includes(type as ChartType)),
    },
    {
      type: 'number',
      name: 'height',
      label: 'Chart Height',
      defaultValue: 352,
      min: 0,
      max: 500,
      column: 2,
      display: ({ type }) => !!type,
    },
    {
      type: 'checkbox',
      name: 'clickAction',
      label: 'Click Action',
      defaultValue: false,
      display: ({ type }) =>
        !!(type && CHART_TYPES.includes(type as ChartType)),
    },
    {
      type: 'select',
      name: 'clickActionDataPath',
      label: 'Click Action Field',
      optionKey: 'clickActionOptions',
      display: (c) => {
        const config = c as ChartWidgetConfig;
        return !!(
          config.type &&
          CHART_TYPES.includes(config.type as ChartType) &&
          config?.clickAction
        );
      },
    },
    {
      type: 'table',
      name: 'headers',
      label: 'Click Action Table Fields',
      variablesKey: 'clickActionVariables',
      defaultValue: [{ label: '', value: '' }],
      column: 2,
      display: (c) => {
        const config = c as ChartWidgetConfig;
        return !!(
          config.type &&
          CHART_TYPES.includes(config.type as ChartType) &&
          config?.clickActionDataPath
        );
      },
    },
  ],
} as const satisfies FormSection;

type AllFields =
  | (typeof schema)[number]['fields'][number]
  | (typeof CHART_LABEL_AND_DATA)[number]
  | (typeof ROOT_SECTION)['fields'][number]
  | (typeof WIDGET_TITLE_AND_INFO)[number]
  | (typeof ADVANCED_SECTION)['fields'][number];

type OptionKeys = Extract<AllFields, { optionKey: string }>['optionKey'];
type VariableKeys = Extract<
  AllFields,
  { variablesKey: string }
>['variablesKey'];
type MapKeys = Extract<AllFields, { mapKey: string }>['mapKey'];

export type FormOptions = Record<VariableKeys, string[]> &
  Record<OptionKeys, SelectOption[]> &
  Record<MapKeys, Record<string, string>>;

@Injectable({
  providedIn: 'root',
})
export class FormSchemaService {
  private ADVANCED_SECTION: FormSection = ADVANCED_SECTION;
  private ROOT_SECTION: FormSection = ROOT_SECTION;

  buildSchema(chartType: ChartType[]): FormSection[] {
    const advancedSection: FormSection = {
      ...this.ADVANCED_SECTION,
      fields: [...this.ADVANCED_SECTION.fields],
    };

    advancedSection.fields.push(
      ...schema.flatMap((item) =>
        this.withDisplay(item.fields, this.chartIn(item.widgets)),
      ),
    );

    const dataSections: FormField[] = advancedSection.fields.filter(
      (item) => item.isDataSection,
    );
    advancedSection.fields = advancedSection.fields.filter(
      (item) => !item.isDataSection,
    );

    const rootSection = structuredClone(this.ROOT_SECTION);
    rootSection.fields.push(
      ...this.withDisplay(WIDGET_TITLE_AND_INFO, ({ type }) => !!type),
      ...this.withDisplay(CHART_LABEL_AND_DATA, ({ type }) =>
        chartType.includes(type as ChartType),
      ),
      ...dataSections,
    );

    return [rootSection, advancedSection];
  }

  static getValues(sections: FormSection[], values?: Record<string, unknown>) {
    return sections
      .flatMap((item) => item.fields)
      .reduce<Record<string, unknown>>((acc, field) => {
        let val = values?.[field.name];
        if (typeof val === 'string') val = val.trim() ? val : undefined;
        acc[field.name] = val ?? field?.defaultValue ?? '';
        return acc;
      }, {});
  }

  static getErrors(
    sections: FormSection[],
    values: Record<string, unknown>,
  ): string[] {
    return sections
      .flatMap((item) => item.fields)
      .map((field) => {
        if (!field.required) return null;
        let val = values?.[field.name];
        let isEmpty = false;
        if (typeof val === 'string') isEmpty = !val.trim();
        else isEmpty = val === undefined || val === null;

        return isEmpty ? `${field.label || field.name} is required` : null;
      }, {})
      .filter(Boolean) as string[];
  }

  private withDisplay(
    fields: FormField[],
    display: FormField['display'],
  ): FormField[] {
    return fields.map((field) => ({ ...field, display }));
  }

  private chartIn(chart: WidgetType[]): FormField['display'] {
    return ({ type }) => !!(type && chart.includes(type));
  }
}
