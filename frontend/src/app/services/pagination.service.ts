import { Injectable, computed, signal } from '@angular/core';

export interface PagerConfig<T, F extends object> {
  pageSizeOptions?: number[];
  defaultPageSize?: number;
  filters?: F;
  filterMethod?: (item: T[], filters: F) => T[];
}

@Injectable({ providedIn: 'root' })
export class PagerService<T, F extends object> {
  private config = signal<PagerConfig<T, F>>({
    pageSizeOptions: [10, 20, 30, 40, 50],
    defaultPageSize: 20,
    filters: {} as F,
    filterMethod: () => [],
  });

  data = signal<T[]>([]);
  filters = signal<F>(this.config().filters!);

  page = signal(1);
  pageSize = signal(this.config().defaultPageSize!);
  pageSizeOptions = computed(() => this.config().pageSizeOptions!);

  startIndex = computed(() => (this.page() - 1) * this.pageSize());
  endIndex = computed(() =>
    Math.min(this.startIndex() + this.pageSize(), this.totalRecords()),
  );

  filteredData = computed(
    () =>
      this.config().filterMethod?.(this.data(), this.filters()) || this.data(),
  );

  totalRecords = computed(() => this.filteredData().length);

  totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalRecords() / this.pageSize())),
  );

  paginatedData = computed(() => {
    const start = (this.page() - 1) * this.pageSize();
    return this.filteredData().slice(start, start + this.pageSize());
  });

  hasNextPage = computed(() => this.page() < this.totalPages());
  hasPrevPage = computed(() => this.page() > 1);

  setConfig(config: PagerConfig<T, F>) {
    this.config.update((v) => ({ ...v, ...config }));
    if (config.defaultPageSize) this.pageSize.set(config.defaultPageSize);
    this.clampPage();
  }

  setData(data: T[]) {
    this.data.set(data);
    this.clampPage();
  }

  setPage(page: number) {
    const clamped = Math.max(1, Math.min(page, this.totalPages()));
    this.page.set(clamped);
  }

  nextPage() {
    this.setPage(this.page() + 1);
  }

  prevPage() {
    this.setPage(this.page() - 1);
  }

  setPageSize(size: number) {
    this.pageSize.set(size);
    this.clampPage();
  }

  goToLast() {
    this.setPage(this.totalPages());
  }

  reset() {
    this.page.set(1);
  }

  private clampPage() {
    const total = this.totalPages();
    if (this.page() > total) {
      this.page.set(total);
    } else if (this.page() < 1) {
      this.page.set(1);
    }
  }

  setFilters(filters: Partial<F>) {
    this.filters.update((v) => ({
      ...v,
      ...filters,
    }));
  }
}
