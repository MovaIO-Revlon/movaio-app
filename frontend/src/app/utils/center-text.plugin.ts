import { ChartType, Plugin } from 'chart.js';

export interface ICenterTextPluginOptions {
  text?: string;
  textFont?: string;
  subtext?: string;
  subtextFont?: string;
  showTextBg?: boolean;
  textBgColor?: string;
  textBgRadius?: number;
}

export const CenterTextPlugin: Plugin<'doughnut', ICenterTextPluginOptions> = {
  id: 'centerText',
  afterDraw: function (chart, _args, options) {
    const {
      ctx,
      chartArea: { left, right, top, bottom },
      options: op,
    } = chart;

    if (!options.subtext && !options.text) return;

    // Calculate center position
    const centerX = (left + right) / 2;
    const centerY =
      (op?.circumference ?? 0) <= 180
        ? top + +(op?.radius ?? 0) + 65
        : (top + bottom) / 2;

    ctx.save();

    if (options.showTextBg) {
      const bgRadius = options.textBgRadius || 60;

      ctx.beginPath();
      ctx.arc(centerX, centerY, bgRadius, 0, 2 * Math.PI, false);
      ctx.closePath();

      ctx.fillStyle = options.textBgColor || '#F3F4F6';
      ctx.fill();
    }

    if (options.text) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = options.textFont || '500 34px Fira Sans';
      ctx.fillStyle = '#262E2B';
      ctx.fillText(options.text, centerX, centerY - 15);
    }

    if (options.subtext) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = options.subtextFont || '400 14px Fira Sans';
      ctx.fillStyle = '#262E2B';
      ctx.fillText(options.subtext, centerX, centerY + 15);
    }

    ctx.restore();
  },
};

declare module 'chart.js' {
  interface PluginOptionsByType<TType extends ChartType = ChartType> {
    centerText?: ICenterTextPluginOptions;
  }
}
