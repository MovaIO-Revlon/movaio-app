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
import { ISearchIndex, TConnectorType } from '../../types';
import { CenterTextPlugin } from '../../utils';
import { CONNECTOR_ICON_MAP } from './constants';

type TGroup = { key: TConnectorType; value: number };

@Component({
  selector: 'connectors-chart',
  imports: [],
  template: `
    <div class="wrapper">
      <canvas #chart></canvas>
    </div>

    <div class="list">
      @for (item of groupData(); track item) {
        <div class="connector" (click)="onSelect(item.key)">
          <img [src]="connectorIconsMap[item.key]" />
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

    .connector img {
      height: 1.2rem;
    }
  `,
})
export class ConnectorsChart {
  @ViewChild('chart') chartCanvas!: ElementRef<HTMLCanvasElement>;

  private chartInstance?: Chart<'doughnut', number[], unknown> = undefined;
  readonly connectorIconsMap = CONNECTOR_ICON_MAP;
  private readonly COLORS = Array.from(
    { length: 5 },
    (_, index) => `rgba(255, 162, 66, ${(index + 1) / 5})`,
  ).reverse();
  data = input.required<Partial<ISearchIndex>[]>();
  totalConnectorCount = input<number>(0);
  filteredCount = input<number>(0);
  selected = model<TConnectorType | undefined>(undefined);

  groupData = computed<TGroup[]>(() => {
    const data = this.data();
    const group: Record<TConnectorType, number> = {
      excel: 0,
      docx: 0,
      ppt: 0,
      pdf: 0,
      team_dynamix: 0,
      service_now: 0,
      jira: 0,
      azure_devops: 0,
      rally: 0,
      github: 0,
      svn: 0,
    };

    data.forEach((item) => {
      if (item.connector_type) group[item.connector_type]++;
    });

    return (Object.keys(group) as TConnectorType[])
      .map((item) => ({
        key: item,
        value: group[item],
      }))
      .filter((item) => item.value > 0);
  });

  constructor() {
    afterRenderEffect(() => {
      const groupData = this.groupData();
      // read filteredCount to make this effect run when pager filtered length changes
      const _fc = this.filteredCount();
      this.renderChart(groupData);
    });

    effect(() => {
      const selected = this.selected();
      const groupData = this.groupData();

      const chart = this.chartInstance;

      if (!chart) return;

      if (!selected) {
        chart.data.datasets[0].borderColor = groupData.map(() => '#fff');
      } else {
        const activeIndex = groupData.findIndex(
          (item) => item.key === selected,
        );

        chart.data.datasets[0].borderColor = groupData.map((_, index) =>
          index === activeIndex ? '#29b14b' : '#fff',
        );
      }

      chart.update();
    });
  }

  onSelect(key: TConnectorType) {
    this.selected.update((v) => (v === key ? undefined : key));
  }

  private renderChart(groupData: TGroup[]): void {
    const ctx = this.chartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    const labels = groupData.map((item) => item.key);
    const countData = groupData.map((item) => item.value);
    const totalCount =
      this.filteredCount() ??
      this.totalConnectorCount() ??
      countData.reduce((a, b) => a + b, 0);

    if (!this.chartInstance) {
      this.chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [
            {
              data: countData,
              backgroundColor: this.COLORS,
              hoverOffset: 4,
              borderRadius: 6,
              spacing: 3,
              borderColor: ['#fff', '#fff', '#fff'],
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
              subtext: 'Connectors',
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

    this.chartInstance.data.labels = labels;
    this.chartInstance.data.datasets[0].data = countData;
    // this.chartInstance.data.datasets[0].backgroundColor = labels.map((_, i) => this.COLORS[i % this.COLORS.length]);
    // this.chartInstance.data.datasets[0].borderColor = labels.map(() => '#fff');
    const displayCount =
      this.filteredCount() ??
      this.totalConnectorCount() ??
      countData.reduce((a, b) => a + b, 0);
    this.chartInstance.options.plugins!.centerText!.text =
      displayCount.toString();
    this.chartInstance.update();
  }
}
