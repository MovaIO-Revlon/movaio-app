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
import { CHART_COLOR_SET10, historyCache } from '../../../utils';
import { WidgetCardComponent } from '../../../marketplace/mcpconnectors/widget-builder/widget-card';
import { rxResource } from '@angular/core/rxjs-interop';
import { ITestcaseDeduplication } from '../../../types';
import { Drawer } from '../../../components/drawer/drawer';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'testcase-deduplication',
  imports: [WidgetCardComponent, Drawer, CommonModule],
  host: {
    class: 'd-block',
  },
  template: `
    @let dataset = this.data();

    <app-widget-card
      [isLoading]="apiQuery.isLoading()"
      [isEmpty]="hasNoData()"
      title="Test Suite Optimization & Deduplication"
      [showInfo]="true"
      style="min-height: 24rem;"
      infoText="Streamlines your repository to cut execution times and maintenance overhead. By identifying exact duplicates, overlapping workflows, and abandoned test cases, it delivers high-confidence recommendations to merge or remove redundant tests. This ensures maximum QA coverage with minimal waste, enabling faster regression cycles and clearer documentation."
      (refresh)="query.refetch()"
      [showRefresh]="filterStore.cacheEnabled()"
      [emptyMessage]="
        !dataset?.totalAnalyzedRecords
          ? undefined
          : 'No optimization opportunities found. Test suite is already optimized'
      "
    >
      <div class="d-flex justify-content-between flex-wrap gap-1">
        <div class="d-flex flex-column">
          <div class="score-card">
            <span class="score">{{ dataset?.totalAnalyzedRecords }}</span>
            Total Records Analyzed
          </div>
          <div class="score-card">
            <span class="score">{{ dataset?.optimizationCandidates }}</span>
            Optimization Candidates
          </div>
          <div class="score-card">
            <span class="score">{{ dataset?.affectedTestCase }}</span>
            TEST CASES AFFECTED
          </div>
          <div class="score-card">
            <span class="score">{{ dataset?.avgConfidence }}%</span> AVG.
            CONFIDENCE
          </div>
          <div class="score-card">
            <span class="score">{{ dataset?.obsoleteTests }}</span> OBSOLETE
            TESTS
          </div>
        </div>
        <canvas
          #canvas
          style="max-width: 450px; height: 200px; max-height: 200px"
        >
        </canvas>
        <div style="flex-basis: 100%" class="d-flex gap-1">
          <div class="card">
            <span class="text-danger">{{ dataset?.highPriorityActions }}</span>
            <div>HIGH PRIORITY ACTIONS</div>
          </div>

          <div class="card">
            <span class="text-warning">{{
              dataset?.mediumPriorityActions
            }}</span>
            <div>MEDIUM PRIORITY ACTIONS</div>
          </div>

          <div class="card">
            <span class="text-primary">{{ dataset?.mergeActions }}</span>
            <div>MERGE ACTIONS</div>
          </div>
        </div>
        <button
          type="button"
          style="flex-basis: 100%"
          class="btn btn-warning btn-sm text-white"
          (click)="openRecords.set(true)"
          [disabled]="!dataset?.optimization_findings?.length"
        >
          View Detailed Findings
        </button>
      </div>
    </app-widget-card>
    @if (dataset?.optimization_findings?.length) {
      <drawer
        [attr.open]="openRecords()"
        (close)="openRecords.set(false)"
        position="right"
      >
        <div header class="header d-flex mb-4">
          <div>
            <div class="title fw-medium">Detailed Optimization Findings</div>
            <div class="description fs-14 text-muted">
              Actionable insights on duplicate coverage, workflow overlaps, and
              obsolete tests.
            </div>
          </div>

          <button
            style="width: 2rem; height: 2rem"
            (click)="openRecords.set(false)"
            class="ms-auto btn-warning btn rounded-circle text-warning fs-12 btn-sm bg-warning-subtle border-warning-subtle"
          >
            <i class="fa fa-x"></i>
          </button>
        </div>

        <div
          body
          class="body overflow-auto h-100 d-flex flex-column gap-4 pe-2"
        >
          @for (item of dataset.optimization_findings; track item.finding_id) {
            <details class="border rounded-2 dropdown">
              <summary class="d-flex justify-content-between p-2">
                <i class="fa fa-solid fa-chevron-right"></i>

                <div>
                  <div class="text-capitalize">
                    {{ getNormalText(item.finding_id) }}

                    <span class="text-muted fs-14"
                      >(Affected Testcases
                      {{ item.affected_test_cases.length }})
                    </span>
                  </div>
                  <div class="fs-12 text-capitalize text-muted mt-1">
                    Category: {{ getNormalText(item.finding_category) }}
                  </div>
                  <div class="d-flex gap-2 mt-1" style="font-size: 0.6rem">
                    @let priority =
                      item.optimization_recommendation.action_priority;
                    @let cfStyle = getConfidenceStyle(item.confidence_score);
                    <span
                      [class]="priorityClassMap[priority]"
                      class="px-2 py-1 rounded-4 text-uppercase"
                      >{{ priority }} priority</span
                    >
                    <span
                      class="bg-primary-subtle text-primary px-2 py-1 rounded-4 text-uppercase"
                    >
                      {{
                        getNormalText(
                          item.optimization_recommendation.recommended_action
                        )
                      }}
                      Recommended
                    </span>
                    <span
                      [style.background]="cfStyle.bg"
                      [style.color]="cfStyle.text"
                      class="px-2 py-1 rounded-4 text-uppercase"
                      >{{ item.confidence_score }}% Confidence</span
                    >
                  </div>
                </div>
              </summary>
              <div class="p-2 fs-12 d-flex flex-column gap-2 bg-light">
                @if (item?.analysis_details?.key_differences?.length) {
                  <div class="fw-medium text-uppercase">Key Differences</div>
                  <ul>
                    @for (k of item.analysis_details.key_differences; track k) {
                      <li>{{ k }}</li>
                    }
                  </ul>
                }

                @if (item?.analysis_details?.obsolete_indicators?.length) {
                  <div class="fw-medium text-uppercase">
                    Obsolete Indicators
                  </div>
                  <ul>
                    @for (
                      k of item.analysis_details.obsolete_indicators;
                      track k
                    ) {
                      <li>{{ k }}</li>
                    }
                  </ul>
                }

                @if (item?.analysis_details?.overlapping_areas?.length) {
                  <div class="fw-medium text-uppercase">Overlapping Areas</div>
                  <ul>
                    @for (
                      k of item.analysis_details.overlapping_areas;
                      track k
                    ) {
                      <li>{{ k }}</li>
                    }
                  </ul>
                }

                <div class="fw-medium">AFFECTED TEST CASES</div>
                @for (
                  testcase of item.affected_test_cases;
                  track testcase.test_case_id
                ) {
                  <div
                    class="border rounded-4 px-3 py-1 bg-white"
                    style="max-width: fit-content;"
                  >
                    <span class="text-primary fw-semibold">{{
                      testcase.test_case_id
                    }}</span>
                    - <span>{{ testcase.title }}</span> - -
                    <span>{{ testcase.priority }}</span> -
                    <span>{{ testcase.status }}</span>
                    @if (testcase.last_executed) {
                      -
                      <span
                        >Last -
                        {{ testcase.last_executed | date: 'MMM d, y' }}</span
                      >
                    }
                  </div>
                }

                <div class="fw-medium mt-3">OPTIMIZATION BENEFIT</div>
                <div
                  class="bg-white border-start border-success border-3 p-2 rounded-1"
                >
                  <strong>Impact:</strong>
                  <div>
                    {{
                      item.optimization_recommendation
                        .expected_optimization_benefit
                    }}
                  </div>
                </div>

                <div class="fw-medium mt-3">JUSTIFICATION</div>
                <div
                  class="bg-white border-start border-primary border-3 p-2 rounded-1"
                >
                  <div>
                    {{ item.optimization_recommendation.justification }}
                  </div>
                </div>
              </div>
            </details>
          }
        </div>
      </drawer>
    }
  `,
  styles: `
    .dropdown summary > i {
      position: absolute;
      top: 0.5rem;
      right: 0.5rem;
      color: #b1b1b1;
    }

    .dropdown:open summary > i {
      transform: rotate(90deg);
    }

    .score-card {
      display: flex;
      align-items: center;
      gap: 1rem;
      text-transform: uppercase;
      font-size: 0.7rem;
      color: #b1b1b1;
    }
    .score {
      font-size: 1.2rem;
      font-weight: bold;
      width: 3.5rem;
      text-align: right;
      color: #f9a84a;
    }
    .card {
      padding: 0.5rem;
      border-radius: 0;
      border: 0;
      flex: 1;
      text-align: center;
      background: #f3f4f6;
      font-size: 0.875rem;
      color: #6f6f6f;
    }

    .card > span {
      font-weight: bold;
      font-size: 1.275rem;
    }
  `,
})
export class TestcaseDeduplication {
  @ViewChild('canvas')
  canvas!: ElementRef<HTMLCanvasElement>;

  private readonly service = inject(AnalyticsService);
  readonly filterStore = inject(FilterStore);
  private readonly DATA_PATH = 'agent_execution.duplicate test cases';

  private chartInstance?: Chart<ChartType, number[], unknown> = undefined;
  priorityClassMap: Record<string, string> = {
    high: 'text-danger bg-danger-subtle',
    medium: 'text-warning bg-warning-subtle',
    low: 'text-primary bg-primary-subtle',
  };

  getNormalText(text: string) {
    return text.replace('exactdup', 'Exact Duplicate').split('_').join(' ');
  }

  getConfidenceStyle(score: number) {
    score = Math.max(0, Math.min(100, score)); // Clamp 0-100

    if (score === 100) {
      return { bg: '#E6F4EA', text: '#137333' };
    } else if (score >= 80) {
      return { bg: '#F1F8E9', text: '#558B2F' };
    } else if (score >= 50) {
      return { bg: '#FEF7E0', text: '#B06000' };
    } else if (score >= 30) {
      return { bg: '#FFEFE2', text: '#C45100' };
    } else {
      return { bg: '#FCE8E6', text: '#C5221F' };
    }
  }

  openRecords = signal(false);

  data = computed(() => {
    const d = this.filterStore.getData<ITestcaseDeduplication>(
      !this.apiQuery.error() && this.apiQuery.value()?.data,
      this.DATA_PATH,
    );
    let highPriorityActions = 0;
    let mediumPriorityActions = 0;
    let mergeActions = 0;
    let affectedTestCase = 0;

    d?.optimization_findings?.forEach((item) => {
      if (item.optimization_recommendation?.action_priority === 'high')
        highPriorityActions += 1;
      else if (item.optimization_recommendation?.action_priority === 'medium')
        mediumPriorityActions += 1;

      if (item.optimization_recommendation?.recommended_action === 'merge')
        mergeActions += 1;
      affectedTestCase += item.affected_test_cases.length;
    });
    return (
      d && {
        totalAnalyzedRecords: d?.summary?.total_records_analyzed ?? 0,
        optimizationCandidates: d?.summary?.optimization_candidates ?? 0,
        obsoleteTests: d?.summary?.potentially_obsolete_tests ?? 0,
        affectedTestCase,
        avgConfidence: d?.optimization_findings
          ? Math.round(
              (d.optimization_findings.reduce(
                (a, b) => a + b?.confidence_score,
                0,
              ) || 0) / (d.optimization_findings?.length || 1),
            )
          : 0,
        optimization_findings: d.optimization_findings,
        summary: d.summary,
        highPriorityActions,
        mediumPriorityActions,
        mergeActions,
      }
    );
  });

  query = this.filterStore.createReFetchable();

  hasNoData = computed(() => !this.data()?.optimization_findings?.length);

  constructor() {
    afterRenderEffect(() => {
      this.renderChart();
    });
  }

  private renderChart(): void {
    const ctx = this.canvas.nativeElement.getContext('2d');
    if (!ctx) return;

    const dataset = this.data();
    let labels: string[] = [
      'Exact Duplicates Groups',
      'Optimization Candidates',
      'Potentially Obsolete Tests',
      'Semantic Similar Groups',
    ];
    const countData: number[] = [
      dataset?.summary?.exact_duplicate_groups,
      dataset?.summary?.optimization_candidates,
      dataset?.summary?.potentially_obsolete_tests,
      dataset?.summary?.semantic_similarity_groups,
    ].map((i) => i ?? 0);

    labels = labels.map((item, index) => `${item}(${countData[index]})`);

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
          circumference: 180,
          rotation: -90,
          responsive: true,
          maintainAspectRatio: false,
          cutout: 50,
          radius: 100,
          elements: {
            arc: {
              spacing: 10,
              borderRadius: 10,
            },
          },
          plugins: {},
        },
        plugins: [],
      });
      return;
    }

    this.chartInstance.data.labels = labels;
    this.chartInstance.data.datasets[0].data = countData;
    this.chartInstance.update();
  }

  apiQuery = rxResource({
    params: () => this.query.payload(),
    stream: ({ params }) =>
      this.service
        .fetchTestcaseDeduplication(params)
        .pipe(historyCache(this.filterStore.cache, this.DATA_PATH)),
  });
}
