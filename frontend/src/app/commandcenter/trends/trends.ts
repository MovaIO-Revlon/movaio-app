import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DatePicker } from '../../components/datepicker/datepicker';
import { Select } from '../../components/select/select';
import { CardLoader } from '../../components/shared/card-loader';
import { FilterStore, PAGE_NAME } from './filter.store';
import { IncidentTrends } from './incident-trends/incident-trends';
import { DefectTrends } from './defect-trends/defect-trends';
import { TestcaseTrends } from './testcase-trends/testcase-trends';
import { AIInfuseStateService } from '../../services/aiinfuse-state.service';
import { MultiSelect } from '../../components/multi-select/multi-select';
import { TooltipDirective } from '../../custom-tooltip/tooltip.directive';

@Component({
  selector: 'trends',
  imports: [
    CommonModule,
    FormsModule,
    DatePicker,
    Select,
    CardLoader,
    IncidentTrends,
    DefectTrends,
    TestcaseTrends,
    MultiSelect,
    TooltipDirective,
  ],
  templateUrl: './trends.html',
  styleUrl: './trends.css',
  providers: [{ provide: PAGE_NAME, useValue: 'trends' }, FilterStore],
  host: {
    class: 'insights-root',
  },
})
export class Trends {
  isPrivilegeView: boolean = false;
  isPrivilegeEdit: boolean = false;
  isPrivilegeDelete: boolean = false;
  isPrivilegeRefresh: boolean = false;
  isPrivilegeExecute: boolean = false;

  constructor(
    readonly filterStore: FilterStore,
    private _stateService: AIInfuseStateService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit() {
    this.loadPrivileges();
  }

  loadPrivileges() {
    this._stateService.getPrivilegesByPage('Insights').subscribe({
      next: (loaded_privileges: any) => {
        console.log(
          'Loaded privileges for Chatbot by page: ',
          loaded_privileges,
        );
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
}
