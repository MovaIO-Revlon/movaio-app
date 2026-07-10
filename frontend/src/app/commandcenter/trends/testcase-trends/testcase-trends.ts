import { Component, effect, inject, resource, signal } from '@angular/core';
import { FilterStore } from '../filter.store';
import {
  AnalyticsService,
  TTestcaseHistory,
} from '../../../services/analytics.service';
import { firstValueFrom } from 'rxjs';
import { EntityAnalytics } from '../../../components/shared/entity-analytics';
import { KpiCard } from '../../../components/shared/kpi-card';
import { SimilarEntityModal } from '../../../components/shared/similar-entity-modal';
import {
  ITestcaseAnalyticsQueryResponse,
  ITestcase,
  ApiResponse,
  TableWidgetConfig,
} from '../../../types';
import { TestcaseTableModal } from '../../../components/shared/testcase-table-modal/testcase-table-modal';
import { TestcaseFrequency } from './testcase-frequency';
import { TRENDS_STATIC_USE_CASES_KEY } from '../../../marketplace/mcpconnectors/constants';
import {
  IHeading,
  EntityTable,
} from '../../../components/shared/entity-table/entity-table';
import { WidgetRenderer } from '../../../components/widgets/widget-renderer';

@Component({
  selector: 'testcase-trends',
  imports: [
    KpiCard,
    EntityAnalytics,
    SimilarEntityModal,
    TestcaseTableModal,
    TestcaseFrequency,
    WidgetRenderer,
    EntityTable,
  ],
  templateUrl: './testcase-trends.html',
  styleUrl: '../trends.css',
})
export class TestcaseTrends {
  filterStore = inject(FilterStore);
  private readonly service = inject(AnalyticsService);
  useCases = TRENDS_STATIC_USE_CASES_KEY.testcase;

  kpis = signal<ITestcaseAnalyticsQueryResponse['kpis']>({
    avg_testcase_per_day: 0,
    similar_testcase: [],
  });

  analytics = signal<Record<string, { label: string; value: number }[]>>({
    category: [],
    priority: [],
    severity: [],
    status: [],
  });

  meta = signal<ITestcaseAnalyticsQueryResponse['meta']>({
    total_testcase: 0,
    end_date: '',
    start_date: '',
  });

  selectSimilarTestcase = signal<{ label: string; value: number }[] | null>(
    null,
  );

  selectedTestcaseData = signal<{ title: string; data: ITestcase[] }[] | null>(
    null,
  );

  dynamicData = signal<{ headings: IHeading[]; data: unknown[] }>({
    headings: [],
    data: [],
  });

  constructor() {
    effect(() => {
      const history = this.filterStore.appliedFilters().history;

      if (!history) return;

      const kpis = (this.filterStore.history() as TTestcaseHistory)?.kpis;

      this.kpisQuery.set(
        kpis
          ? {
              data: kpis,
              message: 'from history',
              success: true,
            }
          : undefined,
      );
    });

    effect(() => {
      const kpiRes =
        this.kpisQuery.value() as ApiResponse<ITestcaseAnalyticsQueryResponse>;

      if (kpiRes?.data) {
        this.kpis.set(kpiRes.data.kpis);
        this.analytics.set(this.analyticsDataAdapter(kpiRes.data.analytics));
        this.meta.set(kpiRes.data.meta || []);
      }
    });
  }

  private analyticsDataAdapter(
    data: ITestcaseAnalyticsQueryResponse['analytics'],
  ) {
    const mapper = ({ label, count }: { label: string; count: number }) => ({
      label,
      value: count,
    });
    return {
      category: data.category.map(mapper),
      priority: data.priority.map(mapper),
      severity: data.severity.map(mapper),
      status: data.status.map(mapper),
    };
  }

  kpisQuery = resource({
    params: () => this.filterStore.queryFilters(),
    loader: ({ params, abortSignal }) =>
      firstValueFrom(this.service.fetchKpiAnalytics(params, abortSignal)),
  });

  selectTestcase(data: { title: string; data: ITestcase[] }[] | null): void {
    this.selectedTestcaseData.set(data);
  }

  openSimilarDefectsModal() {
    this.selectSimilarTestcase.set(
      this.kpis().similar_testcase?.map((item) => ({
        label: item.title,
        value: item.count,
      })) || [],
    );
  }

  onSelectData({
    key,
    data,
  }: {
    key: string;
    data: { label: string; value: number };
  }) {
    const res =
      this.kpisQuery.value() as ApiResponse<ITestcaseAnalyticsQueryResponse>;

    this.selectedTestcaseData.set([
      {
        title: `${key} (${data.label})`,
        data: res.data?.analytics?.all_records
          ?.filter((item) => item[key as keyof ITestcase] === data.label)
          .map((item) => ({
            ...item,
            test_case_id: item.id,
            state: item.status,
            created: item.created || item.created_at,
          })),
      },
    ]);
  }

  selectDynamicData({
    data,
    headers,
  }: {
    data: unknown[];
    headers: TableWidgetConfig['headers'];
    title: string;
  }) {
    this.dynamicData.set({
      data,
      headings: headers.map((item) => ({
        label: item.label,
        key: item.value,
        stringTemplate: true,
      })),
    });
  }
}
