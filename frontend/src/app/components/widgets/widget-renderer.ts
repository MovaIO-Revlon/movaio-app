import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import {
  ChartWidgetConfig,
  WidgetConfig,
  TableWidgetConfig,
} from '../../types/widget.types';
import { CHART_TYPES, getValue } from '../../utils';
import { Chart, ChartType } from 'chart.js';
import { ChartConfigService } from '../../services/widget/chart-config.service';
import { WidgetCardComponent } from '../../marketplace/mcpconnectors/widget-builder/widget-card';
import { AccordionWidgetComponent } from './accordion-widget';
import { CardWidgetComponent } from './card-widget';
import { AnalyticsService, THistory } from '../../services/analytics.service';
import { FilterStore } from '../../commandcenter/trends/filter.store';
import { rxResource } from '@angular/core/rxjs-interop';
import { tap } from 'rxjs';
import { TableWidgetComponent } from './table-widget';
import { TUseCaseType } from '../../types';
@Component({
  selector: 'widget-renderer',
  standalone: true,
  imports: [
    WidgetCardComponent,
    AccordionWidgetComponent,
    CardWidgetComponent,
    TableWidgetComponent,
  ],
  template: `
    @let widgetConfig = config();
    @let data = dataset();
    @let isLoading = insightsQuery.isLoading();

    @if (isChartType()) {
      <app-widget-card
        [isLoading]="isLoading"
        [isEmpty]="isEmpty()"
        [title]="widgetConfig?.chartTitle || 'Widget Preview'"
        [showInfo]="!!widgetConfig?.infoText?.trim()"
        [infoText]="widgetConfig?.infoText || ''"
        [style.min-height]="getHeight(widgetConfig?.height)"
        [showRefresh]="filterStore.cacheEnabled()"
        (refresh)="query.refetch()"
      >
        <canvas #chartCanvas></canvas>
      </app-widget-card>
    } @else {
      @switch (widgetConfig.type) {
        @case ('accordion') {
          <app-accordion-widget
            [isLoading]="isLoading"
            [isEmpty]="isEmpty()"
            [data]="data"
            [config]="widgetConfig"
            [showRefresh]="filterStore.cacheEnabled()"
            (refresh)="query.refetch()"
          />
        }
        @case ('card') {
          <app-card-widget
            [isLoading]="isLoading"
            [isEmpty]="isEmpty()"
            [data]="data"
            [config]="widgetConfig"
            [showRefresh]="filterStore.cacheEnabled()"
            (refresh)="query.refetch()"
          />
        }
        @case ('table') {
          <table-widget
            [isLoading]="isLoading"
            [isEmpty]="isEmpty()"
            [data]="data"
            [config]="widgetConfig"
            [showRefresh]="filterStore.cacheEnabled()"
            (refresh)="query.refetch()"
          />
        }
      }
    }
  `,
})
export class WidgetRenderer implements OnDestroy {
  canvasContext = signal<CanvasRenderingContext2D | null>(null);
  @ViewChild('chartCanvas') set canvasRef(
    element: ElementRef<HTMLCanvasElement> | undefined,
  ) {
    this.canvasContext.set(element?.nativeElement?.getContext('2d') || null);
  }
  private chartInstance?: Chart;
  private readonly chartConfigService = inject(ChartConfigService);
  private readonly service = inject(AnalyticsService);
  readonly filterStore = inject(FilterStore);

  config = input.required<WidgetConfig>();
  useCaseType = input<TUseCaseType>('insights');
  dataSource = input<unknown>({});
  case = input<string>('');
  select = output<{
    data: unknown[];
    headers: TableWidgetConfig['headers'];
    title: string;
  }>();

  DATA_PATH = computed(() => {
    const uc = this.case();
    return [uc, uc].join('.');
  });

  data = computed(() => {
    const useCase = this.case();
    const ucType = this.useCaseType();
    let d: unknown;

    if (!useCase) return undefined;

    if (this.filterStore.cacheEnabled()) {
      d = getValue(this.filterStore.cache(), this.DATA_PATH());
      if (d) return d;
    }

    if (!d && this.filterStore.appliedFilters().history) {
      if (ucType === 'insights') {
        d =
          this.filterStore.history()?.key?.agent_execution?.[
            useCase as keyof THistory['key']['agent_execution']
          ];
      } else {
        d = this.filterStore.history()?.key?.[useCase as keyof THistory['key']];
      }

      if (d) return d;
    }
    return ucType === 'insights'
      ? getValue(this.insightsQuery.value()?.data, this.DATA_PATH())
      : this.insightsQuery.value()?.data;
  });

  dataset = computed<unknown[]>(() => {
    const key = this.config()?.dataset;
    const data = key ? getValue(this.data() ?? this.dataSource(), key) : [];
    return data && Array.isArray(data) ? data : [];
  });

  query = this.filterStore.createReFetchable();

  isEmpty = computed(() => !this.dataset()?.length);

  isChartType = computed(() => {
    const type = this.config()?.type;
    return type ? CHART_TYPES.includes(type as ChartType) : false;
  });

  constructor() {
    effect(() => {
      const config = this.config();
      const ctx = this.canvasContext();
      if (ctx && config && this.isChartType()) {
        this.renderChart(ctx, config as ChartWidgetConfig);
      }
    });
  }

  ngOnDestroy(): void {
    this.destroyChart();
  }

  private renderChart(
    ctx: CanvasRenderingContext2D,
    config: ChartWidgetConfig,
  ): void {
    this.destroyChart();

    const dataset = this.dataset();
    const chartConfig = this.chartConfigService.getConfig(config, dataset);

    if (!chartConfig) {
      console.warn('Could not generate chart config');
      return;
    }

    try {
      this.chartInstance = new Chart(ctx, {
        ...chartConfig,
        options: {
          ...chartConfig.options,
          onClick: (_, activeElements) => {
            if (
              config?.clickAction &&
              config?.clickActionDataPath &&
              activeElements.length
            ) {
              const clickedElementIndex =
                config?.type === 'bar' && config?.labelBelowPlugin
                  ? Math.floor(activeElements[0].index / 2)
                  : activeElements[0].index;

              const data = getValue(
                dataset[clickedElementIndex],
                config.clickActionDataPath,
              ) as unknown[];

              this.select.emit({
                data,
                headers: config.headers,
                title: 'Data',
              });
            }
          },
        },
      });
    } catch (error) {
      console.error('Error creating chart:', error);
    }
  }

  private destroyChart(): void {
    if (this.chartInstance) {
      this.chartInstance.destroy();
      this.chartInstance = undefined;
    }
  }

  getHeight(height?: number) {
    if (height) return `${height}px`;

    return '';
  }

  insightsQuery = rxResource({
    params: () => {
      const params = this.query.payload();
      const useCase = this.case();
      if (!params || !useCase) return;

      return { ...params, usecases: [useCase] };
    },
    stream: ({ params }) =>
      this.service[
        this.useCaseType() === 'insights'
          ? 'fetchUseCaseInsights'
          : 'fetchUseCaseTrend'
      ](params).pipe(
        tap((data) => {
          const path = this.DATA_PATH();
          const res = data;
          const value = getValue(res, path);

          this.filterStore.cache.update((v) => ({
            ...v,
            [path]: value,
          }));
        }),
      ),
  });
}
