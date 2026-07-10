import { WidgetConfig } from './widget.types';

export type TConnectorType =
  | 'jira'
  | 'excel'
  | 'team_dynamix'
  | 'docx'
  | 'pdf'
  | 'ppt'
  | 'service_now'
  | 'azure_devops'
  | 'rally'
  | 'github'
  | 'svn';

export type TEntity = 'incident' | 'testcase' | 'defect';

export interface IUseCase {
  id: string;
  description: string;
  json: string;

  source: 'static' | 'dynamic';
  persistence: 'local' | 'remote';

  loading?: boolean;
  allowEdit?: boolean;
  chartType?: string;
}

export interface ISearchIndex {
  _id: string;

  index_id: string;
  index_name: string;
  entity_type: TEntity;
  connector_type: TConnectorType;
  onboarded_agent: IOnboardedAgent;
  column_mappings: Record<string, string>;
  dynamic_mappings: Record<string, string>;
  file_names: string[];
  file_ids: string[];
  last_synced_at: string;
  ingested_at: string;
  createdAt: string;
  status: string;
  record_count: number;
  full_schema: ISchemaForAgent['full_schema'];

  sheet_name: string;

  connector_url: string;
  jira_api_token: string;
  project_key: string;
  username: string;

  usecases: string[] | IMCPUseCase[];
  visualization: Record<string, WidgetConfig>;
  trends_usecases: string[];
  trends_uc: IMCPUseCase[];
  trends_visualization: Record<string, WidgetConfig>;
}

export interface IOnboardedAgent {
  agent_id: string;
  agent_name: string;
}

export interface IMCPUseCase {
  _id: string;
  index_id: string;
  index_name: string;
  raw_config: string;
  structured_config: Record<'error' | string, string>;
  tool: string;
  updated_at: string;
  usecase_name: string;
}

export interface IDataUseCase {
  formats: Format[];
}

interface Format {
  description: string;
  format_name: string;
  recommended_charts: RecommendedChart[];
  sample_json: unknown;
}

interface RecommendedChart {
  chart_name: string;
  chart_type: string;
  data_fields_used: string[];
  description: string;
}

export interface ITrendUseCase {
  chartfit_structure_json: {
    chart_type: string;
    data_source: string;
    extraction_config: {
      fields_to_extract: string[];
    };
  };
  opensearch_query: object;
  sample_response: unknown;
}

export interface ISchemaForAgent {
  detected_categorical_fields: Record<
    string,
    {
      inferred_type: string;
      unique_values: any[];
    }
  >;
  full_schema:
    | {
        column_name: string;
        data_type: string;
        inferred_type?: string;
        unique_values: any[];
      }[]
    | unknown;
}
