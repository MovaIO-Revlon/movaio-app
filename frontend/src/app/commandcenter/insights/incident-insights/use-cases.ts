import { Component, computed, inject, input } from '@angular/core';
import { IUseCases } from '../../../types';
import { AnalyticsService } from '../../../services/analytics.service';
import { FilterStore } from '../../trends/filter.store';
import { historyCache } from '../../../utils';
import { WidgetCardComponent } from '../../../marketplace/mcpconnectors/widget-builder/widget-card';
import { rxResource } from '@angular/core/rxjs-interop';

@Component({
  selector: 'use-cases',
  imports: [WidgetCardComponent],
  host: {
    class: 'd-block',
  },
  template: `
    <app-widget-card
      [isLoading]="automationQuery.isLoading()"
      [isEmpty]="hasNoData()"
      [noPadding]="!enabledHeaders()"
      [title]="enabledHeaders() ? 'Potential Automation Use Cases' : ''"
      [showInfo]="false"
      [showRefresh]="filterStore.cacheEnabled()"
      (refresh)="query.refetch()"
      style="min-height: 24rem;"
    >
      <div class="test-case-wrapper overflow-auto h-100 position-relative">
        @for (item of data(); track item.rank) {
          <div class="test-case-card">
            <div class="title">{{ item.automation_title }}</div>
            <div class="description">{{ item.description }}</div>
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
export class UseCases {
  private readonly service = inject(AnalyticsService);
  readonly filterStore = inject(FilterStore);
  private readonly DATA_PATH =
    'agent_execution.Potential automation.automation_use_cases';

  data = computed<IUseCases[]>(() => {
    const externalData = this.externalData();
    if (externalData) return externalData;

    const useCasesRes =
      !this.automationQuery.error() && this.automationQuery.value()?.data;
    const d = this.filterStore.getData<IUseCases[]>(
      useCasesRes,
      this.DATA_PATH,
    );
    return Array.isArray(d) ? d : [];
  });

  hasNoData = computed(() => !this.data().length);

  enabledHeaders = input(true);
  externalData = input<IUseCases[]>();

  query = this.filterStore.createReFetchable();
  automationQuery = rxResource({
    params: () => (this.externalData() ? undefined : this.query.payload()),
    stream: ({ params }) =>
      this.service
        .fetchAutomationSteps(params)
        .pipe(historyCache(this.filterStore.cache, this.DATA_PATH)),
  });
}
