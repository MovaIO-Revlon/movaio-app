import { Component, computed, inject, input } from '@angular/core';
import { ITestcaseUseCase } from '../../../types';
import { AnalyticsService } from '../../../services/analytics.service';
import { FilterStore } from '../../trends/filter.store';
import { rxResource } from '@angular/core/rxjs-interop';
import { WidgetCardComponent } from '../../../marketplace/mcpconnectors/widget-builder/widget-card';
import { historyCache } from '../../../utils';

@Component({
  selector: 'testcase-use-cases',
  imports: [WidgetCardComponent],
  host: {
    class: 'd-block',
  },
  template: `
    <app-widget-card
      [isLoading]="automationQuery.isLoading()"
      [isEmpty]="hasNoData()"
      [title]="enabledHeaders() ? 'Potential Automation Use cases' : ''"
      [showInfo]="false"
      style="min-height: 24rem;"
      [showRefresh]="filterStore.cacheEnabled()"
      (refresh)="query.refetch()"
    >
      <div class="test-case-wrapper overflow-auto h-100 position-relative">
        @for (item of data(); track item.rank) {
          <div class="test-case-card">
            <div class="title">{{ item.automation_title }}</div>
            <div class="description">
              <p>{{ item.description }}</p>
              <p class="flex-grow-1">
                <strong>Impact</strong>: {{ item.potential_impact }}
              </p>

              <div style="display: grid; grid-template-columns: auto auto;">
                <p><strong>Feature</strong>: {{ item.feature }}</p>
                <p><strong>Status</strong>: {{ item.status }}</p>
                <p><strong>Use Case</strong>: {{ item.use_case }}</p>
              </div>
            </div>
          </div>
        }

        <div class="helptext position-sticky bottom-0 bg-white">
          By addressing these areas, efficiency can be greatly improved,
          response times reduced, and user satisfaction increased.
        </div>
      </div>
    </app-widget-card>
  `,
  styleUrl: '../insights.css',
})
export class TestcaseUseCases {
  private readonly service = inject(AnalyticsService);
  readonly filterStore = inject(FilterStore);
  private readonly DATA_PATH =
    'agent_execution.Potential automation.automation_use_cases';

  data = computed<ITestcaseUseCase[]>(() => {
    const d = this.filterStore.getData<ITestcaseUseCase[]>(
      !this.automationQuery.error() && this.automationQuery.value()?.data,
      this.DATA_PATH,
    );
    return Array.isArray(d) ? d : [];
  });

  hasNoData = computed(() => !this.data().length);

  enabledHeaders = input(true);

  query = this.filterStore.createReFetchable();

  automationQuery = rxResource({
    params: () => this.query.payload(),
    stream: ({ params }) =>
      this.service
        .fetchAutomationSteps(params)
        .pipe(historyCache(this.filterStore.cache, this.DATA_PATH)),
  });
}
