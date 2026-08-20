import {
  AfterViewInit,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import { PagerService } from '../../services/pagination.service';
import {
  IConnection,
  IMCPUseCase,
  ISearchIndex,
  IUseCase,
  TConnectorType,
  WidgetConfig,
} from '../../types';
import { FormsModule } from '@angular/forms';
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
import { AIInfuseStateService } from '../../services/aiinfuse-state.service';
import { TooltipDirective } from '../../custom-tooltip/tooltip.directive';
import { rxResource } from '@angular/core/rxjs-interop';

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

  pager = inject(PagerService<ISearchIndex | IConnection, IMcpFilter>);
  private readonly service = inject(SemarketplaceService);
  toast = inject(ToastService);
  private readonly loadingService = inject(NgxSpinnerService);

  readonly connectorIconsMap = CONNECTOR_ICON_MAP;
  selectedData = signal<ISearchIndex | IConnection | null>(null);
  loading = signal(false);
  sidebarOpen = signal(false);
  activeTab = signal('mcp');

  constructor(private _stateService: AIInfuseStateService) {
    this.pager.setConfig({
      filterMethod: this.filterData.bind(this),
      filters: {
        search: '',
      },
      pageSizeOptions: [12, 24, 48, 100],
      defaultPageSize: 12,
    });

    effect(() => {
      const data = this.data();

      this.pager.setData(data);
    });
  }

  ngAfterViewInit(): void {
    this.loadingService.hide();
  }

  data = computed(() => {
    const tab = this.activeTab();
    const query = tab == 'mcp' ? this.searchIndexQuery : this.connectionQuery;

    if (query.error()) return [];

    const res = query.value();

    if (!res) return [];

    if (tab === 'mcp' && 'indexes' in res) {
      return res.indexes.reverse();
    }

    if (tab === 'tool' && 'data' in res) {
      return (
        this.connectionQuery
          .value()
          ?.data?.flatMap((item) =>
            item.connections.map((c) => ({
              ...c,
              connector_type: item.connector_type,
            })),
          ) || []
      );
    }

    return [];
  });

  excludeNames = computed(() => {
    const d = this.data();

    let list = d.map((item) =>
      '_id' in item ? item.index_name : item.connection_name,
    );

    const selectedData = this.selectedData();
    if (selectedData) {
      const key = (
        'connection_name' in d[0] ? 'connection_name' : 'index_name'
      ) as keyof typeof selectedData;

      const name = selectedData[key];

      list = list.filter((item) => item !== name);
    }

    return list;
  });

  privilege = computed(() => {
    const page =
      this.activeTab() === 'mcp'
        ? 'MCP Connector Management'
        : 'Tools Management';

    const defaultPrivilege = {
      view: false,
      add: false,
      edit: false,
      delete: false,
      refresh: false,
      execute: false,
    };

    this._stateService.getPrivilegesByPage(page).subscribe({
      next: (loaded_privileges: any) => {
        if (!loaded_privileges) return;

        defaultPrivilege.edit =
          loaded_privileges?.['insert / edit'] ||
          loaded_privileges?.edit ||
          loaded_privileges?.add ||
          defaultPrivilege.edit;
        defaultPrivilege.view =
          loaded_privileges?.view ||
          defaultPrivilege.edit ||
          defaultPrivilege.view;
        defaultPrivilege.add =
          loaded_privileges?.['add / create'] ||
          loaded_privileges?.add ||
          loaded_privileges.edit ||
          defaultPrivilege.add;
        defaultPrivilege.delete =
          loaded_privileges?.delete || defaultPrivilege.delete;
        defaultPrivilege.refresh =
          loaded_privileges?.refresh || defaultPrivilege.refresh;
        defaultPrivilege.execute =
          loaded_privileges?.execute || defaultPrivilege.execute;
      },
    });

    return defaultPrivilege;
  });

  searchIndexQuery = rxResource({
    stream: () => this.service.getMCPConnectorsDetails(),
  });

  connectionQuery = rxResource({
    stream: () => this.service.fetchConnection(),
  });

  mcpStatisticsQuery = rxResource({
    stream: () => this.service.getMCPStatistics(),
  });

  isSameDate(date1?: string, date2?: string) {
    return date1?.split('.')?.[0] === date2?.split('.')?.[0];
  }

  chartData = computed(() => {
    const stats = !this.mcpStatisticsQuery.error()
      ? this.mcpStatisticsQuery.value()
      : null;
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
    const stats = !this.mcpStatisticsQuery.error()
      ? this.mcpStatisticsQuery.value()
      : null;
    return stats?.data?.mcp_count || 0;
  });

  entityData = computed((): Record<string, number> => {
    const stats = !this.mcpStatisticsQuery.error()
      ? this.mcpStatisticsQuery.value()
      : null;
    return stats?.data?.mcp_entity_count || {};
  });

  connectorCount = computed(() => {
    const stats = !this.mcpStatisticsQuery.error()
      ? this.mcpStatisticsQuery.value()
      : null;
    return stats?.data?.mcp_count || 0;
  });

  filteredCount = computed(() => {
    try {
      return this.pager.filteredData().length;
    } catch {
      return 0;
    }
  });

  tabs = computed(() => {
    const toolsCount = (
      (!this.connectionQuery.error() && this.connectionQuery.value()?.data) ||
      []
    ).reduce((a, b) => a + b.connections.length, 0);
    return [
      {
        label: 'MCP Connectors',
        key: 'mcp',
        count:
          (!this.searchIndexQuery.error() &&
            this.searchIndexQuery.value()?.indexes?.length) ||
          0,
      },
      {
        label: 'Tools',
        key: 'tool',
        count: toolsCount,
      },
    ];
  });

  toggleSidebar() {
    this.sidebarOpen.update((v) => !v);
  }

  private filterData(
    data: ISearchIndex[] | IConnection[],
    filters: IMcpFilter,
  ) {
    const searchString = filters.search?.toLowerCase();
    const connectorType = filters.connectorType;
    const entityType = filters.entityType;

    if (this.activeTab() === 'tool') {
      return (data as IConnection[]).filter((item) => {
        if (
          searchString &&
          ![item.connection_name, item.user_id].some((e) =>
            e.toLowerCase().includes(searchString),
          )
        )
          return false;

        return true;
      });
    }

    return (data as ISearchIndex[]).filter((item) => {
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

  openDeleteConfirmModal(
    event: Event | null,
    entityData: ISearchIndex | IConnection,
  ) {
    event?.stopPropagation();

    this.selectedData.set(entityData);

    const el = this.deleteConfirmModal.nativeElement;
    if (el) $(el).modal('show');

    this.mcpModal.closeModal(false);
  }

  confirmDelete(): void {
    const selectedData = this.selectedData();
    if (!selectedData) return;

    this.loading.set(true);

    if ('connection_name' in selectedData) {
      this.service.removeConnector(selectedData.connection_id).subscribe({
        next: () => {
          this.loading.set(false);
          this.toast.showToast('success', 'Tool deleted successfully.');
          this.connectionQuery.reload();
        },
        error: () => {
          this.loading.set(false);
          this.toast.showToast('error', 'Error occurred while deleting Tool.');
        },
      });
      this.selectedData.set(null);
      return;
    }
    const { index_id, index_name } = selectedData;

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
    this.selectedData.set(null);
  }

  syncToOpenSearch(e: Event, { index_id, index_name }: ISearchIndex) {
    e.stopPropagation();

    if (!index_id || !index_name || !this.privilege()?.refresh) return;

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

  openOnboardModal(data?: ISearchIndex | IConnection) {
    const privilege = this.privilege();

    if (data && !(privilege.view || privilege.edit)) return;
    if (!data && !privilege.add) return;

    this.selectedData.set(data || null);

    if (!data) {
      return this.mcpModal.openModal({});
    }

    if (this.activeTab() !== 'mcp') {
      const connector = data as IConnection;
      this.loadingService.show();
      return this.service.getConnectionData(connector.connection_id).subscribe({
        next: (res) => {
          const connection = res.data[connector.connection_id];
          this.loadingService.hide();
          return this.mcpModal.openModal(
            {
              connector_type: connection.connector_type,
              category: 'agent',
              source: {
                name: connector.connection_name,
                ...connection.credentials,
              },
              customTools:
                connection?.active_tools
                  ?.filter((tool) => tool?.type && tool?.type === 'custom')
                  ?.map((tool) => ({
                    ...tool.parameter,
                    id: tool._id,
                    type: tool.type === 'custom' ? tool.type : 'static',
                  })) || [],
              toolsOrder: connection?.tools_order?.length
                ? connection.tools_order
                : connection?.active_tools.map(
                    (tool) => tool.tool_action_name,
                  ) || [],
            },
            connector,
          );
        },
        error: () => {
          this.loadingService.hide();
        },
      });
    }

    this.loadingService.show();

    const index = data as ISearchIndex;
    this.service.getMCPDataForIndex({ index_id: index.index_id }).subscribe({
      next: (res) => {
        const searchIndex = res.data;
        this.loadingService.hide();
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

        return this.mcpModal.openModal(
          {
            connector_type: searchIndex.connector_type,
            category: 'insight',
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
          },
          searchIndex,
        );
      },
      error: () => {
        this.loadingService.hide();
      },
    });
  }

  onClose(refetch?: boolean) {
    if (!refetch) return;
    if (this.activeTab() === 'mcp') return this.searchIndexQuery.reload();
    this.selectedData.set(null);
    return this.connectionQuery.reload();
  }
}
