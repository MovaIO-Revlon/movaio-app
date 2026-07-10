import { Component, forwardRef, model, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ControlValueAccessor,
  FormsModule,
  NG_VALUE_ACCESSOR,
} from '@angular/forms';
import { CONNECTOR_GROUPS, IConnectorGroup } from './constants';

@Component({
  selector: 'connector-step',
  imports: [CommonModule, FormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ConnectorStep),
      multi: true,
    },
  ],
  standalone: true,
  template: `
    @for (group of connectorsGroup; track group.name) {
      <div class="card p-3 group fw-medium">
        <div>{{ group.name }}</div>
        <div class="connectors">
          @for (connector of group.connectors; track connector.key) {
            <button
              [disabled]="disabled() || connector.disabled"
              type="button"
              class="connector border bg-white"
              [class.border-warning]="value() === connector.key"
              (click)="handleSelect(connector.key)"
            >
              <img [src]="connector.icon" [alt]="connector.key" />
              {{ connector.label }}
            </button>
          }
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: repeat(auto-fill, 224px);
      gap: 1rem;
      justify-content: center;
      padding: 1rem;
    }

    .group {
      background: #fafafa;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .connectors {
      display: flex;
      gap: 0.4rem;
      flex-direction: column;
    }

    .connector {
      width: 100%;
      text-align: left;
      padding: 0.625rem 1rem;
      border-radius: 0.313rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      justify-content: flex-start;
    }

    .connector img {
      height: 1.375rem;
    }
  `,
})
export class ConnectorStep implements ControlValueAccessor {
  readonly connectorsGroup: IConnectorGroup[] = CONNECTOR_GROUPS;

  value = model<string>('');
  disabled = model(false);
  select = output<string>();

  handleSelect(option: string) {
    this.value.set(option);
    this.select.emit(option);

    this.onChange(option);
    this.onTouched();
  }

  onChange: (value: string) => void = () => { };
  onTouched: () => void = () => { };

  writeValue(obj: any): void {
    this.value.set(obj || '');
  }

  registerOnChange(fn: any): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }
}
