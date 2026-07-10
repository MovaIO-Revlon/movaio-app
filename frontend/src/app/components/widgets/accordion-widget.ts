import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AccordionWidgetConfig } from '../../types/widget.types';
import { getValue, renderTemplate } from '../../utils';
import { WidgetCardComponent } from '../../marketplace/mcpconnectors/widget-builder/widget-card';

@Component({
  selector: 'app-accordion-widget',
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
      @for (item of data(); track $index) {
        <details class="accordion-item">
          @let count = getCount(item);

          <summary class="accordion-header">
            <span class="accordion-title" [innerHTML]="getTitle(item)"></span>
            @if (count) {
              <span class="accordion-count" [innerHTML]="count"></span>
            }
            <svg
              class="accordion-icon"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path
                d="M4.427 9.573l3.396-3.396a.25.25 0 01.354 0l3.396 3.396a.25.25 0 01-.177.427H4.604a.25.25 0 01-.177-.427z"
              />
            </svg>
          </summary>

          <div
            class="accordion-content"
            [style.--columns]="widgetConfig?.columns || 1"
          >
            @for (childItem of getBodyData(item); track $index) {
              <div
                class="accordion-detail"
                [innerHTML]="renderBody(childItem)"
              ></div>
            }
          </div>
        </details>
      }
    </app-widget-card>
  `,
  styles: `
    .accordion-container {
      max-height: 380px;
      overflow-y: auto;
    }

    .accordion-item {
      border-bottom: 1px solid #e1e0e3;
    }

    .accordion-item:last-child {
      border-bottom: none;
    }

    .accordion-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.9rem 1rem;
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      user-select: none;
      transition: background-color 0.2s;
    }

    .accordion-header:hover {
      background-color: #f7fafc;
    }

    .accordion-title {
      flex: 1;
    }

    .accordion-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.5rem;
      height: 1.5rem;
      padding: 0 0.5rem;
      font-size: 0.875rem;
      font-weight: 600;
      color: #f9a84a;
      background-color: rgba(249, 168, 74, 0.13);
      border-radius: 0.3rem;
    }

    .accordion-icon {
      flex-shrink: 0;
      color: #718096;
      transition: transform 0.2s;
    }

    .accordion-item[open] .accordion-icon {
      transform: rotate(180deg);
    }

    .accordion-content {
      --columns: 1;
      display: grid;
      grid-template-columns: repeat(var(--columns), 1fr);
      gap: 0.5rem;
      padding: 0 1rem 1rem 1rem;
    }

    .accordion-detail {
      padding: 0.75rem;
      font-size: 0.875rem;
      line-height: 1.5;
      background-color: rgba(204, 65, 65, 0.2);
      border: 1px solid rgba(204, 65, 65, 0.08);
      border-radius: 0.5rem;
    }

    .accordion-detail :global(p) {
      margin: 0.5rem 0;
    }

    .accordion-detail :global(p:first-child) {
      margin-top: 0;
    }

    .accordion-detail :global(p:last-child) {
      margin-bottom: 0;
    }
  `,
})
export class AccordionWidgetComponent {
  data = input.required<unknown[]>();
  config = input.required<AccordionWidgetConfig>();
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

  getCount(item: unknown): string {
    const config = this.config();

    if (!config.count) return '';

    const value = getValue(item, config.count);
    return value?.toString() ?? '';
  }

  getBodyData(item: unknown): unknown[] {
    const config = this.config();
    const bodySource = config.bodySource;

    if (!bodySource || bodySource === 'self') {
      return [item];
    }

    const data = getValue(item, bodySource);

    if (Array.isArray(data)) {
      return data;
    }

    return data ? [data] : [{}];
  }

  renderBody(data: unknown): string {
    const config = this.config();
    return renderTemplate(config.body || '', data as Record<string, unknown>);
  }
}
