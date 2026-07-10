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
import { IDefectTopArea } from '../../../types';
import { AnalyticsService } from '../../../services/analytics.service';
import { FilterStore } from '../../trends/filter.store';
import { WordCloudController, WordElement } from 'chartjs-chart-wordcloud';
import { CHART_COLOR_SET10, historyCache } from '../../../utils';
import { rxResource } from '@angular/core/rxjs-interop';
import { WidgetCardComponent } from '../../../marketplace/mcpconnectors/widget-builder/widget-card';

Chart.register(WordCloudController, WordElement);

@Component({
  selector: 'top-defects',
  imports: [WidgetCardComponent],
  host: {
    class: 'd-block',
  },
  template: `
    <app-widget-card
      [isLoading]="topDefectsQuery.isLoading()"
      [isEmpty]="hasNoData()"
      title="Defect Hotspots"
      [showInfo]="true"
      style="min-height: 24rem;"
      infoText="Identifies high-risk application modules by highlighting areas with the highest density of recurring software defects."
      [showRefresh]="filterStore.cacheEnabled()"
      (refresh)="query.refetch()"
    >
      <canvas #impactedApplications></canvas>
    </app-widget-card>
  `,
})
export class TopDefects {
  @ViewChild('impactedApplications')
  impactedApplications!: ElementRef<HTMLCanvasElement>;

  private readonly service = inject(AnalyticsService);
  readonly filterStore = inject(FilterStore);
  private readonly DATA_PATH = 'agent_execution.Top 10 Defect.top_areas';

  data = computed<IDefectTopArea[]>(() => {
    const d = this.filterStore.getData<IDefectTopArea[]>(
      !this.topDefectsQuery.error() && this.topDefectsQuery.value()?.data,
      this.DATA_PATH,
    );
    return Array.isArray(d) ? d : [];
  });

  query = this.filterStore.createReFetchable();
  selectDefectTopArea = output<IDefectTopArea>();

  hasNoData = computed(() => !this.data().length);

  constructor() {
    afterRenderEffect(() => {
      this.renderChart();
    });
  }

  private renderChart(): void {
    const ctx = this.impactedApplications.nativeElement.getContext('2d');
    const data = this.data().map((item) => ({
      ...item,
      incident_count: item.matching_defects?.length || 0,
    }));

    if (!ctx) return;

    const values = data?.length ? data.map((item) => item.incident_count) : [0];
    const colors = CHART_COLOR_SET10;

    const labels = data?.length ? data.map((item) => item.area) : ['     '];

    Chart.getChart(ctx)?.destroy();

    new Chart(ctx, {
      type: WordCloudController.id,
      data: {
        // text
        labels,
        datasets: [
          {
            // size in pixels
            label: '',
            data: values.map((item) => Math.max(20, item * 3)),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const index = ctx.dataIndex;
                return `${data[index].incident_count}`;
              },
            },
          },
        },
        elements: {
          word: {
            rotate: 0,
            minRotation: 0,
            maxRotation: 0,
            rotationSteps: 1,
            color: (ctx) => {
              const index = ctx.dataIndex ?? 0;
              return colors[index % colors.length];
            },
            weight: (ctx) => {
              const value = ctx.dataset.data[ctx.dataIndex];
              if (value > 40) return 'bold';
              if (value > 20) return 600;

              return 400;
            },
          },
        },
        onClick: (_, activeElements) => {
          if (activeElements.length > 0) {
            const clickedElementIndex = activeElements[0].index;
            this.selectDefectTopArea.emit(this.data()[clickedElementIndex]);
          }
        },
      },
    });
  }

  topDefectsQuery = rxResource({
    params: () => this.query.payload(),
    stream: ({ params }) =>
      this.service
        .fetchTopDefects(params)
        .pipe(historyCache(this.filterStore.cache, this.DATA_PATH)),
  });
}
