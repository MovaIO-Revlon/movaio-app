import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
  TemplateRef,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EntityTable, IHeading } from '../entity-table/entity-table';
import { Popover } from '../../popover/popover';
import { NgTemplateOutlet } from '@angular/common';
import { IDefect } from '../../../types';
import { isSameDay } from '../../../utils';
import { PagerService } from '../../../services/pagination.service';

@Component({
  selector: 'defect-table-modal',
  imports: [FormsModule, EntityTable, Popover, NgTemplateOutlet],
  templateUrl: './defect-table-modal.html',
  styleUrl: './defect-table-modal.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [PagerService],
})
export class DefectTableModal implements AfterViewInit {
  @ViewChild('headingCell') headingCell!: TemplateRef<any>;
  @ViewChild('incidentIdCell') incidentIdCell!: TemplateRef<any>;
  @ViewChild('descriptionCell') descriptionCell!: TemplateRef<any>;
  close = output();
  open = input(false);
  title = input<string | undefined>('Data');
  data = input<{ title: string; data: IDefect[] }[]>([]);
  hiddenFields = input<(keyof IDefect)[]>(['age_days']);

  pager = inject(PagerService<IDefect, Record<string, string>>);

  selectedTab = signal(0);

  private filteredData(d: IDefect[], filters: Record<string, string>) {
    const keys = Object.keys(filters).filter(
      (k) => k.split('.').length === 1 && Boolean(filters[k]),
    );

    const res = d.filter((defect) => {
      let flag = true;
      keys.forEach((key) => {
        if (key === 'date' && filters[`${key}.equal`]) {
          const d = defect.created;
          if (d) flag = isSameDay(new Date(d), new Date(filters[key]));
        } else if (['priority', 'severity'].includes(key)) {
          const d = defect[key as keyof IDefect];

          if (d) flag = filters[key].includes(String(d));
        } else {
          const d = defect[key as keyof IDefect];

          if (d) flag = d.toString().includes(filters[key]);
        }
      });

      return flag;
    });
    return res;
  }

  headers: IHeading[] = [];
  priorityOptions: string[] = [];
  severityOptions: string[] = [];

  constructor() {
    this.pager.setConfig({
      filterMethod: this.filteredData,
      filters: {
        ['date.equal']: 'equal',
      },
    });

    effect(() => {
      const d = this.data();
      const selectedTab = this.selectedTab();
      this.pager.setData(d?.[selectedTab]?.data || []);
    });

    effect(() => {
      const d = this.data();
      this.priorityOptions = ['(select all)'];
      this.severityOptions = ['(select all)'];

      if (d.length) {
        d.map((item) => item.data)
          .flat(1)
          .forEach((item) => {
            if (!this.priorityOptions.includes(item.priority))
              this.priorityOptions.push(item.priority);
            if (!this.severityOptions.includes(item.severity))
              this.severityOptions.push(item.severity);
          });
      }
    });
  }

  ngAfterViewInit(): void {
    this.headers = [
      {
        label: 'Defect ID',
        key: 'defect_id',
        headingTemplate: this.headingCell,
        cellTemplate: this.incidentIdCell,
      },
      {
        label: 'Title',
        key: 'title',
        headingTemplate: this.headingCell,
        cellTemplate: this.descriptionCell,
      },
      { label: 'Status', key: 'state', headingTemplate: this.headingCell },
      {
        label: 'Priority',
        key: 'priority',
        headingTemplate: this.headingCell,
      },
      {
        label: 'Severity',
        key: 'severity',
        headingTemplate: this.headingCell,
      },
      {
        label: 'CreatedOn',
        key: 'created',
        headingTemplate: this.headingCell,
      },
      {
        label: 'Category',
        key: 'category',
        headingTemplate: this.headingCell,
      },
      {
        label: 'Age days',
        key: 'age_days',
        headingTemplate: this.headingCell,
      },
    ];
  }

  closeModal() {
    this.close.emit();
  }

  selectCheckBox(key: string, value: string) {
    const currentValue = this.pager.filters()[key];
    const options =
      key === 'priority' ? this.priorityOptions : this.severityOptions;

    let values = currentValue?.split(',') || [];
    if (value === '(select all)') {
      values = values.includes('(select all)') ? [] : options || [];
    } else if (values.includes(value)) {
      values = values.filter((item) => item !== value);
    } else values.push(value);

    this.pager.filters.update((v) => {
      v[key] = values.filter(Boolean).join();
      return v;
    });
  }

  getOptions(key: string) {
    return key === 'priority' ? this.priorityOptions : this.severityOptions;
  }

  updateFilter(key: string, value: string) {
    this.pager.filters.update((v) => ({
      ...v,
      [key]: value,
    }));
  }
}
