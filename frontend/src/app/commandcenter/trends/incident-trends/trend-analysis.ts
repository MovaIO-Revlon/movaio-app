import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  input,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart } from 'chart.js';
import { FormsModule } from '@angular/forms';
import { IIncident, ITrendByApplication } from '../../../types';
import { TooltipDirective } from '../../../custom-tooltip/tooltip.directive';
import { CardLoader } from '../../../components/shared/card-loader';
@Component({
  selector: 'trend-analysis',
  imports: [CommonModule, FormsModule, TooltipDirective, CardLoader],
  template: `
    <div class="title">
      <span>Trend Analysis</span>
      <span
        class="info"
        appTooltip="Incidents trend over time across key applications/services"
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 17 17"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            opacity="0.6"
            d="M7.65 12.75H9.35V7.65H7.65V12.75ZM8.5 0C3.80375 0 0 3.80375 0 8.5C0 13.1962 3.80375 17 8.5 17C13.1962 17 17 13.1962 17 8.5C17 3.80375 13.1962 0 8.5 0ZM8.5 15.3C4.7515 15.3 1.7 12.2485 1.7 8.5C1.7 4.7515 4.7515 1.7 8.5 1.7C12.2485 1.7 15.3 4.7515 15.3 8.5C15.3 12.2485 12.2485 15.3 8.5 15.3ZM7.65 5.95H9.35V4.25H7.65V5.95Z"
            fill="#FFA242"
          />
        </svg>
      </span>
    </div>

    @if (loading() || hasNoData()) {
      <card-loader
        style="--top-spacing: 3rem"
        [loading]="loading()"
        [noData]="hasNoData()"
      />
    }
    <div class="wrapper">
      <canvas #trendAnalysis></canvas>
    </div>

    <div class="d-flex justify-content-between flex-wrap fs-12 text-muted">
      @for (item of DATASET_MAP; track $index) {
        <span
          class="cursor-pointer"
          [style.color]="selectedType() === item.key ? item.color : ''"
          (click)="selectType(item.key)"
        >
          <svg
            width="17"
            height="10"
            viewBox="0 0 17 10"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M1 5H15.3478"
              [attr.stroke]="item.color"
              stroke-width="2"
              stroke-linecap="round"
            />
            <circle
              cx="8"
              cy="5"
              r="4"
              fill="white"
              [attr.stroke]="item.color"
              stroke-width="2"
            />
          </svg>

          <span class="ps-2">{{ item.label }}</span>
        </span>
      }
    </div>
  `,
  styleUrl: '../trends.css',
})
export class TrendAnalysis {
  @ViewChild('trendAnalysis')
  trendAnalysisCanvas!: ElementRef<HTMLCanvasElement>;

  private chartInstance?: Chart<'line', (number | null)[], unknown> = undefined;
  readonly DATASET_MAP: {
    label: string;
    color: string;
    key: keyof Pick<
      ITrendByApplication,
      'weekends' | 'weekdays' | 'business_hours' | 'off_hours'
    >;
  }[] = [
    { label: 'Weekdays', key: 'weekdays', color: '#F53131' },
    { label: 'Weekends', key: 'weekends', color: '#F17A92' },
    { label: 'Business Hours', key: 'business_hours', color: '#059BDC' },
    { label: 'Off Hours', key: 'off_hours', color: '#F9C426' },
  ];

  selectedType = signal('');

  loading = input(false);

  data = input<ITrendByApplication>(
    {
      business_hours: [],
      details: {},
      periods: [],
      off_hours: [],
      weekdays: [],
      weekends: [],
    },
    {
      alias: 'data',
    },
  );

  selectTrend = output<{ title: string; data: IIncident[] }[]>();

  hasNoData = computed(() => {
    const d = this.data();

    return this.DATASET_MAP.every((item) => !d[item.key].length);
  });

  constructor() {
    afterRenderEffect(() => {
      this.renderChart();
    });
  }

  filteredDataset = computed(() => {
    const selectedType = this.selectedType();

    if (selectedType)
      return this.DATASET_MAP.filter((item) => item.key === selectedType);

    return this.DATASET_MAP;
  });

  private renderChart(): void {
    const ctx = this.trendAnalysisCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    const { periods, ...rest } = this.data();

    const datasets = this.filteredDataset().map((item) => ({
      label: item.label,
      data: rest[item.key].map((item) => item || null),
      borderColor: item.color,
      pointStyle: 'circle',
      pointRadius: 5,
      pointBackgroundColor: '#fff',
      pointBorderWidth: 2,
    }));

    if (!this.chartInstance) {
      this.chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: periods,
          datasets,
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false,
            },
          },
          scales: {
            x: {
              border: {
                color: '#CECCD1',
                display: true,
                dash: [3, 3],
              },
            },
            y: {
              title: { display: true, text: 'Incident Count', color: '#000' },
              border: {
                color: '#CECCD1',
                display: true,
                dash: [3, 3],
              },
              ticks: {
                stepSize: 1,
                precision: 0,
              },
            },
          },
          onClick: (_, activeElements) => {
            if (!activeElements.length) return;

            const selectedTrend = activeElements.map((activeElement) => {
              const clickedElementIndex = activeElement.index;
              const datasetIndex = activeElement.datasetIndex;

              const currentData = this.data();
              const filteredDataset = this.filteredDataset();

              const clickedGroup = filteredDataset[datasetIndex].key;
              const clickedGroupData =
                currentData.details[
                  currentData.periods[
                    clickedElementIndex
                  ] as keyof typeof currentData.details
                ];

              return {
                title: filteredDataset[datasetIndex].label,
                data: clickedGroupData[clickedGroup].map((item) => ({
                  incident_id: item.id,
                  created_at: item.created_at,
                  created: item.created_at,
                  date: item.created_at,
                  title: item.description,
                  category: item.category,
                  severity: item.severity,
                  priority: item.priority,
                  state: item.status,
                })) as IIncident[],
              };
            });

            if (selectedTrend?.length) this.selectTrend.emit(selectedTrend);
          },
        },
      });
      return;
    }

    this.chartInstance.data.labels = periods;
    this.chartInstance.data.datasets = datasets;
    this.chartInstance.update();
  }

  selectType(app: string) {
    this.selectedType.update((v) => (v === app ? '' : app));

    this.renderChart();
  }
}
