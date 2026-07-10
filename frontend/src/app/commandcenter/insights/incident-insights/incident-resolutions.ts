import { Component, computed, inject, input } from '@angular/core';
import { IIncidentResolution } from '../../../types';
import { AnalyticsService } from '../../../services/analytics.service';
import { FilterStore } from '../../trends/filter.store';
import { WidgetCardComponent } from '../../../marketplace/mcpconnectors/widget-builder/widget-card';
import { historyCache } from '../../../utils';
import { rxResource } from '@angular/core/rxjs-interop';
@Component({
  selector: 'incident-resolutions',
  imports: [WidgetCardComponent],
  template: `
    <app-widget-card
      [isLoading]="resolutionsQuery.isLoading()"
      [isEmpty]="hasNoData()"
      title="Top 10 Resolutions"
      infoText="The Top 10 Resolutions highlight the most common actions taken by support teams to resolve incidents."
      [showRefresh]="filterStore.cacheEnabled()"
      (refresh)="query.refetch()"
      style="min-height: 24rem;"
    >
      @for (resolution of data(); track $index) {
        <details class="request-details">
          <summary class="title">
            {{ resolution.resolution }}
            <span class="count">{{
              resolution.matching_incidents.length || 0
            }}</span>
            <i class="fa-solid fa-chevron-down"></i>
          </summary>
          <div class="dropdown">
            @for (
              item of resolution.matching_incidents;
              track item.incident_id
            ) {
              <div class="detail">
                <p>ID: {{ item.incident_id }}</p>
                <p>Title: {{ item.title }}</p>
                <p>Solution Comment: {{ item.comment }}</p>
                <p>Matching Percentage: {{ item.matchPercentage }}</p>
                @if (item.description) {
                  <p>Description: {{ item.description }}</p>
                }
                @if (item.serviceType) {
                  <p>Service Type: {{ item.serviceType }}</p>
                }
                @if (item.category) {
                  <p>Category: {{ item.category }}</p>
                }
              </div>
            }
          </div>
        </details>
      }
    </app-widget-card>
  `,
  styleUrl: '../insights.css',
})
export class IncidentResolutions {
  private readonly service = inject(AnalyticsService);
  readonly filterStore = inject(FilterStore);
  private readonly DATA_PATH =
    'agent_execution.Top 10 Resolutions.top_resolutions';

  data = computed<IIncidentResolution[]>(() => {
    const externalData = this.externalData();
    if (externalData) return externalData;

    const useCasesRes =
      !this.resolutionsQuery.error() && this.resolutionsQuery.value()?.data;
    const d = this.filterStore.getData<IIncidentResolution[]>(
      useCasesRes,
      this.DATA_PATH,
    );
    return Array.isArray(d) ? d : [];
  });
  externalData = input<IIncidentResolution[]>();

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
