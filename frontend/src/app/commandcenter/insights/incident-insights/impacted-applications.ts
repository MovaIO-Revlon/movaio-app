import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  ViewChild,
} from '@angular/core';
import { IApplication } from '../../../types';
import { WordCloudController, WordElement } from 'chartjs-chart-wordcloud';
import { Chart } from 'chart.js';

import { AnalyticsService } from '../../../services/analytics.service';
import { FilterStore } from '../../trends/filter.store';
import { CHART_COLOR_SET10, historyCache } from '../../../utils';
import { rxResource } from '@angular/core/rxjs-interop';
import { WidgetCardComponent } from '../../../marketplace/mcpconnectors/widget-builder/widget-card';
import { CommonModule } from '@angular/common';

Chart.register(WordCloudController, WordElement);

@Component({
  selector: 'impacted-applications',
  imports: [WidgetCardComponent, CommonModule],
  host: {
    class: 'd-block',
  },
  template: `
    <app-widget-card
      [isLoading]="topApplicationsQuery.isLoading()"
      [isEmpty]="hasNoData()"
      [noPadding]="!enabledHeaders()"
      [title]="enabledHeaders() ? 'Top 10 Applications Impacted' : ''"
      [showInfo]="true"
      infoText="The Top 10 Applications Impacted list highlights which business and IT applications experienced the highest number of incidents."
      [showRefresh]="filterStore.cacheEnabled()"
      (refresh)="query.refetch()"
      [style.min-height]="height()"
      class="h-full"
    >
      <canvas #impactedApplications></canvas>
    </app-widget-card>
  `,
})
export class ImpactedApplications {
  @ViewChild('impactedApplications')
  impactedApplications!: ElementRef<HTMLCanvasElement>;

  private readonly service = inject(AnalyticsService);
  readonly filterStore = inject(FilterStore);
  private readonly DATA_PATH =
    'agent_execution.top_10_applications.top_applications';

  data = computed<IApplication[]>(() => {
    const externalData = this.externalData();
    if (externalData) return externalData;

    const res =
      !this.topApplicationsQuery.error() &&
      this.topApplicationsQuery.value()?.data;
    const d = this.filterStore.getData<IApplication[]>(res, this.DATA_PATH);
    return Array.isArray(d) ? d : [];
  });
  externalData = input<IApplication[]>();

  query = this.filterStore.createReFetchable();

  enabledHeaders = input(true);
  height = input('24rem');

  selectApplication = output<IApplication>();

  hasNoData = computed(() => !this.data().length);

  constructor() {
    afterRenderEffect(() => {
      this.renderImpactedApplications();
    });
  }

  private renderImpactedApplications(): void {
    const ctx = this.impactedApplications.nativeElement.getContext('2d');
    const data = this.data().map((item) => ({
      ...item,
      incident_count: item.matching_incidents?.length || 0,
    }));

    if (!ctx) return;

    const values = data?.length ? data.map((item) => item.incident_count) : [0];
    const colors = CHART_COLOR_SET10;

    const labels = data?.length
      ? data.map((item) => item.application)
      : ['     '];

    Chart.getChart(ctx)?.destroy();

    new Chart(ctx, {
      type: WordCloudController.id,
      data: {
        // text
        labels,
        datasets: [
          {
            // size in pixels
            label: '',
            data: values.map((item) => Math.min(Math.max(20, item * 3), 32)),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const index = ctx.dataIndex;
                return `${data[index].incident_count}`;
              },
            },
          },
        },
        elements: {
          word: {
            rotate: 0,
            minRotation: 0,
            maxRotation: 0,
            rotationSteps: 1,
            color: (ctx) => {
              const index = ctx.dataIndex ?? 0;
              return colors[index % colors.length];
            },
            weight: (ctx) => {
              const value = ctx.dataset.data[ctx.dataIndex];
              if (value > 40) return 'bold';
              if (value > 20) return 600;

              return 400;
            },
          },
        },
        onClick: (_, activeElements) => {
          if (activeElements.length > 0) {
            const clickedElementIndex = activeElements[0].index;
            this.selectApplication.emit(this.data()[clickedElementIndex]);
          }
        },
      },
    });
  }

  topApplicationsQuery = rxResource({
    params: () => this.query.payload(),
    stream: ({ params }) =>
      this.service
        .fetchTopApplications(params)
        .pipe(historyCache(this.filterStore.cache, this.DATA_PATH)),
  });
}
