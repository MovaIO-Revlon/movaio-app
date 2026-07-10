import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TooltipDirective } from '../../custom-tooltip/tooltip.directive';
import { CardLoader } from './card-loader';
@Component({
  selector: 'kpi-card',
  imports: [CommonModule, FormsModule, TooltipDirective, CardLoader],
  template: `
    <div class="label">
      <span>{{ label() }}</span>
      @if (description()) {
        <span class="info" [appTooltip]="description()">
          <svg
            width="17"
            height="17"
            viewBox="0 0 17 17"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              opacity="0.6"
              d="M7.65 12.75H9.35V7.65H7.65V12.75ZM8.5 0C3.80375 0 0 3.80375 0 8.5C0 13.1962 3.80375 17 8.5 17C13.1962 17 17 13.1962 17 8.5C17 3.80375 13.1962 0 8.5 0ZM8.5 15.3C4.7515 15.3 1.7 12.2485 1.7 8.5C1.7 4.7515 4.7515 1.7 8.5 1.7C12.2485 1.7 15.3 4.7515 15.3 8.5C15.3 12.2485 12.2485 15.3 8.5 15.3ZM7.65 5.95H9.35V4.25H7.65V5.95Z"
              fill="#FFA242"
            />
          </svg>
        </span>
      }
    </div>

    @if (loading() || hasNoData()) {
      <card-loader [loading]="loading()" [noData]="hasNoData()" style="--top-spacing: 2.5rem"/>
    }

    <div class="metric">
      <span
        class="value-wrapper"
        [class.flex-grow-1]="percentage() === undefined"
      >
        @for (item of value(); track $index) {
          <span class="value">{{ item }}</span>
          @if ($index !== value().length - 1) {
            <span class="spacer"></span>
          }
        }
      </span>

      @if (percentage() !== undefined) {
        <span class="percent">
          @if (percentage()! > 0) {
            +
          }
          {{ percentage() }}%

          <svg
            width="19"
            height="14"
            viewBox="0 0 19 14"
            fill="none"
            class="ms-2"
            xmlns="http://www.w3.org/2000/svg"
            [style.transform]="percentage()! < 0 ? 'rotate(180deg)' : ''"
          >
            <path
              fill-rule="evenodd"
              clip-rule="evenodd"
              d="M11.0864 9.06638L16.2336 4.04506C16.5309 3.75199 17.1152 3.96013 17.1152 4.37546L17.1152 6.53332C17.1152 7.04852 17.4591 7.46665 17.9797 7.46665L18.0196 7.46665C18.5392 7.46665 19 7.04852 19 6.53332L19 1.86666C19 0.835334 17.9996 1.81989e-06 16.9594 1.72895e-06L12.2483 1.31709e-06C11.7286 1.27166e-06 11.4626 0.476 11.4626 0.9912L11.4626 1.02107C11.4626 1.53626 11.7286 1.86666 12.2483 1.86666L14.552 1.86666C14.6459 1.86705 14.7375 1.89473 14.8153 1.94621C14.8931 1.99769 14.9537 2.07066 14.9894 2.15592C15.0251 2.24118 15.0342 2.33491 15.0157 2.42529C14.9972 2.51566 14.9519 2.59863 14.8855 2.66373L10.4214 7.08492C10.3343 7.17155 10.2306 7.24034 10.1163 7.28729C10.002 7.33424 9.87933 7.35841 9.75543 7.35841C9.63152 7.35841 9.50885 7.33424 9.39453 7.28729C9.28021 7.24034 9.17651 7.17155 9.08947 7.08492L8.70091 6.70039C7.9656 5.97145 6.77239 5.97145 6.03518 6.70039L0.276201 12.4068C0.0992547 12.5824 -1.80415e-06 12.8195 -1.82575e-06 13.0666C-1.84736e-06 13.3138 0.0992546 13.5509 0.276201 13.7265C0.363247 13.8131 0.466938 13.8819 0.581259 13.9289C0.69558 13.9758 0.818253 14 0.94216 14C1.06607 14 1.18874 13.9758 1.30306 13.9289C1.41738 13.8819 1.52107 13.8131 1.60812 13.7265L6.70209 8.68092C6.78921 8.59425 6.89299 8.52545 7.00738 8.47849C7.12178 8.43153 7.24454 8.40735 7.36852 8.40735C7.4925 8.40735 7.61525 8.43153 7.72965 8.47849C7.84405 8.52545 7.94783 8.59425 8.03495 8.68092L8.42066 9.06358C8.59466 9.2372 8.80203 9.37513 9.03074 9.46936C9.25944 9.5636 9.50493 9.61226 9.75293 9.61252C10.0009 9.61278 10.2465 9.56464 10.4754 9.47088C10.7043 9.37713 10.912 9.23964 11.0864 9.06638Z"
              [attr.fill]="
                percentage()! < 0
                  ? '#E26363'
                  : percentage()! > 0
                    ? '#29B14B'
                    : '#fff'
              "
            />
          </svg>
        </span>
      }
    </div>
  `,
  styles: `
    :host {
      flex: 1;
      background-color: #fff;
      border: 1px solid #e1e0e3;
      border-radius: 0.625rem;
      padding: 1.1rem 1rem;
      min-width: 12rem;
      overflow: clip;
    }

    :host .label {
      font-weight: 400;
      font-size: 0.8rem;
      font-family: 'Fira Sans', system-ui, sans-serif;
      line-height: 24px;
      letter-spacing: 0%;
      margin-bottom: 0.75rem;
      display: flex;
      justify-content: space-between;
    }

    :host .metric {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    :host .metric .value {
      font-family: 'Fira Sans', system-ui, sans-serif;
      font-weight: 600;
      font-size: 1rem;
      line-height: 22px;
      letter-spacing: 0%;
      position: relative;
    }

    :host .metric .value-wrapper {
      display: flex;
      align-items: center;
      gap: 0.8rem;
    }
    :host .metric .spacer {
      width: 1px;
      align-self: stretch;
      margin: -1% 0;
      background-color: #cbcbcc;
    }

    :host .metric .percent {
      font-family: 'Fira Sans', system-ui, sans-serif;
      font-weight: 400;
      font-size: 1.125rem;
      line-height: 24px;
      letter-spacing: 0%;
      text-align: right;
    }
  `,
  host: {
    '(click)': 'onHostClick()',
  },
})
export class KpiCard {
  label = input('');
  percentage = input<number | undefined>();
  value = input<string[]>([]);
  description = input('');
  loading = input(false);
  clickAction = output();

  hasNoData = computed(() => this.value().every((item) => !item.trim()));

  onHostClick() {
    this.clickAction.emit();
  }
}
