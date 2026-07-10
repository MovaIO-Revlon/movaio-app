import {
  ICategory,
  IError,
  IOverview,
  IPriority,
  ISeverity,
  IStatus,
  IUseCases,
} from './analytics.entities';

export interface IDefectAnalyticsQueryResponse {
  analytics: {
    all_records: IDefect[];
    category: ICategory[];
    priority: IPriority[];
    severity: ISeverity[];
    status: IStatus[];
  };
  kpis: {
    avg_defects_per_day: number;
    avg_mttr: string;
    similar_defects: { title: string; count: number }[];
  };
  meta: {
    end_date: string;
    note?: string;
    start_date: string;
    total_defects: number;
  };
  defect_age: IDefectAge;
}

export interface IDefect {
  id?: string;
  defect_id?: string;

  created?: string;
  created_at?: string;

  title: string;
  description?: string;
  impact?: string;

  category: string;
  priority: string;
  severity: string;

  status?: string;
  state?: string;

  age_days?: number;
}

export type TDefectTop10<T extends string, K> = {
  date_range_applied?: string | null;
  summary: string;
  defect_filter_applied?: string;
} & {
  [key in T]: K;
};

export interface IDefectTopArea {
  area: string;
  defect_count: number;
  key_insights: string;
  matching_defects: IDefect[];
  rank: number;
}

export interface IDefectDetails {
  application: string;
  assigned_to: any;
  category: string;
  created: string;
  defect_id: string;
  description: string;
  epic: string;
  feature: string;
  issue_type: string;
  priority: string;
  severity: string;
  state: string;
  title: string;
}

export interface IDefectSolution {
  explanation: string;
  rank: number;
  resolution_time_days: number;
  solution: string;
  source_defects: string[];
  success_rate_percentage: number;
}

export interface IDefectRootCause {
  defect_count: number;
  key_insights: string;
  matching_defects: IDefect[];
  rank: number;
  root_cause: string;
}

export interface IDefectResolution {
  average_resolution_time_days: number;
  defect_count: number;
  key_insights: string;
  matching_defects?: IDefect[];
  rank: number;
  resolution: string;
}

export interface IFeatureImpacted {
  defect_count: number;
  feature_or_epic: string;
  key_insights: string;
  matching_defects: IDefect[];
  rank: number;
  type: string;
}

export interface IDefectSmartInsightResponse {
  ai_analysis: {
    title: string;

    errors: IError[];
    overview: IOverview;

    'Defect solution': {
      defect_details: IDefectDetails;
      top_solutions: IDefectSolution[];
    };

    'potential regression scenarios': TDefectTop10<
      'regression_scenarios',
      IDefectRegressionScenario[]
    >;

    similar_defect: IDefect[];
  };
}

export interface IDefectAgeSeries {
  data: number[];
  name: string;
}

export interface IDefectCustomSeries {
  data: {
    custom: {
      bucket: string;
      defects: IDefect[];
      status: string;
    };
    y: number;
  }[];

  name: string;
}
export interface IDefectAge {
  bucketDefinitions: {
    label: string;
    maxDays: number;
    minDays: number;
  }[];

  chart: {
    stacking: string;
    title: string;
    xAxis: {
      categories: string[];
      title: string;
    };
    yAxis: {
      title: string;
    };
  };

  generatedOn: string;
  notes: string;

  series: IDefectAgeSeries[];

  seriesWithCustom: IDefectCustomSeries[];
  statusOrder: string[];
  totalsByBucket: number[];
}

export interface IDefectRegressionScenario {
  defect_count: number;
  description: string;
  pattern_type: string;
  pattern_value: string;
  potential_impact: string;
  rank: number;
  related_defects: string[];
  related_test_cases: string[];
  scenario_title: string;
  severity_distribution: ISeverityDistribution;
  suggested_test_count_estimate: number;
}

export interface ISeverityDistribution {
  critical: number;
  high: number;
  low: number;
  medium: number;
}
