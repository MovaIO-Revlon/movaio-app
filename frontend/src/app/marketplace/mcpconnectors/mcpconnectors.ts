import {
  AfterViewInit,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  resource,
  signal,
  ViewChild,
} from '@angular/core';
import { PagerService } from '../../services/pagination.service';
import {
  IMCPUseCase,
  ISearchIndex,
  IUseCase,
  TConnectorType,
  WidgetConfig,
} from '../../types';
import { FormsModule } from '@angular/forms';
import { catchError, lastValueFrom, of } from 'rxjs';
import { SemarketplaceService } from '../../services/semarketplace.service';
import { ToastService } from '../../services/toast.service';
import { Toast } from '../../components/toast/toast';
import { McpFormModal, TStepperData } from './mcp-form-modal';
import { CommonModule } from '@angular/common';
import { TimeAgoPipe } from '../../timeago/time-ago-pipe';
import { ConnectorsChart } from './connectors-chart';
import {
  CONNECTOR_ICON_MAP,
  ENTITY_DEFAULT_FIELDS,
  INSIGHT_STATIC_USE_CASES,
  TRENDS_STATIC_USE_CASES,
} from './constants';
import { NgxSpinnerService } from 'ngx-spinner';
import { EntitiesChart } from './entities-chart';
import { IColumn } from './column-mapper';
import { ChangeDetectorRef } from '@angular/core';
import { AIInfuseStateService } from '../../services/aiinfuse-state.service';
import { TooltipDirective } from '../../custom-tooltip/tooltip.directive';

declare var $: any;

interface IMcpFilter {
  search?: string;
  connectorType?: TConnectorType;
  entityType?: string;
}
@Component({
  selector: 'app-mcpconnectors',
  standalone: true,
  imports: [
    FormsModule,
    Toast,
    McpFormModal,
    CommonModule,
    TimeAgoPipe,
    ConnectorsChart,
    EntitiesChart,
    TooltipDirective,
  ],
  providers: [PagerService, ToastService],
  templateUrl: './mcpconnectors.html',
  styleUrl: './mcpconnectors.css',
})
export class McpConnectors implements AfterViewInit {
  @ViewChild('deleteConfirmModal') deleteConfirmModal!: ElementRef;

  @ViewChild(McpFormModal) mcpModal!: McpFormModal;

  pager = inject(PagerService<ISearchIndex, IMcpFilter>);
  private readonly service = inject(SemarketplaceService);
  toast = inject(ToastService);
  private readonly loadingService = inject(NgxSpinnerService);

  readonly connectorIconsMap = CONNECTOR_ICON_MAP;
  selectedData?: ISearchIndex;
  loading = signal(false);
  sidebarOpen = signal(false);

  isPrivilegeView: boolean = false;
  isPrivilegeEdit: boolean = false;
  isPrivilegeDelete: boolean = false;
  isPrivilegeRefresh: boolean = false;
  isPrivilegeExecute: boolean = false;

  constructor(
    private _stateService: AIInfuseStateService,
    private cdr: ChangeDetectorRef,
  ) {
    this.pager.setConfig({
      filterMethod: this.filterData,
      filters: {
        search: '',
      },
      pageSizeOptions: [12, 24, 48, 100],
      defaultPageSize: 12,
    });

    effect(() => {
      const res = this.searchIndexQuery.value();
      if (res?.indexes) this.pager.setData(res.indexes.reverse());
    });
  }

  ngAfterViewInit(): void {
    this.loadingService.hide();
    this.loadPrivileges();
  }

  loadPrivileges() {
    this._stateService
      .getPrivilegesByPage('MCP Connector Management')
      .subscribe({
        next: (loaded_privileges: any) => {
          if (loaded_privileges) {
            this.isPrivilegeView = loaded_privileges?.view || false;
            this.isPrivilegeEdit =
              loaded_privileges?.['insert / edit'] ||
              loaded_privileges?.edit ||
              false;
            this.isPrivilegeDelete = loaded_privileges?.delete || false;
            this.isPrivilegeRefresh = loaded_privileges?.refresh || false;
            this.isPrivilegeExecute = loaded_privileges?.execute || false;
            this.cdr.detectChanges();
          }
        },
      });
  }

  searchIndexQuery = resource({
    loader: ({ abortSignal }) =>
      lastValueFrom(
        this.service
          .getMCPConnectorsDetails(abortSignal)
          .pipe(catchError(() => of(null))),
      ),
  });

  mcpStatisticsQuery = resource({
    loader: () =>
      lastValueFrom(
        this.service.getMCPStatistics().pipe(catchError(() => of(null))),
      ),
  });

  isSameDate(date1?: string, date2?: string) {
    return date1?.split('.')?.[0] === date2?.split('.')?.[0];
  }

  chartData = computed(() => {
    const stats = this.mcpStatisticsQuery.value();
    if (!stats?.data?.mcp_connector_count) return [];

    const connectorCounts = stats.data.mcp_connector_count;
    const indexes: {
      connector_type: TConnectorType;
      index_name: string;
      ingested_at: string;
      onboarded_agent: { agent_id: string; agent_name: string };
    }[] = [];

    // Create dummy objects based on connector counts for chart display
    for (const [connectorType, count] of Object.entries(connectorCounts)) {
      const normalizedType = connectorType.toLowerCase() as TConnectorType;
      for (let i = 0; i < count; i++) {
        indexes.push({
          connector_type: normalizedType,
          index_name: `${connectorType} ${i + 1}`,
          ingested_at: new Date().toISOString(),
          onboarded_agent: { agent_id: '', agent_name: '' },
        });
      }
    }

    return indexes;
  });

  entityTotalCount = computed(() => {
    const stats = this.mcpStatisticsQuery.value();
    return stats?.data?.mcp_count || 0;
  });

  entityData = computed((): Record<string, number> => {
    const stats = this.mcpStatisticsQuery.value();
    return stats?.data?.mcp_entity_count || {};
  });

  connectorCount = computed(() => {
    const stats = this.mcpStatisticsQuery.value();
    return stats?.data?.mcp_count || 0;
  });

  filteredCount = computed(() => {
    try {
      return this.pager.filteredData().length;
    } catch {
      return 0;
    }
  });

  toggleSidebar() {
    this.sidebarOpen.update((v) => !v);
  }

  private filterData(searchIndexes: ISearchIndex[], filters: IMcpFilter) {
    const searchString = filters.search?.toLowerCase();
    const connectorType = filters.connectorType;
    const entityType = filters.entityType;

    return searchIndexes.filter((item) => {
      if (connectorType && connectorType !== item.connector_type) return false;
      if (entityType && entityType !== item.entity_type) return false;

      if (
        searchString &&
        ![item.index_name, item.connector_type, item.entity_type].some((e) =>
          e.toLowerCase().includes(searchString),
        )
      )
        return false;

      return true;
    });
  }

  openDeleteConfirmModal(event: Event | null, searchIndex: ISearchIndex) {
    event?.stopPropagation();

    this.selectedData = searchIndex;

    const el = this.deleteConfirmModal.nativeElement;
    if (el) $(el).modal('show');

    this.mcpModal.closeModal(false);
  }

  confirmDelete(): void {
    if (!this.selectedData) return;

    this.loading.set(true);
    const { index_id, index_name } = this.selectedData;

    this.service.deleteMCPConnector({ index_id, index_name }).subscribe({
      next: (response) => {
        this.loading.set(false);
        if (response.status == 'success') {
          this.toast.showToast(
            'success',
            'MCP Connector deleted successfully.',
          );
          this.searchIndexQuery.reload();
        } else {
          this.toast.showToast('error', 'Failed to delete MCP Connector.');
        }
      },
      error: (err: any) => {
        this.loading.set(false);
        this.toast.showToast(
          'error',
          'Error occurred while deleting MCP Connector.',
        );
      },
    });
  }

  syncToOpenSearch(e: Event, { index_id, index_name }: ISearchIndex) {
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
            this.searchIndexQuery.reload();
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

  private getUseCases(
    useCaseNames: string[],
    usecases: IMCPUseCase[],
    defaultUseCases: Record<string, IUseCase>,
    visualization?: Record<string, WidgetConfig>,
  ) {
    const useCases: IUseCase[] = [];
    const staticCases = structuredClone(defaultUseCases);

    const dynamicUseCasesMapping = usecases.reduce<Record<string, IMCPUseCase>>(
      (acc, item) => {
        acc[item.usecase_name] = item;
        return acc;
      },
      {},
    );

    if (useCaseNames?.length) {
      useCaseNames.forEach((usecase_name) => {
        const item = dynamicUseCasesMapping[usecase_name];
        const staticItem = defaultUseCases[usecase_name];

        if (item) {
          useCases.push({
            id: item._id,
            description: item.usecase_name,
            json: item.raw_config,
            source: 'dynamic',
            persistence: 'remote',
            chartType: visualization?.[item.usecase_name]?.type,
          });
        } else if (staticItem) {
          delete staticCases[usecase_name];
          useCases.push({
            id: crypto.randomUUID(),
            description: staticItem.description,
            json: staticItem.json,
            source: 'static',
            persistence: 'local',
            chartType: visualization?.[usecase_name]?.type,
          });
        }
      });

      if (
        Object.keys(defaultUseCases).length === Object.keys(staticCases).length
      ) {
        useCases.unshift(...Object.values(staticCases));
      } else {
        useCases.push(...Object.values(staticCases));
      }
    }

    return useCases;
  }

  openOnboardModal(index?: ISearchIndex) {
    if (!index) {
      return this.mcpModal.openModal({
        isPrivilegeEdit: this.isPrivilegeEdit,
      });
    }

    this.loadingService.show();

    this.service.getMCPDataForIndex({ index_id: index.index_id }).subscribe({
      next: (res) => {
        const searchIndex = res.data;

        if (!searchIndex) return;

        const columns: IColumn[] = [];
        if (searchIndex?.column_mappings) {
          const defaultFields = ENTITY_DEFAULT_FIELDS[searchIndex.entity_type];

          columns.push(
            ...defaultFields.map((item) => ({
              key: item.key,
              value:
                searchIndex.column_mappings?.[item.key] || item.default || '',
            })),
          );
        }

        if (searchIndex?.dynamic_mappings) {
          Object.keys(searchIndex.dynamic_mappings).forEach((key) =>
            columns.push({
              key,
              value: searchIndex.dynamic_mappings?.[key] || '',
            }),
          );
        }

        const useCases: TStepperData['useCases'] = {
          insights: this.getUseCases(
            index.usecases as string[],
            searchIndex.usecases as IMCPUseCase[],
            INSIGHT_STATIC_USE_CASES[searchIndex.entity_type],
            searchIndex?.visualization,
          ),
          trends: this.getUseCases(
            index.trends_usecases as string[],
            searchIndex.trends_uc,
            TRENDS_STATIC_USE_CASES[searchIndex.entity_type],
            searchIndex?.trends_visualization,
          ),
        };

        this.loadingService.hide();

        return this.mcpModal.openModal(
          {
            connector_type: searchIndex.connector_type,
            index_name: searchIndex.index_name,
            entity_type: searchIndex.entity_type,
            onboarded_agent: searchIndex.onboarded_agent.agent_id,
            // excel
            sheet_name: searchIndex.sheet_name,
            // jira
            url: searchIndex.connector_url,
            api_token: searchIndex.jira_api_token,
            project_key: searchIndex.project_key,
            username: searchIndex.username,
            // fields
            columns,
            files:
              searchIndex.file_names?.map((name) => ({
                name,
                extension: name.split('.')?.pop() || '',
                file: '',
              })) || [],
            columnsList: [],
            fullSchema: searchIndex?.full_schema || [],
            useCases,
            visualization: {
              insights: searchIndex.visualization || {},
              trends: searchIndex.trends_visualization || {},
            },
            isPrivilegeEdit: this.isPrivilegeEdit,
          },
          searchIndex,
        );
      },
      error: () => {
        this.loadingService.hide();
      },
    });
  }
}
