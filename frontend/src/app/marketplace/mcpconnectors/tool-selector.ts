import {
  Component,
  computed,
  effect,
  input,
  model,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { IFunctionJson, ITool, TConnectorType } from '../../types';
import { RequestBuilderModal } from '../../components/request-builder/request-builder-modal';
import { DndDropEvent, DndModule } from 'ngx-drag-drop';

type TConnectors = Extract<TConnectorType, 'OneDrive' | 'ServiceNow'>;

@Component({
  selector: 'tool-selector',
  imports: [CommonModule, ReactiveFormsModule, RequestBuilderModal, DndModule],
  host: {
    class: 'p-3 d-block ',
  },
  template: `
    @let toolList = state();

    <div class="border rounded-2 overflow-hidden">
      @if (toolList) {
        <table class="table table-borderless fs-14 table-striped">
          <thead>
            <tr>
              <th class="bg-light border-bottom position-sticky top-0 z-3"></th>

              <th
                class="bg-light border-bottom fs-14 position-sticky top-0 z-3"
              >
                Tools
              </th>
              <th
                class="bg-light border-bottom fs-14 position-sticky top-0 z-3"
              >
                Action
              </th>
              <th class="bg-light border-bottom position-sticky top-0 z-3"></th>
            </tr>
          </thead>
          <tbody dndDropzone (dndDrop)="onDrop($event)">
            <tr
              dndPlaceholderRef
              class="dndPlaceholder border border-warning"
              style="--bs-border-style: dashed"
            ></tr>

            @for (tool of toolList; track tool.name) {
              <tr [dndDraggable]="$index" dndEffectAllowed="move">
                <td class="text-center">
                  <div
                    type="button"
                    class="btn btn-sm text-muted bg-light-subtle"
                    dndHandle
                    style="cursor: grab;"
                    title="Drag To Reorder"
                  >
                    <i class="fa-solid fa-grip-vertical"></i>
                  </div>
                </td>

                <td class="position-relative text-uppercase">
                  {{ tool.name }}
                </td>
                <td>
                  <span>{{ tool.description }}</span>
                </td>
                <td>
                  <div class="d-flex align-items-center gap-2">
                    @if (tool.parameters) {
                      <button
                        type="button"
                        class="btn btn-sm bg-warning text-white mr-2"
                        (click)="removeAction(tool, $index)"
                        [disabled]="!privilegeEdit()"
                      >
                        <i class="fa-solid fa-trash"></i>
                      </button>

                      <button
                        type="button"
                        class="btn btn-sm bg-warning text-white"
                        (click)="editAction(tool)"
                        [disabled]="!privilegeEdit()"
                      >
                        <i class="fa-solid fa-pencil"></i>
                      </button>
                    }
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>

    <div class="pt-2">
      <button
        class="btn btn-sm bg-white text-muted border-0"
        type="button"
        (click)="openToolModal()"
        [disabled]="!privilegeEdit()"
      >
        <i class="fa-solid fa-circle-plus text-warning"></i> Add Tool
      </button>
    </div>

    <request-builder-modal
      #requestBuilderModal
      (submit)="addTool($event)"
      (cancel)="selectedState.set(null)"
      [data]="selectedState()"
      [excludeNames]="usedNames()"
    />
  `,
  styles: ``,
})
export class ToolSelector implements OnInit {
  requestBuilderModal = viewChild<RequestBuilderModal>('requestBuilderModal');

  connector = input<TConnectors>();
  tools = input<ITool[]>([]);
  data = input<IFunctionJson[]>([]);
  toolsOrder = input<string[]>([]);
  valid = model<boolean>(false);
  submit = output<IFunctionJson[]>();
  privilegeEdit = input(false);

  selectedState = signal<IFunctionJson | null>(null);

  state = signal<IFunctionJson[]>([]);
  usedNames = computed(() => {
    const selected = this.selectedState();
    const state = this.state();

    return (
      selected ? state.filter((item) => item.name !== selected.name) : state
    ).map((item) => item.name);
  });
  selectedTools = computed(() => {
    const connector = this.connector();

    return (
      this.tools().find((item) => item.tool_name === connector)?.tool_action ||
      []
    );
  });

  ngOnInit(): void {
    const selectedTools = this.selectedTools().reduce<Record<string, string>>(
      (a, b) => {
        a[b.action_name] = b.action_desc;
        return a;
      },
      {},
    );

    const customTools = this.data().reduce<Record<string, IFunctionJson>>(
      (a, b) => {
        a[b.name] = b;
        return a;
      },
      {},
    );

    const mapper = (name: string) => {
      const item: IFunctionJson = customTools[name] || {
        name,
        description: selectedTools[name] || '',
        active: true,
        groups: [],
        method: 'POST',
        paramsAdditional: false,
        path: '',
        protocol: 'rest',
        securityScheme: {
          accessTokenUrl: '',
          authorizeUrl: '',
          clientId: '',
          clientSecret: '',
          location: '',
          name: '',
          prefix: '',
          refreshTokenUrl: '',
          scope: '',
          type: '',
        },
        serverUrl: '',
        tags: '',
        visibility: 'public',
      };

      if (selectedTools[name]) delete selectedTools[name];

      return item;
    };

    this.state.set([
      ...this.toolsOrder().map((item) => mapper(item)),
      ...Object.keys(selectedTools).map(mapper),
    ]);
  }

  constructor() {
    effect(() => {
      this.valid.set(this.state().length > 0);
    });
  }

  onSubmit() {
    const val = this.state();
    if (!this.valid()) return val;
    this.submit.emit(val);
    return val;
  }

  openToolModal() {
    this.requestBuilderModal()?.openModal();
  }

  addTool(request: IFunctionJson) {
    if (request?.id)
      this.state.update((prev) =>
        prev.map((item) =>
          item.id === request.id
            ? { ...request, type: request.id ? 'custom' : 'local' }
            : item,
        ),
      );
    else this.state.update((prev) => [...prev, { ...request, type: 'local' }]);
  }

  removeAction(request: IFunctionJson, index: number) {
    if (request.type === 'local') {
      this.state.update((prev) => prev.filter((_, i) => i !== index));
      return;
    }
  }

  editAction(request: IFunctionJson) {
    this.selectedState.set(request);
    this.openToolModal();
  }

  onDrop(event: DndDropEvent) {
    const state = this.state();
    let fromIndex = event.data;
    let toIndex = event.index;

    if (typeof toIndex === undefined) {
      toIndex = state.length;
    }

    if (fromIndex === toIndex) return;

    const req = state.at(fromIndex);
    state.splice(fromIndex, 1);
    if (req)
      state.splice(
        Math.max(0, toIndex! - (fromIndex < toIndex! ? 1 : 0)),
        0,
        req,
      );

    this.state.set([...state]);
  }
}
