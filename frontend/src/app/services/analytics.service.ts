import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  ApiResponse,
  IAgentExecutionResponse,
  IAiInference,
  IAnalyticsQuery,
  IApplication,
  IDefectAnalyticsQueryResponse,
  IIncidentAnalyticsQueryResponse,
  IInfrastructure,
  IIssue,
  IIncidentResolution,
  IIncidentRootCause,
  ISearchIndex,
  IIncidentSmartInsightResponse,
  IDefectSmartInsightResponse,
  ITrendByApplication,
  IUseCases,
  TIncidentTop10,
  TDefectTop10,
  IDefectTopArea,
  IDefectSolution,
  IDefectDetails,
  IDefectRootCause,
  IDefectResolution,
  IFeatureImpacted,
  TSmartInsightQuery,
  IDefectRegressionScenario,
  IAnalyticsHistory,
  IAnalyticsHistoryQuery,
  IDataUseCase,
  ITrendUseCase,
  ISchemaForAgent,
} from '../types';
import { abort } from '../utils';
import {
  IImpactedTestCase,
  IPotentialRegressionTestSuite,
  ITestcaseAnalyticsQueryResponse,
  ITestcaseCoverage,
  ITestcaseDeduplication,
  ITestCaseFrequency,
  ITestcaseHotspots,
  ITestCasePrioritization,
  ITestcaseQualityEvaluation,
  ITestcaseUseCase,
  TTestcaseTop10,
} from '../types/testcase.entities';

export type TIncidentHistory = IAnalyticsHistory<
  IAgentExecutionResponse<{
    'AI Inferences': TIncidentTop10<'ai_inferences', IAiInference[]>;
    'Top 10 Root Causes': TIncidentTop10<
      'top_root_causes',
      IIncidentRootCause[]
    >;
    'Top 10 Resolutions': TIncidentTop10<
      'top_resolutions',
      IIncidentResolution[]
    >;
    top_10_issues: TIncidentTop10<'top_issues', IIssue[]>;
    top_10_infrastructure_systems: TIncidentTop10<
      'top_infrastructure_systems',
      IInfrastructure[]
    >;
    'Potential automation': TIncidentTop10<'automation_use_cases', IUseCases[]>;
    top_10_applications: TIncidentTop10<'top_applications', IApplication[]>;
  }>,
  IIncidentAnalyticsQueryResponse
>;

export type TDefectHistory = IAnalyticsHistory<
  IAgentExecutionResponse<{
    'AI Inferences': TDefectTop10<'ai_inferences', IAiInference[]>;
    'Top 10 Root Causes': TDefectTop10<'top_root_causes', IDefectRootCause[]>;
    'Top 10 Resolutions': TDefectTop10<'top_resolutions', IDefectResolution[]>;
    'Top 10 Defect': TDefectTop10<'top_areas', IDefectTopArea[]>;
    'Top 10 Features/Epics Impacted': TDefectTop10<
      'top_impacted_areas',
      IFeatureImpacted[]
    >;
    'Potential regression scenarios': TDefectTop10<
      'regression_scenarios',
      IDefectRegressionScenario[]
    >;
  }>,
  IDefectAnalyticsQueryResponse
>;

export type TTestcaseHistory = IAnalyticsHistory<
  IAgentExecutionResponse<{
    'Testcase hotspots': TTestcaseTop10<'top_hotspots', ITestcaseHotspots[]>;
    'Testcase Impacted': TTestcaseTop10<
      'impacted_test_cases',
      IImpactedTestCase[]
    >;
    'Testcase prioritization': TTestcaseTop10<
      'prioritized_test_cases',
      ITestCasePrioritization[]
    >;
    'Potential automation': TTestcaseTop10<
      'automation_use_cases',
      ITestcaseUseCase[]
    >;
    'Potential regression testsuite': IPotentialRegressionTestSuite;
    'Testcase prioritization frequency': TTestcaseTop10<
      'prioritized_test_cases',
      ITestCaseFrequency[]
    >;
    'Test Coverage Metrics': ITestcaseCoverage;
  }>,
  ITestcaseAnalyticsQueryResponse
>;

export type THistory = TIncidentHistory | TDefectHistory | TTestcaseHistory;
@Injectable({
  providedIn: 'root',
})
export class AnalyticsService {
  constructor(private http: HttpClient) {}

  fetchKpiAnalytics(payload: IAnalyticsQuery, signal: AbortSignal) {
    return this.http
      .post<
        ApiResponse<
          | IIncidentAnalyticsQueryResponse
          | IDefectAnalyticsQueryResponse
          | ITestcaseAnalyticsQueryResponse
        >
      >('/insights/kpis', payload)
      .pipe(abort(signal));
  }

  fetchTopApplications(payload: IAnalyticsQuery) {
    return this.http.post<
      ApiResponse<
        IAgentExecutionResponse<{
          top_10_applications: TIncidentTop10<
            'top_applications',
            IApplication[]
          >;
        }>
      >
    >('/insights/call_agent/topapplications', payload);
  }

  fetchTopInfrastructureSystems(payload: IAnalyticsQuery) {
    return this.http.post<
      ApiResponse<
        IAgentExecutionResponse<{
          top_10_infrastructure_systems: TIncidentTop10<
            'top_infrastructure_systems',
            IInfrastructure[]
          >;
        }>
      >
    >('/insights/call_agent/topinfrastructuresystems', payload);
  }

  fetchTopIssues(payload: IAnalyticsQuery) {
    return this.http.post<
      ApiResponse<
        IAgentExecutionResponse<{
          top_10_issues: TIncidentTop10<'top_issues', IIssue[]>;
        }>
      >
    >('/insights/call_agent/topissues', payload);
  }

  fetchTrendByApplication(payload: IAnalyticsQuery, signal: AbortSignal) {
    return this.http
      .post<ITrendByApplication>(
        '/insights/call_agent/trendbyapplication',
        payload,
      )
      .pipe(abort(signal));
  }

  fetchTopResolutions(payload: IAnalyticsQuery) {
    return this.http.post<
      ApiResponse<
        IAgentExecutionResponse<{
          'Top 10 Resolutions':
            | TIncidentTop10<'top_resolutions', IIncidentResolution[]>
            | TDefectTop10<'top_resolutions', IDefectResolution[]>;
        }>
      >
    >('/insights/call_agent/topresolution', payload);
  }

  fetchTopRootCauses(payload: IAnalyticsQuery) {
    return this.http.post<
      ApiResponse<
        IAgentExecutionResponse<{
          'Top 10 Root Causes':
            | TIncidentTop10<'top_root_causes', IIncidentRootCause[]>
            | TDefectTop10<'top_root_causes', IDefectRootCause[]>;
        }>
      >
    >('/insights/call_agent/toprootcause', payload);
  }

  fetchAiInference(payload: IAnalyticsQuery) {
    return this.http.post<
      ApiResponse<
        IAgentExecutionResponse<{
          'AI Inferences': TIncidentTop10<'ai_inferences', IAiInference[]>;
        }>
      >
    >('/insights/call_agent/aiinference', payload);
  }

  fetchAutomationSteps(payload: IAnalyticsQuery) {
    return this.http.post<
      ApiResponse<
        | IAgentExecutionResponse<{
            'Potential automation': TIncidentTop10<
              'automation_use_cases',
              IUseCases[]
            >;
          }>
        | IAgentExecutionResponse<{
            'Potential regression scenarios': TDefectTop10<
              'regression_scenarios',
              IDefectRegressionScenario[]
            >;
          }>
        | IAgentExecutionResponse<{
            'Potential automation': TTestcaseTop10<
              'automation_use_cases',
              ITestcaseUseCase[]
            >;
          }>
      >
    >('/insights/call_agent/automationsteps', payload);
  }

  getSmartInsight(payload: TSmartInsightQuery) {
    return this.http.post<
      IIncidentSmartInsightResponse | IDefectSmartInsightResponse
    >('/smartinsightanalytics', payload);
  }

  fetchSearchIndexes() {
    return this.http.post<{ status: string; indexes: ISearchIndex[] }>(
      '/insights/opensearchindex',
      null,
    );
  }

  fetchTopDefects(payload: IAnalyticsQuery) {
    return this.http.post<
      ApiResponse<
        | IAgentExecutionResponse<{
            'Top 10 Defect': TDefectTop10<'top_areas', IDefectTopArea[]>;
          }>
        | IAgentExecutionResponse<{
            'Testcase hotspots': TTestcaseTop10<
              'top_hotspots',
              ITestcaseHotspots[]
            >;
          }>
      >
    >('/insights/call_agent/topdefects', payload);
  }

  fetchTopDefectSolutions(payload: IAnalyticsQuery, signal: AbortSignal) {
    return this.http
      .post<
        ApiResponse<
          IAgentExecutionResponse<{
            'Defect Solution': {
              defect_details: IDefectDetails;
              top_solutions: IDefectSolution[];
            };
          }>
        >
      >('/insight/call_agents/defectsolution', payload)
      .pipe(abort(signal));
  }

  fetchTopImpactedFeature(payload: IAnalyticsQuery) {
    return this.http.post<
      ApiResponse<
        IAgentExecutionResponse<{
          'Top 10 Features/Epics Impacted': TDefectTop10<
            'top_impacted_areas',
            IFeatureImpacted[]
          >;
        }>
      >
    >('/insights/call_agent/featureimpacted', payload);
  }

  fetchTestcasePrioritization(payload: IAnalyticsQuery) {
    return this.http.post<
      ApiResponse<
        IAgentExecutionResponse<{
          'Testcase prioritization': TTestcaseTop10<
            'prioritized_test_cases',
            ITestCasePrioritization[]
          >;
        }>
      >
    >('/insights/call_agent/testcaseprioritization', payload);
  }

  fetchTestcaseFrequency(payload: IAnalyticsQuery, signal: AbortSignal) {
    return this.http
      .post<
        ApiResponse<
          IAgentExecutionResponse<{
            'Testcase prioritization frequency': TTestcaseTop10<
              'prioritized_test_cases',
              ITestCaseFrequency[]
            >;
          }>
        >
      >('/insights/call_agent/testcasefrequency', payload)
      .pipe(abort(signal));
  }

  fetchTestcaseImpacted(payload: IAnalyticsQuery) {
    return this.http.post<
      ApiResponse<
        IAgentExecutionResponse<{
          'Testcase Impacted': TTestcaseTop10<
            'impacted_test_cases',
            IImpactedTestCase[]
          >;
        }>
      >
    >('/insights/call_agent/testcaseimpacted', payload);
  }

  fetchTestcaseCoverage(payload: IAnalyticsQuery) {
    return this.http.post<
      ApiResponse<
        IAgentExecutionResponse<{
          'Test Coverage Metrics': ITestcaseCoverage;
        }>
      >
    >('/insights/call_agent/testcasecoverage', payload);
  }

  fetchTestcaseDeduplication(payload: IAnalyticsQuery) {
    return this.http.post<
      ApiResponse<
        IAgentExecutionResponse<{
          'duplicate test cases': ITestcaseDeduplication;
        }>
      >
    >('/insights/call_agent/testduplication', payload);
  }

  fetchTestcaseQuality(payload: IAnalyticsQuery) {
    return this.http.post<
      ApiResponse<
        IAgentExecutionResponse<{
          'evaluate test case quality': ITestcaseQualityEvaluation;
        }>
      >
    >('/insights/call_agent/testquality', payload);
  }

  fetchTestcaseRegression(payload: IAnalyticsQuery) {
    return this.http.post<
      ApiResponse<
        IAgentExecutionResponse<{
          'Potential regression testsuite': IPotentialRegressionTestSuite;
        }>
      >
    >('/insights/call_agent/testcaseregression', payload);
  }

  fetchInsightHistory(payload: IAnalyticsHistoryQuery) {
    return this.http.post<ApiResponse<THistory>>(
      '/insights/insightshistory',
      payload,
    );
  }

  fetchInsightIndexHistory(
    payload: IAnalyticsHistoryQuery,
    signal: AbortSignal,
  ) {
    return this.http
      .post<ApiResponse<THistory>>('/insights/insightindexhistory', payload)
      .pipe(abort(signal));
  }

  getUseCases(payload: { usecase: string }) {
    return this.http.post<ApiResponse<IDataUseCase>>(
      '/insights/usecases',
      payload,
    );
  }

  getTrendUseCase(payload: {
    usecase: string;
    full_schema: ISchemaForAgent['full_schema'];
  }) {
    return this.http.post<ApiResponse<ITrendUseCase>>(
      '/insights/trends_usecase',
      payload,
    );
  }

  fetchUseCaseInsights(payload: IAnalyticsQuery & { usecases: string[] }) {
    return this.http.post<{
      data: Record<string, Record<string, unknown>>;
      status: string;
    }>('/insights/call_agent/dynamicusecases', payload);
  }

  fetchUseCaseTrend(payload: IAnalyticsQuery & { usecases: string[] }) {
    return this.http.post<{
      data: Record<string, Record<string, unknown>>;
      status: string;
    }>('/insights/dynamictrenduc', {
      ...payload,
      usecases: undefined,
      usecase_name: payload.usecases[0],
    });
  }

  removeUseCase(payload: { index_id: string; usecase_name: string }) {
    return this.http.post<ApiResponse<null>>(
      '/insights/deleteusecases',
      payload,
    );
  }

  apiRateLimit() {
    return this.http.post<{
      count: number;
      total_count: number;
      status: string;
    }>('/limitcount', {});
  }
}
