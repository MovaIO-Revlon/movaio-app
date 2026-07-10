import { Component, effect, inject, resource, signal } from '@angular/core';
import { FilterStore } from '../filter.store';
import {
  AnalyticsService,
  TIncidentHistory,
} from '../../../services/analytics.service';
import { firstValueFrom } from 'rxjs';
import {
  ApiResponse,
  IIncident,
  IIncidentAnalyticsQueryResponse,
  ITrendByApplication,
  TableWidgetConfig,
} from '../../../types';
import { TrendAnalysis } from './trend-analysis';
import { SimilarEntityModal } from '../../../components/shared/similar-entity-modal';
import { IncidentTableModal } from '../../../components/shared/incident-table-modal/incident-table-modal';
import { KpiCard } from '../../../components/shared/kpi-card';
import { EntityAnalytics } from '../../../components/shared/entity-analytics';
import { TRENDS_STATIC_USE_CASES_KEY } from '../../../marketplace/mcpconnectors/constants';
import { WidgetRenderer } from '../../../components/widgets/widget-renderer';
import {
  IHeading,
  EntityTable,
} from '../../../components/shared/entity-table/entity-table';

@Component({
  selector: 'incident-trends',
  imports: [
    KpiCard,
    EntityAnalytics,
    TrendAnalysis,
    SimilarEntityModal,
    IncidentTableModal,
    WidgetRenderer,
    EntityTable,
  ],
  templateUrl: './incident-trends.html',
  styleUrl: '../trends.css',
})
export class IncidentTrends {
  filterStore = inject(FilterStore);
  private readonly service = inject(AnalyticsService);
  useCases = TRENDS_STATIC_USE_CASES_KEY.incident;

  kpis = signal<IIncidentAnalyticsQueryResponse['kpis']>({
    avg_incidents_per_day: 0,
    avg_mttr: '',
    recurring_issue_pct: 0,
    similar_incidents: [],
    sla_compliance_pct: 0,
  });

  analytics = signal<Record<string, { label: string; value: number }[]>>({
    category: [],
    priority: [],
    severity: [],
    status: [],
  });

  trend = signal<ITrendByApplication>({
    business_hours: [],
    details: {},
    periods: [],
    off_hours: [],
    weekdays: [],
    weekends: [],
  });

  meta = signal<IIncidentAnalyticsQueryResponse['meta']>({
    total_incidents: 0,
    end_date: '',
    start_date: '',
  });

  selectedSimilarIncidentData = signal<
    { label: string; value: number }[] | null
  >(null);

  selectedIncidentData = signal<{ title: string; data: IIncident[] }[] | null>(
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

      const kpis = (this.filterStore.history() as TIncidentHistory)?.kpis;

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
        this.kpisQuery.value() as ApiResponse<IIncidentAnalyticsQueryResponse>;

      if (kpiRes?.data) {
        this.kpis.set(kpiRes.data.kpis);
        this.analytics.set(this.analyticsDataAdapter(kpiRes.data.analytics));
        this.meta.set(kpiRes.data.meta || []);
        if (
          kpiRes?.data?.trends?.incident_trends &&
          !Array.isArray(kpiRes?.data?.trends?.incident_trends)
        )
          this.trend.set(kpiRes.data.trends.incident_trends);
      }
    });
  }

  private analyticsDataAdapter(
    data: IIncidentAnalyticsQueryResponse['analytics'],
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

  selectIncidents(data: { title: string; data: IIncident[] }[] | null): void {
    this.selectedIncidentData.set(data);
  }

  onSelectData({
    key,
    data,
  }: {
    key: string;
    data: { label: string; value: number };
  }) {
    const res =
      this.kpisQuery.value() as ApiResponse<IIncidentAnalyticsQueryResponse>;

    this.selectedIncidentData.set([
      {
        title: `${key} (${data.label})`,
        data: res.data?.analytics?.all_records
          ?.filter((item) => item[key as keyof IIncident] === data.label)
          .map((item) => ({
            ...item,
            incident_id: item.id,
            state: item.status,
            date: item.created_at,
          })),
      },
    ]);
  }

  openSimilarIncidentModal() {
    this.selectedSimilarIncidentData.set(
      this.kpis().similar_incidents?.map((item) => ({
        label: item.title,
        value: item.count,
      })) || [],
    );
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
