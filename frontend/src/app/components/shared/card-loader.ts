import { Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'card-loader',
  imports: [CommonModule, FormsModule],
  template: `
    @if (loading()) {
      <div
        class="spinner-border"
        role="status"
        style="
              --bs-spinner-width: 0.8rem;
              --bs-spinner-height: 0.8rem;
              --bs-spinner-border-width: 0.1em;
            "
      >
        <span class="sr-only">Loading...</span>
      </div>
      Loading...
    } @else if (noData()) {
      {{ noDataText() || 'No results found' }}
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.3rem;
      position: absolute;
      font-size: 0.875rem;
      inset: 0;
      background: white;
      z-index: 1;
      top: var(--top-spacing, 0);
    }
  `,
})
export class CardLoader {
  noDataText = input<string | undefined>();
  noData = input<boolean>(false);
  loading = input<boolean>(false);
}
