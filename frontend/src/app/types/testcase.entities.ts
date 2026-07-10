import { ICategory, IPriority, ISeverity, IStatus } from './analytics.entities';

export interface ITestcase {
  id?: string;
  test_case_id?: string;

  execution_count?: number;
  failure_count?: number;

  priority: string;
  severity?: string;
  category?: string;

  status: string;
  title: string;
  description?: string;

  created?: string;
  created_at?: string;
}

export type TTestcaseTop10<T extends string, K> = {
  date_range_applied?: string | null;
  summary: string;
  test_case_filter_applied?: string;
} & {
  [key in T]: K;
};

export interface ITestcaseHotspots {
  failure_rate_percentage: number;
  hotspot_area: string;
  key_insights: string;
  rank: number;
  test_case_count: number;
  total_failure_count: number;
  matching_test_cases: ITestcase[];
}

export interface ITestCasePrioritization {
  epic: string;
  execution_count: number;
  failure_count: number;
  feature: string;
  prioritization_reason: string;
  priority: string;
  rank: number;
  status: string;
  test_case_id: string;
  title: string;
  use_case: string;
  impact_explanation: string;
  failure_rate_percentage: number;
  impact_relevance_score: number;
  risk_score: number;
  business_criticality_score: number;
  overall_priority_score: string;
}

export interface IImpactedTestCase {
  epic: string;
  execution_count: number;
  failure_count: number;
  feature: string;
  key_insights: string;
  last_executed: string;
  priority: string;
  rank: number;
  status: string;
  test_case_id: string;
  title: string;
  use_case: string;
}

export interface ITestCaseFrequency {
  application: string;
  execution_count: number;
  failure_count: number;
  feature: string;
  last_executed: string;
  prioritization_reason: string;
  priority: string;
  rank: number;
  status: string;
  test_case_id: string;
  title: string;
}

export interface ITestcaseAnalyticsQueryResponse {
  analytics: {
    all_records: ITestcase[];
    category: ICategory[];
    priority: IPriority[];
    severity: ISeverity[];
    status: IStatus[];
  };
  kpis: {
    avg_testcase_per_day: number;
    similar_testcase: { title: string; count: number }[];
  };
  meta: {
    end_date: string;
    start_date: string;
    total_testcase: number;
  };
}

export interface ITestcaseUseCase {
  application: string;
  automation_feasibility: IAutomationFeasibility;
  automation_title: string;
  category: string;
  description: string;
  epic: string;
  estimated_automation_effort: string;
  execution_profile: IExecutionProfile;
  feature: string;
  potential_impact: string;
  priority: string;
  rank: number;
  roi_estimate: string;
  status: string;
  test_case_id: string;
  title: string;
  use_case: string;
}

export interface IAutomationFeasibility {
  overall_automation_score: number;
  repeatability_score: number;
  stability_score: number;
  technical_feasibility_score: number;
}

export interface IExecutionProfile {
  execution_count: number;
  failure_count: number;
  failure_rate_percentage: number;
  last_executed: string;
}

export interface IPotentialRegressionTestSuite {
  coverage_distribution: ICoverageDistribution;
  date_range_applied: string;
  regression_strategy: IRegressionStrategy;
  regression_suite: IRegressionSuite[];
  summary: string;
}

export interface ICoverageDistribution {
  by_application: {
    APIService: number;
    AuthApp: number;
    BackupService: number;
    DBService: number;
    FileService: number;
    MainApp: number;
    PaymentApp: number;
    SyncService: number;
  };
  by_feature: {
    Checkout: number;
    'Data Aggregation': number;
    'Data Backup': number;
    'Data Encryption': number;
    'Data Sync': number;
    'Endpoint Call': number;
    'Event Hooks': number;
    Indexing: number;
    'Log Management': number;
    'Login Screen': number;
    'Offline Mode': number;
    'Page Count': number;
    Pagination: number;
    'Password Set': number;
    'Profile Edit': number;
    'Push Notifications': number;
    'Role Management': number;
    Startup: number;
    Theme: number;
    'Upload Feature': number;
  };
  risk_levels: {
    high: number;
    low: number;
    medium: number;
  };
  total_tests_selected: number;
}

export interface IRegressionStrategy {
  exclusions: string[];
  selection_criteria: string[];
}

export interface IRegressionSuite {
  application: string;
  business_criticality_score: number;
  epic: string;
  execution_history: {
    execution_count: number;
    failure_count: number;
    failure_rate_percentage: number;
    last_executed: string;
  };
  feature: string;
  justification: string;
  priority: string;
  rank: number;
  recommended_execution_frequency: string;
  regression_candidate_score: number;
  status: string;
  technical_risk_score: number;
  test_case_id: string;
  title: string;
  use_case: string;
}

export interface ITestcaseCoverage {
  coverage_distribution: Record<string, Record<string, number>> & {
    total_test_cases: 105;
  };
  notable_coverage_gaps: {
    gap_category: string;
    reasoning: string;
  }[];
}

export interface ITestcaseDeduplication {
  optimization_findings: IOptimizationFinding[];
  summary: {
    exact_duplicate_groups: number;
    optimization_candidates: number;
    potentially_obsolete_tests: number;
    semantic_similarity_groups: number;
    total_records_analyzed: number;
  };
}

interface IOptimizationFinding {
  affected_test_cases: ITestCase[];
  analysis_details: {
    key_differences: string[];
    obsolete_indicators: string[];
    overlapping_areas: string[];
    similarity_type: string;
  };
  confidence_score: number;
  finding_category: string;
  finding_id: string;
  optimization_recommendation: {
    action_priority: string;
    expected_optimization_benefit: string;
    justification: string;
    recommended_action: string;
  };
}

interface ITestCase {
  application: string;
  execution_count: number;
  feature: string;
  last_executed: string;
  priority: string;
  status: string;
  test_case_id: string;
  title: string;
  use_case: string;
}

export interface ITestcaseQualityEvaluation {
  evaluations_table_data: {
    identified_issues: string[];
    overall_quality_score: number;
    quality_badge: string;
    suggested_improvements: string[];
    test_case_id: string;
    title: string;
    ui_indicators: {
      completeness_indicator: string;
      coverage_indicator: string;
      readability_indicator: string;
      traceability_indicator: string;
    };
  }[];
  summary_charts_data: {
    average_quality_score: number;
    quality_tier_distribution: {
      acceptable: number;
      excellent: number;
      needs_improvement: number;
      poor: number;
    };
    top_identified_gaps: string[];
    total_test_cases_evaluated: number;
  };
}
