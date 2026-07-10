import { Component, effect, inject, resource, signal } from '@angular/core';
import { FilterStore } from '../filter.store';
import {
  AnalyticsService,
  TDefectHistory,
} from '../../../services/analytics.service';
import { firstValueFrom } from 'rxjs';
import { EntityAnalytics } from '../../../components/shared/entity-analytics';
import { DefectTableModal } from '../../../components/shared/defect-table-modal/defect-table-modal';
import {
  ApiResponse,
  IDefect,
  IDefectAge,
  IDefectAnalyticsQueryResponse,
  TableWidgetConfig,
} from '../../../types';
import { KpiCard } from '../../../components/shared/kpi-card';
import { SimilarEntityModal } from '../../../components/shared/similar-entity-modal';
import { DefectAge } from './defect-age';
import { TRENDS_STATIC_USE_CASES_KEY } from '../../../marketplace/mcpconnectors/constants';
import {
  IHeading,
  EntityTable,
} from '../../../components/shared/entity-table/entity-table';
import { WidgetRenderer } from '../../../components/widgets/widget-renderer';

@Component({
  selector: 'defect-trends',
  imports: [
    KpiCard,
    EntityAnalytics,
    DefectTableModal,
    SimilarEntityModal,
    DefectAge,
    WidgetRenderer,
    EntityTable,
  ],
  templateUrl: './defect-trends.html',
  styleUrl: '../trends.css',
})
export class DefectTrends {
  filterStore = inject(FilterStore);
  private readonly service = inject(AnalyticsService);
  useCases = TRENDS_STATIC_USE_CASES_KEY.defect;

  kpis = signal<IDefectAnalyticsQueryResponse['kpis']>({
    avg_defects_per_day: 0,
    avg_mttr: '',
    similar_defects: [],
  });

  analytics = signal<Record<string, { label: string; value: number }[]>>({
    category: [],
    priority: [],
    severity: [],
    status: [],
  });

  meta = signal<IDefectAnalyticsQueryResponse['meta']>({
    total_defects: 0,
    end_date: '',
    start_date: '',
  });

  defectAge = signal<IDefectAge>({
    bucketDefinitions: [],
    chart: {
      stacking: '',
      title: '',
      xAxis: {
        categories: [],
        title: '',
      },
      yAxis: {
        title: '',
      },
    },
    generatedOn: '',
    notes: '',
    series: [],
    seriesWithCustom: [],
    statusOrder: [],
    totalsByBucket: [],
  });

  selectedSimilarDefects = signal<{ label: string; value: number }[] | null>(
    null,
  );

  selectedDefectData = signal<{ title: string; data: IDefect[] }[] | null>(
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

      const kpis = (this.filterStore.history() as TDefectHistory)?.kpis;

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
        this.kpisQuery.value() as ApiResponse<IDefectAnalyticsQueryResponse>;

      if (kpiRes?.data) {
        this.kpis.set(kpiRes.data.kpis);
        this.analytics.set(this.analyticsDataAdapter(kpiRes.data.analytics));
        this.meta.set(kpiRes.data.meta || []);
        this.defectAge.set(kpiRes.data.defect_age);
      }
    });
  }

  private analyticsDataAdapter(
    data: IDefectAnalyticsQueryResponse['analytics'],
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

  selectDefects(data: { title: string; data: IDefect[] }[] | null): void {
    this.selectedDefectData.set(data);
  }

  openSimilarDefectsModal() {
    this.selectedSimilarDefects.set(
      this.kpis().similar_defects?.map((item) => ({
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
      this.kpisQuery.value() as ApiResponse<IDefectAnalyticsQueryResponse>;

    this.selectedDefectData.set([
      {
        title: `${key} (${data.label})`,
        data: res.data?.analytics?.all_records
          ?.filter((item) => item[key as keyof IDefect] === data.label)
          .map((item) => ({
            ...item,
            defect_id: item.id,
            state: item.status,
            created: item.created_at,
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
