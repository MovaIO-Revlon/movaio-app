import { ChartType } from 'chart.js';
import { TOption } from '../components/select/select';

export const CHART_COLOR_SET10 = [
  '#F17A92',
  '#FFA242',
  '#F9C426',
  '#7BD189',
  '#3BCEAC',
  '#4A90E2',
  '#8E7CC3',
  '#D9534F',
  '#2D6A4F',
  '#1D3557',
];

export const PRIORITY_COLOR_MAPPING: Record<string, [string, string]> = {
  HIGH: ['#29B14B', '#29B14B33'],
  MEDIUM: ['#FFA242', '#FFA24233'],
  LOW: ['#F17A92', '#F17A9233'],
};

export const CHART_TYPES: ChartType[] = [
  'bar',
  'line',
  'pie',
  // 'doughnut',
  // 'radar',
  // 'polarArea',
  // 'bubble',
  // 'scatter',
  'treemap',
  'wordCloud',
];

export const entityOptions: TOption[] = [
  { label: 'Incident', value: 'incident' },
  { label: 'Defect', value: 'defect' },
  { label: 'Testcase', value: 'testcase' },
];

export const CHART_ICON_MAP = {
  bar: 'fa-chart-simple',
  pie: 'fa-chart-pie',
  line: 'fa-chart-line',
};

export const INSIGHT_DEFAULT_USE_CASE_JSON = `{
  "formats": [
    {
      "description": "",
      "format_name": "",
      "recommended_charts": [],
      "sample_json": {
        // your sample data here
      }
    }
  ]
}
`;

export const TRENDS_DEFALUT_USE_CASE_JSON = `{
  chartfit_structure_json: {
    chart_type: 'table',
    data_source: 'hits',
    extraction_config: {
      fields_to_extract: ['id', 'name', 'description'],
    },
  },
  opensearch_query: {
    _source: ['id', 'name', 'description'],
    query: {
      bool: {
        must_not: [
          {
            exists: {
              field: 'description',
            },
          },
        ],
      },
    },
    size: 1000,
  },
}`;

export const PSV_REGEX = /```psv\s+([^\n]+)\n([\s\S]*?)```/g;
