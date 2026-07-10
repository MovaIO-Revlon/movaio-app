import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  signal,
  untracked,
  ViewChild,
} from '@angular/core';
import { NgxSpinnerService } from 'ngx-spinner';
import { Header } from '../header/header';
import { CommonModule, DatePipe, KeyValuePipe } from '@angular/common';
import { Chart } from 'chart.js';
import {
  TLog,
  LogType,
  TLogQueryResponse,
  IRequestLog,
  IResponseLog,
  IEventLog,
} from '../types/log.entities';
import { FormsModule } from '@angular/forms';
import { debounce, debounceWatch, generateRanges } from '../utils';
import { LogsService } from '../services/logs.service';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastService } from '../services/toast.service';
import { Toast } from '../components/toast/toast';
import { interval, Subject, takeUntil } from 'rxjs';
import { MultiSelect } from '../components/multi-select/multi-select';
import { utils, writeFile } from 'xlsx';
import { LyzrTraces } from '../lyzr-traces/lyzr-traces';
import { AIInfuseStateService } from '../services/aiinfuse-state.service';
import { DatePicker, IDateRange } from '../components/datepicker/datepicker';
import { TOption } from '../components/select/select';
import { Popover } from '../components/popover/popover';
import { environment as config } from '../../environments/environment';

// Update the IRequestDetails interface to include optional workflow properties
export interface IRequestDetails {
  duration: string;
  request: IRequestLog;
  response?: IResponseLog;
  events: IEventLog[];
  requestBodySize: string;
  responseBodySize: string;
  statusColor?: string;
  lyzrDetails?: {
    agentId: string;
    requestId: string;
    startDate: string;
    endDate: string;
    workflowId?: string; // Optional for workflow traces
    eventId?: string; // Optional for workflow traces
    agents?: any[];
    project?: string; // Optional for workflow traces
  };
}
interface InternalFilterState {
  source: string[];
  status: string[];
  project: string[];
  type: string[];
  user: string[];
  path: string[];
}

const initialFilterState: InternalFilterState = {
  source: [],
  status: [],
  project: [],
  type: [],
  user: [],
  path: [],
};

@Component({
  selector: 'app-logs',
  imports: [
    Header,
    KeyValuePipe,
    FormsModule,
    Toast,
    MultiSelect,
    CommonModule,
    LyzrTraces,
    DatePicker,
    MultiSelect,
    Popover,
  ],
  templateUrl: './logs.html',
  styleUrl: './logs.css',
})
export class Logs implements AfterViewInit, OnDestroy {
  @ViewChild('logTypes') logTypes!: ElementRef<HTMLCanvasElement>;

  loading = signal(false);
  refreshing = signal(false);
  downloadOpen = signal(false);

  private chartInstance?: Chart<'doughnut', number[], unknown> = undefined;
  private readonly destroy$ = new Subject<void>();
  private es?: AbortController;

  colorMapping: { [key in LogType]: string } = {
    INFO: '#6BB6B2',
    WARNING: '#F7BD59',
    ERROR: '#FF6060',
    DEBUG: '#8D8D8D',
  };

  statusCodeOptions: string[] = [];
  userListOptions: string[] = [];
  typeOptions = Object.keys(this.colorMapping);
  sourceOptions: string[] = [];
  pathOptions: string[] = [];
  dateRangeOptions: IDateRange[] = [];

  selectedRows: Record<string, boolean> = { selectAll: false };
  data: IRequestLog[] = [];
  filteredData: IRequestLog[] = [];
  paginatedData = signal<IRequestLog[]>([]);

  responsesIndex: Record<string, IResponseLog[] | undefined> = {};
  eventsIndex: Record<string, IEventLog[] | undefined> = {};

  pagination = signal({
    page: 1,
    pageSize: 20,
    totalRecords: 0,
    totalPages: 0,
    startIndex: 0,
    endIndex: 0,
  });
  pageSizeOptions = [10, 20, 30, 40, 50];

  searchTerm = signal('');
  filter = {
    ...initialFilterState,
  };
  dateRange = signal<Date[]>([]);

  logTypesCount: { [key in LogType]?: number } = {};
  selectedLog?: TLog = undefined;

  apiStatus = signal<TLogQueryResponse | null>(null);
  autoRefreshInterval = 5 * 60 * 1000; // 5 min
  updateQuery: () => void;

  requestDetails?: IRequestDetails;
  masterDatabase = config.masterDatabase;

  constructor(
    private readonly _loadingService: NgxSpinnerService,
    private readonly logsService: LogsService,
    private readonly router: Router,
    private readonly activatedRoute: ActivatedRoute,
    readonly toast: ToastService,
    private readonly state: AIInfuseStateService,
  ) {
    this.updateQuery = debounce(() => {
      if (this.activatedRoute.snapshot.routeConfig?.path !== 'logs') return;

      const query: Record<string, string> = {};

      if (this.searchTerm().trim()) query['search'] = this.searchTerm();

      const { project, source, status, type, user, path } = this.filter;
      if (project.length) query['project'] = project.join(',');
      if (source.length) query['source'] = source.join(',');
      if (status.length) query['status'] = project.join(',');
      if (type.length) query['type'] = type.join(',');
      if (user.length) query['user'] = user.join(',');
      if (path.length) query['path'] = path.join(',');

      const dateRange = this.dateRange();
      if (dateRange[0])
        query['fromDate'] = new DatePipe('en-US').transform(
          dateRange[0],
          'yyyy-MM-dd',
        )!;
      if (dateRange[1])
        query['toDate'] = new DatePipe('en-US').transform(
          dateRange[1],
          'yyyy-MM-dd',
        )!;

      const pagination = this.pagination();
      query['page'] = String(pagination.page);
      query['limit'] = String(pagination.pageSize);

      this.router
        .navigate([], {
          relativeTo: this.activatedRoute,
          queryParams: query,
          queryParamsHandling: 'replace',
          replaceUrl: true,
        })
        .then(() => {
          this._loadingService.hide();
        });
    }, 100);

    debounceWatch(this.searchTerm, () => {
      this.filterData();
      this.updateQuery();
    });

    const { today, last30, last7, lastMonth, thisMonth, yesterday } =
      generateRanges();

    this.dateRangeOptions = [
      { label: 'Today', range: [today.start, today.end] },
      { label: 'Yesterday', range: [yesterday.start, yesterday.end] },
      { label: 'Last 7 Days', range: [last7.start, last7.end] },
      {
        label: 'Last 30 Days',
        range: [last30.start, last30.end],
      },
      {
        label: 'This Month',
        range: [thisMonth.start, thisMonth.end],
      },
      {
        label: 'Last Month',
        range: [lastMonth.start, lastMonth.end],
      },
    ];

    this.dateRange.set(
      this.dateRangeOptions[0].range.map((item) => new Date(item)),
    );
  }

  ngAfterViewInit(): void {
    this._loadingService.hide();
    this.resetQuery();
    this.fetchLogs();
    this.startAutoRefresh();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.cache.clear();
  }

  get maxDate() {
    return new DatePipe('en-US').transform(new Date(), 'yyyy-MM-dd')!;
  }

  get isRowSelected() {
    return Object.values(this.selectedRows).some(Boolean);
  }

  get projectOptions(): TOption[] {
    const userManagementData = this.state.getUserManagementData();
    const userEmail = this.state.getLoginDetails()?.Email;

    const userData: any = userManagementData?.find(
      (item: any) => item.Email === userEmail,
    );
    let list = (userData?.PrjDetails as { prj_name: string }[])?.map(
      (item) => ({ label: item.prj_name, value: item.prj_name }),
    );
    if (!this.isSuperAdminMaster()) {
      const loggedUser = this.state.getLoginDetails();
      const activeProject = loggedUser?.ActiveProject.toString()
        .trim()
        .toLowerCase();
      list = [activeProject];
    }
    return list || [];
  }

  private startAutoRefresh() {
    interval(this.autoRefreshInterval)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.refreshLogs();
      });
  }

  private resetQuery() {
    const query = this.activatedRoute.snapshot.queryParams;
    Object.keys(query).forEach((key) => {
      if (key === 'page')
        this.pagination.update((v) => ({
          ...v,
          page: +query[key] || 1,
        }));
      else if (key === 'limit')
        this.pagination.update((v) => ({
          ...v,
          pageSize: +query[key] || 20,
        }));
      else if (key === 'search') {
        untracked(() => {
          this.searchTerm.set(query[key]);
        });
      } else if (key === 'fromDate' || key === 'toDate') {
        this.dateRange.update((v) => {
          const updated = [...v];

          if (query[key])
            updated[key === 'fromDate' ? 0 : 1] = new Date(query[key]);

          return updated;
        });
      } else {
        this.filter[key as keyof InternalFilterState] = query[key]
          .split(',')
          .filter(Boolean);
      }
    });
  }

  //  logs chart and count
  private updateLogTypeCounts() {
    const obj: { [key in LogType]?: number } = {};
    this.filteredData.forEach((a) => {
      const type =
        this.responsesIndex[a.request_id]?.[0]?.type ||
        this.eventsIndex[a.request_id]?.[0]?.type ||
        a.type;

      if (obj[type]) obj[type] += 1;
      else obj[type] = 1;
    });

    this.logTypesCount = obj;
  }

  private renderLogTypesChart(): void {
    const logTypesCount = Object.entries(this.logTypesCount) as [
      LogType,
      number,
    ][];

    const data = logTypesCount.map((item) => item[1]);
    const backgroundColor = logTypesCount.map(
      (item) => this.colorMapping[item[0]],
    );

    if (this.chartInstance === undefined) {
      const ctx = this.logTypes.nativeElement.getContext('2d');
      if (!ctx) return;

      this.chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          datasets: [
            {
              label: 'Log Types',
              data,
              backgroundColor,
              hoverOffset: 4,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: 60,
          radius: 85,
        },
      });
    } else {
      this.chartInstance.data.datasets[0].data = data;
      this.chartInstance.data.datasets[0].backgroundColor = backgroundColor;
      this.chartInstance.update();
    }
  }

  isSuperAdminMaster(): boolean {
    const loggedUser = this.state.getLoginDetails();
    const role = loggedUser?.Role?.toString().trim().toLowerCase();
    const activeProject = loggedUser?.ActiveProject.toString()
      .trim()
      .toLowerCase();
    return (
      role === 'super admin' &&
      activeProject === this.masterDatabase.trim().toLowerCase()
    );
  }

  //  filter and pagination
  paginate(): void {
    this.pagination.update((v) => {
      const updated = { ...v };

      updated.startIndex = (updated.page - 1) * updated.pageSize;
      updated.endIndex = Math.min(
        updated.startIndex + updated.pageSize,
        this.filteredData.length,
      );

      return updated;
    });

    const pagination = this.pagination();
    this.paginatedData.set(
      this.filteredData.slice(pagination.startIndex, pagination.endIndex),
    );
  }

  checkEventStatus(status: string[], log: IRequestLog) {
    const events = this.eventsIndex[log.request_id];

    if (!events?.length) return;

    return events.find((item) => status.some((s) => item?.status?.includes(s)));
  }

  private cache = new Map<string, { status: string; desc?: string }>();

  getStatus(log: IRequestLog) {
    const status = { status: '', desc: '' };

    if (!this.cache.has(log.request_id)) {
      const response = this.responsesIndex?.[log.request_id]?.[0];
      const errorEvent = this.eventsIndex[log.request_id]?.find((item) =>
        item?.status?.match(/\b[45]\d{2}\b/g),
      );

      if (errorEvent) {
        status.status = errorEvent.status || '';
        status.desc = errorEvent.desc;
      } else {
        status.status = response?.status || '';
        status.desc = response?.desc ?? '';
      }

      this.cache.set(log.request_id, status);
    }

    return this.cache.get(log.request_id);
  }

  filterData(): void {
    const text = this.searchTerm().toLowerCase();
    const searchText = text.toLowerCase();
    const { user, source, status, type, path } = this.filter;

    const filteredData = this.data.filter((log) => {
      if (user?.length && !user.includes(log.user)) return false;
      if (source?.length && !source.includes(log.source)) return false;
      if (path?.length && !path.includes(log.path)) return false;

      const response = this.responsesIndex?.[log.request_id]?.[0];
      const eventStatus = (this.eventsIndex?.[log.request_id]
        ?.filter((item) => !!(item.status && item.status !== 'None'))
        .map((item) => item.status) || []) as string[];
      if (response?.status) eventStatus.push(response.status);

      if (type?.length && !type.includes(this.getLogType(log))) return false;
      if (
        status?.length &&
        (!eventStatus.length || !eventStatus?.some((s) => status.includes(s)))
      ) {
        return false;
      }

      const searchableProperty = [
        log.type,
        log.timestamp,
        log.body,
        log.headers,
        log.project,
        log.query,
        log.user,
        log.path,
        log.method,
        log.project,
      ];

      if (response?.status) searchableProperty.push(response.status);
      if (response?.desc) searchableProperty.push(response.desc);

      if (searchText) {
        return (
          text === log.request_id ||
          searchableProperty.some((property) =>
            property.toLowerCase().includes(searchText),
          )
        );
      }

      return true;
    });

    this.filteredData = filteredData;
    this.pagination.update((v) => {
      const updated = { ...v };
      updated.totalRecords = filteredData.length;
      updated.totalPages =
        Math.ceil(updated.totalRecords / updated.pageSize) || 1;
      updated.page = 1;

      return updated;
    });

    this.updateLogTypeCounts();

    this.paginate();
  }

  prevPage() {
    if (this.pagination().page > 1) {
      this.pagination.update((v) => ({ ...v, page: v.page - 1 }));
      this.updateQuery();
      this.paginate();
    }
  }

  nextPage() {
    const pagination = this.pagination();
    if (pagination.page < pagination.totalPages) {
      this.pagination.update((v) => ({ ...v, page: v.page + 1 }));
      this.updateQuery();
      this.paginate();
    }
  }

  goToPage(page: number) {
    if (page >= 1 && page <= this.pagination().totalPages) {
      this.pagination.update((v) => ({ ...v, page }));
      this.updateQuery();
      this.paginate();
    }
  }

  // In the Logs component, update the getLyzrDetails method
  getLyzrDetails(
    { path, method, body, timestamp, request_id }: IRequestLog,
    response: IResponseLog,
  ) {
    const LYZR_APIS = ['chatbotagent', 'workflowRun', 'insights'];

    let lyzrDetails: IRequestDetails['lyzrDetails'];

    if (LYZR_APIS.some((api) => path.includes(api)) && method !== 'OPTIONS') {
      const agentMatch = /['"]agent_id['"]\s*:\s*['"]([^'"]+)['"]/.exec(body);
      const agentId = agentMatch ? agentMatch[1] : '';

      const startDate = new Date(timestamp);
      let endDate = new Date(response.timestamp);

      // Check if this is a workflowRun API call
      if (path.includes('workflowRun')) {
        // For workflowRun, we need to extract workflow_id and event_id from the response body
        const workflowMatch = /['"]workflow_id['"]\s*:\s*['"]([^'"]+)['"]/.exec(
          response.body,
        );
        const eventMatch = /['"]event_id['"]\s*:\s*['"]([^'"]+)['"]/.exec(
          response.body,
        );

        const workflowId = workflowMatch ? workflowMatch[1] : '';
        const eventId = eventMatch ? eventMatch[1] : '';

        if (workflowId && eventId) {
          // Extract agent details from events
          const events = this.eventsIndex[request_id] || [];
          const agents: any[] = [];

          // Create a map to track unique agents by agent_id
          const agentMap = new Map<
            string,
            { agent_id: string; agent_name: string; task_index: number }
          >();

          events.forEach((event) => {
            try {
              const eventData =
                typeof event.body === 'string'
                  ? JSON.parse(event.body)
                  : event.body;

              if (eventData && eventData.agent_id && eventData.agent_name) {
                // Only add the agent if we haven't seen it before
                if (!agentMap.has(eventData.agent_id)) {
                  agentMap.set(eventData.agent_id, {
                    agent_id: eventData.agent_id,
                    agent_name: eventData.agent_name,
                    task_index: eventData.task_index || 0,
                  });
                }
              }
            } catch (e) {
              console.error('Error parsing event data:', e);
            }
          });

          // Convert the map back to an array
          agents.push(...agentMap.values());

          // If we didn't find any agents in events, fall back to the agent_id from the request body
          if (agents.length === 0 && agentId) {
            agents.push({
              agent_id: agentId,
              agent_name: '', // We don't have the name in this case
              task_index: 0,
            });
          }

          lyzrDetails = {
            agentId,
            requestId: request_id,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            workflowId,
            eventId,
            agents,
            project: this.filter['project']?.[0] || '',
          };

          console.log('Extracted agents from events:', agents); // Debug log
        }
      } else if (path.includes('insights')) {
        // For insights API calls, extract agent_id and agent_name
        const events = this.eventsIndex[request_id] || [];
        const agents: any[] = [];

        // Create a map to track unique agents by agent_id
        const agentMap = new Map<
          string,
          { agent_id: string; agent_name: string; task_index: number }
        >();

        // First try to extract agent_name from response body
        let responseAgentName = '';
        try {
          const responseBody =
            typeof response?.body === 'string'
              ? JSON.parse(response.body)
              : response?.body;
          if (responseBody && responseBody.agent_name) {
            responseAgentName = responseBody.agent_name;
          }
        } catch (e) {
          // Silently continue if parsing fails
        }

        // Also try to extract from request body
        let requestAgentName = '';
        try {
          const requestBody =
            typeof body === 'string' ? JSON.parse(body) : body;
          if (requestBody && requestBody.agent_name) {
            requestAgentName = requestBody.agent_name;
          }
        } catch (e) {
          // Silently continue if parsing fails
        }

        events.forEach((event) => {
          try {
            const eventData =
              typeof event.body === 'string'
                ? JSON.parse(event.body)
                : event.body;

            if (eventData && eventData.agent_id) {
              // Use agent_name from event if available, otherwise use response or request name
              const agentName =
                eventData.agent_name || responseAgentName || requestAgentName;

              // Only add the agent if we haven't seen it before
              if (!agentMap.has(eventData.agent_id)) {
                agentMap.set(eventData.agent_id, {
                  agent_id: eventData.agent_id,
                  agent_name: agentName,
                  task_index: eventData.task_index || 0,
                });
              }
            }
          } catch (e) {
            console.error('Error parsing event data:', e);
          }
        });

        // Convert the map back to an array
        agents.push(...agentMap.values());

        // If we didn't find any agents in events, fall back to the agent_id from the request body
        if (agents.length === 0 && agentId) {
          agents.push({
            agent_id: agentId,
            agent_name: responseAgentName || requestAgentName, // Use the agent_name from response or request
            task_index: 0,
          });
        }

        // For insights API, pass the data as workflow-like structure for compatibility
        lyzrDetails = {
          agentId,
          requestId: request_id,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          workflowId: `insights_${request_id}`, // Generate a pseudo-workflow ID for insights
          eventId: request_id, // Use request_id as event_id for insights
          agents,
          project: this.filter['project']?.[0] || '',
        };

        console.log('Extracted insights trace details:', lyzrDetails); // Debug log
      } else {
        // For chatbotagent, use the original logic
        lyzrDetails = {
          agentId,
          requestId: request_id,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        };
      }
    }

    return lyzrDetails;
  }

  // Update the openViewLogModal method to handle workflow traces
  openViewLogModal(log: IRequestLog) {
    const { request_id, body, timestamp } = log;
    const response = this.responsesIndex[request_id]?.find(
      (item) => item.rtype === 'response',
    );

    const requestBodySize = this.getPayloadSize(body);
    let responseBodySize = '0KB';
    let duration = 0;
    let responseDetail!: IResponseLog;
    const events: IEventLog[] = (this.eventsIndex[request_id] || [])
      .map((item) => ({
        ...item,
        body: this.formatJSON(item.body || '{}'),
      }))
      .reverse();

    const errorEvent = events.find((item) =>
      item?.status?.match(/\b[45]\d{2}\b/g),
    );
    if (response && errorEvent) {
      response.desc = errorEvent.desc;
      response.status = errorEvent.status || '';
    }

    let statusColor = '';
    let lyzrDetails: IRequestDetails['lyzrDetails'];

    if (response) {
      statusColor = this.getStatusColor(+response.status);
      responseBodySize = this.getPayloadSize(response.body);
      duration =
        new Date(response.timestamp).getTime() - new Date(timestamp).getTime();
      responseDetail = {
        ...response,
        body: this.formatJSON(response.body),
        headers:
          response.rtype === 'response'
            ? this.formatJSON(response.headers)
            : '{}',
      };
      lyzrDetails = this.getLyzrDetails(log, response);
      if (lyzrDetails) {
        lyzrDetails.project = this.filter['project']?.[0] || '';
      }
    }

    const durationStr =
      duration > 1000 ? `${duration / 1000}s` : `${duration}ms`;

    this.requestDetails = {
      duration: durationStr,
      request: {
        ...log,
        body: this.formatJSON(log.body),
        headers: this.formatJSON(log.headers),
        query: this.formatJSON(log.query),
      },
      events,
      response: responseDetail,
      requestBodySize,
      responseBodySize,
      statusColor,
      lyzrDetails,
    };
  }

  closeViewLogModal(event?: MouseEvent | Event) {
    if (event) {
      const target = event?.target as HTMLDivElement;

      if (!target.classList.contains('request-viewer-wrapper')) return;
    }

    this.requestDetails = undefined;
    this.selectedLog = undefined;
  }

  clearFilters() {
    this.filter = { ...initialFilterState };
    this.dateRange.set(
      this.dateRangeOptions[0].range.map((item) => new Date(item)),
    );
    this.searchTerm.set('');
    this.updateQuery();
    this.fetchLogs();
  }

  refreshLogs(e?: MouseEvent) {
    this.refreshing.set(true);
    this.fetchLogs()
      .then(() => {
        if (e) this.toast.showToast('success', 'Refreshed');

        this.refreshing.set(false);
      })
      .catch(() => {
        this.refreshing.set(false);
      });
  }

  handleLogs(log: TLog) {
    const itemWithUtcDate: TLog = {
      ...log,
      timestamp: '',
    };

    try {
      itemWithUtcDate.timestamp = new Date(
        log.timestamp.replace(' ', 'T').replace(',', '.') +
          (log.timestamp.toLowerCase()?.endsWith('z') ? '' : 'Z'),
      ).toISOString();
    } catch {
      // INVALID LOG TIMESTAMP
    }

    if (itemWithUtcDate.rtype === 'request') {
      if (itemWithUtcDate.source === 'Subscription Management')
        itemWithUtcDate.source = 'AI Solution Management';
      this.data.push(itemWithUtcDate);

      if (!this.sourceOptions.includes(itemWithUtcDate.source))
        this.sourceOptions.push(itemWithUtcDate.source);

      if (!this.userListOptions.includes(itemWithUtcDate.user))
        this.userListOptions.push(itemWithUtcDate.user);

      if (!this.pathOptions.includes(itemWithUtcDate.path))
        this.pathOptions.push(itemWithUtcDate.path);
      return;
    }

    if (itemWithUtcDate.rtype === 'response') {
      if (!this.statusCodeOptions.includes(itemWithUtcDate.status))
        this.statusCodeOptions.push(itemWithUtcDate.status);

      if (!this.responsesIndex[log.request_id]) {
        this.responsesIndex[log.request_id] = [itemWithUtcDate];
        return;
      }

      this.responsesIndex[log.request_id]!.push(itemWithUtcDate);
    }

    if (itemWithUtcDate.rtype === 'event') {
      if (
        itemWithUtcDate.status &&
        itemWithUtcDate.status !== 'None' &&
        !this.statusCodeOptions.includes(itemWithUtcDate.status)
      )
        this.statusCodeOptions.push(itemWithUtcDate.status);

      if (!this.eventsIndex[log.request_id]) {
        this.eventsIndex[log.request_id] = [itemWithUtcDate];
        return;
      }
      this.eventsIndex[log.request_id]!.push(itemWithUtcDate);
    }
  }

  applyFilter() {
    this.updateQuery();
    this.fetchLogs();
  }

  sortData(logs: IRequestLog[]) {
    return logs.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  private fetchLogs() {
    return new Promise((resolve, reject) => {
      try {
        this.loading.set(true);
        const refresh = debounce(() => {
          this.loading.set(false);
          this.filterData();
          this.renderLogTypesChart();
        }, 50);

        this.es?.abort();
        this.es = undefined;
        const dateRange = this.dateRange();

        this.logsService
          .getLogs(
            {
              fromDate: new DatePipe('en-US').transform(
                dateRange[0],
                'yyyy-MM-dd',
              )!,
              toDate: new DatePipe('en-US').transform(
                dateRange[1],
                'yyyy-MM-dd',
              )!,
              project: this.filter.project?.filter(Boolean)?.join(','),
            },
            this as any,
          )
          .subscribe({
            next: (res) => {
              this.apiStatus.set(res || null);
              if (res.type === 'start') {
                this.data = [];
                this.responsesIndex = {};
                this.eventsIndex = {};
              } else if (res.type === 'logs') {
                res.data.forEach((item) => this.handleLogs(item));
                refresh();
              } else if (res.type === 'end') {
                this.data = this.sortData(this.data);
                refresh();
                this.apiStatus.set(null);
                resolve(true);
              }
            },
            error: (err) => {
              console.error('Error fetching logs:', err);
              this.loading.set(false);
              resolve(true);
            },
          });
      } catch (e) {
        reject(e);
      }
    });
  }

  resetRows(e: Event) {
    const target = e.target as HTMLInputElement;

    if (target.checked) this.selectedRows['selectAll'] = true;
    else this.selectedRows = { selectAll: false };
  }

  getLogType(log: IRequestLog) {
    return this.responsesIndex[log.request_id]?.[0]?.type || log.type;
  }

  getDownLoadData() {
    let data: TLog[] = [];

    if (!this.selectedRows['selectAll'] && this.isRowSelected) {
      data = this.data.filter((item) => this.selectedRows[item.request_id]);
    } else if (this.selectedRows['selectAll']) {
      data = [...this.data];
    }

    return data.map((item) => ({
      ...item,
      response: JSON.stringify(
        this.responsesIndex[item.request_id]?.[0] || {},
        null,
        2,
      ),
    }));
  }

  downloadJson() {
    const data = this.getDownLoadData();

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${new Date().toISOString()}.json`;
    a.click();

    URL.revokeObjectURL(url);
    this.downloadOpen.set(false);
  }

  downloadXlsx() {
    const data = this.getDownLoadData();

    const ws = utils.json_to_sheet(data);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, `Sheet1`);
    writeFile(wb, `logs-${new Date().toISOString()}.xlsx`);
    this.downloadOpen.set(false);
  }

  handleFilterChange(filterKey: keyof InternalFilterState, value: string[]) {
    this.filter[filterKey] = value;

    this.filterData();
    this.updateQuery();
  }

  // formatJSON(arg = '{}') {
  //   const str = JSON.stringify(JSON.parse(arg), null, 1).trim();

  //   return str;
  // }

  formatJSON(arg = '{}') {
    try {
      // Handle empty or invalid inputs
      if (!arg || (typeof arg === 'string' && arg.trim() === '')) {
        return '{}';
      }

      let parsed = arg;
      let attempts = 0;
      const maxAttempts = 5; // Increased to handle deeply nested escaping

      // First, if it's a string, try to unescape it
      if (typeof parsed === 'string') {
        // Check if it has escaped quotes and backslashes
        if (parsed.includes('\\\"') || parsed.includes('\\\\')) {
          // Unescape the string
          try {
            parsed = JSON.parse(`"${parsed}"`); // Parse as JSON string to unescape
          } catch {
            // If that fails, try manual unescaping
            parsed = parsed
              .replace(/\\"/g, '"')
              .replace(/\\\\/g, '\\')
              .replace(/\\n/g, '\n')
              .replace(/\\r/g, '\r')
              .replace(/\\t/g, '\t');
          }
        }
      }

      // Keep parsing until we get to the actual object or reach max attempts
      while (typeof parsed === 'string' && attempts < maxAttempts) {
        try {
          const nextParsed = JSON.parse(parsed);
          if (nextParsed === parsed) {
            // Parsing returned the same value, we're done
            break;
          }
          parsed = nextParsed;
          attempts++;
        } catch {
          // If parsing fails, we've reached the final string value
          break;
        }
      }

      // Now format the parsed data with proper indentation
      const formatted =
        typeof parsed === 'string'
          ? parsed
          : JSON.stringify(parsed, null, 2).trim();

      return formatted;
    } catch (error) {
      console.error('Invalid JSON:', error);
      // Return the original string if it's not valid JSON
      return typeof arg === 'string' ? arg : JSON.stringify(arg, null, 2);
    }
  }

  getPayloadSize(data: string) {
    const uintArray = new TextEncoder().encode(data);
    return `${(uintArray.length / 1024).toFixed(2)}KB`; // KB
  }

  getStatusColor(status: number): string {
    if (status >= 200 && status < 300) return '#2E7D32'; // 2xx success
    if (status >= 300 && status < 400) return '#0288D1'; // 3xx redirect
    if (status >= 400 && status < 500) return '#ED6C02'; // 4xx client error
    if (status >= 500) return '#D32F2F'; // 5xx server error
    return '#616161'; // 1xx / unknown
  }

  getUser(log: IRequestLog) {
    const user = log?.user?.split('@')?.[0];

    if (user && user !== '127.0.0.1') return user;

    return log?.ip || '---';
  }
}
