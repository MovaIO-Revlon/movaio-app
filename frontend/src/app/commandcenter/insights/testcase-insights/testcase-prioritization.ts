import { Component, computed, inject } from '@angular/core';
import { AnalyticsService } from '../../../services/analytics.service';
import { FilterStore } from '../../trends/filter.store';
import { ITestCasePrioritization } from '../../../types/testcase.entities';
import { historyCache } from '../../../utils';
import { rxResource } from '@angular/core/rxjs-interop';
import { WidgetCardComponent } from '../../../marketplace/mcpconnectors/widget-builder/widget-card';

@Component({
  selector: 'testcase-prioritization',
  imports: [WidgetCardComponent],
  host: {
    class: 'd-block',
  },
  template: `
    <app-widget-card
      [isLoading]="prioritizationQuery.isLoading()"
      [isEmpty]="hasNoData()"
      title="Impact Based Test Case Prioritization"
      [showInfo]="true"
      infoText="Optimizes execution by ranking test cases based on business criticalty and risk to maximize early defect detection."
      [showRefresh]="filterStore.cacheEnabled()"
      (refresh)="query.refetch()"
      style="min-height: 24rem;"
    >
      <div class="ai-inference-wrapper">
        @for (item of data(); track item.title) {
          <div
            class="ai-inference-card"
            [attr.data-severity]="item.priority.toUpperCase()"
          >
            <div class="title">
              {{ item.test_case_id }} {{ item.title }}
              <span class="priority">{{ item.priority }}</span>
            </div>

            <div class="description">
              <p>{{ item.prioritization_reason }}</p>

              <div style="display:grid; grid-template-columns: 1fr 1fr;">
                <p class="flex-grow-1">
                  <strong>Impact: </strong> {{ item.impact_explanation }}
                </p>
                <p class="flex-grow-1">
                  <strong>Epic:</strong> {{ item.epic }}<br /><br />
                  <strong>feature:</strong> {{ item.feature }}
                </p>
              </div>
            </div>
          </div>
        }
      </div>
    </app-widget-card>
  `,
  styleUrl: '../insights.css',
})
export class TestcasePrioritization {
  private readonly service = inject(AnalyticsService);
  readonly filterStore = inject(FilterStore);
  private readonly DATA_PATH =
    'agent_execution.Testcase prioritization.prioritized_test_cases';

  data = computed<ITestCasePrioritization[]>(() => {
    const d = this.filterStore.getData<ITestCasePrioritization[]>(
      !this.prioritizationQuery.error() &&
        this.prioritizationQuery.value()?.data,
      this.DATA_PATH,
    );
    return Array.isArray(d) ? d : [];
  });

  hasNoData = computed(() => !this.data().length);

  query = this.filterStore.createReFetchable();

  prioritizationQuery = rxResource({
    params: () => this.query.payload(),
    stream: ({ params }) =>
      this.service
        .fetchTestcasePrioritization(params)
        .pipe(historyCache(this.filterStore.cache, this.DATA_PATH)),
  });
}
