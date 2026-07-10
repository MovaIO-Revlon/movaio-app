import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  Inject,
  inject,
  OnInit,
  signal,
  ViewChild,
  WritableSignal,
} from '@angular/core';
import { Header } from '../header/header';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { NgxSpinnerService } from 'ngx-spinner';
import { DatePipe } from '@angular/common';
import { debounceWatch, getApiError } from '../utils';
import { IRole, ITeam, IUpdateRoleRequest, IUpdateTeamRequest } from '../types';
import { FormError } from '../components/form-error/form-error';
import { PluginsService } from '../services/plugins.service';
import { AIInfuseStateService } from '../services/aiinfuse-state.service';
import { ToastService } from '../services/toast.service';
import { Toast } from '../components/toast/toast';
import { MultiSelect } from "../components/multi-select/multi-select";
import { TOption } from '../components/select/select';
import { SemarketplaceService } from '../services/semarketplace.service';

declare var bootstrap: any;
interface PaginatedState<T> {
  searchTerm: WritableSignal<string>;
  data: T[];
  paginatedData: T[];
  filteredData: T[];
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
}

type TABS = 'plugins' | 'teams';

const initialState = {
  searchTerm: '',
  data: [],
  paginatedData: [],
  filteredData: [],
  page: 1,
  pageSize: 10,
  totalRecords: 0,
  totalPages: 0,
  startIndex: 0,
  endIndex: 0,
};

@Component({
  selector: 'app-plugins',
  imports: [
    Header,
    FormsModule,
    DatePipe,
    ReactiveFormsModule,
    FormError,
    Toast,
    MultiSelect
],
  templateUrl: './plugins.html',
  styleUrl: './plugins.css'
})
export class Plugins {
  
  private loadingService = inject(NgxSpinnerService);
  private pluginsService = inject(PluginsService);
  private state = inject(AIInfuseStateService);
  private cdr = inject(ChangeDetectorRef);
  private formBuilder = inject(FormBuilder);
  private _marketService = inject(SemarketplaceService);

  toast = inject(ToastService);

  plugins: PaginatedState<any> = {
    ...initialState,
    searchTerm: signal(''),
  };

  teams: PaginatedState<ITeam> = {
    ...initialState,
    searchTerm: signal(''),
  };
  pageSizeOptions = [10, 20, 30, 40, 50];

  pluginForm!: FormGroup;
  selectedPlugin?: any = undefined;

  agencyList: TOption[] = [];
  allAgencyList: any = [];

  selectedAgents = [];

  constructor() {
    debounceWatch(this.plugins.searchTerm, () => {
      this.filterData('plugins');
    });
  }

  private validateDuplicatePlugin(
    control: AbstractControl,
  ): ValidationErrors | null {
    if (!control.value) return null;

    if (
      this.selectedPlugin &&
      this.selectedPlugin.PluginName.toLowerCase() === control.value.toLowerCase()
    )
      return null;

    const item = this.plugins.data.find(
      (item) => item.PluginName.toLowerCase() === control.value.toLowerCase(),
    );
    console.log('item', item);
    return item ? { duplicate: true } : null;
  }


  ngOnInit(): void {
    this.fetchPlugins();
    this.fetchAgentsList();
    this.pluginForm = this.formBuilder.group({
      pluginName: this.formBuilder.control('', {
        nonNullable: true,
        validators: [
          Validators.required,
          this.validateDuplicatePlugin.bind(this),
        ],
      }),
      agencyList: this.formBuilder.control([], {
        nonNullable: true,
        validators: [Validators.required],
      }),
      agentsList: this.formBuilder.control([], {
        nonNullable: true,
        validators: [Validators.required],
      }),
    });
  }


  //  filter and pagination
  paginate(key: TABS): void {
    this[key].startIndex = (this[key].page - 1) * this[key].pageSize;
    this[key].endIndex = Math.min(
      +this[key].startIndex + +this[key].pageSize,
      this[key].filteredData.length,
    );
    this[key].paginatedData = this[key].filteredData.slice(
      this[key].startIndex,
      this[key].endIndex,
    );
    this.cdr.detectChanges();
  }

  filterData(key: TABS): void {
    if (!this[key].searchTerm()) {
      this[key].filteredData = [...this[key].data];
    } else {
      this[key].page = 1;
      this[key].filteredData = this[key].data.filter((item) => {
      return item.PluginName.toLowerCase().includes(
        this[key].searchTerm().toLowerCase(),
      );
      })
    }

    this[key].totalRecords = this[key].filteredData.length;
    this[key].totalPages =
      Math.ceil(this[key].totalRecords / this[key].pageSize) || 1;
    this[key].page = 1;
    this.paginate(key);
  }

  prevPage(key: TABS) {
    if (this[key].page > 1) {
      this[key].page--;
      this.paginate(key);
    }
  }

  nextPage(key: TABS) {
    if (this[key].page < this[key].totalPages) {
      this[key].page++;
      this.paginate(key);
    }
  }

  goToPage(page: number, key: TABS) {
    if (page >= 1 && page <= this[key].totalPages) {
      this[key].page = page;
      this.paginate(key);
    }
  }

  get agentsList(): TOption[] {
    let agents: TOption[] = [];
    this.agencyList.forEach(agency => {
      if(this.pluginForm.get('agencyList')?.value.includes(agency.value)){
        const agencyDetails = this.allAgencyList.find((a:any) => a.agency_id === agency.value)?.agents || [];
        agencyDetails.forEach((agent: any) => {
          agents.push({ label: agent.name, value: agent.agent_id });
        });
      }
    });
    return agents? agents : [];
  }

  fetchPlugins(): void {
    this.loadingService.show();

    this.pluginsService.fetchAllPlugins().subscribe({
      next: (response) => {
        if (response?.success) {
          this.plugins.data = response?.data || [];
          console.log(this.plugins);
          this.loadingService.hide();
          this.filterData('plugins');
          this.cdr.detectChanges();
        } 
        else {
          this.plugins.data = [];
          this.loadingService.hide();
          this.toast.showToast('error', response?.message || 'Something went wrong');
        }
      },
      error: (error) => {
        console.error('Error loading teams and plugins:', error);
        this.loadingService.hide();
        this.plugins.data = [];
      },
    });
  }

  fetchAgentsList(): void {
    this.loadingService.show();

    this._marketService.getAgencyWithAgents().subscribe({
      next: (response:any) => {
        if (response?.success) {
          this.agencyList = response?.data?.map((agent: any) => ({
            label: agent.agency_name,
            value: agent.agency_id
          })) || [];
          this.allAgencyList = response?.data || [];
          this.loadingService.hide();
        }
          else {  
            this.agencyList = [];
            this.toast.showToast('error', response?.message || 'Something went wrong');
          }
      },
      error: (error) => {
        console.error('Error loading agents list:', error);
      }
    });

    // this._marketService.getAgentDetails().subscribe({
    //   next: (response:any) => {
    //     if (response?.success) {
    //       this.agentsList = response?.data?.map((agent: any) => ({
    //         label: agent.name,
    //         value: agent._id
    //       })) || [];
    //     }
    //       else {  
    //         this.agentsList = [];
    //         this.toast.showToast('error', response?.message || 'Something went wrong');
    //       }
    //   },
    //   error: (error) => {
    //     console.error('Error loading agents list:', error);
    //   }
    // });
  }


  // plugins
  closePluginForm() {
    this.pluginForm.reset({ pluginName: '', agentsList: [], agencyList: [] });
    this.selectedPlugin = undefined;
    this.pluginForm.get('pluginName')?.enable();

    const modalEl = document.getElementById('pluginsModal');
      if (!modalEl) return;

      const modal = bootstrap.Modal.getInstance(modalEl) ?? new bootstrap.Modal(modalEl);
      modal.hide();
  }

  editPlugin(plugin: any) {
    console.log(plugin);
    this.selectedPlugin = plugin;
    this.pluginForm.patchValue({ pluginName: plugin.PluginName});
    plugin.AgencyList?.forEach((agency: any) => {
      this.pluginForm.get('agencyList')?.value.push(agency.agency_id);
      agency.agents.forEach((agent: any) => {
        this.pluginForm.get('agentsList')?.value.push(agent.agent_id);
      });
    });

    this.pluginForm.get('pluginName')?.disable();

    const instance = new bootstrap.Modal(
      document.getElementById('pluginsModal'),
    );
    instance.show();
  }

  deletePlugin(plugin: any) {
    this.loadingService.show();
    this.pluginsService.deletePlugin(plugin._id.$oid).subscribe({
      next: (response) => {
        if (response?.success) {
          this.toast.showToast('success', 'Plugin deleted successfully');
          this.fetchPlugins();
        } else {
          this.toast.showToast('error', response?.message || 'Something went wrong');
        }
        this.loadingService.hide();
      },
      error: (error:any) => {
        console.error('Error deleting plugin:', error);
        this.loadingService.hide();
        this.toast.showToast('error', 'Something went wrong');
      }
    });
  }

  submitForm(){
    console.log(this.pluginForm.value, this.selectedAgents);
    // this.loadingService.show();
    console.log(this.pluginForm.value.agencyList);
    let finalAgencyList: any = [];

    this.pluginForm.value.agencyList.forEach((agencyId: string) => {
      const agencyDetails = this.allAgencyList.find((a:any) => a.agency_id === agencyId);
      let agencyObj: any = []
      agencyDetails?.agents.forEach((agent: any) => {
        console.log('agent', agent);
        if(this.pluginForm.value.agentsList.find((a: any) => a === agent.agent_id)){
          agencyObj.push({ agent_id: agent.agent_id, agent_name: agent.name });
          console.log('pushing agent', agent.name);
        }
      });
      if(agencyObj.length){
        finalAgencyList.push({ agency_id: agencyId, agency_name: agencyDetails.agency_name, agents: agencyObj });
      }
      console.log('selected agency list', finalAgencyList);
    });

    let payload: any = {
      PluginName: this.pluginForm.value.pluginName,
      AgencyList: finalAgencyList
    };

    console.log(this.selectedPlugin);

    if(this.selectedPlugin){
      payload['PluginId'] = this.selectedPlugin._id.$oid;
    }

    this.pluginsService.updatePlugin(payload).subscribe({
      next: (response) => {
        if (response?.success) {
          this.toast.showToast('success', 'Plugin updated successfully');
          this.fetchPlugins();
          this.closePluginForm();
          this.pluginForm.reset({ pluginName: '', agentsList: [], agencyList: [] });
          this.selectedPlugin = undefined;
          this.pluginForm.get('pluginName')?.enable();
        } else {
          this.toast.showToast('error', response?.message || 'Something went wrong');
        }
        this.loadingService.hide();
      },
      error: (error) => {
        console.error('Error updating plugin:', error);
        this.loadingService.hide();
        this.toast.showToast('error', 'Something went wrong');
      }
    });

  }
}

