import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatePicker } from '../../components/datepicker/datepicker';
import { Select } from '../../components/select/select';
import { CardLoader } from '../../components/shared/card-loader';
import { FilterStore, PAGE_NAME } from '../trends/filter.store';
import { IncidentInsight } from './incident-insights/incident-insight';
import { DefectInsight } from './defect-insights/defect-insight';
import { TestCaseInsights } from './testcase-insights/testcase-insight';
import { MultiSelect } from '../../components/multi-select/multi-select';
import { AIInfuseStateService } from '../../services/aiinfuse-state.service';
import { TooltipDirective } from '../../custom-tooltip/tooltip.directive';

@Component({
  selector: 'app-insights',
  imports: [
    CommonModule,
    FormsModule,
    DatePicker,
    Select,
    CardLoader,
    IncidentInsight,
    DefectInsight,
    TestCaseInsights,
    MultiSelect,
    TooltipDirective,
  ],
  templateUrl: './insights.html',
  styleUrl: './insights.css',
  providers: [{ provide: PAGE_NAME, useValue: 'insights' }, FilterStore],
  host: {
    class: 'insights-root',
  },
})
export class Insights {
  isSmartInsightOpen = signal(false);
  privilege = signal<{
    view: boolean;
    edit: boolean;
    delete: boolean;
    refresh: boolean;
    execute: boolean;
  }>({
    view: false,
    edit: false,
    delete: false,
    refresh: false,
    execute: false,
  });

  readonly filterStore = inject(FilterStore);
  readonly stateService = inject(AIInfuseStateService);

  ngOnInit() {
    this.loadPrivileges();
  }

  loadPrivileges() {
    this.stateService.getPrivilegesByPage('Insights').subscribe({
      next: (loaded_privileges: any) => {
        if (loaded_privileges) {
          this.privilege.set({
            view: loaded_privileges?.view || false,
            edit:
              loaded_privileges?.['insert / edit'] ||
              loaded_privileges?.edit ||
              false,
            delete: loaded_privileges?.delete || false,
            refresh: loaded_privileges?.refresh || false,
            execute: loaded_privileges?.execute || false,
          });
        }
      },
    });
  }

  toggleSmartInsight(open?: boolean) {
    this.isSmartInsightOpen.update((v) => (open !== undefined ? open : !v));
  }

  getSteps(count: number) {
    return new Array(count);
  }
}
