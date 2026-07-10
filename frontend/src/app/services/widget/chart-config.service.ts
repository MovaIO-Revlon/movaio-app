import { Injectable } from '@angular/core';
import { ChartConfiguration, ChartOptions, ChartType, Plugin } from 'chart.js';
import { ChartWidgetConfig } from '../../types';
import {
  ArcPointerPlugin,
  CenterTextPlugin,
  CHART_COLOR_SET10,
  LabelBelowPlugin,
} from '../../utils';

@Injectable({
  providedIn: 'root',
})
export class ChartConfigService {
  getConfig<T extends ChartType>(
    config: ChartWidgetConfig,
    data: unknown[],
  ): ChartConfiguration<T> | null {
    const strategyMap: Record<string, () => ChartConfiguration<T> | null> = {
      pie: () => this.getPieConfig(config, data) as ChartConfiguration<T>,
      doughnut: () => this.getPieConfig(config, data) as ChartConfiguration<T>,
      wordCloud: () =>
        this.getWordCloudConfig(config, data) as ChartConfiguration<T>,
      treemap: () =>
        this.getTreeMapConfig(config, data) as ChartConfiguration<T>,
      bar: () => this.getBarConfig(config, data) as ChartConfiguration<T>,
    };

    const strategy = strategyMap[config.type];
    return strategy
      ? strategy()
      : (this.getDefaultConfig(config, data) as ChartConfiguration<T>);
  }

  private getDefaultConfig(
    config: ChartWidgetConfig,
    dataset: unknown[],
  ): ChartConfiguration<ChartType> {
    const { labels, data } = this.extractChartData(config, dataset);

    return {
      type: config.type as ChartType,
      data: {
        labels,
        datasets: [{ data }],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: config.displayLegend ?? false },
        },
      },
      plugins: [],
    };
  }

  private getPieConfig(
    config: ChartWidgetConfig,
    dataset: unknown[],
  ): ChartConfiguration<'pie' | 'doughnut'> {
    const { labels, data } = this.extractChartData(config, dataset);
    const plugins: Plugin<'pie' | 'doughnut'>[] = [];
    const options: ChartOptions<'pie' | 'doughnut'> = {
      cutout: config.cutout ?? 0,
      radius: config.radius ?? 100,
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: config.displayLegend ?? false },
      },
    };

    if (config.centerTextPlugin) {
      plugins.push(CenterTextPlugin);

      const centerText =
        config.aggregationMode === 'total'
          ? data.reduce((a, b) => a + b, 0)
          : data.length;

      (options.plugins as any).centerText = {
        text: centerText?.toString() || '',
        subtext: config.centerSubText?.toString() || '',
      };
    }

    if (config.arcPointerPlugin) {
      plugins.push(ArcPointerPlugin);
      (options.plugins as any).arcPointer = {
        lineLength: config.arcLineLength ?? 30,
      };
    }

    return {
      type: config.type as 'pie' | 'doughnut',
      data: { labels, datasets: [{ data }] },
      options,
      plugins,
    };
  }

  private getWordCloudConfig(
    config: ChartWidgetConfig,
    dataset: unknown[],
  ): ChartConfiguration<'wordCloud'> {
    const { labels, data } = this.extractChartData(config, dataset);

    return {
      type: 'wordCloud',
      data: { labels, datasets: [{ data }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: config.displayLegend ?? false },
        },
        elements: {
          word: {
            rotate: config.rotate ?? 0,
            minRotate: config.minRotation ?? 0,
            maxRotation: config.maxRotation ?? 0,
            rotationSteps: config.rotationSteps ?? 0,
            size: (ctx) => this.calculateWordSize(ctx, data, config),
            weight: (ctx) => this.calculateWordWeight(ctx, data),
            color: (ctx) => this.getChartColor(ctx.dataIndex ?? 0),
          },
        },
      } as ChartOptions<'wordCloud'>,
      plugins: [],
    };
  }

  private getTreeMapConfig(
    config: ChartWidgetConfig,
    dataset: unknown[],
  ): ChartConfiguration<'treemap'> {
    const labels = dataset.map((item) =>
      this.getFieldValue(item, config.labelKey),
    );

    return {
      type: 'treemap',
      data: {
        labels,
        datasets: [
          {
            data: dataset as any,
            key: config.dataKey,
            groups: [config.labelKey],
            borderColor: config.borderColor ?? 'white',
            borderWidth: config.borderWidth ?? 1,
            spacing: config.spacing ?? 0,
            labels: {
              display: config.displayLabel ?? true,
              position: (config.labelPosition ?? 'top') as any,
            },
          },
        ],
      },
      options: {
        responsive: true,
        animation: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: config.displayLegend ?? false },
        },
        backgroundColor: (ctx) => this.getChartColor(ctx.dataIndex ?? 0),
      } as ChartOptions<'treemap'>,
      plugins: [],
    };
  }

  private getBarConfig(
    config: ChartWidgetConfig,
    dataset: unknown[],
  ): ChartConfiguration<'bar'> {
    const { labels, data } = config.labelBelowPlugin
      ? this.extractBarDataWithLabels(config, dataset)
      : this.extractChartData(config, dataset);

    const plugins: Plugin<'bar'>[] = [];
    const options: ChartOptions<'bar'> = {
      indexAxis: (config.indexAxis as 'x' | 'y') ?? 'x',
      scales: {
        y: {
          display: config.displayScaleY ?? false,
          grid: { display: config.displayGridY ?? false },
        },
        x: {
          display: config.displayScaleX ?? true,
          beginAtZero: config.xBeginAtZero ?? true,
          grid: { display: config.displayGridX ?? false },
        },
      },
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: config.displayLegend ?? false },
      },
    };

    if (config.labelBelowPlugin) {
      plugins.push(LabelBelowPlugin);
      (options.plugins as any).labelBelow = {
        font: config.labelBelowPluginFont ?? '500 14px Fira Sans',
      };
    }

    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: this.getChartColors(),
          },
        ],
      },
      options,
      plugins,
    };
  }

  private extractChartData(
    config: ChartWidgetConfig,
    dataset: unknown[],
  ): { labels: string[]; data: number[] } {
    const labels = dataset.map(
      (item) => this.getFieldValue(item, config.labelKey)?.toString() ?? '',
    );
    const data = dataset.map((item) =>
      this.parseNumber(this.getFieldValue(item, config.dataKey)),
    );
    return { labels, data };
  }

  private extractBarDataWithLabels(
    config: ChartWidgetConfig,
    dataset: unknown[],
  ): { labels: string[]; data: number[] } {
    const labels = dataset
      .map((item) => {
        const label = this.getFieldValue(item, config.labelKey);
        const value = this.getFieldValue(item, config.dataKey);
        return ['', `${label} (${value})`];
      })
      .flat();

    const data = dataset
      .map((item) => [
        0,
        this.parseNumber(this.getFieldValue(item, config.dataKey)),
      ])
      .flat();

    return { labels, data };
  }

  private getFieldValue(item: unknown, key: string): unknown {
    if (typeof item !== 'object' || item === null) return undefined;
    return (item as Record<string, unknown>)[key];
  }

  private parseNumber(value: unknown): number {
    const num = Number(value);
    return Number.isNaN(num) ? 0 : num;
  }

  private calculateWordSize(
    ctx: any,
    data: number[],
    config: ChartWidgetConfig,
  ): number {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const value = +(ctx.raw as number) || 1;

    const minSize = config.minFontSize ?? 28;
    const maxSize = config.maxFontSize ?? 64;

    if (min === max) return (minSize + maxSize) / 2;

    return ((value - min) / (max - min)) * (maxSize - minSize) + minSize;
  }

  private calculateWordWeight(ctx: any, data: number[]): number {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const value = +(ctx.raw as number) || 1;

    const normalized = ((value - min) / (max - min || 1)) * 800 + 10;
    return Math.round(normalized / 100) * 100;
  }

  private getChartColor(index: number): string {
    const colors = this.getChartColors();
    return colors[index % colors.length];
  }

  private getChartColors(): string[] {
    return [...CHART_COLOR_SET10];
  }
}
