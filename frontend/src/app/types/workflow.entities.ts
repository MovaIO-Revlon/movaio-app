import type { Edge } from 'ngx-vflow';
import { IAgent } from './agent.entities';

export interface IWorkflow {
  _id?: string;
  flow_id: string;
  flow_name: string;
  flow_description?: string;
  agency_name?: string;
  team?: string;
  flow_data?: IFlowData;
  api_key?: string;
  edges?: Edge[];
  IsExternal?: boolean;
  status?: string;
  trending?: boolean;
  created_at?: string;
  updated_at?: string;
}
export interface IFlowTask {
  function: string;
  name: string;
  user_input?: string;
  call_next?: string[];
  params: {
    assets: string[];
    config: {
      agent_id: string;
      api_agent_id?: string;
      agent_name: string;
      api_key: string;
      api_url: string;
      session_id: string;
      user_id: string;
      true_cond_ids?: string[];
      false_cond_ids?: string[];
      true?: string;
      false?: string;
    };
  };
  tag: string;
}
export interface IFlowData {
  tasks?: IFlowTask[];
  default_inputs?: {
    _file_mapping: Record<
      string,
      {
        name: string;
        size: number;
        type: string;
      }
    >;
  };
  edges: unknown[];
  flow_data: {
    node_positions: Record<string, { x: number; y: number }>;
  };
}

export interface IImportWorkflowRequest {
  api_key: string;
  workflow_id: string;
  isRefresh?: boolean;
  agency_name?: string;
}
export interface ICreateWorkflowRequest
  extends Partial<Pick<IWorkflow, 'flow_name' | 'flow_data'>> {
  flow_description?: string;
  edges?: any[];
  agency_name?: string;
}

export interface IUpdateWorkflowRequest {
  flowId: string;
  flow_data?: IFlowData;
  edges: any[];
  flow_name?: string;
  flow_description?: string;
  agency_name?: string;
}

export interface IReferenceData {
  id: string;
  type: 'api' | 'agent' | 'iterative' | 'condition';
}

export interface IAgentFormData extends IReferenceData {
  agent: string;
  input: string;
  agentDetails?: IAgent;
}

export interface IIterativeFormData extends IReferenceData {
  loop_condition: string;
}

export interface IApiFormData extends IReferenceData {
  api_url: string;
  http_method: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export interface IConditionFormData extends IReferenceData {
  condition: string;
  true_cond_ids: string[];
  false_cond_ids: string[];
}

export type TWorkflowFormData =
  | IAgentFormData
  | IApiFormData
  | IIterativeFormData
  | IConditionFormData;

export interface WorkflowResponse {
  _id: string;
  agency_id: string;
  agency_name: string;
  created_ts: string;
  flow_id: string;
  flow_name: string;
  mapping_id: string;
  order_number: number;
  status: string;
  updated_ts: string;
  confidence_perc: string;
  assigned_to: string;
  confidence_status: string;
  description: string;
  avatar: string;
  run_status: string;
}
export interface WorkflowDetail {
  _id: string;
  agency_id: string;
  agency_name: string;
  assigned_to: string;
  team?: string;
  avatar: string;
  confidence_perc: string;
  confidence_status: string;
  created_ts: string;
  description: string;
  flow_id: string;
  flow_name: string;
  mapping_id: string;
  order_number: number;
  run_status: string;
  status: string;
  updated_ts: string;
  IsExternal: boolean;
}
