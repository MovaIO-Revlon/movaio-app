import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardWidgetConfig } from '../../types/widget.types';
import { getValue, renderTemplate } from '../../utils';
import { WidgetCardComponent } from '../../marketplace/mcpconnectors/widget-builder/widget-card';

@Component({
  selector: 'app-card-widget',
  standalone: true,
  imports: [CommonModule, WidgetCardComponent],
  template: `
    @let widgetConfig = config();
    <app-widget-card
      [isLoading]="isLoading()"
      [isEmpty]="isEmpty()"
      [noPadding]="true"
      [title]="widgetConfig?.chartTitle || 'Widget Preview'"
      [showInfo]="!!widgetConfig?.infoText?.trim()"
      [infoText]="widgetConfig?.infoText || ''"
      [showRefresh]="showRefresh()"
      (refresh)="refresh.emit()"
      style="min-height: 24rem;"
    >
      <div class="cards-container h-100">
        @for (item of data(); track $index) {
          @let tag = getTag(item);
          <div
            class="card-1"
            [style.--color]="widgetConfig?.color?.[tag] || '#1659ea'"
          >
            <div class="card-header">
              <span class="card-title">{{ getTitle(item) }}</span>
              @if (tag) {
                <span class="card-tag">{{ tag }}</span>
              }
            </div>

            <div class="card-body" [innerHTML]="renderBody(item)"></div>

            <div class="card-caption" [innerHTML]="renderCaption(item)"></div>
          </div>
        }
      </div>
    </app-widget-card>
  `,
  styles: `
    .cards-container {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
      overflow-y: auto;
    }

    .card-1 {
      --color: #1659ea;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1.125rem 0.938rem;
      background-color: color-mix(in srgb, var(--color) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--color) 20%, transparent);
      border-radius: 0.625rem;
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.625rem;
    }

    .card-title {
      flex: 1;
      font-size: 0.938rem;
      font-weight: 500;
    }

    .card-tag {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 3.8rem;
      padding: 0 0.5rem;
      font-size: 0.75rem;
      font-weight: 500;
      text-transform: uppercase;
      color: var(--color);
      background-color: color-mix(in srgb, var(--color) 15%, transparent);
      border: 1px solid color-mix(in srgb, var(--color) 25%, transparent);
      border-radius: 0.313rem;
    }

    .card-body,
    .card-caption {
      font-size: 0.875rem;
      line-height: 1.5;
      color: #4a5568;
    }

    .card-body :global(p),
    .card-caption :global(p) {
      margin: 0.5rem 0;
    }
  `,
})
export class CardWidgetComponent {
  data = input.required<unknown[]>();
  config = input.required<CardWidgetConfig>();
  isLoading = input<boolean>(false);
  isEmpty = input<boolean>(false);
  showRefresh = input<boolean>(false);
  refresh = output();

  getTitle(item: unknown): string {
    const config = this.config();
    if (!config.title) return '';

    const value = getValue(item, config.title);
    return value?.toString() ?? '';
  }

  getTag(item: unknown): string {
    const config = this.config();
    if (!config.tag) return '';

    const value = getValue(item, config.tag);
    return value?.toString() ?? '';
  }

  renderBody(item: unknown): string {
    const config = this.config();
    return renderTemplate(config.body || '', item as Record<string, unknown>);
  }

  renderCaption(item: unknown): string {
    const config = this.config();
    return renderTemplate(
      config.caption || '',
      item as Record<string, unknown>,
    );
  }
}
