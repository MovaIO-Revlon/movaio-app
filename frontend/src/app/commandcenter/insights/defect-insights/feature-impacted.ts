import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  inject,
  output,
  ViewChild,
} from '@angular/core';
import { Chart } from 'chart.js';
import { IFeatureImpacted } from '../../../types';
import { AnalyticsService } from '../../../services/analytics.service';
import { FilterStore } from '../../trends/filter.store';
import {
  AnyObject,
  TreemapController,
  TreemapElement,
} from 'chartjs-chart-treemap';
import { CHART_COLOR_SET10, historyCache } from '../../../utils';
import { rxResource } from '@angular/core/rxjs-interop';
import { WidgetCardComponent } from '../../../marketplace/mcpconnectors/widget-builder/widget-card';

Chart.register(TreemapController, TreemapElement);
@Component({
  selector: 'feature-impacted',
  imports: [WidgetCardComponent],
  host: {
    class: 'd-block',
  },
  template: `
    <app-widget-card
      [isLoading]="topFeatureImpactedQuery.isLoading()"
      [isEmpty]="hasNoData()"
      title="Top 10 Features and Epics Impacted"
      [showInfo]="true"
      style="min-height: 24rem;"
      infoText="Highlights the primary features and high-level initiatives most affected by current defects to help prioritize critical stability fixes."
      [showRefresh]="filterStore.cacheEnabled()"
      (refresh)="query.refetch()"
    >
      <canvas #featureImpacted></canvas>
    </app-widget-card>
  `,
})
export class FeatureImpacted {
  @ViewChild('featureImpacted')
  featureImpacted!: ElementRef<HTMLCanvasElement>;

  private readonly service = inject(AnalyticsService);
  readonly filterStore = inject(FilterStore);
  private readonly DATA_PATH =
    'agent_execution.Top 10 Features/Epics Impacted.top_impacted_areas';

  private chartInstance?: Chart<'treemap', any, unknown> = undefined;

  data = computed<IFeatureImpacted[]>(() => {
    const d = this.filterStore.getData<IFeatureImpacted[]>(
      !this.topFeatureImpactedQuery.error() &&
        this.topFeatureImpactedQuery.value()?.data,
      this.DATA_PATH,
    );
    return Array.isArray(d) ? d : [];
  });

  query = this.filterStore.createReFetchable();
  selectImpacted = output<IFeatureImpacted>();

  hasNoData = computed(() => !this.data().length);

  constructor() {
    afterRenderEffect(() => {
      this.renderChart();
    });
  }

  private renderChart(): void {
    const ctx = this.featureImpacted.nativeElement.getContext('2d');

    if (!ctx) return;

    const infraData = this.data().map((item) => ({
      ...item,
      defect_count: item.matching_defects?.length || 0,
    }));

    const data = infraData.map((item) => item.defect_count);
    const colors = CHART_COLOR_SET10;

    const labels = infraData.map((item) => item.feature_or_epic);

    this.chartInstance?.destroy();

    this.chartInstance = new Chart(ctx, {
      type: 'treemap',
      data: {
        datasets: [
          {
            tree: infraData as unknown as AnyObject[],
            key: 'defect_count',
            groups: ['feature_or_epic'],
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
            this.selectImpacted.emit(this.data()[clickedElementIndex]);
          }
        },
      },
    });
  }

  topFeatureImpactedQuery = rxResource({
    params: () => this.query.payload(),
    stream: ({ params }) =>
      this.service
        .fetchTopImpactedFeature(params)
        .pipe(historyCache(this.filterStore.cache, this.DATA_PATH)),
  });
}
