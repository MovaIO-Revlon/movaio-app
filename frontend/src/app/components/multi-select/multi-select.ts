import { CommonModule } from '@angular/common';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  forwardRef,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
  afterNextRender,
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
  template: `
    @let val = value();
    @let optionsList = options();
    <popover
      [(isOpen)]="isOpen"
      [popover-width]="parentWidth()"
      [disabled]="disabled()"
      [positionY]="positionY()"
    >
      <div
        trigger
        class="label"
        [attr.aria-expanded]="isOpen()"
        [class.disabled]="disabled()"
      >
        <span #labelTextEl class="label-text-inner">
          {{ displayLabel() || placeholder() }}
        </span>
        <span class="icon">
          <ng-content select="[icon]">
            <i class="fa-solid fa-angle-right"></i>
          </ng-content>
        </span>
      </div>

      <div content class="options">
        @if (withSelectAll() && optionsList?.length) {
          <label class="option">
            <input
              type="checkbox"
              class="form-check-input"
              [checked]="selectedAll()"
              (change)="handleSelect('all')"
            />
            <span class="label-text"> Select All </span>
          </label>
        }

        @for (item of optionsList; track $index) {
          @let optionValue = getValue(item);
          @let optionLabel = getLabel(item);
          <label class="option" [title]="optionLabel">
            <input
              type="checkbox"
              class="form-check-input"
              [checked]="val.includes(optionValue)"
              (change)="handleSelect(optionValue)"
            />
            <span class="label-text">
              {{ optionLabel }}
            </span>
          </label>
        }
      </div>
    </popover>
  `,
  styles: `
    :host {
      --label-border-radius: 8px;
      --label-border-width: 1px;
      --label-border-color: #e1e0e3;
      --label-padding-x: 0.75rem;
      --label-padding-y: 0.375rem;
      --label-spacing: 0.5rem;
      --label-font-size: inherit;
      --min-height: 38px;

      --width: 140px;
      --options-max-height: 180px;
      --options-max-width: fit-content;
      --options-border-radius: 8px;

      --option-padding-x: 15px;
      --option-padding-y: 7px;
      --option-gap: 0.5rem;
      --option-font-size: 14px;
      --option-line-height: 24px;

      --checkbox-size: 1.125rem;
      --checkbox-color: #ffa242;

      --position-right: 0;
      --position-left: 0;
    }

    .label {
      width: var(--width);
      border-radius: var(--label-border-radius);
      border: var(--label-border-width) solid var(--label-border-color);
      background-color: #fff;
      min-height: var(--min-height);

      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--label-spacing);

      font-weight: 400;
      font-size: var(--label-font-size);
      vertical-align: middle;

      padding: var(--label-padding-y) var(--label-padding-x);
    }

    .label[aria-expanded='true'] > .icon {
      transform: rotate(90deg);
    }

    .options label {
      display: flex;
      align-items: center;
      padding: var(--option-padding-y) var(--option-padding-x);
      gap: var(--option-gap);

      font-family: 'Fira Sans', system-ui, sans-serif;
      font-weight: 400;
      font-style: Regular;
      font-size: var(--option-font-size);
      line-height: var(--option-line-height);
      letter-spacing: 0px;
      vertical-align: middle;
    }

    .options {
      max-height: var(--options-max-height);
      max-width: var(--options-max-width);
      overflow: auto;
      background: white;
      border: var(--bs-border-width) solid var(--bs-border-color);
      border-radius: var(--options-border-radius);
      scrollbar-gutter: thin;
      width: 100%;
      margin-top: 0.1rem;
    }

    :host > [popover][popover-width='parent'] .options {
      margin-top: 0;
      border-top: none;
      border-top-left-radius: 0;
      border-top-right-radius: 0;
    }

    :host > [popover][popover-width='parent'] .label[aria-expanded='true'] {
      border-bottom: none;
      border-bottom-right-radius: 0;
      border-bottom-left-radius: 0;
    }

    .options label input[type='checkbox'] {
      box-shadow: none;
      height: var(--checkbox-size);
      width: var(--checkbox-size);
      margin: 0;
    }

    .options label input[type='checkbox']:checked {
      background-color: var(--checkbox-color);
      border-color: var(--checkbox-color);
      box-shadow: none;
    }

    .label[disabled='true'] * {
      transform: none !important;
      user-select: none;
    }

    .options label:first-child {
      margin-top: 0.5rem;
    }

    .options label:last-child {
      margin-bottom: 0.5rem;
    }

    .label-text {
      display: block;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .label-text-inner {
      display: block;
      flex: 1 1 auto;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `,
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
  positionY = input<'top' | 'bottom'>('bottom');

  onSelect = output<string[]>();

  disabled = model(false);

  private destroyRef = inject(DestroyRef);
  private resizeObserver?: ResizeObserver;

  labelTextEl = viewChild<ElementRef<HTMLSpanElement>>('labelTextEl');

  fullLabel = computed<string>(() => {
    const val = this.value();
    if (!val.length) return '';

    return (
      this.options()
        ?.filter((item) => val.includes(this.getValue(item)))
        .map((item) => this.getLabel(item))
        .join(', ') || ''
    );
  });

  displayLabel = signal('');
  extraCount = signal(0);

  selectedAll = computed(() => {
    const op = this.options();
    return op?.length && op?.length === this.value().length;
  });

  private measureCtx?: CanvasRenderingContext2D;

  constructor() {
    effect(() => {
      this.fullLabel();
      this.measureAndTruncate();
    });

    let wasOpen = false;
    effect(() => {
      const open = this.isOpen();
      if (wasOpen && !open) {
        this.onTouched();
      }

      wasOpen = open;
    });

    afterNextRender(() => {
      const el = this.labelTextEl()?.nativeElement;
      if (!el) return;

      this.measureCtx =
        document.createElement('canvas').getContext('2d') ?? undefined;

      this.resizeObserver = new ResizeObserver(() => this.measureAndTruncate());
      this.resizeObserver.observe(el);

      this.destroyRef.onDestroy(() => this.resizeObserver?.disconnect());

      this.measureAndTruncate();
    });
  }

  private measureTextWidth(el: HTMLElement, text: string): number {
    if (!this.measureCtx) return 0;
    const font = getComputedStyle(el).font;
    if (this.measureCtx.font !== font) {
      this.measureCtx.font = font;
    }
    return this.measureCtx.measureText(text).width;
  }

  private measureAndTruncate(): void {
    const el = this.labelTextEl()?.nativeElement;
    if (!el || !this.measureCtx) return;

    const val = this.value();
    const items =
      this.options()
        ?.filter((item) => val.includes(this.getValue(item)))
        .map((item) => this.getLabel(item)) || [];

    if (!items.length) {
      this.displayLabel.set('');
      this.extraCount.set(0);
      return;
    }

    const availableWidth = el.clientWidth;
    const full = items.join(', ');

    if (this.measureTextWidth(el, full) <= availableWidth) {
      this.displayLabel.set(full);
      this.extraCount.set(0);
      return;
    }

    let lo = 0;
    let hi = items.length - 1;
    let best = { text: `+${items.length}`, extra: items.length };

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const extra = items.length - mid;
      const candidate =
        mid > 0 ? `${items.slice(0, mid).join(', ')}, +${extra}` : `+${extra}`;

      if (this.measureTextWidth(el, candidate) <= availableWidth) {
        best = { text: candidate, extra };
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    this.displayLabel.set(best.text);
    this.extraCount.set(best.extra);
  }

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

      if (newValue.includes(option))
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
