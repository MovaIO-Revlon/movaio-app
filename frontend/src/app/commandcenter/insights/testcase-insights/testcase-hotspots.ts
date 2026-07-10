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

import { AnalyticsService } from '../../../services/analytics.service';
import { FilterStore } from '../../trends/filter.store';
import { WordCloudController, WordElement } from 'chartjs-chart-wordcloud';
import { ITestcaseHotspots } from '../../../types/testcase.entities';
import { CHART_COLOR_SET10, historyCache } from '../../../utils';
import { rxResource } from '@angular/core/rxjs-interop';
import { WidgetCardComponent } from '../../../marketplace/mcpconnectors/widget-builder/widget-card';

Chart.register(WordCloudController, WordElement);

@Component({
  selector: 'testcase-hotspots',
  imports: [WidgetCardComponent],
  host: {
    class: 'd-block',
  },
  template: `
    <app-widget-card
      [isLoading]="topTestcaseHotspotQuery.isLoading()"
      [isEmpty]="hasNoData()"
      title="Testcase Hotspots"
      [showInfo]="true"
      style="min-height: 24rem;"
      infoText="Identifies the most unstable test cases by highlighting those with the highest frequency of failure and execution volatility."
      [showRefresh]="filterStore.cacheEnabled()"
      (refresh)="query.refetch()"
    >
      <canvas #impactedChart></canvas>
    </app-widget-card>
  `,
})
export class TestcaseHotspots {
  @ViewChild('impactedChart')
  impactedChart!: ElementRef<HTMLCanvasElement>;

  private readonly service = inject(AnalyticsService);
  readonly filterStore = inject(FilterStore);
  private readonly DATA_PATH = 'agent_execution.Testcase hotspots.top_hotspots';

  data = computed<ITestcaseHotspots[]>(() => {
    const d = this.filterStore.getData<ITestcaseHotspots[]>(
      !this.topTestcaseHotspotQuery.error() &&
        this.topTestcaseHotspotQuery.value()?.data,
      this.DATA_PATH,
    );
    return Array.isArray(d) ? d : [];
  });

  query = this.filterStore.createReFetchable();

  selectHotspot = output<ITestcaseHotspots>();

  hasNoData = computed(() => !this.data().length);

  constructor() {
    afterRenderEffect(() => {
      this.renderChart();
    });
  }

  private renderChart(): void {
    const ctx = this.impactedChart.nativeElement.getContext('2d');
    const data = this.data().map((item) => ({
      ...item,
      test_case_count: item.matching_test_cases?.length || 0,
    }));

    if (!ctx) return;

    const values = data?.length
      ? data.map((item) => item.test_case_count)
      : [0];
    const colors = CHART_COLOR_SET10;

    const labels = data?.length
      ? data.map((item) => item.hotspot_area)
      : ['     '];

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
                return `${data[index].test_case_count}`;
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
            this.selectHotspot.emit(this.data()[clickedElementIndex]);
          }
        },
      },
    });
  }

  topTestcaseHotspotQuery = rxResource({
    params: () => this.query.payload(),
    stream: ({ params }) =>
      this.service
        .fetchTopDefects(params)
        .pipe(historyCache(this.filterStore.cache, this.DATA_PATH)),
  });
}
