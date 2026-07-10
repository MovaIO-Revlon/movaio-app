import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  inject,
  ViewChild,
} from '@angular/core';
import { Chart } from 'chart.js';
import { AnalyticsService } from '../../../services/analytics.service';
import { FilterStore } from '../../trends/filter.store';
import {
  AnyObject,
  TreemapController,
  TreemapElement,
} from 'chartjs-chart-treemap';
import { IImpactedTestCase } from '../../../types/testcase.entities';
import { CHART_COLOR_SET10, historyCache } from '../../../utils';
import { WidgetCardComponent } from '../../../marketplace/mcpconnectors/widget-builder/widget-card';
import { rxResource } from '@angular/core/rxjs-interop';

Chart.register(TreemapController, TreemapElement);
@Component({
  selector: 'testcase-impacted',
  imports: [WidgetCardComponent],
  host: {
    class: 'd-block',
  },
  template: `
    <app-widget-card
      [isLoading]="topImpactedTescaseQuery.isLoading()"
      [isEmpty]="hasNoData()"
      title="High Impacted Epics and Features"
      [showInfo]="true"
      style="min-height: 24rem;"
      infoText="Displays the specific test cases affected by recent code changes or defects to ensure targeted validation of impacted functionality."
      [showRefresh]="filterStore.cacheEnabled()"
      (refresh)="query.refetch()"
    >
      <canvas #priorityChart></canvas>
    </app-widget-card>
  `,
})
export class TestcaseImpacted {
  @ViewChild('priorityChart')
  priorityChart!: ElementRef<HTMLCanvasElement>;

  private readonly service = inject(AnalyticsService);
  readonly filterStore = inject(FilterStore);
  private readonly DATA_PATH =
    'agent_execution.Testcase Impacted.impacted_test_cases';

  private chartInstance?: Chart<'treemap', any, unknown> = undefined;

  data = computed<IImpactedTestCase[]>(() => {
    const d = this.filterStore.getData<IImpactedTestCase[]>(
      !this.topImpactedTescaseQuery.error() &&
        this.topImpactedTescaseQuery.value()?.data,
      this.DATA_PATH,
    );
    return Array.isArray(d) ? d : [];
  });

  query = this.filterStore.createReFetchable();

  hasNoData = computed(() => !this.data().length);

  constructor() {
    afterRenderEffect(() => {
      this.renderChart();
    });
  }

  private renderChart(): void {
    const ctx = this.priorityChart.nativeElement.getContext('2d');

    if (!ctx) return;

    const testCaseData = this.data();
    const colors = CHART_COLOR_SET10;

    this.chartInstance?.destroy();

    this.chartInstance = new Chart(ctx, {
      type: 'treemap',
      data: {
        datasets: [
          {
            tree: testCaseData as unknown as AnyObject[],
            key: 'rank',
            groups: ['epic'],
            type: 'treemap',
            data: [],
            borderColor: 'white',
            borderWidth: 1,
            spacing: 0,
            labels: {
              display: true,
              align: 'left',
              position: 'top',
              padding: 5,
              font: {
                size: 10,
                weight: 500,
              },
              formatter: (ctx) => {
                return [ctx?.raw?.g || ''];
              },
            },
            backgroundColor: (ctx) => {
              const index = ctx.dataIndex ?? 0;
              return colors[index % colors.length];
            },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const d = this.data();
                return [
                  `Feature: ${d[ctx.dataIndex].feature}`,
                  `Use Case: ${d[ctx.dataIndex].use_case}`,
                ];
              },
            },
          },
        },
      },
    });
  }

  topImpactedTescaseQuery = rxResource({
    params: () => this.query.payload(),
    stream: ({ params }) =>
      this.service
        .fetchTestcaseImpacted(params)
        .pipe(historyCache(this.filterStore.cache, this.DATA_PATH)),
  });
}
