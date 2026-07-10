import {
  afterRenderEffect,
  Component,
  computed,
  effect,
  ElementRef,
  model,
  resource,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TooltipDirective } from '../../../custom-tooltip/tooltip.directive';
import { CardLoader } from '../../../components/shared/card-loader';
import { AnalyticsService, TTestcaseHistory } from '../../../services/analytics.service';
import { FilterStore } from '../filter.store';
import { firstValueFrom } from 'rxjs';
import { Chart } from 'chart.js';
import { ITestCaseFrequency } from '../../../types/testcase.entities';
import { CHART_COLOR_SET10 } from '../../../utils';

@Component({
  selector: 'testcase-frequency',
  imports: [CommonModule, FormsModule, TooltipDirective, CardLoader],
  template: `
    <div class="title">
      <span>Test cases by frequency of usage</span>
      <span
        class="info"
        appTooltip="The Top 10 testcases by their frequency of execution."
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

    @if (prioritizationQuery.isLoading() || hasNoData()) {
      <card-loader
        style="--top-spacing: 3rem"
        [loading]="prioritizationQuery.isLoading()"
        [noData]="hasNoData()"
      />
    }

    <div class="wrapper" style="height: 400px">
      <canvas #canvas></canvas>
    </div>
  `,
  styleUrl: '../../insights/insights.css',
})
export class TestcaseFrequency {
  @ViewChild('canvas')
  canvas!: ElementRef<HTMLCanvasElement>;

  private chartInstance?: Chart<'bar', number[], string> = undefined;

  data = model<ITestCaseFrequency[]>([]);

  hasNoData = computed(() => !this.data().length);

  constructor(
    private readonly service: AnalyticsService,
    readonly filterStore: FilterStore,
  ) {
    effect(() => {
      const history = this.filterStore.appliedFilters().history;

      if (!history) return;

      const agent_execution = (this.filterStore.history() as TTestcaseHistory)?.key?.agent_execution

      this.prioritizationQuery.set(agent_execution ? {
        data: {
          agent_execution: {
            "Testcase prioritization frequency": agent_execution['Testcase prioritization frequency'],
            errors: agent_execution.errors,
            overview: agent_execution.overview
          }
        },
        message: 'from history',
        success: true
      } : undefined)
    })

    effect(() => {
      const res = this.prioritizationQuery.value();

      if (res?.data) {
        this.data.set(
          Array.isArray(
            res.data.agent_execution?.['Testcase prioritization frequency']
              ?.prioritized_test_cases,
          )
            ? res.data.agent_execution['Testcase prioritization frequency']
              .prioritized_test_cases
            : [],
        );
      }
    });

    afterRenderEffect(() => {
      this.renderChart();
    });
  }

  private renderChart(): void {
    const ctx = this.canvas.nativeElement.getContext('2d');
    if (!ctx) return;
    const priorityData = this.data();

    const labels = priorityData.map((item) => item.test_case_id).flat(1);
    const data = priorityData.map((item) => item.execution_count);

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
          scales: {
            x: {
              beginAtZero: true,
              grid: {
                display: false,
              },
              title: {
                display: true,
                text: 'Testcases',
              },
            },
            y: {
              title: {
                display: true,
                text: 'Execution Count',
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
        },
      });
      return;
    }

    this.chartInstance.data.labels = labels;
    this.chartInstance.data.datasets[0].data = data;
    this.chartInstance.update();
  }

  prioritizationQuery = resource({
    params: () => this.filterStore.queryFilters(),
    loader: ({ params, abortSignal }) =>
      firstValueFrom(this.service.fetchTestcaseFrequency(params, abortSignal)),
  });
}
