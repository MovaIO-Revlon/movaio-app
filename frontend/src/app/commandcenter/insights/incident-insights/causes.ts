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
import {
  CHART_COLOR_SET10,
  historyCache,
  LabelBelowPlugin,
} from '../../../utils';
import { IIncidentRootCause } from '../../../types';
import { AnalyticsService } from '../../../services/analytics.service';
import { FilterStore } from '../../trends/filter.store';
import { rxResource } from '@angular/core/rxjs-interop';
import { WidgetCardComponent } from '../../../marketplace/mcpconnectors/widget-builder/widget-card';

@Component({
  selector: 'causes',
  imports: [WidgetCardComponent],
  template: `
    <app-widget-card
      [isLoading]="rootCausesQuery.isLoading()"
      [isEmpty]="hasNoData()"
      title="Top 10 Root Causes"
      [showInfo]="true"
      infoText="The Top 10 Root Causes summarize the underlying reasons behind the incidents reported."
      [showRefresh]="filterStore.cacheEnabled()"
      (refresh)="query.refetch()"
      style="min-height: 24rem;"
    >
      <canvas #causes></canvas>
    </app-widget-card>
  `,
  styleUrl: '../insights.css',
})
export class Causes {
  @ViewChild('causes')
  causesCanvas!: ElementRef<HTMLCanvasElement>;
  private readonly service = inject(AnalyticsService);
  readonly filterStore = inject(FilterStore);
  private readonly DATA_PATH =
    'agent_execution.Top 10 Root Causes.top_root_causes';

  private chartInstance?: Chart<'bar', number[], string> = undefined;

  data = computed<IIncidentRootCause[]>(() => {
    const useCasesRes =
      !this.rootCausesQuery.value() && this.rootCausesQuery.value()?.data;
    const d = this.filterStore.getData<IIncidentRootCause[]>(
      useCasesRes,
      this.DATA_PATH,
    );
    return Array.isArray(d) ? d : [];
  });

  query = this.filterStore.createReFetchable();

  selectCause = output<IIncidentRootCause>();

  hasNoData = computed(() => !this.data().length);

  constructor() {
    afterRenderEffect(() => {
      this.renderChart();
    });
  }

  private renderChart(): void {
    const ctx = this.causesCanvas.nativeElement.getContext('2d');
    if (!ctx) return;
    const issuesData = this.data().map((item) => ({
      ...item,
      incident_count: item?.matching_incidents?.length || 0,
    }));

    const labels = issuesData
      .map((item) => ['', `${item.root_cause} (${item.incident_count})`])
      .flat(1);
    const data = issuesData.map((item) => [0, item.incident_count]).flat();

    if (!this.chartInstance) {
      this.chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              data,
              backgroundColor: CHART_COLOR_SET10,
            },
          ],
        },
        options: {
          indexAxis: 'y',
          scales: {
            y: { display: false },
            x: {
              beginAtZero: true,
              grid: {
                display: false,
              },
            },
          },
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false,
            },
            labelBelow: {
              font: '500 14px Fira Sans',
            },
          },
          onClick: (_, activeElements) => {
            if (activeElements.length > 0) {
              const clickedElementIndex = Math.floor(
                activeElements[0].index / 2,
              );
              this.selectCause.emit(this.data()[clickedElementIndex]);
            }
          },
        },
        plugins: [LabelBelowPlugin],
      });
      return;
    }

    this.chartInstance.data.labels = labels;
    this.chartInstance.data.datasets[0].data = data;
    this.chartInstance.update();
  }

  rootCausesQuery = rxResource({
    params: () => this.query.payload(),
    stream: ({ params }) =>
      this.service
        .fetchTopRootCauses(params)
        .pipe(historyCache(this.filterStore.cache, this.DATA_PATH)),
  });
}
