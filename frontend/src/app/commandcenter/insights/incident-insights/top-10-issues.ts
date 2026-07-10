import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  inject,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { Chart, ChartType, TooltipModel } from 'chart.js';

import {
  ArcPointerPlugin,
  historyCache,
  CenterTextPlugin,
  CHART_COLOR_SET10,
} from '../../../utils';
import { IIncident, IIssue } from '../../../types';
import { AnalyticsService } from '../../../services/analytics.service';
import { FilterStore } from '../../trends/filter.store';
import { WidgetCardComponent } from '../../../marketplace/mcpconnectors/widget-builder/widget-card';
import { rxResource } from '@angular/core/rxjs-interop';
@Component({
  selector: 'top-10-issues',
  imports: [WidgetCardComponent],
  template: `
    <app-widget-card
      [isLoading]="topIssuesQuery.isLoading()"
      [isEmpty]="hasNoData()"
      title="Top 10 Issues Reported"
      [showInfo]="true"
      style="min-height: 26rem;"
      infoText="The Top 10 Issues Reported highlight the most frequent problems encountered by users across communication, authentication, access, and monitoring systems."
      [showRefresh]="filterStore.cacheEnabled()"
      (refresh)="query.refetch()"
    >
      <div style="max-height: 300px;">
        <canvas #issues></canvas>
      </div>

      @let selected = selectedField();
      <div class="d-flex mx-auto justify-content-center gap-3">
        @for (filterBy of filters; track filterBy) {
          <div class="form-check">
            <input
              class="form-check-input"
              type="radio"
              name="filterBy"
              [checked]="filterBy.value === selected"
              [id]="filterBy.value"
              (click)="changeFilter(filterBy.value)"
            />
            <label class="form-check-label" [for]="filterBy.value">
              {{ filterBy.label }}
            </label>
          </div>
        }
      </div>
    </app-widget-card>
  `,
})
export class Top10Issues {
  @ViewChild('issues') issuesCanvas!: ElementRef<HTMLCanvasElement>;

  private readonly service = inject(AnalyticsService);
  readonly filterStore = inject(FilterStore);
  private chartInstance?: Chart<ChartType, number[], unknown> = undefined;
  private readonly DATA_PATH = 'agent_execution.top_10_issues.top_issues';

  readonly filters = [
    { label: 'Status', value: 'state' },
    { label: 'Priority', value: 'priority' },
    { label: 'Severity', value: 'severity' },
  ];

  selectIssue = output<IIssue>();
  selectedField = signal(this.filters[0].value);

  hasNoData = computed(() => !this.data().length);
  data = computed<IIssue[]>(() => {
    const d = this.filterStore.getData<IIssue[]>(
      !this.topIssuesQuery.error() && this.topIssuesQuery.value()?.data,
      this.DATA_PATH,
    );
    return Array.isArray(d) ? d : [];
  });

  query = this.filterStore.createReFetchable();

  constructor() {
    afterRenderEffect(() => {
      this.renderChart();
    });
  }

  private issueData = computed(() =>
    this.data().map((item) => ({
      ...item,
      incident_count: item?.matching_incidents?.length || 0,
    })),
  );

  private getOrCreateTooltip = (chart: Chart<ChartType, number[], unknown>) => {
    let tooltipEl = chart.canvas.parentNode?.querySelector('div');

    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.style.padding = '0.5rem';
      tooltipEl.style.boxShadow = 'rgba(0, 0, 0, 0.35) 0px 5px 15px';
      tooltipEl.style.background = '#fff';
      tooltipEl.style.borderRadius = '8px';
      tooltipEl.style.color = 'black';
      tooltipEl.style.opacity = '1';
      tooltipEl.style.pointerEvents = 'none';
      tooltipEl.style.position = 'absolute';
      tooltipEl.style.transform = 'translate(-50%, 0)';
      tooltipEl.style.transition = 'all .1s ease';

      const table = document.createElement('table');
      table.style.margin = '0px';

      tooltipEl.appendChild(table);
      chart.canvas.parentNode?.appendChild(tooltipEl);
    }

    return tooltipEl;
  };

  private externalTooltipHandler = (context: {
    chart: Chart<ChartType, number[], unknown>;
    tooltip: TooltipModel<'pie'>;
  }) => {
    const { chart, tooltip } = context;
    const tooltipEl = this.getOrCreateTooltip(chart);
    const { raw: incidentCount = 0, dataIndex } = tooltip.dataPoints?.[0] || {};
    const groups = this.groupByField(
      this.selectedField(),
      this.data()?.[dataIndex]?.matching_incidents || [],
    );

    if (tooltip.opacity === 0) {
      tooltipEl.style.opacity = '0';
      return;
    }

    if (tooltip.body) {
      const titleLines = tooltip.title || [];

      const tableHead = document.createElement('thead');

      titleLines.forEach((title, i) => {
        const tr = document.createElement('tr');
        tr.style.borderWidth = '0';

        const th = document.createElement('th');
        th.style.borderWidth = '0';
        th.style.fontSize = '12px';
        th.style.fontWeight = '400';
        th.style.color = tooltip.labelColors[i].backgroundColor.toString();
        const text = document.createTextNode(`${title}: ${incidentCount}`);

        th.appendChild(text);
        tr.appendChild(th);
        tableHead.appendChild(tr);
      });

      const tableBody = document.createElement('tbody');
      Object.keys(groups).forEach((key, i) => {
        const span = document.createElement('span');
        span.style.background = CHART_COLOR_SET10[i % CHART_COLOR_SET10.length];
        span.style.borderRadius = '50%';
        span.style.marginRight = '5px';
        span.style.height = '8px';
        span.style.width = '8px';
        span.style.display = 'inline-block';

        const tr = document.createElement('tr');
        tr.style.backgroundColor = 'inherit';
        tr.style.borderWidth = '0';

        const td = document.createElement('td');
        td.style.borderWidth = '0';
        td.style.fontSize = '11px';

        const text = document.createTextNode(`${key}: ${groups[key] || 0}`);

        td.appendChild(span);
        td.appendChild(text);
        tr.appendChild(td);
        tableBody.appendChild(tr);
      });

      const tableRoot = tooltipEl.querySelector('table');

      // Remove old children
      while (tableRoot?.firstChild) {
        tableRoot.firstChild.remove();
      }

      // Add new children
      tableRoot?.appendChild(tableHead);
      tableRoot?.appendChild(tableBody);
    }

    const { offsetLeft: positionX, offsetTop: positionY } = chart.canvas;

    // Display, position, and set styles for font
    tooltipEl.style.opacity = '1';
    tooltipEl.style.left = positionX + tooltip.caretX + 'px';
    tooltipEl.style.top = positionY + tooltip.caretY + 'px';
    tooltipEl.style.padding =
      tooltip.options.padding + 'px ' + tooltip.options.padding + 'px';
  };

  private renderChart(): void {
    const ctx = this.issuesCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    const labels: string[] = [];
    const countData: number[] = [];

    this.issueData().forEach((item) => {
      labels.push(item.issue_type);
      countData.push(item.incident_count);
    });
    const incidentCount = countData.reduce((a, b) => a + b, 0);

    if (!this.chartInstance) {
      this.chartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
          labels,
          datasets: [
            {
              data: countData,

              backgroundColor: CHART_COLOR_SET10,
              hoverOffset: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: 70,
          radius: 110,
          plugins: {
            legend: { display: false },
            centerText: {
              text: incidentCount.toString(),
              subtext: 'Incidents',
            },
            arcPointer: {
              lineLength: 30,
            },
            tooltip: {
              enabled: false,
              position: 'nearest',
              external: this.externalTooltipHandler,
            },
          },
          onClick: (_, activeElements) => {
            if (activeElements.length > 0) {
              const clickedElementIndex = activeElements[0].index;
              this.selectIssue.emit(this.data()[clickedElementIndex]);
            }
          },
        },
        plugins: [CenterTextPlugin, ArcPointerPlugin],
      });
      return;
    }

    this.chartInstance.data.labels = labels;
    this.chartInstance.data.datasets[0].data = countData;
    this.chartInstance.options.plugins!.centerText!.text =
      incidentCount.toString();
    this.chartInstance.update();
  }

  changeFilter(value: string) {
    this.selectedField.set(value);
  }

  private groupByField(field: string, incidents: IIncident[]) {
    const obj: Record<string, number> = {};

    incidents.forEach((item) => {
      const key = item[field as keyof IIncident]!;

      if (!obj[key]) obj[key] = 0;

      obj[key] += 1;
    });

    return obj;
  }

  topIssuesQuery = rxResource({
    params: () => this.query.payload(),
    stream: ({ params }) =>
      this.service
        .fetchTopIssues(params)
        .pipe(historyCache(this.filterStore.cache, this.DATA_PATH)),
  });
}
