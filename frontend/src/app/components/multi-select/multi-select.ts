import { CommonModule } from '@angular/common';
import {
  Component,
  computed,
  forwardRef,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import {
  ControlValueAccessor,
  FormsModule,
  NG_VALUE_ACCESSOR,
} from '@angular/forms';
import { Popover } from '../popover/popover';

type TOption = { label: string; value: string } | string;

@Component({
  selector: 'app-multi-select',
  imports: [FormsModule, CommonModule, Popover],
  templateUrl: './multi-select.html',
  styleUrl: './multi-select.css',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => MultiSelect),
      multi: true,
    },
  ],
})
export class MultiSelect implements ControlValueAccessor {
  options = input<TOption[]>();
  value = model<string[]>([]);
  placeholder = input('Select');
  isOpen = signal(false);
  parentWidth = input<boolean>(true);
  withSelectAll = input<boolean>(false);

  onSelect = output<string[]>();

  disabled = model(false);

  selectedAll = computed(() => this.options()?.length === this.value().length);

  getValue(option: TOption): string {
    if (typeof option === 'object') return option.value;

    return option;
  }

  getLabel(option: TOption): string {
    if (typeof option === 'object') return option.label;

    return option;
  }
  handleSelect(option: string) {
    let newValue: string[] = [];

    this.value.update((v) => {
      if (option === 'all') {
        newValue = this.selectedAll()
          ? []
          : this.options()?.map(this.getValue) || [];
        return newValue;
      }
      newValue = [...v];

      if (option === 'all') {
        newValue = this.selectedAll()
          ? []
          : this.options()?.map(this.getValue) || [];
      } else if (newValue.includes(option))
        newValue = newValue.filter((item) => item !== option);
      else newValue.push(option);

      return newValue;
    });

    this.onChange(newValue);
    this.onSelect.emit(newValue);
  }

  onChange(_: any) {}
  onTouched() {}

  registerOnChange(fn: any): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: any): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }
  writeValue(obj: any): void {
    this.value.set(obj || []);
  }
}
