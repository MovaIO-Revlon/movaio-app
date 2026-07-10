import { ArcElement, ChartType, Plugin } from 'chart.js';

export interface IArcPointerOptions {
  display?: boolean;
  lineLength?: number;
  font?: string;
  collisionPadding?: number;
  maxIterations?: number;
  balanceLabels?: boolean;
}

export const ArcPointerPlugin: Plugin<'doughnut', IArcPointerOptions> = {
  id: 'arcPointer',
  afterDraw: function (chart, _args, options) {
    if (options.display === false) return;

    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const lineLength = options.lineLength || 30;
    const font = options.font || '10px Fira Sans';
    const collisionPadding = options.collisionPadding ?? 0.1;
    const maxIterations = options.maxIterations || 5;
    const balanceLabels = options.balanceLabels ?? true;
    const labels = (chart.data.labels as string[]) || [];

    ctx.save();
    ctx.font = font;

    const fontSizeMatch = font.match(/(\d+)px/);
    const fontSize = fontSizeMatch ? parseInt(fontSizeMatch[1]) : 10;

    const truncate = (text: string, maxChar: number) =>
      text.length > maxChar ? text.slice(0, maxChar) + '...' : text;

    interface LabelData {
      text: string;
      x: number;
      y: number;
      originalY: number;
      align: CanvasTextAlign;
      isLeftSide: boolean;
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      color: string;
      textHeight: number;
      angle: number;
      index: number;
      centerX: number;
      centerY: number;
    }

    const labelData: LabelData[] = [];

    meta.data.forEach((element, i) => {
      const arcElement = element as ArcElement;
      const { x, y } = arcElement.getProps(['x', 'y'], true);
      const angle = (arcElement.startAngle + arcElement.endAngle) / 2;
      const radius = arcElement.outerRadius - 5;

      const startX = x + Math.cos(angle) * radius;
      const startY = y + Math.sin(angle) * radius;
      const endX = x + Math.cos(angle) * (radius + lineLength);
      const endY = y + Math.sin(angle) * (radius + lineLength);

      const isLeftSide = angle > Math.PI / 2 && angle < (3 * Math.PI) / 2;
      const labelText = truncate(labels[i] || 'unknown', 15);

      labelData.push({
        text: labelText,
        x: endX + (isLeftSide ? -6 : 6),
        y: endY,
        originalY: endY,
        align: isLeftSide ? 'right' : 'left',
        isLeftSide,
        startX,
        startY,
        endX,
        endY,
        color: arcElement.options.backgroundColor as string,
        textHeight: fontSize * 1.2,
        angle,
        index: i,
        centerX: x,
        centerY: y,
      });
    });

    const leftLabels = labelData
      .filter((l) => l.isLeftSide)
      .sort((a, b) => a.y - b.y);
    const rightLabels = labelData
      .filter((l) => !l.isLeftSide)
      .sort((a, b) => a.y - b.y);

    const resolveCollisions = (labels: LabelData[]) => {
      if (labels.length < 2) return;

      const minSpacing = fontSize + collisionPadding;

      for (let pass = 0; pass < maxIterations; pass++) {
        let hadCollision = false;

        for (let i = 1; i < labels.length; i++) {
          const prev = labels[i - 1];
          const curr = labels[i];

          const prevBottom = prev.y + prev.textHeight / 2;
          const currTop = curr.y - curr.textHeight / 2;
          const currentSpacing = currTop - prevBottom;

          if (currentSpacing < minSpacing) {
            const verticalShift = minSpacing - currentSpacing;

            const angle = curr.angle;
            const centerX = curr.centerX;
            const centerY = curr.centerY;

            const currentRadius = Math.sqrt(
              Math.pow(curr.endX - centerX, 2) +
                Math.pow(curr.endY - centerY, 2),
            );
            const targetY = curr.endY + verticalShift;
            const sinAngle = Math.sin(angle);

            if (Math.abs(sinAngle) > 0.1) {
              const newRadius = (targetY - centerY) / sinAngle;

              if (newRadius > currentRadius) {
                curr.endX = centerX + Math.cos(angle) * newRadius;
                curr.endY = targetY;
                curr.y = curr.endY;
                curr.x = curr.endX + (curr.isLeftSide ? -6 : 6);
              } else {
                curr.y += verticalShift;
                curr.endY = curr.y;
              }
            } else {
              curr.y += verticalShift;
              curr.endY = curr.y;
            }

            hadCollision = true;
          }
        }

        if (!hadCollision) break;
      }

      if (balanceLabels && labels.length > 0) {
        const totalShift = labels.reduce(
          (sum, l) => sum + (l.y - l.originalY),
          0,
        );
        const avgShift = totalShift / labels.length;

        labels.forEach((l) => {
          const adjustment = avgShift / 2;

          const angle = l.angle;
          const centerX = l.centerX;
          const centerY = l.centerY;

          const targetY = l.endY - adjustment;
          const sinAngle = Math.sin(angle);

          if (Math.abs(sinAngle) > 0.1) {
            const newRadius = (targetY - centerY) / sinAngle;

            if (newRadius > 0) {
              l.endX = centerX + Math.cos(angle) * newRadius;
              l.endY = targetY;
              l.y = l.endY;
              l.x = l.endX + (l.isLeftSide ? -6 : 6);
            } else {
              l.y -= adjustment;
              l.endY = l.y;
            }
          } else {
            l.y -= adjustment;
            l.endY = l.y;
          }
        });
      }
    };

    resolveCollisions(leftLabels);
    resolveCollisions(rightLabels);

    labelData.forEach((item) => {
      ctx.strokeStyle = item.color;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.moveTo(item.startX, item.startY);
      ctx.lineTo(item.endX, item.endY);
      ctx.stroke();

      const arrowSize = 5;
      const arrowAngle = Math.atan2(
        item.endY - item.startY,
        item.endX - item.startX,
      );
      ctx.beginPath();
      ctx.moveTo(item.endX, item.endY);
      ctx.lineTo(
        item.endX - arrowSize * Math.cos(arrowAngle - Math.PI / 8),
        item.endY - arrowSize * Math.sin(arrowAngle - Math.PI / 8),
      );
      ctx.lineTo(
        item.endX - arrowSize * Math.cos(arrowAngle + Math.PI / 8),
        item.endY - arrowSize * Math.sin(arrowAngle + Math.PI / 8),
      );
      ctx.closePath();
      ctx.fill();
    });

    ctx.fillStyle = '#000';
    ctx.textBaseline = 'middle';
    labelData.forEach((item) => {
      ctx.textAlign = item.align;
      ctx.fillText(item.text, item.x, item.y);
    });

    ctx.restore();
  },
};

declare module 'chart.js' {
  interface PluginOptionsByType<TType extends ChartType = ChartType> {
    arcPointer?: IArcPointerOptions;
  }
}
