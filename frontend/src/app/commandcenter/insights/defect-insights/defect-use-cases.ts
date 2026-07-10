import { Component, computed, inject, input } from '@angular/core';

import { IDefectRegressionScenario } from '../../../types';
import { AnalyticsService } from '../../../services/analytics.service';
import { FilterStore } from '../../trends/filter.store';
import { rxResource } from '@angular/core/rxjs-interop';
import { WidgetCardComponent } from '../../../marketplace/mcpconnectors/widget-builder/widget-card';
import { historyCache } from '../../../utils';

@Component({
  selector: 'defect-use-cases',
  imports: [WidgetCardComponent],
  template: `
    <app-widget-card
      [isLoading]="automationQuery.isLoading()"
      [isEmpty]="hasNoData()"
      [noPadding]="!enabledHeaders()"
      [title]="enabledHeaders() ? 'Potential Regression Scenarios' : ''"
      [showInfo]="false"
      [showRefresh]="filterStore.cacheEnabled()"
      (refresh)="query.refetch()"
      style="min-height: 24rem;"
    >
      <div class="test-case-wrapper overflow-auto h-100 position-relative">
        @for (item of data(); track item.rank) {
          <div class="test-case-card">
            <div class="title">{{ item.scenario_title }}</div>
            <div class="description">
              {{ item.description }}

              <br />
              <br />
              <p><strong>Impact</strong>: {{ item.potential_impact }}</p>
              <p>
                <strong>Related defects</strong>:
                {{ item.related_defects.join(', ') }}
              </p>
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
export class DefectUseCases {
  private readonly service = inject(AnalyticsService);
  readonly filterStore = inject(FilterStore);
  private readonly DATA_PATH =
    'agent_execution.Potential regression scenarios.regression_scenarios';

  data = computed<IDefectRegressionScenario[]>(() => {
    const externalData = this.externalData();
    if (externalData) return externalData;

    const useCasesRes =
      !this.automationQuery.error() && this.automationQuery.value()?.data;
    const d = this.filterStore.getData<IDefectRegressionScenario[]>(
      useCasesRes,
      this.DATA_PATH,
    );
    return Array.isArray(d) ? d : [];
  });

  hasNoData = computed(() => !this.data().length);
  externalData = input<IDefectRegressionScenario[]>();

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
