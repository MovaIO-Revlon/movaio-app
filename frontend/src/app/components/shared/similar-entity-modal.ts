import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PagerService } from '../../services/pagination.service';
import { Drawer } from '../drawer/drawer';

@Component({
  selector: 'similar-entity-modal',
  imports: [CommonModule, FormsModule, Drawer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [PagerService],
  template: `
    <drawer
      [attr.open]="open()"
      (close)="closeModal()"
      position="left"
      style="--modal-width: 40rem"
    >
      <div header>
        <p class="fw-medium">Similar Incidents</p>
      </div>

      <div
        body
        class="body flex-grow-1 h-100 border rounded-3"
        style="overflow: clip"
      >
        <div class="position-relative h-100 overflow-auto">
          <table class="table mb-0 fs-14">
            <caption class="visually-hidden">
              Headings
            </caption>
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              @for (item of data(); track item.label) {
                <tr>
                  <td>{{ $index + 1 }}.</td>
                  <td>{{ item.label }}</td>
                  <td>{{ item.value }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </drawer>
  `,
})
export class SimilarEntityModal {
  close = output();
  open = input(false);
  data = input<{ label: string; value: number }[]>([]);

  closeModal() {
    this.close.emit();
  }
}
