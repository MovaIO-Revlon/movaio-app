import { Component, input } from '@angular/core';

@Component({
  selector: 'details[smart-insight-card]',
  imports: [],
  template: `
    <summary>
      <span class="title">{{ label() }}</span>
      <span class="icon">
        <i class="fa-solid fa-minus close-icon d-none"></i>
        <i class="fa-solid fa-plus open-icon"></i>
      </span>
    </summary>
    <div class="body">
      <ng-content> </ng-content>
    </div>
  `,
  styles: `
    :host {
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 0.8rem;
    }

    :host .icon {
      height: 1.5rem;
      width: 1.5rem;
      display: grid;
      place-content: center;
    }

    :host:open .close-icon {
      display: block !important;
    }
    :host:open .open-icon {
      display: none;
    }

    :host summary {
      padding: 1.063rem 1.25rem;
      display: flex;
      justify-content: space-between;
    }

    :host > summary > .title {
      color: #262E2B;
      font-size: 1.125rem;
      line-height: 1.5rem;
      font-weight: 500;
    }
  `,
})
export class SmartInsightCard {
  label = input<string>('');

  constructor() {}
}
