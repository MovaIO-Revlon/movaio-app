import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  inject,
  output,
  ViewChild,
} from '@angular/core';
import { IInfrastructure } from '../../../types';
import {
  AnyObject,
  TreemapController,
  TreemapElement,
} from 'chartjs-chart-treemap';
import { Chart } from 'chart.js';
import { AnalyticsService } from '../../../services/analytics.service';
import { FilterStore } from '../../trends/filter.store';
import { CHART_COLOR_SET10, historyCache } from '../../../utils';
import { WidgetCardComponent } from '../../../marketplace/mcpconnectors/widget-builder/widget-card';
import { rxResource } from '@angular/core/rxjs-interop';

Chart.register(TreemapController, TreemapElement);

@Component({
  selector: 'impacted-infras',
  imports: [WidgetCardComponent],
  host: {
    class: 'd-block ',
  },
  template: `
    <app-widget-card
      [isLoading]="topInfrastructureQuery.isLoading()"
      [isEmpty]="hasNoData()"
      title="Top 10 Infra Impacted"
      [showInfo]="true"
      infoText="The Top 10 Infra Systems Impacted highlights which infrastructure environments experienced the highest number of incidents."
      [showRefresh]="filterStore.cacheEnabled()"
      (refresh)="query.refetch()"
      style="min-height: 24rem;"
    >
      <canvas #impactedInfra></canvas>
    </app-widget-card>
  `,
  styleUrl: '../insights.css',
})
export class ImpactedInfras {
  @ViewChild('impactedInfra')
  impactedInfra!: ElementRef<HTMLCanvasElement>;

  private readonly service = inject(AnalyticsService);
  readonly filterStore = inject(FilterStore);
  private readonly DATA_PATH =
    'agent_execution.top_10_infrastructure_systems.top_infrastructure_systems';

  private chartInstance?: Chart<'treemap', any, unknown> = undefined;

  data = computed<IInfrastructure[]>(() => {
    const res =
      !this.topInfrastructureQuery.value() &&
      this.topInfrastructureQuery.value()?.data;
    const d = this.filterStore.getData<IInfrastructure[]>(res, this.DATA_PATH);
    return Array.isArray(d) ? d : [];
  });

  query = this.filterStore.createReFetchable();

  selectInfra = output<IInfrastructure>();

  hasNoData = computed(() => !this.data().length);

  constructor() {
    afterRenderEffect(() => {
      this.renderChart();
    });
  }

  private renderChart(): void {
    const ctx = this.impactedInfra.nativeElement.getContext('2d');

    if (!ctx) return;

    const infraData = this.data().map((item) => ({
      ...item,
      incident_count: item.matching_incidents?.length || 0,
    }));

    const data = infraData.map((item) => item.incident_count);
    const colors = CHART_COLOR_SET10;

    const labels = infraData.map((item) => item.infra_system);

    this.chartInstance?.destroy();

    this.chartInstance = new Chart(ctx, {
      type: 'treemap',
      data: {
        datasets: [
          {
            tree: infraData as unknown as AnyObject[],
            key: 'incident_count',
            groups: ['infra_system'],
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
                const label = labels[ctx.dataIndex] || 'unknown';
                const maxLength = 10 * data?.[ctx.dataIndex] || 10;
                const lines: string[] = [];

                for (let i = 0; i < label.length; i += maxLength) {
                  lines.push(label.slice(i, maxLength));
                }
                lines.push(`${data[ctx.dataIndex]}`);

                return lines;
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
              label: (ctx) =>
                `${labels[ctx.dataIndex]} (${data[ctx.dataIndex]})`,
            },
          },
        },
        onClick: (_, activeElements) => {
          if (activeElements.length > 0) {
            const clickedElementIndex = activeElements[0].index;
            this.selectInfra.emit(this.data()[clickedElementIndex]);
          }
        },
      },
    });
  }

  topInfrastructureQuery = rxResource({
    params: () => this.query.payload(),
    stream: ({ params }) =>
      this.service
        .fetchTopInfrastructureSystems(params)
        .pipe(historyCache(this.filterStore.cache, this.DATA_PATH)),
  });
}
