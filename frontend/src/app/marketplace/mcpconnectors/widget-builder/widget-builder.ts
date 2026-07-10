import {
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartType } from 'chart.js';
import {
  ChartWidgetConfig,
  SelectOption,
  TableWidgetConfig,
  WidgetConfig,
  WidgetType,
} from '../../../types/widget.types';
import { FormSection } from '../../../types/form.types';
import {
  FormOptions,
  FormSchemaService,
} from '../../../services/widget/form-schema.service';
import { getPaths, getValue, parseFieldsMeta } from '../../../utils';
import { WidgetCardComponent } from './widget-card';
import { NgxSpinnerService } from 'ngx-spinner';
import { DynamicFormComponent } from './dynamic-form';
import {
  IDataUseCase,
  ITrendUseCase,
  IUseCase,
  TUseCaseType,
} from '../../../types';
import { CHART_TYPES } from '../../../utils';
import { WidgetRenderer } from '../../../components/widgets/widget-renderer';
import { FormsModule } from '@angular/forms';
import {
  IHeading,
  EntityTable,
} from '../../../components/shared/entity-table/entity-table';

@Component({
  selector: 'widget-builder',
  standalone: true,
  imports: [
    CommonModule,
    DynamicFormComponent,
    WidgetCardComponent,
    WidgetRenderer,
    FormsModule,
    EntityTable,
  ],
  templateUrl: './widget-builder.html',
  styleUrl: './widget-builder.css',
})
export class WidgetBuilderComponent implements OnInit {
  private readonly formSchemaService = inject(FormSchemaService);
  private readonly loading = inject(NgxSpinnerService);

  readonly chartTypes = CHART_TYPES;

  valid = model<boolean>(false);
  cases = input.required<IUseCase[]>();
  isFormValid = model(false);
  useCaseTab = input<TUseCaseType>('insights');

  activeUseCase = signal('');
  useCaseConfig = model<Record<string, Partial<WidgetConfig>>>({});
  dynamicUseCases = computed(() =>
    this.cases().filter((item) => item.source === 'dynamic'),
  );

  dynamicData = signal<{ headings: IHeading[]; data: unknown[] }>({
    headings: [],
    data: [],
  });

  dataSource = computed<unknown>(() => {
    const activeCase = this.activeUseCase();

    const useCase =
      activeCase &&
      this.dynamicUseCases().find((item) => item.description === activeCase);

    if (!useCase) return;

    const caseJson = JSON.parse(useCase.json);
    const sampleJson =
      this.useCaseTab() === 'insights'
        ? (caseJson as IDataUseCase)?.formats?.[0]?.sample_json
        : (caseJson as ITrendUseCase)?.sample_response;

    return sampleJson;
  });

  formConfig = signal<Partial<WidgetConfig>>({});
  currentDatasetKey = computed(() => this.formConfig()?.dataset);
  currentDataset = computed(() => {
    const key = this.currentDatasetKey();
    const data = key ? getValue(this.dataSource(), key) : [];
    return data && Array.isArray(data) ? data : [];
  });
  datasetPaths = computed(() => {
    const data = this.dataSource();
    if (!data) return [];
    return getPaths(data, ['array'], 'object', 5);
  });

  currentFieldMetaData = computed(() => {
    const currentDataset = this.currentDataset();
    if (!currentDataset.length) return [];

    return parseFieldsMeta(currentDataset);
  });

  widgetType = computed(() => this.formConfig()?.type);
  clickActionDataPath = computed(() => {
    const config = this.formConfig() as ChartWidgetConfig;
    return config?.clickAction && config?.clickActionDataPath
      ? config.clickActionDataPath
      : '';
  });
  bodySource = computed(() => {
    const config = this.formConfig();
    return config.type === 'accordion' ? config.bodySource : '';
  });
  tag = computed(() => {
    const config = this.formConfig();
    return config.type === 'card' ? config.tag : '';
  });

  options = computed<FormOptions>(() => {
    const widgetType = this.widgetType();
    const currentDataset = this.currentDataset();
    const tag = this.tag();
    const bodySource = this.bodySource();
    const clickActionDataPath = this.clickActionDataPath();

    const obj: FormOptions = {
      dataset: [],
      widgetTypes: [],
      labelOptions: [],
      dataOptions: [],
      treemapLabelPosition: [],
      barChartOrientation: [],
      stringFields: [],
      arrayFields: [],
      variables: [],
      tagColorMapOptions: {},
      aggregationModeOptions: [
        { label: 'Total Value', value: 'total' },
        { label: 'Record count', value: 'count' },
      ],
      clickActionOptions: [],
      clickActionVariables: [],
    };

    obj.dataset = this.datasetPaths().map(this.getOption);
    obj.widgetTypes = (
      [...this.chartTypes, 'accordion', 'card', 'table'] satisfies WidgetType[]
    ).map(this.getOption);

    if (!widgetType) return obj;

    const currentFieldMetaData = this.currentFieldMetaData();

    if (this.chartTypes.includes(widgetType as ChartType)) {
      obj.clickActionOptions = currentFieldMetaData
        .filter((f) => f.type === 'array' && f.subType === 'object')
        .map((f) => this.getOption(f.key));

      if (clickActionDataPath)
        obj.clickActionVariables = parseFieldsMeta(
          getValue(currentDataset[0], clickActionDataPath) as unknown[],
        ).map((f) => f.key);
    }

    obj.labelOptions = currentFieldMetaData
      .filter((f) => f.type === 'string')
      .map((f) => this.getOption(f.key));

    obj.dataOptions = currentFieldMetaData
      .filter((f) => f.type === 'number')
      .map((f) => this.getOption(f.key));

    if (widgetType === 'treemap') {
      obj.treemapLabelPosition = [
        { label: 'Top', value: 'top' },
        { label: 'Middle', value: 'middle' },
        { label: 'Bottom', value: 'bottom' },
      ];
    }

    if (widgetType === 'bar') {
      obj.barChartOrientation = [
        { label: 'Horizontal', value: 'y' },
        { label: 'Vertical', value: 'x' },
      ];
    }

    if (widgetType === 'accordion') {
      obj.stringFields = currentFieldMetaData
        .filter((f) => !['array', 'object'].includes(f.type))
        .map((f) => this.getOption(f.key));

      obj.arrayFields = currentFieldMetaData
        .filter((f) => f.type === 'array')
        .map((f) => this.getOption(f.key));

      if (bodySource) {
        obj.variables = parseFieldsMeta(
          getValue(currentDataset[0], bodySource) as unknown[],
        ).map((f) => f.key);
      }
    }

    if (widgetType === 'card') {
      obj.variables = currentFieldMetaData.map((f) => f.key);

      obj.stringFields = currentFieldMetaData
        .filter((f) => !['array', 'object'].includes(f.type))
        .map((item) => this.getOption(item.key));

      if (tag) {
        currentDataset.forEach((item) => {
          obj.tagColorMapOptions[item[tag]] = '';
        });
      }
    }

    if (widgetType === 'table') {
      obj.variables = currentFieldMetaData.map((f) => f.key);
    }

    return obj;
  });

  formSchema = computed<FormSection[]>(() =>
    this.formSchemaService.buildSchema(this.chartTypes),
  );

  validatedConfig = computed<WidgetConfig | null>(() => {
    const config = this.formConfig();

    if (!this.validateConfig(config)) return null;

    return config as WidgetConfig;
  });

  private validateConfig(config?: Partial<WidgetConfig>) {
    if (!config?.dataset || !config?.type) {
      return false;
    }

    if (this.isChartType(config?.type)) {
      const chartConfig = config as ChartWidgetConfig;
      if (!chartConfig.labelKey || !chartConfig.dataKey) {
        return false;
      }
    }

    return true;
  }

  constructor() {
    effect(() => {
      this.valid.update(() => {
        if (!this.dynamicUseCases()?.length) return true;
        const activeUseCase = this.activeUseCase();
        const currentConfigValid = !!this.validatedConfig();
        const useCaseConfig = this.useCaseConfig();
        const allConfigValid = this.dynamicUseCases()
          .filter((item) => item.description !== activeUseCase)
          .every((c) => this.validateConfig(useCaseConfig[c.description]));
        const formValid = this.isFormValid();

        return currentConfigValid && allConfigValid && formValid;
      });
    });
  }

  ngOnInit(): void {
    this.loading.hide();

    if (!this.activeUseCase()) {
      const useCases = this.useCaseConfig();
      const useCase = Object.keys(useCases || {})?.[0];

      if (!useCase) return;

      this.activeUseCase.set(useCase);
      this.formConfig.set(
        useCases[useCase] || FormSchemaService.getValues(this.formSchema()),
      );
    }
  }

  isChartType(type: WidgetType): type is ChartType {
    return this.chartTypes.includes(type as ChartType);
  }

  private getOption(item: string): SelectOption {
    return { label: item, value: item };
  }

  getConfig(): WidgetConfig | null {
    return this.validatedConfig();
  }

  selectDynamicData({
    data,
    headers,
  }: {
    data: unknown[];
    headers: TableWidgetConfig['headers'];
    title: string;
  }) {
    this.dynamicData.set({
      data,
      headings: headers.map((item) => ({
        label: item.label,
        key: item.value,
        stringTemplate: true,
      })),
    });
  }

  onSelectUseCase(selected?: string) {
    const activeUseCase = this.activeUseCase();

    this.useCaseConfig.update((v) => {
      const newState = { ...v };
      if (activeUseCase) newState[activeUseCase] = this.formConfig();

      if (selected) {
        newState[selected] =
          v[selected] || FormSchemaService.getValues(this.formSchema());
      }

      return newState;
    });

    if (selected) {
      this.formConfig.set(this.useCaseConfig()[selected]);
      this.activeUseCase.set(selected);
    }
  }

  onSubmit() {
    this.onSelectUseCase();

    const val = this.useCaseConfig();
    const obj: Record<string, Partial<WidgetConfig>> = {};
    this.dynamicUseCases().forEach((item) => {
      if (val[item.description]) {
        obj[item.description] = val[item.description];
      }
    });

    if (!this.valid()) return obj;
    return obj;
  }
}
