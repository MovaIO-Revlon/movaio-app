import {
  Component,
  computed,
  ElementRef,
  forwardRef,
  inject,
  input,
  LOCALE_ID,
  model,
  OnInit,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import {
  ControlValueAccessor,
  FormsModule,
  NG_VALUE_ACCESSOR,
} from '@angular/forms';
import { formatDate } from '@angular/common';
import { generateRanges, isSameDay } from '../../utils';
import { Popover } from '../popover/popover';

type TModes = 'days' | 'month' | 'year';

interface IGrid {
  originalDate: string;
  date: number;
  day: number;
  month: number;
  year: number;
  weekday: string;
  inMonth: boolean;
  inRange: boolean;
  disabled: boolean;
  startDate: boolean;
  endDate: boolean;
}

export interface IDateRange {
  label: string;
  range: [string, string];
}

@Component({
  selector: 'app-datepicker',
  imports: [FormsModule, Popover],
  templateUrl: './datepicker.html',
  styleUrl: './datepicker.css',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DatePicker),
      multi: true,
    },
  ],
})
export class DatePicker implements ControlValueAccessor, OnInit {
  @ViewChild('popover') popover!: ElementRef<HTMLElement>;
  @ViewChild('defaultTrigger') defaultTrigger?: ElementRef<HTMLElement>;

  value = model<Date[]>([]);
  minDate = input('');
  maxDate = input('');
  allowSingleDate = input(true);
  popoverPosition = input<'left' | 'right'>('right');

  placeholder = input('Select');
  private _temp = signal<Date[]>([]);
  private locale = inject(LOCALE_ID);
  private readonly YEAR_RANGE_SIZE = 12;
  private readonly RANGES = generateRanges();
  isOpen = signal(false);
  disabled = model(false);

  onSelect = output<Date[]>();

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

  weekDays = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];
  months = [
    { key: 'january', value: 'Jan' },
    { key: 'february', value: 'Feb' },
    { key: 'march', value: 'Mar' },
    { key: 'april', value: 'Apr' },
    { key: 'may', value: 'May' },
    { key: 'june', value: 'Jun' },
    { key: 'july', value: 'Jul' },
    { key: 'august', value: 'Aug' },
    { key: 'september', value: 'Sep' },
    { key: 'october', value: 'Oct' },
    { key: 'november', value: 'Nov' },
    { key: 'december', value: 'Dec' },
  ];
  month = signal(0);
  year = signal(0);

  rangeWindowYear = 0;
  mode = signal<TModes>('days');

  dateRangeOptions = model<IDateRange[]>([]);

  ngOnInit(): void {
    const d = new Date();
    this.year.set(d.getFullYear());
    this.rangeWindowYear = this.year();
    this.month.set(d.getMonth());

    if (!this.dateRangeOptions()?.length) {
      const {
        today,
        last30,
        last7,
        lastMonth,
        thisMonth,
        yesterday,
        last6Month,
        lastYear,
        allTime,
      } = this.RANGES;

      this.dateRangeOptions.set([
        { label: 'Today', range: [today.start, today.end] },
        { label: 'Yesterday', range: [yesterday.start, yesterday.end] },
        { label: 'Last 7 Days', range: [last7.start, last7.end] },
        {
          label: 'Last 30 Days',
          range: [last30.start, last30.end],
        },
        {
          label: 'This Month',
          range: [thisMonth.start, thisMonth.end],
        },
        {
          label: 'Last Month',
          range: [lastMonth.start, lastMonth.end],
        },
        {
          label: 'Last 6 Month',
          range: [last6Month.start, last6Month.end],
        },
        {
          label: 'Last Year',
          range: [lastYear.start, lastYear.end],
        },
        {
          label: 'All Time',
          range: [allTime.start, allTime.end],
        },
      ]);
    }

    if (!this.value().length) {
      this._temp.set(
        this.dateRangeOptions()[0].range.map((item) => new Date(item)),
      );
    }
  }

  private inRange(date: Date, max: Date | null, min: Date | null) {
    if (isNaN(date.getTime())) return false;

    const dTime = date.getTime();

    if (max && !isNaN(max.getTime()) && dTime > max.getTime()) return false;
    if (min && !isNaN(min.getTime()) && dTime < min.getTime()) return false;

    return true;
  }

  isRangeSelected(range: string[]) {
    const currentVal = this._temp().length ? this._temp() : this.value();
    return (
      isSameDay(currentVal[0], new Date(range[0])) &&
      isSameDay(currentVal[1], new Date(range[1]))
    );
  }

  label = computed(() => {
    let temp = this._temp();
    if (!temp.length) temp = this.value();
    if (!temp.length) return this.placeholder();

    const defaultLabels = ['From Date', 'To Date'];

    return [temp[0], temp[1]]
      .map((item, index) =>
        item
          ? formatDate(item, 'MMM dd, yyyy', this.locale)
          : defaultLabels[index],
      )
      .join(' - ');
  });

  calendarGrid = computed<IGrid[]>(() => {
    const grid: IGrid[] = [];

    if (!this.isOpen()) return grid;

    const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
    const firstOfMonth = new Date(this.year(), this.month());
    const start = new Date(firstOfMonth);
    start.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());

    let maxDateRange: Date | null = null;
    let minDateRange: Date | null = null;

    if (this.minDate()) {
      minDateRange = new Date(this.minDate());
      minDateRange.setHours(0, 0, 0, 0);
    }
    if (this.maxDate()) {
      maxDateRange = new Date(this.maxDate());
      maxDateRange.setHours(0, 0, 0, 0);
    }

    const currentVal = this._temp().length ? this._temp() : this.value();
    const month = this.month();

    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      d.setHours(0, 0, 0, 0);

      grid.push({
        startDate: isSameDay(d, currentVal[0]),
        endDate: isSameDay(d, currentVal[1]),
        originalDate: d.toISOString(),
        date: d.getDate(),
        day: d.getDay(),
        month: d.getMonth(),
        year: d.getFullYear(),
        weekday: fmt.format(d),
        inMonth: d.getMonth() === month,
        inRange:
          currentVal.length == 2
            ? this.inRange(d, currentVal[1], currentVal[0])
            : false,
        disabled: !this.inRange(d, maxDateRange, minDateRange),
      });
    }

    return grid;
  });

  heading = computed<string>(() => {
    const yearRange = this.yearRange();
    const mode = this.mode();

    if (mode === 'year')
      return `${yearRange[0]} - ${yearRange[yearRange.length - 1]}`;
    if (mode === 'month') return this.year().toString();

    return `${this.months[this.month()].key} ${this.year()}`;
  });

  yearRange = computed(() => {
    const mode = this.mode();

    if (mode !== 'year') return [];
    const half = Math.floor(this.YEAR_RANGE_SIZE / 2);
    const startYear = this.rangeWindowYear - half;

    return Array.from(
      { length: this.YEAR_RANGE_SIZE },
      (_, index) => startYear + index,
    );
  });

  applyDisabled = computed(
    () => this._temp().length < (this.allowSingleDate() ? 1 : 2),
  );

  togglePickerMode() {
    this.mode.update(
      (v) =>
        (v === 'days' ? 'month' : v === 'month' ? 'year' : 'days') as TModes,
    );
  }

  prev() {
    if (this.mode() === 'year') {
      this.rangeWindowYear -= this.YEAR_RANGE_SIZE;
      return;
    }

    const month = this.month();

    if (month === 0) {
      this.year.update((v) => v - 1);
      this.month.set(11);
      return;
    }

    this.month.update((v) => v - 1);
  }

  next() {
    if (this.mode() === 'year') {
      this.rangeWindowYear += this.YEAR_RANGE_SIZE;
      return;
    }

    const month = this.month();

    if (month === 11) {
      this.year.update((v) => (v += 1));
      this.month.set(0);
      return;
    }

    this.month.update((v) => v + 1);
  }

  selectDate({ originalDate: date, inMonth, disabled }: IGrid) {
    if (this.disabled() || disabled || !inMonth) return;

    this._temp.update((v) => {
      let newState = [...v];

      if (newState.length === 2) newState = [];

      newState.push(new Date(date));
      if (newState.length > 1)
        newState = newState.sort((a, b) => a.getTime() - b.getTime());

      return newState;
    });
  }

  selectRange(range: [string, string]) {
    this._temp.set(range.map((item) => new Date(item)));
  }

  selectYear(year: number) {
    this.year.set(year);
    this.mode.set('month');
    this.rangeWindowYear = year;
  }

  selectMonth(month: number) {
    this.month.set(month);
    this.mode.set('days');
    this.rangeWindowYear = this.year();
  }

  commit() {
    const range = this._temp().sort((a, b) => a.getTime() - b.getTime());

    if (!this.allowSingleDate() && range.length < 2) return;

    if (range.length) {
      this.value.set(range);
      this.onChange(range);
      this._temp.set([]);
      this.onSelect.emit(range);
      this.mode.set('days');
      this.year.set(this.RANGES.today.year);
      this.month.set(this.RANGES.today.month);
    }
    this.isOpen.set(false);
  }

  cancel() {
    this.onChange(this.value());
    this.isOpen.set(false);
    this.onSelect.emit(this.value());
    this._temp.set([]);
    this.mode.set('days');
    this.year.set(this.RANGES.today.year);
    this.month.set(this.RANGES.today.month);
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
