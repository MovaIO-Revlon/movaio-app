import { Component, ElementRef, input, output, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import {
  FilterStore,
  PAGE_NAME,
} from '../../commandcenter/trends/filter.store';
import { RequestBuilderComponent } from './request-builder';
import { IFunctionJson } from '../../types';

declare var $: any;

@Component({
  selector: 'request-builder-modal',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RequestBuilderComponent,
  ],
  providers: [{ provide: PAGE_NAME, useValue: 'insights' }, FilterStore],
  template: `
    <div
      class="modal fade"
      data-bs-backdrop="static"
      data-bs-keyboard="false"
      id="requestBuilder"
      #modal
      tabindex="-1"
      aria-labelledby="requestBuilderLabel"
      aria-hidden="true"
    >
      @let defaultData = data();
      <div class="modal-dialog modal-xl">
        <div class="modal-content">
          <div class="modal-header py-2">
            <h1 class="modal-title fw-semibold fs-14" id="requestBuilderLabel">
              {{ defaultData?.id ? 'Edit' : 'New' }} Tool Action
            </h1>
            <button
              type="button"
              class="btn-close"
              aria-label="Close"
              (click)="oncancel()"
            ></button>
          </div>

          <div class="modal-body">
            <request-builder
              #requestBuilder
              [initialSchema]="defaultData"
              [excludeNames]="excludeNames()"
            />
          </div>

          @let builder = requestBuilderRef();

          <div class="modal-footer">
            <button
              type="button"
              class="btn btn-secondary"
              (click)="oncancel()"
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-warning text-white px-3"
              [disabled]="!builder?.form?.valid"
              (click)="onSubmit()"
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class RequestBuilderModal {
  modal = viewChild<ElementRef>('modal');
  requestBuilderRef = viewChild<RequestBuilderComponent>('requestBuilder');

  data = input<IFunctionJson | null>(null);
  excludeNames = input<string[]>([]);
  submit = output<IFunctionJson>();
  cancel = output();

  openModal() {
    const el = this.modal()?.nativeElement;
    if (el) $(el).modal('show');
  }

  closeModal() {
    const el = this.modal()?.nativeElement;
    if (el) $(el).modal('hide');
  }

  onSubmit() {
    const action = this.requestBuilderRef()?.onSubmit();
    if (!action) return;
    this.submit.emit(action);
    this.oncancel();
  }
  oncancel() {
    this.requestBuilderRef()?.onReset();
    this.closeModal();
    this.cancel.emit();
  }
}
