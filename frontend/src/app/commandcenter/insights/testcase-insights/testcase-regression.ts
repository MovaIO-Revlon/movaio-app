import { Component, computed, inject, input } from '@angular/core';
import { IRegressionSuite } from '../../../types';
import { AnalyticsService } from '../../../services/analytics.service';
import { FilterStore } from '../../trends/filter.store';
import { WidgetCardComponent } from '../../../marketplace/mcpconnectors/widget-builder/widget-card';
import { historyCache } from '../../../utils';
import { rxResource } from '@angular/core/rxjs-interop';

@Component({
  selector: 'testcase-regression',
  imports: [WidgetCardComponent],
  host: {
    class: 'd-block',
  },
  template: `
    <app-widget-card
      [isLoading]="automationQuery.isLoading()"
      [isEmpty]="hasNoData()"
      [title]="enabledHeaders() ? 'Potential Regression Test Suite' : ''"
      [showInfo]="false"
      style="min-height: 26rem;"
      [showRefresh]="filterStore.cacheEnabled()"
      (refresh)="query.refetch()"
    >
      <div
        class="wrapper overflow-auto h-100 position-relative border rounded-2"
      >
        <table class="table fs-12">
          <thead>
            <tr>
              <th class="sticky-top bg-secondary-subtle">Test Case ID</th>
              <th class="sticky-top bg-secondary-subtle">Title</th>
              <th class="sticky-top bg-secondary-subtle">Applications</th>
              <th class="sticky-top bg-secondary-subtle">Feature</th>
              <th class="sticky-top bg-secondary-subtle">Frequency</th>
              <th class="sticky-top bg-secondary-subtle">Run(s)</th>
              <th class="sticky-top bg-secondary-subtle">Fail</th>
              <th class="sticky-top bg-secondary-subtle">Fail %</th>
              <th class="sticky-top bg-secondary-subtle">Last Run</th>
              <th class="sticky-top bg-secondary-subtle">Score</th>
              <th class="sticky-top bg-secondary-subtle">Priority</th>
            </tr>
          </thead>
          <tbody>
            @for (item of data(); track item.test_case_id) {
              <tr>
                <td>{{ item.test_case_id }}</td>
                <td>{{ item.title }}</td>
                <td>{{ item.application }}</td>
                <td>{{ item.feature }}</td>
                <td>{{ item.recommended_execution_frequency }}</td>
                <td>{{ item.execution_history.execution_count }}</td>
                <td>{{ item.execution_history.failure_count }}</td>
                <td>{{ item.execution_history.failure_rate_percentage }}</td>
                <td>{{ item.execution_history.last_executed }}</td>
                <td>
                  <div
                    class="progress"
                    role="progressbar"
                    aria-label="Basic example"
                    aria-valuenow="0"
                    aria-valuemin="0"
                    aria-valuemax="100"
                  >
                    <div
                      class="progress-bar"
                      [style.width]="item.regression_candidate_score + '%'"
                    ></div>
                  </div>
                </td>
                <td>
                  <span
                    class="py-1 px-2 rounded-4"
                    [style]="priorityStyle[item.priority]"
                    >{{ item.priority }}</span
                  >
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </app-widget-card>
  `,
  styleUrl: '../insights.css',
})
export class TestCaseRegression {
  readonly priorityStyle: Record<string, string> = {
    High: 'background-color: #cc414133;',
    Medium: 'background-color: #c97f0019;',
    Low: 'background-color: #1659ea19;',
  };

  private readonly service = inject(AnalyticsService);
  readonly filterStore = inject(FilterStore);
  private readonly DATA_PATH =
    'agent_execution.Potential regression testsuite.regression_suite';

  data = computed<IRegressionSuite[]>(() => {
    const d = this.filterStore.getData<IRegressionSuite[]>(
      !this.automationQuery.error() && this.automationQuery.value()?.data,
      this.DATA_PATH,
    );
    return Array.isArray(d) ? d : [];
  });

  query = this.filterStore.createReFetchable();
  hasNoData = computed(() => !this.data().length);

  enabledHeaders = input(true);

  automationQuery = rxResource({
    params: () => this.query.payload(),
    stream: ({ params }) =>
      this.service
        .fetchTestcaseRegression(params)
        .pipe(historyCache(this.filterStore.cache, this.DATA_PATH)),
  });
}
