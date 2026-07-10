import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  input,
  output,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, ChartTypeRegistry } from 'chart.js';
import { FormsModule } from '@angular/forms';
import { IDefect, IDefectAge } from '../../../types';
import { TooltipDirective } from '../../../custom-tooltip/tooltip.directive';
import { CardLoader } from '../../../components/shared/card-loader';
@Component({
  selector: 'defect-age',
  imports: [CommonModule, FormsModule, TooltipDirective, CardLoader],
  template: `
    <div class="title">
      <span>Defect Age Distribution by Status</span>
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
      <canvas #canvas></canvas>
    </div>
  `,
  styleUrl: '../trends.css',
})
export class DefectAge {
  @ViewChild('canvas')
  canvas!: ElementRef<HTMLCanvasElement>;

  private chartInstance?: Chart<keyof ChartTypeRegistry, number[], unknown> =
    undefined;

  selectSeries = output<{ title: string; data: IDefect[] }[]>();

  loading = input(false);

  data = input<IDefectAge>(
    {
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
    },
    {
      alias: 'data',
    },
  );

  hasNoData = computed(() => {
    const d = this.data();

    return !d?.bucketDefinitions?.length;
  });

  constructor() {
    afterRenderEffect(() => {
      this.renderChart();
    });
  }

  private renderChart(): void {
    const ctx = this.canvas.nativeElement.getContext('2d');
    if (!ctx) return;
    const ageData = this.data();

    const labels = ageData.chart.xAxis.categories;
    const colorGroups = [
      '#f25373',
      '#fb8e20',
      '#8c6901',
      '#F17A92',
      '#FFA242',
      '#F9C426',
    ];

    const datasets: Chart<'bar', number[], string>['data']['datasets'] =
      ageData.series.map((item, index) => ({
        label: item.name,
        data: item.data,
        backgroundColor: colorGroups[index % colorGroups.length],
      }));

    if (!this.chartInstance) {
      this.chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets,
        },
        options: {
          scales: {
            x: {
              stacked: true,
              beginAtZero: true,
              title: {
                display: true,
                text: 'Defect age Buckets',
              },
            },
            y: {
              stacked: true,
              beginAtZero: true,
              title: {
                display: true,
                text: 'Defect Count',
              },
            },
          },
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
            },
            labelBelow: {
              font: '500 14px Fira Sans',
            },
          },
          onClick: (_, activeElements) => {
            let groupData = activeElements.map((activeElement) => {
              const clickedElementIndex = activeElement.index;
              const datasetIndex = activeElement.datasetIndex;

              const d = this.data();
              const selectedSeries = d.series[datasetIndex];
              const bucket = d.chart.xAxis.categories[clickedElementIndex];

              const defects: IDefect[] = [];

              d.seriesWithCustom.forEach((item) => {
                if (item.name === selectedSeries.name) {
                  item.data.forEach((customSeries) => {
                    if (customSeries.custom.bucket === bucket) {
                      defects.push(
                        ...customSeries.custom.defects.map((defect) => ({
                          ...defect,
                          defect_id: defect.id || defect.defect_id,
                          state: defect.status,
                        })),
                      );
                    }
                  });
                }
              });

              return {
                title: `${selectedSeries.name} (${bucket})`,
                data: defects,
              };
            });

            groupData = groupData.filter((item) => !!item.data.length);

            if (!groupData.length) return;

            this.selectSeries.emit(groupData);
          },
        },
      });
      return;
    }

    this.chartInstance.data.labels = labels;
    this.chartInstance.data.datasets = datasets;
    this.chartInstance.update();
  }
}
