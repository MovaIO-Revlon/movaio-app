import { Component, input, output } from '@angular/core';
import { CardLoader } from '../../../components/shared/card-loader';

@Component({
  selector: 'app-widget-card',
  standalone: true,
  imports: [CardLoader],
  template: `
    @if (title()) {
      <div class="widget-header">
        <h4 class="widget-title">{{ title() }}</h4>

        @if (showRefresh()) {
          <button
            (click)="refresh.emit()"
            class="info-button ms-auto me-3"
            type="button"
          >
            <i class="fa-solid fa-rotate"></i>
          </button>
        }
        @if (showInfo()) {
          <button
            class="info-button"
            type="button"
            [title]="infoText() || 'Information'"
          >
            <svg width="17" height="17">
              <use href="assets/img/info-circle.svg"></use>
            </svg>
          </button>
        }
      </div>
    }

    <div class="widget-body" [class.with-padding]="!noPadding()">
      <ng-content></ng-content>
    </div>

    @if (isLoading() || isEmpty()) {
      <card-loader
        style="--top-spacing: 3rem"
        [loading]="isLoading()"
        [noData]="isEmpty()"
        [noDataText]="emptyMessage()"
      />
    }
  `,
  styles: `
    :host {
      position: relative;
      display: flex;
      flex-direction: column;
      min-height: 22rem;
      background-color: #ffffff;
      border: 1px solid #e1e0e3;
      border-radius: 0.625rem;
      overflow: hidden;
      height: 0;
    }

    .widget-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.6rem 1rem;
    }

    .widget-title {
      margin: 0;
      font-size: 0.875rem;
      font-weight: 500;
      color: #262e2b;
    }

    .info-button {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0.25rem;
      background: none;
      border: none;
      color: #ffa242;
      cursor: pointer;
      transition: opacity 0.2s;
    }

    .info-button:hover {
      opacity: 0.7;
    }

    .widget-body {
      position: relative;
      flex: 1;
      overflow: auto;
    }

    .widget-body.with-padding {
      padding: 1rem;
    }
  `,
})
export class WidgetCardComponent {
  title = input<string>();
  showInfo = input<boolean>(false);
  infoText = input<string>();
  showRefresh = input<boolean>(false);
  refresh = output();

  isLoading = input<boolean>(false);
  isEmpty = input<boolean>(false);
  emptyMessage = input<string | undefined>();
  noPadding = input<boolean>(false);
}
