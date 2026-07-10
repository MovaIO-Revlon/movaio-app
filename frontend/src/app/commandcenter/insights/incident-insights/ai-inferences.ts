import { Component, computed, inject, input } from '@angular/core';
import { IAiInference } from '../../../types';
import { AnalyticsService } from '../../../services/analytics.service';
import { FilterStore } from '../../trends/filter.store';
import { WidgetCardComponent } from '../../../marketplace/mcpconnectors/widget-builder/widget-card';
import { rxResource } from '@angular/core/rxjs-interop';
import { historyCache } from '../../../utils';

@Component({
  selector: 'ai-inference',
  imports: [WidgetCardComponent],
  template: `
    <app-widget-card
      [isLoading]="inferenceQuery.isLoading()"
      [isEmpty]="hasNoData()"
      [noPadding]="!enabledHeaders()"
      [title]="enabledHeaders() ? 'AI Inferences' : ''"
      [showInfo]="false"
      [showRefresh]="filterStore.cacheEnabled()"
      (refresh)="query.refetch()"
      style="min-height: 24rem;"
    >
      <div class="wrapper ai-inference-wrapper">
        @for (item of data(); track item.title) {
          <div class="ai-inference-card" [attr.data-severity]="item.severity">
            <div class="title">
              {{ item.title }}
              <span class="priority">{{ item.severity }}</span>
            </div>

            <div class="description">
              {{ item.description }}
            </div>

            <div class="impact"><i>Impact: </i>{{ item.impact }}</div>
          </div>
        }
      </div>
    </app-widget-card>
  `,
  styleUrl: '../insights.css',
})
export class AiInference {
  private readonly service = inject(AnalyticsService);
  readonly filterStore = inject(FilterStore);
  private readonly DATA_PATH = 'agent_execution.AI Inferences.ai_inferences';

  data = computed<IAiInference[]>(() => {
    const externalData = this.externalData();
    if (externalData) return externalData;

    const useCasesRes =
      !this.inferenceQuery.error() && this.inferenceQuery.value()?.data;
    const d = this.filterStore.getData<IAiInference[]>(
      useCasesRes,
      this.DATA_PATH,
    );
    return Array.isArray(d) ? d : [];
  });

  externalData = input<IAiInference[]>();

  query = this.filterStore.createReFetchable();

  hasNoData = computed(() => !this.data().length);

  enabledHeaders = input(true);

  inferenceQuery = rxResource({
    params: () => this.query.payload(),
    stream: ({ params }) =>
      this.service
        .fetchAiInference(params)
        .pipe(historyCache(this.filterStore.cache, this.DATA_PATH)),
  });
}
