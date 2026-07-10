import { Component, computed, inject } from '@angular/core';

import { IDefectResolution } from '../../../types';
import { AnalyticsService } from '../../../services/analytics.service';
import { FilterStore } from '../../trends/filter.store';
import { rxResource } from '@angular/core/rxjs-interop';
import { WidgetCardComponent } from '../../../marketplace/mcpconnectors/widget-builder/widget-card';
import { historyCache } from '../../../utils';
@Component({
  selector: 'defect-resolutions',
  imports: [WidgetCardComponent],
  template: `
    <app-widget-card
      [isLoading]="resolutionsQuery.isLoading()"
      [isEmpty]="hasNoData()"
      title="Top 10 Resolutions"
      [showInfo]="true"
      style="min-height: 24rem;"
      infoText="Displays the most common methods used to resolve defects, providing insight into your team's typical fix patterns and outcomes."
      [showRefresh]="filterStore.cacheEnabled()"
      (refresh)="query.refetch()"
    >
      @for (resolution of data(); track $index) {
        <details class="request-details">
          <summary class="title">
            {{ resolution.resolution }}
            <span class="count">{{
              resolution.matching_defects?.length || 0
            }}</span>
            <i class="fa-solid fa-chevron-down"></i>
          </summary>
          <div class="dropdown">
            @for (item of resolution.matching_defects; track item.defect_id) {
              <div class="detail">
                <p>ID: {{ item.defect_id }}</p>
                <p>Title: {{ item.title }}</p>
                <p>Impact: {{ item.impact }}</p>
                <p>Category: {{ item.category }}</p>
              </div>
            }
          </div>
        </details>
      }
    </app-widget-card>
  `,
  styleUrl: '../insights.css',
})
export class DefectResolutions {
  private readonly service = inject(AnalyticsService);
  readonly filterStore = inject(FilterStore);
  private readonly DATA_PATH =
    'agent_execution.Top 10 Resolutions.top_resolutions';

  data = computed<IDefectResolution[]>(() => {
    const d = this.filterStore.getData<IDefectResolution[]>(
      !this.resolutionsQuery.error() && this.resolutionsQuery.value()?.data,
      this.DATA_PATH,
    );
    return Array.isArray(d) ? d : [];
  });

  query = this.filterStore.createReFetchable();

  hasNoData = computed(() => !this.data().length);

  resolutionsQuery = rxResource({
    params: () => this.query.payload(),
    stream: ({ params }) =>
      this.service
        .fetchTopResolutions(params)
        .pipe(historyCache(this.filterStore.cache, this.DATA_PATH)),
  });
}
