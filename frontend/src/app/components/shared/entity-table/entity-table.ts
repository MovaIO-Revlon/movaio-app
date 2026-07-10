import { Component, input, output, TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Drawer } from '../../drawer/drawer';
import { CommonModule, NgTemplateOutlet } from '@angular/common';
import { getValue, renderTemplate } from '../../../utils';

export interface IHeading<T = string> {
  label: string;
  key: T;
  width?: string;
  headingTemplate?: TemplateRef<any>;
  cellTemplate?: TemplateRef<any>;
  stringTemplate?: boolean;
}

@Component({
  selector: 'entity-table',
  imports: [FormsModule, Drawer, NgTemplateOutlet, CommonModule],
  templateUrl: './entity-table.html',
  styleUrl: './entity-table.css',
})
export class EntityTable {
  close = output();
  open = input(true);
  hiddenFields = input<string[]>([]);

  headings = input<IHeading[]>([]);
  withCloseButton = input<boolean>(false);

  data = input<unknown[]>([]);

  closeModal() {
    this.close.emit();
  }

  getData(data: unknown, key: string) {
    return getValue(data, key);
  }

  renderCell(item: unknown, template: string): string {
    return renderTemplate(template, item as Record<string, unknown>);
  }
}
