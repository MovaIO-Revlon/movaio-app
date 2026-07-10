import { IUseCase, TConnectorType, TEntity } from '../../types';
import INSIGHT_INCIDENT_STATIC_USECASES from './insight-incident-static-usecases.json';
import INSIGHT_DEFECT_STATIC_USECASES from './insight-defect-static-usecases.json';
import INSIGHT_TESTCASE_STATIC_USECASES from './insight-testcase-static-usecases.json';
export interface IConnector {
  label: string;
  key: TConnectorType;
  icon: string;
  disabled?: boolean;
}

export interface IConnectorGroup {
  name: string;
  connectors: IConnector[];
}

export const CONNECTOR_GROUPS: IConnectorGroup[] = [
  {
    name: 'Excel/Doc',
    connectors: [
      {
        label: 'Excel',
        key: 'excel',
        icon: 'assets/img/excel_icon.png',
      },
      {
        label: 'Docx',
        key: 'docx',
        icon: 'assets/img/docx.png',
        disabled: true,
      },
      {
        label: 'PPT',
        key: 'ppt',
        icon: 'assets/img/ppt.png',
        disabled: true,
      },
      {
        label: 'PDF',
        key: 'pdf',
        icon: 'assets/img/pdf.png',
        disabled: true,
      },
    ],
  },
  {
    name: 'ITSM Tools',
    connectors: [
      {
        label: 'Team Dynamix',
        key: 'team_dynamix',
        icon: 'assets/img/team_dynamix.png',
      },
      {
        label: 'Service Now',
        key: 'service_now',
        icon: 'assets/img/service_now.png',
        disabled: true,
      },
    ],
  },
  {
    name: 'Agile Tools',
    connectors: [
      {
        label: 'JIRA',
        key: 'jira',
        icon: 'assets/img/jira_icon.png',
      },
      {
        label: 'Azure DevOps',
        key: 'azure_devops',
        icon: 'assets/img/azure_devops.png',
        disabled: true,
      },
      {
        label: 'Rally',
        key: 'rally',
        icon: 'assets/img/rally.png',
        disabled: true,
      },
    ],
  },
  {
    name: 'Version Control Tools',
    connectors: [
      {
        label: 'GitHub',
        key: 'github',
        icon: 'assets/img/github.png',
        disabled: true,
      },
      {
        label: 'SVN',
        key: 'svn',
        icon: 'assets/img/svn.png',
        disabled: true,
      },
    ],
  },
];

export const CONNECTOR_ICON_MAP: Record<TConnectorType, string> =
  CONNECTOR_GROUPS.map((item) => item.connectors)
    .flat(1)
    .reduce(
      (acc, g) => {
        acc[g.key] = g.icon;
        return acc;
      },
      {} as Record<TConnectorType, string>,
    );

export interface IField {
  name: string;
  key: string;
  default?: string;
  readonly?: boolean;
  required?: boolean;
}

export const ENTITY_DEFAULT_FIELDS: Record<TEntity, IField[]> = {
  incident: [
    { name: 'ID', key: 'id', default: 'Ticket Id', readonly: true },
    {
      name: 'Issue Type',
      key: 'issue_type',
      default: 'issue_type',
      readonly: true,
    },
    {
      name: 'Application',
      key: 'application',
      default: 'application',
      readonly: true,
    },
    {
      name: 'Created Date',
      key: 'created_date',
      default: 'created_date',
      readonly: true,
    },
    {
      name: 'Resolved Date',
      key: 'resolved_date',
      default: 'resolved_date',
      readonly: true,
    },
    {
      name: 'Description',
      key: 'description',
      default: 'description',
      readonly: true,
    },
    {
      name: 'Resolution',
      key: 'resolution',
      default: 'resolution',
      readonly: true,
    },
    {
      name: 'Root_cause',
      key: 'root_cause',
      default: 'root_cause',
      readonly: true,
    },
    {
      name: 'Title',
      key: 'title',
      default: 'title',
      readonly: true,
    },
    {
      name: 'Status',
      key: 'status',
      default: 'status',
      readonly: true,
    },
    {
      name: 'Priority',
      key: 'priority',
      default: 'priority',
      readonly: true,
    },
    {
      name: 'Severity',
      key: 'severity',
      default: 'severity',
      readonly: true,
    },
    {
      name: 'Category',
      key: 'category',
      default: 'category',
      readonly: true,
    },
    {
      name: 'SLA',
      key: 'SLA',
      readonly: true,
      required: false,
    },
    {
      name: 'Infra_system',
      key: 'infra_system',
      default: 'infra_system',
      readonly: true,
    },
  ],
  testcase: [
    { name: 'ID', key: 'id', default: 'Testcase_id', readonly: true },
    {
      name: 'Created Date',
      key: 'created_date',
      default: 'created_date',
      readonly: true,
    },
    {
      name: 'Description',
      key: 'description',
      default: 'description',
      readonly: true,
    },
    {
      name: 'Title',
      key: 'title',
      default: 'title',
      readonly: true,
    },
    {
      name: 'Status',
      key: 'status',
      default: 'status',
      readonly: true,
    },
    {
      name: 'Priority',
      key: 'priority',
      default: 'priority',
      readonly: true,
    },
    {
      name: 'Category',
      key: 'category',
      default: 'category',
      readonly: true,
    },
    {
      name: 'Epic',
      key: 'epic',
      default: 'epic',
      readonly: true,
    },
    {
      name: 'Feature',
      key: 'feature',
      default: 'feature',
      readonly: true,
    },
    {
      name: 'Expected Result',
      key: 'expected_result',
      default: 'expected_result',
      readonly: true,
    },
    {
      name: 'User Story',
      key: 'user_story',
      default: 'user_story',
      readonly: true,
    },
  ],
  defect: [
    { name: 'ID', key: 'id', default: 'Defect_Id', readonly: true },
    {
      name: 'Issue Type',
      key: 'issue_type',
      default: 'issue_type',
      readonly: true,
    },
    {
      name: 'Application',
      key: 'application',
      default: 'application',
      readonly: true,
    },
    {
      name: 'Created Date',
      key: 'created_date',
      default: 'created_date',
      readonly: true,
    },
    {
      name: 'Resolved Date',
      key: 'resolved_date',
      default: 'resolved_date',
      readonly: true,
    },
    {
      name: 'Description',
      key: 'description',
      default: 'description',
      readonly: true,
    },
    {
      name: 'Resolution',
      key: 'resolution',
      default: 'resolution',
      readonly: true,
    },
    {
      name: 'Root_cause',
      key: 'root_cause',
      default: 'root_cause',
      readonly: true,
    },
    {
      name: 'Title',
      key: 'title',
      default: 'title',
      readonly: true,
    },
    {
      name: 'Status',
      key: 'status',
      default: 'status',
      readonly: true,
    },
    {
      name: 'Priority',
      key: 'priority',
      default: 'priority',
      readonly: true,
    },
    {
      name: 'Severity',
      key: 'severity',
      default: 'severity',
      readonly: true,
    },
    {
      name: 'Category',
      key: 'category',
      default: 'category',
      readonly: true,
    },
    {
      name: 'Epic',
      key: 'epic',
      default: 'epic',
      readonly: true,
    },
    {
      name: 'Feature',
      key: 'feature',
      default: 'feature',
      readonly: true,
    },
    {
      name: 'User Story',
      key: 'user_story',
      default: 'user_story',
      readonly: true,
    },
  ],
};

export const INSIGHT_STATIC_USE_CASES_KEY = {
  incident: {
    TOP_10_ISSUES: 'top_10_issues',
    TOP_10_APPLICATIONS: 'top_10_applications',
    TOP_10_INFRASTRUCTURE_SYSTEMS: 'top_10_infrastructure_systems',
    TOP_10_RESOLUTION: 'Top 10 Resolutions',
    TOP_10_ROOT_CASES: 'Top 10 Root Causes',
    AI_INFERENCE: 'AI Inferences',
    POTENTIAL_AUTOMATION: 'Potential automation',
  },
  defect: {
    TOP_10_DEFECT: 'Top 10 Defect',
    TOP_10_FEATURES_EPICS_IMPACTED: 'Top 10 Features/Epics Impacted',
    TOP_10_RESOLUTIONS: 'Top 10 Resolutions',
    TOP_10_ROOT_CAUSES: 'Top 10 Root Causes',
    AI_INFERENCES: 'AI Inferences',
    POTENTIAL_REGRESSION_SCENARIOS: 'Potential regression scenarios',
  },
  testcase: {
    TESTCASE_HOTSPOTS: 'Testcase hotspots',
    TESTCASE_IMPACTED: 'Testcase Impacted',
    TESTCASE_PRIORITIZATION: 'Testcase prioritization',
    POTENTIAL_AUTOMATION: 'Potential automation',
    // TEST_COVERAGE_METRICS: 'Test Coverage Metrics',
    TEST_SUITE_OPTIMIZATION_DEDUPLICATION: 'duplicate test cases',
    TESTCASE_QUALITY: 'evaluate test case quality',
    POTENTIAL_REGRESSION_TESTSUITE: 'Potential regression testsuite',
  },
} as const;

const mapper = (
  keys: Record<string, string>,
  mappingObject: Record<string, object>,
) =>
  Object.values(keys).reduce<Record<string, IUseCase>>((acc, item) => {
    acc[item] = {
      description: item,
      json: JSON.stringify(mappingObject[item] || {}, null, 2),
      id: crypto.randomUUID(),
      source: 'static',
      persistence: 'local',
    };
    return acc;
  }, {});

export const INSIGHT_STATIC_USE_CASES: Record<
  TEntity,
  Record<string, IUseCase>
> = {
  incident: mapper(
    INSIGHT_STATIC_USE_CASES_KEY.incident,
    INSIGHT_INCIDENT_STATIC_USECASES,
  ),
  defect: mapper(
    INSIGHT_STATIC_USE_CASES_KEY.defect,
    INSIGHT_DEFECT_STATIC_USECASES,
  ),
  testcase: mapper(
    INSIGHT_STATIC_USE_CASES_KEY.testcase,
    INSIGHT_TESTCASE_STATIC_USECASES,
  ),
};

export const STATIC_USE_CASE_LABEL_MAPPING: Record<string, string> = {
  'Potential automation': 'Potential Automation Use Cases',
  top_10_applications: 'Top 10 Applications Impacted',
  top_10_infrastructure_systems: 'Top 10 Infra Impacted',
  top_10_issues: 'Top 10 Issues Reported',

  'Top 10 Defect': 'Defect Hotspots',
  'Top 10 Features/Epics Impacted': 'Top 10 Features and Epics Impacted',

  'Potential regression testsuite': 'Potential Regression Test Suite',
  'Testcase Impacted': 'High Impacted Epics and Features',
  'Testcase hotspots': 'Testcase Hotspots',
  'Testcase prioritization': 'Impact Based Test Case Prioritization',
  'evaluate test case quality': 'Test Case Quality Evaluation',
  'duplicate test cases': 'Test Suite Optimization & Deduplication',
};

export const TRENDS_STATIC_USE_CASES_KEY = {
  incident: {
    AVERAGE_MTTR: 'Average MTTR',
    AVERAGE_INCIDENT: 'Average Incident',
    SLA_COMPLIANCE: 'SLA Compliance',
    RECURRING_ISSUE: 'Recurring Issue',
    SIMILAR_INCIDENT: 'Similar Incident',
    INCIDENT_ANALYTICS: 'Incident Analytics',
    TRENDS_ANALYTICS: 'Trend Analysis',
  },
  defect: {
    AVERAGE_MTTR: 'Average MTTR',
    AVERAGE_DEFECT: 'Average Defect',
    SIMILAR_DEFECTS: 'Similar Defects',
    DEFECT_ANALYTICS: 'Defect Analytics',
    DEFECT_AGE: 'Defect Age',
  },
  testcase: {
    AVERAGE_TESTCASE: 'Average Testcase',
    SIMILAR_TESTCASE: 'Similar Testcase',
    TESTCASE_ANALYTICS: 'Testcase Analytics',
    TESTCASE_FREQUENCY: 'Testcase prioritization frequency',
  },
} as const;

export const TRENDS_STATIC_USE_CASES: Record<
  TEntity,
  Record<string, IUseCase>
> = {
  incident: mapper(TRENDS_STATIC_USE_CASES_KEY.incident, {}),
  defect: mapper(TRENDS_STATIC_USE_CASES_KEY.defect, {}),
  testcase: mapper(TRENDS_STATIC_USE_CASES_KEY.testcase, {}),
};
