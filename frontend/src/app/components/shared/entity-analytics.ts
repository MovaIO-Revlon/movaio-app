import {
  afterRenderEffect,
  Component,
  effect,
  ElementRef,
  input,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart } from 'chart.js';
import { FormsModule } from '@angular/forms';
import { ArcPointerPlugin, CenterTextPlugin, CHART_COLOR_SET10 } from '../../utils';
import { TooltipDirective } from '../../custom-tooltip/tooltip.directive';
import { CardLoader } from './card-loader';

@Component({
  selector: 'entity-analytics',
  imports: [CommonModule, FormsModule, TooltipDirective, CardLoader],
  template: `
    <div class="title">
      <span>{{ options().label }}</span>
      <span class="info" [appTooltip]="options().tooltip">
        <svg
          width="17"
          height="17"
          viewBox="0 0 17 17"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            opacity="0.6"
            d="M7.65 12.75H9.35V7.65H7.65V12.75ZM8.5 0C3.80375 0 0 3.80375 0 8.5C0 13.1962 3.80375 17 8.5 17C13.1962 17 17 13.1962 17 8.5C17 3.80375 13.1962 0 8.5 0ZM8.5 15.3C4.7515 15.3 1.7 12.2485 1.7 8.5C1.7 4.7515 4.7515 1.7 8.5 1.7C12.2485 1.7 15.3 4.7515 15.3 8.5C15.3 12.2485 12.2485 15.3 8.5 15.3ZM7.65 5.95H9.35V4.25H7.65V5.95Z"
            fill="#FFA242"
          />
        </svg>
      </span>

      <div class="dropdown ms-auto chart-action">
        <button
          href="#"
          role="button"
          id="issues-action-link"
          data-bs-toggle="dropdown"
          aria-expanded="false"
        >
          <svg
            width="16"
            height="18"
            viewBox="0 0 16 18"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M7.7002 1.75C7.3136 1.75 7.0002 2.0634 7.0002 2.45C7.0002 2.8366 7.3136 3.15 7.7002 3.15V2.45V1.75ZM14.7002 3.15C15.0868 3.15 15.4002 2.8366 15.4002 2.45C15.4002 2.0634 15.0868 1.75 14.7002 1.75V2.45V3.15ZM7.7002 14C7.3136 14 7.0002 14.3134 7.0002 14.7C7.0002 15.0866 7.3136 15.4 7.7002 15.4V14.7V14ZM14.7002 15.4C15.0868 15.4 15.4002 15.0866 15.4002 14.7C15.4002 14.3134 15.0868 14 14.7002 14V14.7V15.4ZM7.7002 9.275C8.08679 9.275 8.4002 8.9616 8.4002 8.575C8.4002 8.1884 8.08679 7.875 7.7002 7.875V8.575V9.275ZM0.700195 7.875C0.313596 7.875 0.000195384 8.1884 0.000195324 8.575C0.000195265 8.9616 0.313596 9.275 0.700195 9.275L0.700195 8.575L0.700195 7.875ZM7.7002 2.45V3.15L14.7002 3.15V2.45V1.75L7.7002 1.75V2.45ZM7.7002 14.7V15.4H14.7002V14.7V14H7.7002V14.7ZM7.7002 8.575V7.875L0.700195 7.875L0.700195 8.575L0.700195 9.275L7.7002 9.275V8.575ZM0.700195 2.45H0.000195324C0.000195324 3.80309 1.0971 4.9 2.4502 4.9V4.2V3.5C1.8703 3.5 1.4002 3.0299 1.4002 2.45H0.700195ZM2.4502 4.2V4.9C3.80329 4.9 4.9002 3.80309 4.9002 2.45H4.2002H3.5002C3.5002 3.0299 3.03009 3.5 2.4502 3.5V4.2ZM4.2002 2.45H4.9002C4.9002 1.0969 3.80329 -3.03984e-06 2.4502 -3.03984e-06V0.699997V1.4C3.03009 1.4 3.5002 1.8701 3.5002 2.45H4.2002ZM2.4502 0.699997V-3.03984e-06C1.0971 -3.03984e-06 0.000195324 1.0969 0.000195324 2.45H0.700195H1.4002C1.4002 1.8701 1.8703 1.4 2.4502 1.4V0.699997ZM0.700195 14.7H0.000195324C0.000195324 16.0531 1.0971 17.15 2.4502 17.15V16.45V15.75C1.8703 15.75 1.4002 15.2799 1.4002 14.7H0.700195ZM2.4502 16.45V17.15C3.80329 17.15 4.9002 16.0531 4.9002 14.7H4.2002H3.5002C3.5002 15.2799 3.03009 15.75 2.4502 15.75V16.45ZM4.2002 14.7H4.9002C4.9002 13.3469 3.80329 12.25 2.4502 12.25V12.95V13.65C3.03009 13.65 3.5002 14.1201 3.5002 14.7H4.2002ZM2.4502 12.95V12.25C1.0971 12.25 0.000195324 13.3469 0.000195324 14.7H0.700195H1.4002C1.4002 14.1201 1.8703 13.65 2.4502 13.65V12.95ZM14.7002 8.575H15.4002C15.4002 7.2219 14.3033 6.125 12.9502 6.125V6.825V7.525C13.5301 7.525 14.0002 7.9951 14.0002 8.575H14.7002ZM12.9502 6.825V6.125C11.5971 6.125 10.5002 7.2219 10.5002 8.575H11.2002H11.9002C11.9002 7.9951 12.3703 7.525 12.9502 7.525V6.825ZM11.2002 8.575H10.5002C10.5002 9.92809 11.5971 11.025 12.9502 11.025V10.325V9.625C12.3703 9.625 11.9002 9.1549 11.9002 8.575H11.2002ZM12.9502 10.325V11.025C14.3033 11.025 15.4002 9.92809 15.4002 8.575H14.7002H14.0002C14.0002 9.1549 13.5301 9.625 12.9502 9.625V10.325Z"
              fill="currentColor"
            />
          </svg>
        </button>

        <ul
          class="dropdown-menu dropdown-menu-end"
          aria-labelledby="issues-action-link"
        >
          <li>
            <button type="button" class="dropdown-item fw-semibold" disabled>
              Filter By
            </button>
          </li>
          @for (item of options().filterByOptions; track item) {
            <li>
              <button
                (click)="active.set(item)"
                type="button"
                class="dropdown-item text-capitalize"
                [class.active]="active() === item"
              >
                {{ item }}
              </button>
            </li>
          }
        </ul>
      </div>
    </div>
    @if (loading() || !total()) {
      <card-loader
        style="--top-spacing: 3rem"
        [loading]="loading()"
        [noData]="!total()"
      />
    }
    <div class="wrapper">
      <canvas #analyticsCanvas></canvas>
    </div>
  `,
  styles: `
    :host(.chart-card) .title {
      font-family: 'Fira Sans', system-ui, sans-serif;
      font-weight: 600;
      font-size: 1rem;
      line-height: 1.3rem;
      letter-spacing: 0%;
      color: #262e2b;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    :host(.chart-card) .info {
      display: inline-block;
    }

    :host(.chart-card) .info i {
      color: #ffa242;
    }

    :host(.chart-card) .wrapper {
      margin-top: 1.5rem;
      min-height: 300px;
      flex: 1;
    }

    :host(.chart-card) .chart-action > button {
      display: grid;
      place-content: center;
      height: 2.125rem;
      width: 2.125rem;
      border-radius: 0.3rem;
      color: #797979;
      background: none;
      border: none;
    }

    :host(.chart-card) .chart-action > button:hover {
      background: #ffa24233;
      color: #fff;
    }

    :host(.chart-card) .chart-action button[aria-expanded='true'] {
      background: #ffa242;
      color: #fff;
    }

    :host(.chart-card) .chart-action .dropdown-item:focus,
    :host(.chart-card) .chart-action .dropdown-item:hover {
      background-color: #ffa24233;
    }

    :host(.chart-card) .chart-action .dropdown-item.active {
      background-color: #ffa242;
    }
  `,
})
export class EntityAnalytics {
  @ViewChild('analyticsCanvas')
  analyticsCanvas!: ElementRef<HTMLCanvasElement>;

  private chartInstance?: Chart<'doughnut', number[], unknown> = undefined;

  loading = input(false);

  total = input<number>(0);

  options = input<{
    label?: string;
    centerText?: string;
    filterByOptions: string[];
    tooltip: string;
  }>({
    label: 'Analytics',
    centerText: 'data',
    filterByOptions: [],
    tooltip: '',
  });

  data = input<Record<string, { label: string; value: number }[]>>({});

  selectData = output<{
    key: string;
    data: { label: string; value: number };
  }>();

  active = signal('');

  constructor() {
    effect(() => {
      this.active.set(this.options().filterByOptions[0]);
    });
    afterRenderEffect(() => {
      this.renderIssuesChart();
    });
  }

  private renderIssuesChart(): void {
    const ctx = this.analyticsCanvas.nativeElement.getContext('2d');
    if (!ctx) return;
    const data = this.data()[this.active()] || [];

    const labels = data.map((item) => item.label);
    const countData = data.map((item) => item.value);

    if (!this.chartInstance) {
      this.chartInstance = new Chart(ctx, {
        type: 'doughnut',
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
              text: this.total().toString() || '0',
              subtext: this.options().centerText,
            },
            arcPointer: {
              lineLength: 30,
            },
          },
          onClick: (_, activeElements) => {
            if (activeElements.length > 0) {
              const clickedElementIndex = activeElements[0].index;
              const data = this.data();
              const key = this.active();

              const clickedData = data?.[key]?.[clickedElementIndex];
              if (clickedData) this.selectData.emit({ key, data: clickedData });
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
      this.total()?.toString() || '0';
    this.chartInstance.update();
  }
}
