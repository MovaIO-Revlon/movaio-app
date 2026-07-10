import {
  IApplication,
  ICategory,
  IError,
  IOverview,
  IPriority,
  ISeverity,
  ISolution,
  IStatus,
  IUseCases,
} from './analytics.entities';

export interface IIncidentAnalyticsQueryResponse {
  analytics: {
    all_records: IIncident[];
    category: ICategory[];
    priority: IPriority[];
    severity: ISeverity[];
    status: IStatus[];
  };
  kpis: {
    avg_incidents_per_day: number;
    avg_mttr: string;
    recurring_issue_pct: number;
    similar_incidents?: {
      count: number;
      title: string;
    }[];
    sla_compliance_pct: number;
  };
  meta: {
    end_date: string;
    start_date: string;
    total_incidents: number;
  };
  trends: Record<'incident_trends', ITrendByApplication>;
}

type TTrendDetails = Record<
  'weekdays' | 'weekends' | 'business_hours' | 'off_hours',
  {
    id: string;
    category: string;
    created_at: string;

    title: string;
    description: string;

    status: string;
    priority: string;
    severity: string;
  }[]
>;

export interface ITrendByApplication {
  periods: string[];
  weekdays: number[];
  weekends: number[];
  business_hours: number[];
  off_hours: number[];
  details: Record<string, TTrendDetails>;
}

export interface IIncident {
  category: string;
  date?: string;
  created?: string;
  created_at?: string;
  description?: string;
  comment?: string;
  matchPercentage?: string;
  serviceType?: string;
  incident_id?: string;
  id?: string;
  priority: string;
  severity: string;
  state?: string;
  status?: string;
  title: string;
}

export interface ISimilarIncident {
  incident_id: string;
  severity: string;
  status: string;
  timestamp: string;
  title: string;
}

export type TIncidentTop10<T extends string, K> = {
  date_range_applied?: string | null;
  summary: string;
  incident_filter_applied?: string;
} & {
  [key in T]: K;
};

export interface IIncidentSmartInsightResponse {
  ai_analysis: {
    title: string;

    errors: IError[];
    overview: IOverview;

    'Top 10 Applications Impacted': TIncidentTop10<'top_applications', IApplication[]>;
    'potential automation use cases': TIncidentTop10<
      'automation_use_cases',
      IUseCases[]
    >;
    similar_incident: ISimilarIncident[];
    'top 5 solutions': {
      incident_details: Omit<
        IIncident,
        'created' | 'comment' | 'matchPercentage' | 'serviceType'
      > & {
        application: string;
        assigned_to: string;
        downtime_minutes: number;
        infra_system: string;
        issue_type: string;
      };
      top_solutions: ISolution[];
    };
  };
}

export interface IIncidentRootCause {
  incident_count: number;
  key_insights: string;
  matching_incidents: IIncident[];
  rank: number;
  root_cause: string;
  total_downtime_minutes: number;
}