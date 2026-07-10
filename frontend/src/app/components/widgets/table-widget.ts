import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableWidgetConfig } from '../../types/widget.types';
import { renderTemplate } from '../../utils';
import { WidgetCardComponent } from '../../marketplace/mcpconnectors/widget-builder/widget-card';

@Component({
  selector: 'table-widget',
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
    >
      <div class="px-2 h-100 position-relative">
        <table class="table table-sm ta">
          <thead>
            <tr>
              @for (header of widgetConfig.headers; track header.label) {
                <th
                  class="position-sticky top-0 z-1 bg-light"
                  [innerHTML]="header.label"
                ></th>
              }
            </tr>
          </thead>
          <tbody>
            @for (item of data(); track $index) {
              <tr>
                @for (header of widgetConfig.headers; track header.label) {
                  <td [innerHTML]="renderCell(item, header.value)"></td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    </app-widget-card>
  `,
  styles: ``,
})
export class TableWidgetComponent {
  data = input.required<unknown[]>();
  config = input.required<TableWidgetConfig>();
  isLoading = input<boolean>(false);
  isEmpty = input<boolean>(false);
  showRefresh = input<boolean>(false);
  refresh = output();

  renderCell(item: unknown, value: string): string {
    return renderTemplate(value, item as Record<string, unknown>);
  }
}
