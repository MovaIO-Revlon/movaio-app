import {
  afterRenderEffect,
  Component,
  computed,
  effect,
  ElementRef,
  input,
  model,
  ViewChild,
} from '@angular/core';
import { Chart } from 'chart.js';
import { ISearchIndex } from '../../types';
import { CenterTextPlugin } from '../../utils';

type TGroup = { key: string; value: number };

@Component({
  selector: 'entities-chart',
  template: `
    <div class="wrapper">
      <canvas #chart></canvas>
    </div>

    <div class="list">
      @for (item of groupData(); track item) {
        <div class="connector" (click)="onSelect(item.key)">
          <span class="text-capitalize">{{ item.key }} ({{ item.value }})</span>
        </div>
      }
    </div>
  `,
  styles: `
    .wrapper {
      height: 10rem;
      width: 10rem;
      margin: 0 auto;
    }

    .list {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem;
      font-size: 0.75rem;
      margin: 1rem 0;
    }

    .connector {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
  `,
})
export class EntitiesChart {
  @ViewChild('chart') chartCanvas!: ElementRef<HTMLCanvasElement>;

  private chartInstance?: Chart<'doughnut', number[], unknown> = undefined;

  data = input.required<Record<string, number>>();
  total = input<number>(0);
  selected = model<string | undefined>(undefined);
  filteredCount = input<number>(0);

  groupData = computed<TGroup[]>(() => {
    const d = this.data() || {};
    return Object.keys(d).map((k) => ({ key: k, value: d[k] }));
  });

  private readonly COLORS = Array.from({ length: 8 }, (_, index) =>
    `rgba(255, 162, 66, ${(index + 1) / 8})`,
  ).reverse();

  constructor() {
    afterRenderEffect(() => {
      const groupData = this.groupData();
      // read filteredCount to re-run when pager filtered length changes
      const _fc = this.filteredCount();
      this.renderChart(groupData);
    });

    effect(() => {
      const sel = this.selected();
      const groupData = this.groupData();
      const chart = this.chartInstance;

      if (!chart) return;

      if (!sel) {
        chart.data.datasets[0].borderColor = groupData.map(() => '#fff');
      } else {
        const activeIndex = groupData.findIndex((item) => item.key === sel);
        chart.data.datasets[0].borderColor = groupData.map((_, index) =>
          index === activeIndex ? '#29b14b' : '#fff',
        );
      }

      chart.update();
    });
  }

  onSelect(key: string) {
    this.selected.update((v) => (v === key ? undefined : key));
  }

  private renderChart(groupData: TGroup[]): void {
    const ctx = this.chartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    const labels = groupData.map((item) => item.key);
    const data = groupData.map((item) => item.value);
    const totalCount = (this.filteredCount() ?? this.total() ?? data.reduce((a, b) => a + b, 0));

    if (!this.chartInstance) {
      this.chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [
            {
              data,
              backgroundColor: this.COLORS,
              hoverOffset: 4,
              borderRadius: 6,
              spacing: 3,
              borderColor: Array(labels.length).fill('#fff'),
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: 50,
          radius: 70,
          plugins: {
            legend: { display: false },
            centerText: {
              text: totalCount.toString(),
              subtext: 'Entities',
              textFont: '500 28px Fira Sans',
              subtextFont: '400 12px Fira Sans',
            },
          },
          onClick: (_, activeElements) => {
            if (activeElements.length > 0) {
              const clickedElementIndex = activeElements[0].index;
              const key = this.groupData()[clickedElementIndex].key;
              this.selected.update((v) => (v === key ? undefined : key));
            }
          },
        },
        plugins: [CenterTextPlugin],
      });
      return;
    }

    this.chartInstance.data.labels = labels as any;
    (this.chartInstance.data.datasets[0].data as number[]) = data;
    const displayCount = (this.filteredCount() ?? this.total() ?? data.reduce((a, b) => a + b, 0));
    this.chartInstance.options.plugins!.centerText!.text =
      displayCount.toString();
    this.chartInstance.update();
  }
}
