import { IIncident } from './incident.entities';

export type TUseCaseType = 'insights' | 'trends';

export interface IAnalyticsQuery {
  start_date: string;
  end_date: string;
  index_id: string;
  agent_id: string;
  index_name: string;
  entity: string;
  run_id: string;
  page_name: string;
  version?: number;
  refetch?: boolean;
}

export interface IAnalyticsHistoryQuery {
  entity: string;
  index?: string;
  page_name: string;
}

export type TSmartInsightQuery = Omit<
  IAnalyticsQuery,
  'start_date' | 'end_date'
> &
  (
    | {
        incident_id: string;
      }
    | {
        defect_id: string;
      }
  );
export interface IAgentExecutionResponse<T> {
  agent_execution: T & { errors: IError[]; overview: IOverview };
}
export interface IError {
  error_message: string;
  query: string;
}

export interface IOverview {
  date_range?: string;
  generated_at: string;
  timezone: string;
  title: string;
}

export interface IApplication {
  application: string;
  incident_count: number;
  key_insights: string;
  rank: number;
  total_downtime_minutes: number;
  matching_incidents?: IIncident[];
}

export interface IInfrastructure {
  incident_count: number;
  infra_system: string;
  key_insights: string;
  rank: number;
  total_downtime_minutes: number;
  matching_incidents?: IIncident[];
}

export interface IIssue {
  incident_count: number;
  issue_type: string;
  key_insights: string;
  rank: number;
  total_downtime_minutes: number;
  matching_incidents?: IIncident[];
}

export interface ICategory {
  count: number;
  label: string;
  percentage: number;
}

export interface IPriority {
  count: number;
  label: string;
  percentage: number;
}

export interface ISeverity {
  count: number;
  label: string;
  percentage: number;
}

export interface IStatus {
  count: number;
  label: string;
  percentage: number;
}

export interface IAiInference {
  title: string;
  description: string;
  impact: string;
  severity: string;
}

export interface IUseCases {
  automation_title: string;
  description: string;
  incident_count: number;
  potential_impact: string;
  rank: number;
}

export interface IIncidentResolution {
  average_resolution_time_minutes: number;
  incident_count: number;
  key_insights: string;
  rank: number;
  resolution: string;
  matching_incidents: IIncident[];
}

export interface ISolution {
  explanation: string;
  rank: number;
  resolution_time_minutes: number;
  solution: string;
  source_incidents: string[];
  success_rate_percentage: number;
}

export interface IAnalyticsHistory<T, K> {
  '@timestamp': string;
  run_id: string;
  entity: string;
  end: string;
  start: string;
  index_name: string;
  agent_name: string;
  key: T;
  kpis: K;
  history: null;
  message: string;
}
