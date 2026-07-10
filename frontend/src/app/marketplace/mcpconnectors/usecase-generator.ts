import { Component, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AnalyticsService } from '../../services/analytics.service';
import { CHART_ICON_MAP } from '../../utils';
import { ISchemaForAgent, TUseCaseType } from '../../types';

@Component({
  selector: 'usecase-generator',
  imports: [CommonModule],
  template: `
    <button
      title="Generate Usecase JSON"
      class="generate-btn"
      (click)="generateResponse()"
      [disabled]="disabled()"
      type="button"
    >
      <i
        class="fa fa-solid"
        [class]="
          isLoading() ? 'fa-arrow-rotate-right spin' : 'fa-wand-magic-sparkles'
        "
      ></i>
    </button>
  `,
  styles: `
    .generate-btn {
      width: 1.8rem;
      height: 1.8rem;
      font-size: 0.875rem;
      background: #f9a84a;
      color: #fff;
      border-radius: 50%;
      border: transparent;
      outline: transparent;
      display: grid;
      place-content: center;
    }

    .generate-btn:hover,
    .generate-btn:disabled {
      opacity: 0.5;
    }

    .generate-btn:disabled {
      cursor: not-allowed;
    }

    .spin {
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      100% {
        transform: rotate(360deg);
      }
    }
  `,
})
export class UseCaseGenerator {
  private readonly service = inject(AnalyticsService);

  readonly iconMap: Record<string, string> = CHART_ICON_MAP;

  useCase = input.required<string>();
  fullSchema = input<ISchemaForAgent['full_schema']>([]);
  isLoading = input.required<boolean>();
  useCaseTab = input<TUseCaseType>('insights');
  disabled = input<boolean>();
  chartType = output<string>();
  useCaseJson = output<string>();
  loading = output<boolean>();

  generateResponse() {
    const useCase = this.useCase();

    this.loading.emit(true);

    if (this.useCaseTab() === 'trends') {
      this.service
        .getTrendUseCase({ usecase: useCase, full_schema: this.fullSchema() })
        .subscribe({
          next: (res) => {
            this.loading.emit(false);

            const data = res?.data;

            if (!data) return;

            this.useCaseJson.emit(JSON.stringify(data, null, 2));
          },

          error: () => {
            this.loading.emit(false);
          },
        });
      return;
    }

    this.service.getUseCases({ usecase: useCase }).subscribe({
      next: (res) => {
        this.loading.emit(false);

        const chartKeys = Object.keys(this.iconMap);
        const data = res?.data;

        if (!data) return;

        this.useCaseJson.emit(JSON.stringify(data, null, 2));

        const recommendedCharts = data.formats[0]?.recommended_charts?.map(
          (item) => item.chart_type,
        );

        const chartType = recommendedCharts
          .map((item) => chartKeys.find((c) => item.includes(c)))
          .filter(Boolean)?.[0];

        if (chartType) this.chartType.emit(chartType);
      },

      error: () => {
        this.loading.emit(false);
      },
    });
  }
}
