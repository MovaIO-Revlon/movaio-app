import { Component, inject, input } from '@angular/core';
import { ControlContainer, FormGroupDirective } from '@angular/forms';

@Component({
  selector: 'form-error',
  standalone: true,
  template: `
    @if (shouldShowError) {
      {{ errorMessage }}
    }
  `,
  styles: `
    :host {
      font-size: 13px;
      --bs-text-opacity: 1;
      color: rgba(var(--bs-danger-rgb), var(--bs-text-opacity)) !important;
    }
  `,
})
export class FormError {
  private container = inject(ControlContainer);
  private formDirective = inject(FormGroupDirective, { optional: true });

  controlName = input.required<string | number>();

  messages = input<Record<string, string>>({});

  mode = input<'change' | 'submit'>('change');
  get activeControl() {
    return this.container.control?.get(this.controlName().toString());
  }

  get shouldShowError() {
    const ctrl = this.activeControl;

    if (!ctrl) return false;

    const isSubmitted = this.formDirective?.submitted ?? false;
    return (
      ctrl.invalid && (this.mode() === 'submit' ? isSubmitted : ctrl.touched)
    );
  }

  get errorMessage() {
    const errors = this.activeControl?.errors;
    if (!errors) return null;

    const map = this.messages();
    const firstKey = Object.keys(errors)[0];
    return map[firstKey] ?? errors[firstKey] ?? 'Invalid field';
  }
}
