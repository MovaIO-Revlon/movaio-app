import { Component, inject, model, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IIncident, TableWidgetConfig } from '../../../types';
import { Top10Issues } from './top-10-issues';
import { ImpactedApplications } from './impacted-applications';
import { ImpactedInfras } from './impacted-infras';
import { IncidentResolutions } from './incident-resolutions';
import { Causes } from './causes';
import { AiInference } from './ai-inferences';
import { UseCases } from './use-cases';
import { SmartInsights } from './smart-insights/smart-insights';
import { IncidentTableModal } from '../../../components/shared/incident-table-modal/incident-table-modal';
import { INSIGHT_STATIC_USE_CASES_KEY } from '../../../marketplace/mcpconnectors/constants';
import { FilterStore } from '../../trends/filter.store';
import { WidgetRenderer } from '../../../components/widgets/widget-renderer';
import {
  EntityTable,
  IHeading,
} from '../../../components/shared/entity-table/entity-table';

@Component({
  selector: 'incident-insights',
  imports: [
    CommonModule,
    FormsModule,
    Top10Issues,
    ImpactedApplications,
    ImpactedInfras,
    Causes,
    AiInference,
    UseCases,
    SmartInsights,
    IncidentTableModal,
    IncidentResolutions,
    WidgetRenderer,
    EntityTable,
  ],
  template: `
    @let activeUseCases = filterStore.activeUseCases();
    @let visualization = filterStore.visualization();

    @for (item of activeUseCases; track item) {
      @switch (item) {
        @case (useCases.TOP_10_ISSUES) {
          <top-10-issues
            (selectIssue)="
              selectIncidents([
                {
                  title: $event.issue_type,
                  data: $event.matching_incidents || [],
                },
              ])
            "
            style="grid-column: 1 / -1;"
          />
        }
        @case (useCases.TOP_10_APPLICATIONS) {
          <impacted-applications
            (selectApplication)="
              selectIncidents([
                {
                  title: $event.application,
                  data: $event.matching_incidents || [],
                },
              ])
            "
          />
        }
        @case (useCases.TOP_10_INFRASTRUCTURE_SYSTEMS) {
          <impacted-infras
            (selectInfra)="
              selectIncidents([
                {
                  title: $event.infra_system,
                  data: $event.matching_incidents || [],
                },
              ])
            "
          />
        }
        @case (useCases.TOP_10_RESOLUTION) {
          <incident-resolutions />
        }
        @case (useCases.TOP_10_ROOT_CASES) {
          <causes
            (selectCause)="
              selectIncidents([
                {
                  title: $event.root_cause,
                  data: $event.matching_incidents || [],
                },
              ])
            "
          />
        }
        @case (useCases.AI_INFERENCE) {
          <ai-inference />
        }
        @case (useCases.POTENTIAL_AUTOMATION) {
          <use-cases />
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

    <smart-insights
      [open]="isSmartInsightOpen()"
      (close)="isSmartInsightOpen.set(false)"
      description="Get AI-powered insights and solution recommendations for a specific incident."
    ></smart-insights>

    @let incidentData = selectedIncidentData();
    <incident-table-modal
      [data]="incidentData || []"
      [open]="!!incidentData"
      (close)="selectIncidents(null)"
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
export class IncidentInsight {
  filterStore = inject(FilterStore);
  isSmartInsightOpen = model(false);
  useCases = INSIGHT_STATIC_USE_CASES_KEY.incident;

  dynamicData = signal<{ headings: IHeading[]; data: unknown[] }>({
    headings: [],
    data: [],
  });

  selectedIncidentData = signal<{ title: string; data: IIncident[] }[] | null>(
    null,
  );

  selectIncidents(data: { title: string; data: IIncident[] }[] | null): void {
    this.selectedIncidentData.set(data);
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
