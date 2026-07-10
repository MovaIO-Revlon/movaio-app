import {
  computed,
  effect,
  Inject,
  inject,
  Injectable,
  InjectionToken,
  Signal,
  signal,
  untracked,
} from '@angular/core';
import { IAnalyticsQuery, ISearchIndex, TEntity } from '../../types';
import { TOption } from '../../components/select/select';
import { DatePipe } from '@angular/common';
import { AnalyticsService } from '../../services/analytics.service';
import { entityOptions, getValue, isSameDay } from '../../utils';
import {
  INSIGHT_STATIC_USE_CASES_KEY,
  STATIC_USE_CASE_LABEL_MAPPING,
  TRENDS_STATIC_USE_CASES_KEY,
} from '../../marketplace/mcpconnectors/constants';
import { rxResource } from '@angular/core/rxjs-interop';
import { TrackRequestService } from '../../services/track-request.service';
import { timeoutSignal } from '../../utils/timeout-signal.util';

export const PAGE_NAME = new InjectionToken<'insights' | 'trends'>('insights');

interface IFilters {
  entity: string;
  index: string;
  index_name: string;
  agent: string;
  insightHistory: boolean;
}

interface IAppliedFilters extends Omit<IFilters, 'insightHistory'> {
  range: Date[];
  history?: boolean;
  useCases: string[];
  run_id: string;
}

@Injectable()
export class FilterStore {
  private readonly service = inject(AnalyticsService);
  entityOptions = entityOptions;
  readonly tracker = inject(TrackRequestService);

  cache = signal<Record<string, unknown>>({ undefined });
  selectedUseCases = signal<string[]>([]);
  cacheEnabled = signal<boolean>(false);
  dateRange = signal<Date[]>([new Date(), new Date()]);

  tempFilters = signal<IFilters>({
    entity: '',
    index: '',
    index_name: '',
    agent: '',
    insightHistory: false,
  });

  appliedFilters = signal<IAppliedFilters>({
    range: [],
    entity: '',
    index: '',
    index_name: '',
    agent: '',
    useCases: [],
    run_id: crypto.randomUUID(),
  });

  apiLimitToast = timeoutSignal(false);

  searchIndexes = computed<ISearchIndex[]>(() =>
    this.searchIndexQuery.error()
      ? []
      : this.searchIndexQuery.value()?.indexes || [],
  );

  agentOptions = computed<TOption[]>(
    () =>
      this.searchIndexes().map((item) => ({
        label: item.onboarded_agent.agent_name,
        value: item.onboarded_agent.agent_id,
      })) || [],
  );

  indexOptions = computed<TOption[]>(() => {
    const res = this.searchIndexes();
    const selectedEntity = this.tempFilters().entity;

    if (!selectedEntity)
      return res.map((item) => ({
        label: item.index_name,
        value: item.index_id,
      }));

    return res
      .filter(
        (item) =>
          selectedEntity === item.entity_type.toLowerCase() &&
          item.last_synced_at,
      )
      .map((item) => ({
        label: item.index_name,
        value: item.index_id,
      }));
  });

  visualization = computed(() => {
    const indexes = this.searchIndexes();
    const selectedIndex = this.tempFilters().index;

    const index = indexes.find((item) => item.index_id === selectedIndex);
    if (!index?.visualization) return {};

    return (
      (this.page_name === 'insights'
        ? index.visualization
        : index.trends_visualization) || {}
    );
  });

  useCaseOptions = computed<TOption[]>(() => {
    const v = this.visualization();

    const selectedIndex = this.index();
    const entity = this.entity();
    const index = this.searchIndexes().find(
      (item) => item.index_id === selectedIndex,
    );
    const indexUseCases = ((this.page_name === 'insights'
      ? index?.usecases
      : index?.trends_usecases) || []) as string[];

    const staticCasesKey =
      this.page_name === 'insights'
        ? INSIGHT_STATIC_USE_CASES_KEY
        : TRENDS_STATIC_USE_CASES_KEY;

    const staticCases = entity
      ? Object.values(staticCasesKey[entity as TEntity] || {})
      : [];

    if (indexUseCases.length < staticCases.length) {
      return (
        [
          ...indexUseCases,
          ...staticCases.filter((item) => !indexUseCases.includes(item)),
        ] as string[]
      ).map((label) => ({
        label:
          STATIC_USE_CASE_LABEL_MAPPING[label] || v[label]?.chartTitle || label,
        value: label,
      }));
    }

    return (
      (
        (this.page_name === 'insights'
          ? index?.usecases
          : index?.trends_usecases) as string[]
      )?.map((label) => ({
        label:
          STATIC_USE_CASE_LABEL_MAPPING[label] || v[label]?.chartTitle || label,
        value: label,
      })) || []
    );
  });

  activeUseCases = computed(() =>
    this.cacheEnabled()
      ? this.selectedUseCases()
      : this.appliedFilters().useCases,
  );
  insightHistory = computed(() => this.tempFilters().insightHistory);
  entity = computed(() => this.tempFilters().entity);
  index = computed(() => this.tempFilters().index);
  indexName = computed(() => {
    const index = this.tempFilters()?.index;

    return (
      untracked(() => this.indexOptions()).find((item) => item.value === index)
        ?.label || ''
    );
  });

  history = computed(() => {
    const res = this.insightHistory()
      ? this.analyticsIndexHistoryQuery.value()
      : this.analyticsHistoryQuery.value();

    if (!res?.data || ('history' in res.data && res.data?.history === null))
      return;

    if (this.entity() !== res?.data?.entity) return;

    return res.data;
  });

  apiLimit = computed(() => {
    const obj = {
      msg: '',
      remaining: 0,
      max: 0,
    };

    if (this.apiRateLimitQuery.error()) return obj;

    if (this.apiRateLimitQuery.isLoading()) {
      obj.msg = 'Fetching details..';

      return obj;
    }
    const res = this.apiRateLimitQuery.value();
    if (!res || res.count === undefined || res.total_count === undefined)
      return obj;

    obj.remaining = Math.max(0, res.total_count - res.count);
    obj.max = res.total_count;

    return obj;
  });
  queryFilters = computed<IAnalyticsQuery | undefined>(() => {
    const { index, agent, entity, index_name, range, run_id } =
      this.appliedFilters();

    if (!range[0] || !range[1] || !agent || !index || !entity || !index_name)
      return undefined;

    return {
      start_date: new DatePipe('en-US').transform(range[0], 'yyyy-MM-dd')!,
      end_date: new DatePipe('en-US').transform(range[1], 'yyyy-MM-dd')!,
      index_name,
      index_id: index,
      agent_id: agent,
      entity,
      run_id,
      page_name: this.page_name,
    };
  });

  isFilterChanged = computed<boolean>(() => {
    const tempFilters = this.tempFilters();
    const range = this.dateRange();
    const appliedFilters = this.appliedFilters();
    const selectedUseCases = this.selectedUseCases();

    const checkUseCase = true; // this.page_name === 'insights';
    const hasBaseFields = !!(
      tempFilters.index &&
      tempFilters.entity &&
      tempFilters.agent &&
      range.length &&
      (checkUseCase ? selectedUseCases.length : true)
    );

    const hasBaseFieldChanged = !!(
      (tempFilters.agent !== appliedFilters.agent &&
        tempFilters.index !== appliedFilters.index) ||
      tempFilters.entity !== appliedFilters.entity ||
      !isSameDay(range[0], appliedFilters.range[0]) ||
      !isSameDay(range[1], appliedFilters.range[1])
    );

    if (!checkUseCase) return !!(hasBaseFields && hasBaseFieldChanged);

    return !!(
      hasBaseFields &&
      (hasBaseFieldChanged ||
        !this.equalUnordered(selectedUseCases, appliedFilters.useCases))
    );
  });

  isMissingFilters = computed<boolean>(() => {
    const filters = this.appliedFilters();
    return !filters.index || !filters.entity || !filters.agent;
  });

  hasTempFilter = computed<boolean>(() => {
    const filters = this.tempFilters();
    return !filters.index || !filters.entity || !filters.agent;
  });

  constructor(@Inject(PAGE_NAME) private page_name: 'insights' | 'trends') {
    effect(() => {
      const historyData = this.history();

      const indexOptions = untracked(() => this.indexOptions());
      const indexes = untracked(() => this.searchIndexes());

      const index = indexOptions.find(
        (item) => item.label === historyData?.index_name,
      );

      const agent =
        indexes?.find((item) => item.index_id === index?.value)?.onboarded_agent
          ?.agent_id || '';
      const range: Date[] = [];

      if (historyData?.start && historyData.end)
        range.push(new Date(historyData.start), new Date(historyData.end));

      if (historyData) {
        this.tempFilters.update((v) => ({
          ...v,
          agent,
          index: index?.value || '',
          index_name: index?.label || '',
          indexHistory: index?.label !== historyData.index_name,
        }));
        this.dateRange.set(range);
      }

      this.appliedFilters.update((v) => ({
        ...v,
        entity: historyData?.entity || v.entity,
        history: !!historyData,
        useCases: this.selectDefaultUseCases(
          historyData?.key?.agent_execution,
          historyData?.kpis,
          historyData?.key as unknown as Record<string, unknown>,
        ),
      }));
    });

    effect(() => {
      if (this.tracker.allDone()) {
        this.apiRateLimitQuery.reload();
      }
    });

    effect(() => {
      const limit = this.apiLimit();

      if (limit?.remaining !== undefined) {
        this.apiLimitToast.trigger(true, 5000);
      }
    });
  }

  selectDefaultUseCases(
    data?: Record<string, unknown>,
    kpis?: object,
    key?: Record<string, unknown>,
  ) {
    const entity = this.entity() as TEntity;
    let keys: string[] = [];

    if (entity) {
      const k =
        this.page_name === 'insights'
          ? INSIGHT_STATIC_USE_CASES_KEY
          : TRENDS_STATIC_USE_CASES_KEY;

      keys.push(...Object.values(k[entity]));

      if (
        (data && Object.keys(data)?.length) ||
        (kpis && Object.keys(kpis)?.length)
      ) {
        keys = untracked(() => this.useCaseOptions())
          .filter((item) => {
            if (this.page_name === 'insights') return !!data?.[item.value];

            const v =
              data?.[item.value] ??
              this.getTrendsUseCaseData(item.value, kpis) ??
              key?.[item.value];
            return v !== null && v !== undefined;
          })
          .map((item) => item.value);
      }
    }

    this.selectedUseCases.set(keys);
    return keys;
  }

  onIndexSelect(option: TOption) {
    if (option.value === this.index()) return;
    this.tempFilters.update((v) => ({
      ...v,
      index: option.value,
      index_name: option.label,
      agent:
        this.searchIndexQuery
          .value()
          ?.indexes?.find((item) => item.index_id === option.value)
          ?.onboarded_agent?.agent_id || '',
      insightHistory: this.history()?.index_name !== option?.label,
    }));

    this.appliedFilters.update((v) => ({
      ...v,
      agent: '',
      index: '',
      range: [],
      history: false,
      useCases: [],
    }));

    this.selectDefaultUseCases();
  }

  onEntitySelect(option: TOption) {
    if (option.value === this.entity()) return;

    this.tempFilters.update((v) => ({
      ...v,
      entity: option.value,
      agent: '',
      index: '',
      insightHistory: false,
    }));

    this.appliedFilters.set({
      agent: '',
      entity: '',
      index: '',
      index_name: '',
      range: [],
      history: false,
      useCases: [],
      run_id: crypto.randomUUID(),
    });

    this.selectDefaultUseCases();
  }

  applyFilters() {
    const temp = this.tempFilters();
    const range = this.dateRange();
    const useCases = this.selectedUseCases();
    this.appliedFilters.set({
      ...temp,
      range: [...range],
      history: false,
      useCases,
      run_id: crypto.randomUUID(),
    });
  }

  toggleSmartCache() {
    this.cacheEnabled.update((v) => !v);
  }

  selectUseCases(useCases: string[]) {
    this.selectedUseCases.set(
      this.useCaseOptions()
        .filter((item) => useCases.includes(item.value))
        .map((item) => item.value),
    );
  }

  getData<T>(data: unknown, path: string) {
    let d: unknown = undefined;

    if (this.cacheEnabled()) {
      const c = this.cache()[path];
      if (c) return c as T;
    }

    if (this.appliedFilters().history) d = this.history()?.key;

    if (!d) d = data;

    return getValue(d, path) as T;
  }

  createReFetchable(): {
    payload: Signal<IAnalyticsQuery | undefined>;
    refetch(): void;
  } {
    const version = signal(0);
    let autoTrigger = !this.cacheEnabled();

    const payload = computed(() => {
      const v = version();
      let query = this.queryFilters();

      if (!autoTrigger) {
        autoTrigger = true;
        return undefined;
      }

      untracked(() => {
        if (this.cacheEnabled()) {
          const { index, agent, entity, index_name } = this.tempFilters();
          const range = this.dateRange();

          if (
            !range[0] ||
            !range[1] ||
            !agent ||
            !index ||
            !entity ||
            !index_name
          )
            return undefined;

          query = {
            start_date: new DatePipe('en-US').transform(
              range[0],
              'yyyy-MM-dd',
            )!,
            end_date: new DatePipe('en-US').transform(range[1], 'yyyy-MM-dd')!,
            index_name,
            index_id: index,
            agent_id: agent,
            entity,
            run_id: this.history()?.run_id || crypto.randomUUID(),
            page_name: this.page_name,
            refetch: true,
          };
        }
      });

      return (
        query && {
          ...query,
          v,
        }
      );
    });

    return {
      payload,
      refetch: () => version.update((v) => v + 1),
    };
  }

  private equalUnordered(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;

    const map = new Map<string, number>();

    for (const v of a) {
      map.set(v, (map.get(v) || 0) + 1);
    }

    for (const v of b) {
      const count = map.get(v);
      if (!count) return false;
      if (count === 1) map.delete(v);
      else map.set(v, count - 1);
    }

    return map.size === 0;
  }

  searchIndexQuery = rxResource({
    stream: () => this.service.fetchSearchIndexes(),
  });

  analyticsHistoryQuery = rxResource({
    params: () => {
      const entity = this.entity();

      if (!entity) return;

      return {
        entity,
        page_name: this.page_name,
      };
    },
    stream: ({ params }) => this.service.fetchInsightHistory(params),
  });

  analyticsIndexHistoryQuery = rxResource({
    params: () => {
      const entity = this.entity();
      const index = this.indexName();
      const insightHistory = this.insightHistory();

      if (!entity || !index || !insightHistory) return;

      return {
        entity,
        page_name: this.page_name,
        index: index,
      };
    },
    stream: ({ params, abortSignal }) =>
      this.service.fetchInsightIndexHistory(params, abortSignal),
  });

  apiRateLimitQuery = rxResource({
    stream: () => this.service.apiRateLimit(),
  });

  getTrendsUseCaseData(useCase: string, data?: unknown) {
    const t = TRENDS_STATIC_USE_CASES_KEY;
    const trendsDataPathMap: Record<string, string> = {
      //incident
      [t.incident.AVERAGE_MTTR]: 'kpis.avg_mttr',
      [t.incident.AVERAGE_INCIDENT]: 'kpis.avg_incidents_per_day',
      [t.incident.SLA_COMPLIANCE]: 'kpis.sla_compliance_pct',
      [t.incident.RECURRING_ISSUE]: 'kpis.recurring_issue_pct',
      [t.incident.SIMILAR_INCIDENT]: 'kpis.similar_incidents',
      [t.incident.INCIDENT_ANALYTICS]: 'analytics',
      [t.incident.TRENDS_ANALYTICS]: 'trends',
      // defect
      [t.defect.AVERAGE_DEFECT]: 'kpis.avg_defects_per_day',
      [t.defect.SIMILAR_DEFECTS]: 'kpis.similar_defects',
      [t.defect.DEFECT_ANALYTICS]: 'analytics',
      [t.defect.DEFECT_AGE]: 'defect_age',
      // testcase
      [t.testcase.AVERAGE_TESTCASE]: 'kpis.avg_testcase_per_day',
      [t.testcase.SIMILAR_TESTCASE]: 'kpis.avg_testcase_per_day',
      [t.testcase.TESTCASE_ANALYTICS]: 'analytics',
    };

    return trendsDataPathMap[useCase]
      ? getValue(data, trendsDataPathMap[useCase])
      : null;
  }
}
