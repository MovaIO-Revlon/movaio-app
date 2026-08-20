import {
  Component,
  computed,
  effect,
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
export type TOption = { label: string; value: string; data?: any };

@Component({
  selector: 'app-select',
  imports: [FormsModule, Popover],
  templateUrl: './select.html',
  styleUrl: './select.css',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => Select),
      multi: true,
    },
  ],
})
export class Select implements ControlValueAccessor {
  options = input<TOption[]>();
  parentWidth = input<boolean>(true);
  value = model<string>();
  allowSearch = input(true);
  placeholder = input('Select');
  isOpen = signal(false);
  disabled = model(false);

  onSelect = output<TOption>();

  classes = input<
    Partial<{
      root: string;
      label: string;
      dropdown: string;
      option: string;
      search: string;
      options: string;
    }>
  >();

  selectedLabel = computed(() => {
    const val = this.value();
    const options = this.options();

    if (!val || !options?.length) return '';

    const option = options?.find((item) => item.value === val)?.label;
    return option;
  });

  search = signal('');

  filtered = computed(() => {
    const searchTerm = this.search()?.toLowerCase();

    if (!searchTerm) return this.options() || [];

    return (
      this.options()?.filter((item) =>
        item.label.toLowerCase().includes(searchTerm),
      ) || []
    );
  });

  constructor() {
    let wasOpen = false;
    effect(() => {
      const open = this.isOpen();
      if (wasOpen && !open) {
        this.onTouched();
      }

      wasOpen = open;
    });
  }

  handleSelect(option: TOption) {
    this.onSelect.emit(option);
    this.value.set(option.value);

    this.onChange(option.value);
    this.search.set('');
    this.isOpen.set(false);
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
    this.value.set(obj || '');
  }
}
