import { Component, inject, model, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IDefect, IIncident, TableWidgetConfig } from '../../../types';
import { TopDefects } from './top-defects';
import { AiInference } from '../incident-insights/ai-inferences';
import { DefectRootCauses } from './defect-root-causes';
import { DefectResolutions } from './defect-resolutions';
import { DefectTableModal } from '../../../components/shared/defect-table-modal/defect-table-modal';
import { FeatureImpacted } from './feature-impacted';
import { DefectUseCases } from './defect-use-cases';
import { DefectSmartInsights } from './smart-insights/defect-smart-insights';
import { FilterStore } from '../../trends/filter.store';
import { INSIGHT_STATIC_USE_CASES_KEY } from '../../../marketplace/mcpconnectors/constants';
import { WidgetRenderer } from '../../../components/widgets/widget-renderer';
import {
  IHeading,
  EntityTable,
} from '../../../components/shared/entity-table/entity-table';

@Component({
  selector: 'defect-insights',
  imports: [
    CommonModule,
    FormsModule,
    TopDefects,
    AiInference,
    DefectRootCauses,
    DefectResolutions,
    DefectTableModal,
    FeatureImpacted,
    DefectUseCases,
    DefectSmartInsights,
    WidgetRenderer,
    EntityTable,
  ],
  template: `
    @let activeUseCases = filterStore.activeUseCases();
    @let visualization = filterStore.visualization();

    @for (item of activeUseCases; track item) {
      @switch (item) {
        @case (useCases.TOP_10_DEFECT) {
          <top-defects
            (selectDefectTopArea)="
              selectDefects([
                {
                  title: $event.area,
                  data: $event.matching_defects || [],
                },
              ])
            "
          />
        }
        @case (useCases.TOP_10_FEATURES_EPICS_IMPACTED) {
          <feature-impacted
            (selectImpacted)="
              selectDefects([
                {
                  title: $event.feature_or_epic,
                  data: $event.matching_defects || [],
                },
              ])
            "
          />
        }
        @case (useCases.TOP_10_RESOLUTIONS) {
          <defect-resolutions />
        }
        @case (useCases.TOP_10_ROOT_CAUSES) {
          <defect-root-causes
            (selectCause)="
              selectDefects([
                {
                  title: $event.root_cause,
                  data: $event.matching_defects || [],
                },
              ])
            "
          />
        }
        @case (useCases.AI_INFERENCES) {
          <ai-inference />
        }
        @case (useCases.POTENTIAL_REGRESSION_SCENARIOS) {
          <defect-use-cases />
        }
        @default {
          @if (visualization[item]) {
            <widget-renderer
              [case]="item"
              [config]="visualization[item]"
              (select)="selectDynamicData($event)"
            />
          }
        }
      }
    }

    <defect-table-modal
      [data]="selectedDefectData() || []"
      [open]="!!selectedDefectData()"
      (close)="selectDefects(null)"
    />

    <defect-smart-insights
      [open]="isSmartInsightOpen()"
      (close)="isSmartInsightOpen.set(false)"
      description="Get AI-powered insights and solution recommendations for a specific defect."
    />

    @let dynamicWidgetData = dynamicData();
    <entity-table
      [open]="!!dynamicWidgetData.headings.length"
      [data]="dynamicWidgetData.data"
      [headings]="dynamicWidgetData.headings"
      (close)="dynamicData.set({ headings: [], data: [] })"
      [withCloseButton]="true"
    />
  `,
  styleUrl: '../insights.css',
})
export class DefectInsight {
  filterStore = inject(FilterStore);
  useCases = INSIGHT_STATIC_USE_CASES_KEY.defect;
  isSmartInsightOpen = model(false);

  selectedDefectData = signal<{ title: string; data: IIncident[] }[] | null>(
    null,
  );

  dynamicData = signal<{ headings: IHeading[]; data: unknown[] }>({
    headings: [],
    data: [],
  });

  selectDefects(data: { title: string; data: IDefect[] }[] | null): void {
    this.selectedDefectData.set(data);
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
}
