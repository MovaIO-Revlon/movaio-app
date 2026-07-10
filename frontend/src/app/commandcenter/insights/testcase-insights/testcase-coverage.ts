import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import { Chart, ChartType } from 'chart.js';
import { AnalyticsService } from '../../../services/analytics.service';
import { FilterStore } from '../../trends/filter.store';
import {
  ArcPointerPlugin,
  CenterTextPlugin,
  CHART_COLOR_SET10,
  historyCache,
} from '../../../utils';
import { WidgetCardComponent } from '../../../marketplace/mcpconnectors/widget-builder/widget-card';
import { rxResource } from '@angular/core/rxjs-interop';
import { ITestcaseCoverage } from '../../../types';
import { TOption } from '../../../components/select/select';

@Component({
  selector: 'testcase-coverage',
  imports: [WidgetCardComponent],
  host: {
    class: 'd-block',
  },
  template: `
    <app-widget-card
      [isLoading]="testcaseCoverageQuery.isLoading()"
      [isEmpty]="hasNoData()"
      title="Testcase Coverage"
      [showInfo]="true"
      style="min-height: 24rem;"
      infoText="Identifies code-impacted test cases and defects to ensure targeted validation."
      (refresh)="query.refetch()"
      [showRefresh]="filterStore.cacheEnabled()"
    >
      <canvas #canvas></canvas>
    </app-widget-card>
  `,
})
export class TestcaseCoverage {
  @ViewChild('canvas')
  canvas!: ElementRef<HTMLCanvasElement>;

  private readonly service = inject(AnalyticsService);
  readonly filterStore = inject(FilterStore);
  private readonly DATA_PATH =
    'agent_execution.Test Coverage Metrics.coverage_distribution';

  private chartInstance?: Chart<ChartType, number[], unknown> = undefined;

  private filterByOptions: TOption[] = [
    { label: 'By Application', value: 'by_application' },
    { label: 'By Category', value: 'by_category' },
    { label: 'By Priority', value: 'by_priority' },
  ];

  filterBy = signal<string>(this.filterByOptions[0].value);

  data = computed<ITestcaseCoverage['coverage_distribution']>(() => {
    const d = this.filterStore.getData<
      ITestcaseCoverage['coverage_distribution']
    >(
      !this.testcaseCoverageQuery.error() &&
        this.testcaseCoverageQuery.value()?.data,
      this.DATA_PATH,
    );
    return d;
  });

  query = this.filterStore.createReFetchable();

  hasNoData = computed(
    () => !Object.keys(this.data()?.[this.filterBy()] ?? {}).length,
  );

  constructor() {
    afterRenderEffect(() => {
      this.renderChart();
    });
  }

  private renderChart(): void {
    const ctx = this.canvas.nativeElement.getContext('2d');
    if (!ctx) return;

    const labels: string[] = [];
    const countData: number[] = [];
    const dataset = this.data();
    const data = dataset?.[this.filterBy()] || {};

    Object.keys(data).forEach((item) => {
      labels.push(item);
      countData.push(data[item]);
    });
    const totalCount = dataset?.total_test_cases ?? 0;

    if (!this.chartInstance) {
      this.chartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
          labels,
          datasets: [
            {
              data: countData,
              backgroundColor: CHART_COLOR_SET10,
              hoverOffset: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: 70,
          radius: 90,
          plugins: {
            legend: {
              labels: {
                generateLabels: (chart) => {
                  const currentActiveValue = this.filterBy();

                  return this.filterByOptions.map((item, index) => {
                    const isSelected = item.value === currentActiveValue;
                    const baseColor =
                      CHART_COLOR_SET10[index % CHART_COLOR_SET10.length];

                    return {
                      text: item.label,
                      datasetIndex: index,
                      fillStyle: `${baseColor}${isSelected ? '' : '40'}`,
                      strokeStyle: '#CCCCCC',
                    };
                  });
                },
              },
              onClick: (_e, legendItem, e) => {
                const clickedOption = this.filterByOptions.find(
                  (item) => item.label === legendItem.text,
                );
                if (!clickedOption) return;

                this.filterBy.set(clickedOption.value);
                e.chart.update();
              },
            },
            centerText: {
              text: totalCount.toString(),
              subtext: 'Testcases',
              textFont: '500 24px Fira Sans',
              subtextFont: '500 14px Fira Sans',
            },
            arcPointer: {
              lineLength: 30,
            },
          },
        },
        plugins: [CenterTextPlugin, ArcPointerPlugin],
      });
      return;
    }

    this.chartInstance.data.labels = labels;
    this.chartInstance.data.datasets[0].data = countData;
    this.chartInstance.options.plugins!.centerText!.text =
      totalCount.toString();
    this.chartInstance.update();
  }

  testcaseCoverageQuery = rxResource({
    params: () => this.query.payload(),
    stream: ({ params }) =>
      this.service
        .fetchTestcaseCoverage(params)
        .pipe(historyCache(this.filterStore.cache, this.DATA_PATH)),
  });
}
