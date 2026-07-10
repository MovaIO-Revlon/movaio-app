import { Component, computed, inject, signal } from '@angular/core';
import { AnalyticsService } from '../../../services/analytics.service';
import { FilterStore } from '../../trends/filter.store';
import { historyCache } from '../../../utils';
import { WidgetCardComponent } from '../../../marketplace/mcpconnectors/widget-builder/widget-card';
import { rxResource } from '@angular/core/rxjs-interop';
import { ITestcaseQualityEvaluation } from '../../../types';
import { Drawer } from '../../../components/drawer/drawer';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'testcase-quality',
  imports: [WidgetCardComponent, Drawer, CommonModule],
  host: {
    class: 'd-block',
  },
  template: `
    @let dataset = this.data();

    <app-widget-card
      [isLoading]="apiQuery.isLoading()"
      [isEmpty]="hasNoData()"
      title="Test Case Quality Evaluation"
      [showInfo]="true"
      style="min-height: 24rem;"
      infoText="Provides a comprehensive health check of your test repository to elevate test execution reliability. It scans test steps and metadata to catch missing requirements, ambiguous steps, or weak coverage, scoring each test into clear quality tiers. Complete with interactive visual insights, charts, and actionable improvement badges, it gives teams the exact blueprint needed to fix poorly written tests and guarantee robust QA standards."
      (refresh)="query.refetch()"
      [showRefresh]="filterStore.cacheEnabled()"
      [emptyMessage]="
        !dataset?.summary_charts_data?.total_test_cases_evaluated
          ? undefined
          : 'No quality issues found. Test cases meet quality standard'
      "
    >
      <div class="d-flex flex-column h-100 justify-content-around gap-3">
        <div class="d-flex gap-1">
          <div class="card">
            <span class="text-danger">{{
              dataset?.summary_charts_data?.average_quality_score
            }}</span>
            <div>Avg quality score</div>
          </div>

          <div class="card">
            <span class="text-warning">{{
              dataset?.summary_charts_data?.total_test_cases_evaluated
            }}</span>
            <div>Total Evaluated</div>
          </div>

          <div class="card">
            <span class="text-success">{{
              dataset?.summary_charts_data?.quality_tier_distribution
                ?.acceptable
            }}</span>
            <div>Acceptable +</div>
          </div>
        </div>

        @if (dataset?.qualityTierBreakDown) {
          <div
            class="d-grid fs-12  row-gap-1 column-gap-4 "
            style="grid-template-columns: repeat(2, 1fr)"
          >
            <div class="fw-semibold" style="grid-column: 1 / -1">
              QUALITY TIER BREAKDOWN
            </div>

            @for (item of dataset.qualityTierBreakDown; track $index) {
              <div class="d-flex gap-1 align-items-center">
                <span style="width: 7rem;">{{ item.label }}</span>
                <div
                  style="height: 0.5rem;"
                  class="progress flex-grow-1"
                  role="progressbar"
                  aria-label="Needs Improvement"
                  [attr.aria-valuenow]="item.value"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <div
                    class="progress-bar"
                    [class]="item.class"
                    [style.width]="item.value + '%'"
                  ></div>
                </div>
                <span style="width: 2rem">{{ item.value }}%</span>
              </div>
            }
          </div>
        }

        @if (dataset?.summary_charts_data?.top_identified_gaps) {
          <div class="d-flex flex-wrap gap-1 fs-12">
            <div class="fw-semibold" style="flex-basis: 100%">
              Top SYSTEMIC GAPS
            </div>
            @for (
              gap of dataset.summary_charts_data.top_identified_gaps
                | slice: 0 : 3;
              track gap
            ) {
              <div class="px-3 py-1 rounded-4 bg-warning-subtle text-muted">
                {{ gap }}
              </div>
            }
          </div>
        }

        <button
          type="button"
          class="btn btn-warning btn-sm mt-auto text-white"
          (click)="openRecords.set(true)"
          [disabled]="!dataset?.evaluations_table_data?.length"
        >
          View Detailed Evaluations
        </button>
      </div>
    </app-widget-card>
    @if (dataset?.evaluations_table_data?.length) {
      <drawer
        [attr.open]="openRecords()"
        (close)="openRecords.set(false)"
        position="right"
      >
        <div header class="header d-flex mb-4">
          <div>
            <div class="title fw-medium">Detailed Quality Evaluations</div>
            <div class="description fs-14 text-muted">
              Review health metrics for the top
              {{ dataset.evaluations_table_data.length }} records. Expand to see
              specific gaps and fixes.
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
          @for (
            item of dataset.evaluations_table_data;
            track item.test_case_id
          ) {
            <details class="border rounded-2 dropdown">
              <summary class="d-flex flex-column p-2 fs-12">
                <i class="fa fa-solid fa-chevron-right"></i>
                <div class="text-primary fw-semibold">
                  {{ item.test_case_id }}
                </div>
                <div class="text-muted">{{ item.title }}</div>
                <div class="d-flex gap-2 mt-2 align-items-start">
                  <div
                    class="progress-circle"
                    [style]="'--value: ' + item.overall_quality_score"
                  >
                    <div class="progress-circle-inner bg-white">
                      {{ item.overall_quality_score }}
                    </div>
                  </div>

                  <div class="d-flex flex-wrap gap-2">
                    <span
                      class="bg-light-subtle text-muted px-2 py-1 rounded-4 border"
                    >
                      Completeness:
                      {{ item.ui_indicators.completeness_indicator }}
                    </span>
                    <span
                      class="bg-light-subtle text-muted px-2 py-1 rounded-4 border"
                    >
                      Coverage: {{ item.ui_indicators.coverage_indicator }}
                    </span>
                    <span
                      class="bg-light-subtle text-muted px-2 py-1 rounded-4 border"
                    >
                      Readability:
                      {{ item.ui_indicators.readability_indicator }}
                    </span>
                    <span
                      class="bg-light-subtle text-muted px-2 py-1 rounded-4 border"
                    >
                      Traceability:
                      {{ item.ui_indicators.traceability_indicator }}
                    </span>
                  </div>
                </div>
              </summary>
              <div class="p-2 fs-12 d-flex flex-column border-top">
                <div class="bg-white p-2 rounded-1">
                  <strong>ISSUES</strong>
                  <ul>
                    @if (item.identified_issues.length) {
                      @for (issue of item.identified_issues; track issue) {
                        <li class="text-warning">{{ issue }}</li>
                      }
                    } @else {
                      <li class="text-warning">N/A</li>
                    }
                  </ul>
                </div>

                <div class="bg-white p-2 rounded-1">
                  <strong>SUGGESTIONS</strong>
                  <ul>
                    @if (item.suggested_improvements.length) {
                      @for (
                        suggestion of item.suggested_improvements;
                        track suggestion
                      ) {
                        <li class="text-success">{{ suggestion }}</li>
                      }
                    } @else {
                      <li class="text-success">N/A</li>
                    }
                  </ul>
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
      font-size: 0.875rem;
      color: #b1b1b1;
    }
    .score {
      font-size: 1.5rem;
      font-weight: bold;
      width: 5rem;
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
export class TestcaseQuality {
  private readonly service = inject(AnalyticsService);
  readonly filterStore = inject(FilterStore);
  private readonly DATA_PATH = 'agent_execution.evaluate test case quality';

  priorityClassMap: Record<string, string> = {
    high: 'text-danger bg-danger-subtle',
    medium: 'text-warning bg-warning-subtle',
    low: 'text-primary bg-primary-subtle',
  };

  openRecords = signal(false);

  data = computed(() => {
    const d = this.filterStore.getData<ITestcaseQualityEvaluation>(
      !this.apiQuery.error() && this.apiQuery.value()?.data,
      this.DATA_PATH,
    );
    let qualityTierBreakDown: {
      label: string;
      value: number;
      class: string;
    }[] = [
      {
        label: 'Needs Improvement',
        value:
          d?.summary_charts_data?.quality_tier_distribution
            ?.needs_improvement ?? 0,
        class: 'text-bg-warning',
      },
      {
        label: 'Poor',
        value: d?.summary_charts_data?.quality_tier_distribution?.poor ?? 0,
        class: 'text-bg-danger',
      },
      {
        label: 'Acceptable',
        value:
          d?.summary_charts_data?.quality_tier_distribution?.acceptable ?? 0,
        class: 'text-bg-success',
      },
      {
        label: 'Excellent',
        value:
          d?.summary_charts_data?.quality_tier_distribution?.excellent ?? 0,
        class: 'text-bg-primary',
      },
    ];

    qualityTierBreakDown = qualityTierBreakDown
      .map((item) => ({
        ...item,
        value: Math.round(
          (item.value / d?.summary_charts_data?.total_test_cases_evaluated) *
            100,
        ),
      }))
      .sort((a, b) => b.value - a.value);

    return (
      d && {
        ...d,
        qualityTierBreakDown,
      }
    );
  });

  query = this.filterStore.createReFetchable();

  hasNoData = computed(() => !this.data()?.evaluations_table_data?.length);

  apiQuery = rxResource({
    params: () => this.query.payload(),
    stream: ({ params }) =>
      this.service
        .fetchTestcaseQuality(params)
        .pipe(historyCache(this.filterStore.cache, this.DATA_PATH)),
  });
}
