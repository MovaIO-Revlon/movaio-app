import { BarElement, ChartType, Plugin } from 'chart.js';

export interface ILabelBelowPluginOptions {
  font?: string;
  color?: string;
  spacing?: number;
}

export const LabelBelowPlugin: Plugin<'bar', ILabelBelowPluginOptions> = {
  id: 'labelBelow',
  afterDatasetDraw: function (chart, _args, options) {
    const {
      ctx,
      scales: { x },
    } = chart;

    ctx.save();

    ctx.font = options?.font || '400 10px Fira Sans';
    ctx.fillStyle = options?.color || '#262E2B';

    const meta = chart.getDatasetMeta(0);
    meta.data?.forEach((element, i) => {
      const barElement = element as BarElement;

      const props = barElement.getProps(['y', 'base', 'height'], true);
      const barY = props.y;
      const barHeight = props.height;

      const textY = barY - barHeight / 2 - 5;

      ctx.textAlign = 'left';
      ctx.fillText((chart.data.labels?.[i] as string) || '', x.left, textY);
    });

    ctx.restore();
  },
};

declare module 'chart.js' {
  interface PluginOptionsByType<TType extends ChartType = ChartType> {
    labelBelow?: ILabelBelowPluginOptions;
  }
}
