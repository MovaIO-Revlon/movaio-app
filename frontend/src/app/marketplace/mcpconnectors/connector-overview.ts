import { Component, computed, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CONNECTOR_ICON_MAP } from './constants';
import { ISearchIndex } from '../../types';
import { NgxSpinnerService } from 'ngx-spinner';
import { SemarketplaceService } from '../../services/semarketplace.service';
import { ToastService } from '../../services/toast.service';
import { TimeAgoPipe } from '../../timeago/time-ago-pipe';
@Component({
  selector: 'connector-overview',
  imports: [CommonModule, FormsModule, TimeAgoPipe],
  providers: [],
  standalone: true,
  template: `
    @let details = overview();

    <div class="d-flex align-items-center gap-3 py-3 border-bottom">
      <span
        class="border rounded-3 entity-icon d-flex align-items-center justify-content-center"
      >
        <img [src]="details.icon" />
      </span>
      <div class="d-flex flex-column justify-content-center">
        <span class="fw-semibold text-capitalize">{{ details.name }}</span>
        <span class="text-capitalize text-muted fs-14">{{
          details.connectorType
        }}</span>
      </div>

      <div class="ms-auto d-flex flex-column align-items-end">
        <button
          class="btn bg-white text-muted btn-sm"
          type="button"
          (click)="onDelete.emit()"
        >
          <i class="fa-solid fa-trash"></i>
        </button>
        <span
          class="fs-12 d-flex align-items-center gap-1 px-2 rounded-1"
          [class]="
            details.isActive
              ? 'text-success bg-success-subtle border border-success'
              : 'text-danger bg-danger-subtle border border-danger'
          "
        >
          <span
            class="rounded-circle d-inline-block"
            style="width:0.4rem;height:0.4rem; background: currentColor"
          ></span>
          {{ details.isActive ? 'Active' : 'In-Active' }}</span
        >
      </div>
    </div>
    <div class="row py-3">
      <div class="col-6">
        <table class="table table-striped table-bordered overflow-hidden fs-12">
          <tbody>
            <tr>
              <th scope="row">Connector Type</th>
              <td>{{ details.connectorType }}</td>
            </tr>
            <tr>
              <th scope="row">Source Type</th>
              <td>{{ details.sourceType }}</td>
            </tr>
            <tr>
              <th scope="row">Entity Type</th>
              <td>{{ details.entity }}</td>
            </tr>
            <tr>
              <th scope="row">Assigned Agent</th>
              <td>{{ details.agent }}</td>
            </tr>
            <tr>
              <th scope="row">Created By</th>
              <td>{{ details.createdBy }}</td>
            </tr>
            <tr>
              <th scope="row">Created On</th>
              <td>{{ details.createdOn | date: 'dd/MM/yyyy' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="col-6">
        <button
          (click)="syncToOpenSearch($event)"
          class="btn btn-sm text-success rounded-2"
          style="
                background-color: #e5f3e7;
                color: #29b14b;
                min-width: 10rem;
              "
        >
          @if (details.lastSync) {
            Last sync: {{ details.lastSync | timeAgo }}
          } @else {
            Sync Now
          }
        </button>
        <i (click)="syncToOpenSearch($event)" class="fa-solid fa-rotate"></i>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .entity-icon {
      --size: 3.5rem;
      height: var(--size);
      width: var(--size);
    }

    .entity-icon img {
      width: 60%;
      height: 60%;
    }
  `,
})
export class ConnectorOverView {
  readonly connectorIconsMap = CONNECTOR_ICON_MAP;
  private readonly loadingService = inject(NgxSpinnerService);
  private readonly service = inject(SemarketplaceService);
  private readonly toast = inject(ToastService);

  data = input<ISearchIndex>();
  onDelete = output();

  overview = computed(() => {
    const data = this.data();
    const obj = {
      name: '',
      connectorType: '',
      icon: '',
      isActive: false,
      sourceType: '',
      entity: '',
      agent: '',
      createdBy: '',
      createdOn: '',
      lastSync: '',
    };

    if (!data) return obj;

    obj.name = data.index_name;
    obj.connectorType = data.connector_type;
    obj.icon = this.connectorIconsMap[data.connector_type];
    obj.isActive = data.status?.toLowerCase() === 'active';
    obj.sourceType =
      data.connector_type === 'excel'
        ? data?.file_names?.[0]
        : data.connector_type;
    obj.entity = data.entity_type;
    obj.agent = data.onboarded_agent.agent_name;
    obj.createdBy = data.username;
    obj.createdOn = data.ingested_at;
    obj.lastSync = data.last_synced_at;

    return obj;
  });

  syncToOpenSearch(e: Event) {
    const { index_id, index_name } = this.data() || {};

    e.stopPropagation();

    if (!index_id || !index_name) return;

    this.loadingService.show();

    this.service
      .syncMCPToOpenSearch({
        index_id,
        index_name,
      })
      .subscribe({
        next: (response) => {
          this.loadingService.hide();
          if (response.status === 'success') {
            this.toast.showToast(
              'success',
              'MCP Connector synced to OpenSearch successfully.',
            );
          } else {
            this.toast.showToast(
              'error',
              'Failed to sync MCP Connector to OpenSearch.',
            );
          }
        },
        error: () => {
          this.loadingService.hide();
          this.toast.showToast(
            'error',
            'Error occurred while syncing MCP Connector to OpenSearch.',
          );
        },
      });
  }
}
