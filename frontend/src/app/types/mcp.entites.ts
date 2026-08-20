import { WidgetConfig } from './widget.types';

export type TConnectorType =
  | 'jira'
  | 'excel'
  | 'team_dynamix'
  | 'docx'
  | 'pdf'
  | 'ppt'
  | 'ServiceNow'
  | 'azure_devops'
  | 'rally'
  | 'github'
  | 'svn'
  | 'OneDrive';

export type TConnectorCategory = 'agent' | 'insight';

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

export interface ITool {
  _id:
    | {
        $oid: string;
      }
    | string;
  tool_action: {
    action_desc: string;
    action_name: string;
  }[];
  tool_configs: string[];
  tool_name: string;
}

export interface IConnection {
  connection_id: string;
  connection_name: string;
  connector_type: TConnectorType;
  connector_id: string;
  created_at: string;
  updated_at?: string;
  user_id: string;
  auth_type: 'oauth';
}

export interface IActiveTool {
  _id: string;
  connector_id: string;
  connector_type: string;
  connection_id: string;
  tool_action_name: string;
  description: string;
  created_at: string;
  type?: 'custom';
  parameter: IFunctionJson;
}
export interface IConnectionData {
  _id: string;
  connection_name: string;
  connector_type: TConnectorType;
  connector_id: string;
  user_id: string;
  credentials: Record<string, any>;
  auth_type: 'oauth2';
  created_at: string;
  active_tools: IActiveTool[];
  tools_order: string[];
}

export interface ISecurityScheme {
  type: string;
  location: string;
  name: string;
  prefix: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  authorizeUrl: string;
  accessTokenUrl: string;
  refreshTokenUrl: string;
}

export interface IProperty {
  name: string;
  type: string;
  description: string;
  required: boolean;
  visible: boolean;
}

export interface IGroup {
  key: string;
  label: string;
  locked: boolean;
  enabled: boolean;
  description: string;
  required: boolean;
  visible: boolean;
  additionalProperties: boolean;
  properties: IProperty[];
}

export interface IRequest {
  id?: string;
  // type?: 'local' | 'static' | 'custom';
  name: string;
  description: string;
  tags: string;
  visibility: string;
  active: boolean;
  protocol: string;
  method: string;
  serverUrl: string;
  path: string;
  paramsAdditional: boolean;
  securityScheme: ISecurityScheme;
  groups: IGroup[];
}

export interface IParameter {
  type: string;
  description?: string;
  properties?: Record<string, IParameter>;
  required?: string[];
  visible?: string[];
  additionalProperties?: boolean;
}

export interface IFunctionJson {
  type?: 'local' | 'custom' | 'static';
  id?: string;
  name: string;
  description: string;
  tags: string[];
  visibility: string;
  active: boolean;
  protocol: string;
  protocol_data: {
    method: string;
    server_url: string;
    path: string;
  };
  parameters: IParameter;
}
