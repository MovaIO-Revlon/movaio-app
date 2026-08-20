import {
  Component,
  computed,
  forwardRef,
  model,
  OnDestroy,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ControlValueAccessor,
  FormsModule,
  NG_VALUE_ACCESSOR,
} from '@angular/forms';
import { CONNECTOR_GROUPS, IConnectorGroup } from './constants';

interface IConnector {
  type: string;
  category: string;
}
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
    @let filters = filter();
    <div
      class="d-lg-flex z-1 bg-white position-sticky top-0 justify-content-between align-items-center py-2 px-3"
    >
      <div class="d-flex gap-3 flex-wrap">
        @for (group of connectorsGroup; track group.name) {
          @let name = group.name + $index;

          <div class="form-check fs-14">
            <input
              class="form-check-input"
              type="radio"
              name="connectorType"
              [id]="name"
              [value]="group.name"
              [checked]="filters.type === group.name"
              (change)="updateFilter('type', group.name)"
            />
            <label class="form-check-label text-nowrap" [for]="name">
              {{ group.name }}
            </label>
          </div>
        }
      </div>

      <div
        class="position-relative ms-auto"
        style="width: 40%; max-width: 20rem;"
      >
        <i
          class="search-icon fa-solid fa-magnifying-glass sear-1 fs-12"
          style="top: 50%; transform: translateY(-50%)"
        ></i>
        <input
          type="text"
          class="form-control ps-6 fs-12"
          placeholder="Search"
          [value]="filters.search"
          (input)="updateFilter('search', $any($event)?.target?.value)"
        />
      </div>
    </div>

    @let connectorList = connectors();
    @let noConnectors = !connectorList.length;
    @let globalDisabled = disabled();

    @let val = value();
    <div class="connectors" [class.empty]="noConnectors && 'empty'">
      @for (connector of connectorList; track connector.key) {
        @let isSelected = val.type === connector.key;
        @let isDisabled = globalDisabled || connector.disabled;
        <div
          tabindex="0"
          type="button"
          class="connector border bg-white"
          [class.disabled]="globalDisabled || connector.disabled"
          [class.border-warning]="isSelected"
          (click)="isDisabled ? null : handleSelect(connector.key, '')"
        >
          <img [src]="connector.icon" [alt]="connector.key" />
          {{ connector.label }}
          <div style="flex-basis: 100%" class="basis-100 text-muted fs-12 mt-2">
            {{ connector.description }}
          </div>

          @if (isSelected) {
            <div
              class="selector fs-12"
              [attr.data-value]="val.category"
              (click)="
                $event.stopPropagation();
                !val.category || isDisabled
                  ? null
                  : handleSelect(connector.key, '')
              "
            >
              @if (val.category) {
                {{ getCategoryLabel(val.category) }}
                <i class="fa-solid fa-check"></i>
              } @else {
                @for (item of categoryList; track item.value) {
                  <span
                    (click)="
                      $event.stopPropagation();
                      isDisabled
                        ? null
                        : handleSelect(connector.key, item.value)
                    "
                  >
                    {{ item.label }}
                  </span>
                }
              }
            </div>
          }
        </div>
      }

      @if (noConnectors) {
        <span class="fs-12 text-muted"
          >No Connectors found for keyword "{{ filters.search }}"
        </span>
      }
    </div>
  `,
  styles: `
    .connectors {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
      flex-direction: column;
      padding: 0.5rem 1rem 1rem 1rem;
    }

    .connectors.empty {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 10rem;
    }

    .connector {
      width: 100%;
      text-align: left;
      padding: 0.625rem;
      border-radius: 0.313rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      justify-content: flex-start;
      flex-wrap: wrap;
      position: relative;
      overflow: hidden;
    }

    .connector img {
      height: 1.375rem;
    }

    .selector:not([data-value]),
    .selector[data-value=''] {
      position: absolute;
      top: 0.3rem;
      right: 0.3rem;
      max-width: 9rem;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      border: var(--bs-border-width) var(--bs-border-style)
        var(--bs-border-color) !important;
      padding: 0.5rem;
      border-radius: 0.3rem;
      background-color: white;
    }
    .selector:not([data-value='']) {
      padding: 0.4rem 0.2rem;
      position: absolute;
      top: 0;
      right: 0;
      max-width: 9rem;
      border-bottom-left-radius: 0.5rem;
      color: var(--bs-white);
      font-size: 0.875rem;
      padding: 0.2rem 0.5rem;
      background-color: rgb(var(--bs-warning-rgb));
    }

    .selector span {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      cursor: pointer;
    }
  `,
})
export class ConnectorStep implements ControlValueAccessor, OnDestroy {
  readonly connectorsGroup: IConnectorGroup[] = [
    { name: 'All', connectors: [] },
    ...CONNECTOR_GROUPS,
  ];

  readonly categoryList = [
    { label: 'Data Analysis', value: 'insight' },
    { label: 'Action Execution', value: 'agent' },
  ];

  value = model<IConnector>({ type: '', category: '' });
  disabled = model(false);
  select = output<IConnector>();

  filter = signal<{ type?: string; search?: string }>({
    type: this.connectorsGroup[0].name,
    search: '',
  });

  connectors = computed(() => {
    const filter = this.filter();
    let connectors: IConnectorGroup['connectors'] = [];

    if (filter.type === this.connectorsGroup[0].name) {
      connectors = this.connectorsGroup.flatMap((item) => item.connectors);
    } else
      connectors =
        this.connectorsGroup.find((item) => item.name === filter.type)
          ?.connectors || [];

    if (connectors.length && filter.search) {
      const searchTerm = filter.search.toLowerCase();
      connectors = connectors.filter(
        (item) =>
          item.label.toLowerCase().includes(searchTerm) ||
          item.description.toLowerCase().includes(searchTerm),
      );
    }

    return connectors;
  });

  ngOnDestroy(): void {
    this.filter.set({ type: this.connectorsGroup[0].name, search: '' });
  }

  updateFilter(key: keyof ReturnType<typeof this.filter>, value: any) {
    this.filter.update((v) => ({ ...v, [key]: value }));
  }

  getCategoryLabel(value: string) {
    return this.categoryList.find((item) => value === item.value)?.label;
  }

  handleSelect(type: string, category: string) {
    const op: IConnector = { type, category };
    this.value.update((v) => ({ ...v, ...op }));
    this.select.emit(op);

    this.onChange(op);
    this.onTouched();
  }

  onChange: (value: IConnector) => void = () => {};
  onTouched: () => void = () => {};

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
