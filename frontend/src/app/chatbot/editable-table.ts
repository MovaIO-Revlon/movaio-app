import { Component, effect, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarkdownTable } from '../utils/table.util';

@Component({
  selector: 'chatbot-editable-table',
  imports: [CommonModule],
  template: `
    @for (table of tables(); let tableIndex = $index; track tableIndex) {
      <table
        class="table table-bordered m-0 fs-12"
        aria-label="Data Table"
        [style.table-layout]="!table?.width?.length ? 'fixed' : 'auto'"
      >
        <caption class="visually-hidden">
          Data Table
        </caption>
        @if (table?.width) {
          <colgroup>
            @for (w of table.width; track $index) {
              <col [style.width]="w" />
            }
          </colgroup>
        }
        <thead>
          @if (table.title) {
            <tr>
              <th [attr.colspan]="table.headers.length">
                <div class="d-flex align-items-center">
                  @if (editable()) {
                    <button type="button" class="save" (click)="handleSave()">
                      <i class="fa-solid fa-floppy-disk"></i>
                    </button>
                  } @else {
                    <button type="button" class="edit" (click)="enableEdit()">
                      <i class="fa-solid fa-pencil"></i>
                    </button>
                  }

                  <div class="ms-2">
                    {{ table.title }}
                  </div>
                </div>
              </th>
            </tr>
          }
          <tr>
            @for (header of table.headers; track $index) {
              <th scope="col">{{ header }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of table.rows; let rowIndex = $index; track rowIndex) {
            <tr>
              @for (cell of row; track $index) {
                @if (table.headers[$index] === 'Test Data') {
                  @if (rowIndex === 0) {
                  <td [rowSpan]="table.rowSpan?.[$index]">
                    <textarea
                      rows="10"
                      [readonly]="!editable()"
                      [defaultValue]="cell"
                      (input)="onChange($event, tableIndex, rowIndex, $index)"
                    ></textarea>
                  </td>
                  }
                } @else {
                  <td>
                    <input
                      [readonly]="!editable()"
                      [defaultValue]="cell"
                      (input)="onChange($event, tableIndex, rowIndex, $index)"
                    />
                  </td>
                }
              }
            </tr>
          }
        </tbody>
      </table>
    }
  `,
  styles: `
    :host {
      position: relative;
    }
    table td {
      padding: 0 !important;
      overflow: auto;
    }
    table td::webkit-scrollbar {
      width: 0;
    }
    table td input,
    table td textarea {
      padding: 0.5rem 0.5rem;
      border: none;
      outline: none;
      width: 100%;
      box-sizing: border-box;
    }

    .edit,
    .save {
      width: 30px;
      min-width: 30px;
      height: 30px;
      min-height: 30px;
      border: 1px solid #ffb944;
      background: #ffb944;
      color: #fff;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .action {
      text-align: right;
    }
  `,
})
export class EditableTable {
  tables = input<MarkdownTable[]>([]);
  update = output<MarkdownTable[]>();

  localData: MarkdownTable[] = [];

  editable = signal(false);

  constructor() {
    effect(() => {
      const data = this.tables();
      this.localData = structuredClone(data);
    });
  }

  onChange(
    event: Event,
    tableIndex: number,
    rowIndex: number,
    colIndex: number,
  ) {
    this.localData[tableIndex].rows[rowIndex][colIndex] = (
      event.target as HTMLInputElement
    ).value;
  }

  enableEdit() {
    this.editable.set(true);
  }

  handleSave() {
    this.update.emit(this.localData);
    this.editable.set(false);
  }
}
