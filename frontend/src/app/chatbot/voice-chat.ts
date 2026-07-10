import {
  Component,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
  AfterViewInit,
  inject,
  effect,
  ViewEncapsulation,
  computed,
  signal,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { VoiceAgentService, VoiceState } from '../services/voice-agent.service';
import { environment } from '../../environments/environment';
import { Header } from '../header/header';
import { rxResource } from '@angular/core/rxjs-interop';
import { SemarketplaceService } from '../services/semarketplace.service';
import { TOption, Select } from '../components/select/select';
import { RouterLink } from '@angular/router';
import { AIInfuseStateService } from '../services/aiinfuse-state.service';
import { IAgent, ILoginResponse } from '../types';
import { Sidebar } from '../components/sidebar/sidebar';
import { TreeNode, TreeComponent } from '../components/tree/tree';
import { ToastService } from '../services/toast.service';
import { Toast } from '../components/toast/toast';

interface LogEvent {
  time: string;
  text: string;
  type: 'final' | 'warn' | 'err' | 'info';
  id?: string;
}

@Component({
  selector: 'voice-chatbot',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    Header,
    Select,
    RouterLink,
    Sidebar,
    TreeComponent,
    Toast,
  ],
  encapsulation: ViewEncapsulation.None,
  template: `
    <app-header></app-header>

    <main>
      <div class="bg-white border-end">
        <sidebar [(isOpen)]="sidebarOpen" mode="overlay" trigger="hover">
          <div class="d-flex flex-column gap-1 px-2">
            <strong class="fs-14 text-muted">Agencies</strong>
            <app-tree
              [nodes]="agencyTreeData()"
              style="--font-size: 0.7rem; --icon-size: 0.8rem; --row-height: 1.7rem;"
              (nodeClick)="switchAgency($event.id)"
              [activeId]="activeAgencyId()"
            />
          </div>
        </sidebar>
      </div>

      <div class="root">
        <div class="bg-white px-2 border-bottom pb-2">
          <div class="d-flex align-items-center gap-3">
            <div class="controls fs-14 d-flex gap-3 align-items-center">
              <div class="controls-row">
                @let aOptions = agentOptions();
                <span class="text-muted fw-semibold">Mova-iO Agent</span>
                <app-select
                  placeholder="Select"
                  [options]="aOptions"
                  [(ngModel)]="activeAgentId"
                  [allowSearch]="false"
                  (onSelect)="clear()"
                  style="
        --min-height: auto;
        --width: 16rem;
        --option-font-size: 0.9rem;
        --font-size: 0.7rem;
        --options-max-width: auto;
      "
                  [parentWidth]="false"
                  [disabled]="
                    voice.connected() ||
                    voiceAgentsQuery.isLoading() ||
                    !aOptions.length ||
                    !activeAgencyId()
                  "
                />
              </div>

              <div class="controls-row">
                <button
                  class="primary btn btn-sm rounded-4 px-3"
                  [class.live]="voice.connected()"
                  [disabled]="disableControls"
                  (click)="toggleCall()"
                >
                  @if (voice.connected()) {
                    <i class="fa-solid fa-stop"></i> End call
                  } @else {
                    <i class="fa-solid fa-microphone"></i> Start call
                  }
                </button>

                <button
                  *ngIf="
                    voice.connected() && voice.micPermission() === 'denied'
                  "
                  (click)="retryMic()"
                >
                  🎤 Enable mic
                </button>
              </div>
            </div>

            <div
              class="d-flex fs-12 align-items-center gap-3 text-capitalize ms-auto"
            >
              <div class="d-flex gap-1  align-items-center ">
                <span class="fw-semibold">Status:</span>
                <span class="dot" [ngClass]="statusColorClass"></span>
                <span class="text-muted">{{ statusText }}</span>
                <div style="flex:1"></div>
              </div>

              <div class="d-flex gap-1  align-items-center ">
                <span class="text-muted fw-semibold">mic</span>
                <div class="meter" title="mic input level">
                  <div class="bar" [style.width.%]="voice.micLevel()"></div>
                </div>
              </div>

              <button
                type="button"
                class="btn btn-sm bg-white me-4 text-muted"
                routerLink="/commandcenterdashboard"
                title="Close Voice Chat"
              >
                <i class="fa-solid fa-x"></i>
              </button>
            </div>
          </div>

          <div class=" fs-14 text-muted">{{ getHintText() }}</div>
          @if (voice.error()) {
            <div class="fs-14 text-danger text-center" *ngIf="">
              {{ voice.error() }}
            </div>
          }
        </div>

        <div class="chat-area" style="min-height: 0;">
          <section class="panel border-end">
            <h2>This turn</h2>
            <div class="row">
              <span class="k fw-semibold">You said</span>
              <span class="v"
                ><span
                  class="badge"
                  *ngIf="!voice.interimUserText() && latestUser"
                  >you</span
                ></span
              >
            </div>
            <div
              class="transcript"
              [class.thinking]="voice.state() === 'THINKING'"
            >
              <span *ngIf="voice.interimUserText()">{{
                voice.interimUserText()
              }}</span>
              <span *ngIf="!voice.interimUserText() && latestUser">{{
                latestUser
              }}</span>
              <span
                class="muted"
                *ngIf="!voice.interimUserText() && !latestUser"
              >
                {{
                  voice.connected()
                    ? 'listening...'
                    : 'click Start call and start talking…'
                }}
              </span>
            </div>

            <hr
              style="border:0; border-top:1px solid var(--border); margin:14px 0;"
            />

            <div class="row">
              <span class="k fw-semibold">Agent answer</span>
              <span class="v"
                ><span class="badge" *ngIf="voice.state() === 'THINKING'"
                  >Thinking...</span
                ></span
              >
            </div>
            <div
              class="answer"
              [class.thinking]="
                voice.state() === 'SPEAKING' &&
                !voice.interimAgentText() &&
                !latestAgent
              "
            >
              <span *ngIf="voice.interimAgentText()">{{
                voice.interimAgentText()
              }}</span>
              <span *ngIf="!voice.interimAgentText() && latestAgent">{{
                latestAgent
              }}</span>
              <span
                class="muted"
                *ngIf="!voice.interimAgentText() && !latestAgent"
                >—</span
              >
            </div>
          </section>

          <div
            style="display: grid; grid-template-rows: 1fr auto; min-height: 0;"
          >
            <section class="panel d-flex flex-column" style="min-height: 0;">
              <div class="d-flex align-items-center justify-content-between">
                <h2>Event stream (raw)</h2>
                <button
                  type="button"
                  class="btn btn-sm btn-warning text-white"
                  (click)="clear()"
                >
                  Clear
                </button>
              </div>
              <div class="events" #eventsContainer>
                @for (ev of eventLog(); track ev.time) {
                  <div class="e" [ngClass]="ev.type">
                    {{ ev.time }} &nbsp;&nbsp; {{ ev.text }}
                  </div>
                }
              </div>
            </section>

            <section class="panel border-top">
              <h2>Live activity (last 60 sec)</h2>
              <canvas
                #monitorCanvas
                style="width:100%;height:80px;display:block;background:var(--surface);border-radius:6px;"
              ></canvas>
              <div class="chart-legend" style="margin-top:6px;">
                <span class="lg"
                  ><span class="sw" style="background:var(--c1);"></span> Mic
                  input</span
                >
                <span class="lg"
                  ><span class="sw" style="background:var(--c4);"></span> Agent
                  output</span
                >
                <span
                  style="margin-left:auto;color:var(--muted);font-family:var(--mono);font-variant-numeric:tabular-nums;"
                >
                  {{ voice.metrics().sessionDuration }}s
                </span>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>

    <app-toast [toastMessage]="toast.toastMessage()" />
  `,
  styles: `
    :root {
      --panel: #ffffff;
      --muted: #5a6478;
      --soft: #3a4256;
      --text: #0e1320;
      --accent: #f9a84a;
      --ok: #1c8f3c;
      --warn: #b56a06;
      --err: #c43030;
      --c1: #f9a84a;
      --c2: #1c8f3c;
      --c3: #1f6dd1;
      --c4: #7a3ec0;
      --c5: #c43030;
      --surface: #eef1f6;
      --surface-2: #e2e7ef;
      --border: #cdd4de;
      --grid: #dfe4ec;
      --gate-bg: rgba(247, 249, 252, 0.92);
    }

    main {
      height: calc(100% - 5rem);
      margin-top: 4.063rem;
      display: grid;
      grid-template-columns: auto 1fr;
    }

    .root {
      height: 100%;
      display: grid;
      grid-template-rows: auto 1fr;
      min-height: 0;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--muted);
      transition: background 0.3s;
    }
    .dot.ok {
      background: var(--ok);
    }
    .dot.warn {
      background: var(--warn);
    }
    .dot.err {
      background: var(--err);
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 6px;
      background: var(--surface);
      font-size: 12px;
      color: var(--accent);
      cursor: pointer;
      border: 0;
    }
    .meter {
      width: 160px;
      height: 8px;
      background: var(--surface-2);
      border-radius: 4px;
      overflow: hidden;
    }
    .meter > .bar {
      height: 100%;
      background: linear-gradient(
        90deg,
        var(--ok) 0%,
        var(--warn) 70%,
        var(--err) 100%
      );
      transition: width 60ms linear;
    }
    .controls {
      padding: 0.5rem;
    }
    .controls-row {
      display: flex;
      gap: 12px;
      justify-content: center;
      align-items: center;
      flex-wrap: wrap;
    }
    button:hover {
      background: var(--surface-2);
    }
    button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    button.primary {
      background: #f9a84a;
      color: white;
    }
    button.primary.live {
      background: var(--err);
    }
    .chat-area {
      display: grid;
      grid-template-columns: 340px 1fr;
      width: 100%;
    }
    .panel {
      background: var(--panel);
      padding: 14px 16px;
    }
    .panel h2 {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--muted);
      margin: 0 0 10px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 0;
      font-size: 13px;
    }
    .row .k {
      color: var(--muted);
    }
    .transcript,
    .answer {
      font-size: 15px;
      line-height: 1.5;
      min-height: 48px;
      white-space: pre-wrap;
    }
    .muted {
      color: var(--muted);
      font-style: italic;
    }
    .thinking {
      color: var(--accent);
      animation: thinking-pulse 1.2s ease-in-out infinite;
    }
    @keyframes thinking-pulse {
      0%,
      100% {
        opacity: 0.55;
      }
      50% {
        opacity: 1;
      }
    }
    .chart-legend {
      display: flex;
      gap: 0.8rem;
      font-size: 11px;
      color: var(--soft);
    }
    .chart-legend .sw {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 2px;
    }
    .events {
      font-family: var(--mono);
      font-size: 0.875rem;
      line-height: 1.75;
      overflow: auto;
      color: var(--soft);
      min-height: 0;
      height: 100%;
      overflow: auto;
    }
    .events .e.err {
      color: var(--err);
    }
    .events .e.final {
      color: var(--text);
    }
    .events .e.warn {
      color: var(--warn);
    }
    input,
    select {
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 10px;
    }
  `,
})
export class VoiceChat implements OnInit, AfterViewInit, OnDestroy {
  voice = inject(VoiceAgentService);
  private service = inject(SemarketplaceService);
  private stateService = inject(AIInfuseStateService);
  toast = inject(ToastService);

  @ViewChild('monitorCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('eventsContainer') eventsContainer!: ElementRef<HTMLDivElement>;

  showGate = true;
  theme: 'light' | 'dark' = 'dark';
  sidebarOpen = signal(false);

  activeAgencyId = signal('');
  activeAgentId = signal('');

  latestUser = '';
  latestAgent = '';

  eventLog = signal<LogEvent[]>([]);
  private msgSub!: Subscription;

  private rafId: number | null = null;
  private readonly MON_SAMPLES = 60 * 30;
  private monMic = new Float32Array(this.MON_SAMPLES);
  private monAgent = new Float32Array(this.MON_SAMPLES);
  private monIdx = 0;
  isPrivilegeView: boolean = false;
  isPrivilegeEdit: boolean = false;
  isPrivilegeDelete: boolean = false;
  isPrivilegeRefresh: boolean = false;
  isPrivilegeExecute: boolean = false;

  agencyOptions = computed<TOption[]>(() => {
    if (this.voiceAgentsQuery.error()) return [];

    const loggedUser: ILoginResponse = this.stateService.getLoginDetails();
    const activePrj = loggedUser?.ActiveProject;

    const mappedProject = loggedUser?.ProjectDtl?.find(
      (p: any) => p.prj_name?.toLowerCase() === activePrj?.toLowerCase(),
    );
    const mappedTeam = (mappedProject?.team_name || '')?.toLowerCase();
    const mappedRole = mappedProject?.role_name?.toLowerCase() || '';

    let agencies = this.voiceAgentsQuery.value()?.data || [];
    if (!['admin', 'super admin'].includes(mappedRole)) {
      agencies = agencies.filter(
        (item) => item.assigned_to.toLowerCase() === mappedTeam,
      );
    }

    return agencies.map((item) => ({
      label: item.agency_name,
      value: item.agency_id,
      data: item?.agents?.filter(
        (item) => item.agent_type_id === 'VOICE_AGENT',
      ),
    }));
  });

  agentOptions = computed<TOption[]>(() => {
    const activeAgencyId = this.activeAgencyId();
    if (!activeAgencyId) return [];

    return (
      (
        this.agencyOptions().find((item) => item.value === activeAgencyId)
          ?.data as IAgent[]
      )?.map((item) => ({
        label: item.name,
        value: item.agent_id,
      })) || []
    );
  });

  agencyTreeData = computed<TreeNode[]>(() =>
    this.agencyOptions().map((item) => {
      const len = item.data?.length ?? 0;
      return {
        id: item.value,
        label: `${item.label} (${len})`,
        icon: '<i class="fa fa-solid fa-sitemap"></i>',
        tooltip: `${len} voice agent${len !== 1 ? 's' : ''}`,
      };
    }),
  );

  constructor(
    private cdRef: ChangeDetectorRef,
    private _stateService: AIInfuseStateService,
  ) {
    effect(() => {
      const state = this.voice.state();
      this.log(`State transition: ${state}`, 'info');

      if (state === VoiceState.LISTENING) {
        this.latestUser = '';
        this.latestAgent = '';
      }
    });

    effect(() => {
      const err = this.voice.error();
      if (err) this.log(`Error: ${err}`, 'err');
    });

    effect(() => {
      const voiceAgent = this.agentOptions()?.[0];
      if (!voiceAgent) return;

      this.voice.initialize({
        agentId: voiceAgent.value,
        startSessionUrl: `${environment.apiUrl}/voice-agent/sessions/start`,
        endSessionUrl: `${environment.apiUrl}/voice-agent/sessions/end`,
        autoReconnect: true,
        debug: true,
      });
    });

    effect(() => {
      const op = this.agencyOptions()[0];
      if (op) this.activeAgencyId.set(op.value);
    });
  }

  ngOnInit() {
    this.loadPrivileges();
    this.msgSub = this.voice.messages$.subscribe((msg) => {
      if (msg.role === 'user') {
        this.latestUser = msg.text;
        this.log(`you: ${msg.text}`, 'final', msg.id);
      } else {
        this.latestAgent = msg.text;
        this.log(`agent: ${msg.text}`, 'final', msg.id);
      }
    });
  }

  ngAfterViewInit() {
    this.startCanvasMonitor();
  }

  ngOnDestroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.msgSub) this.msgSub.unsubscribe();
    this.voice.stop();
    this.activeAgencyId.set('');
    this.activeAgentId.set('');
    this.clear();
  }

  switchAgency(agencyId: string) {
    if (this.activeAgencyId() === agencyId) return;

    if (
      !this.agencyOptions().find((item) => item.value === agencyId)?.data
        ?.length
    ) {
      this.toast.showToast('error', 'No Voice Agents available');
    }

    this.activeAgencyId.set(agencyId);
    this.activeAgentId.set('');
    this.sidebarOpen.set(false);
  }

  unlockAndStart() {
    this.voice.unlockAudio();
    this.showGate = false;
    this.log('Audio unlocked', 'info');
  }

  toggleCall() {
    if (this.voice.connected() || this.voice.connecting()) {
      this.voice.stop();
      this.log('Call ended', 'info');
    } else {
      const activeAgentId = this.activeAgentId();

      this.voice.switchAgent(activeAgentId);
      this.voice.start();
      this.log(`Starting call with agent: ${activeAgentId}`, 'warn');
    }
  }

  retryMic() {
    this.voice.unmute();
  }

  clear() {
    this.eventLog.set([]);
    this.latestUser = '';
    this.voice.interimAgentText.set('');
    this.voice.interimUserText.set('');
  }

  get statusColorClass() {
    const state = this.voice.state();
    if (state === VoiceState.ERROR) return 'err';
    if (state === VoiceState.CONNECTING) return 'warn';
    if (this.voice.connected()) return 'ok';
    return '';
  }

  get statusText() {
    const state = this.voice.state();
    if (state === VoiceState.ERROR) return 'error';
    if (state === VoiceState.CONNECTING) return 'connecting...';
    if (this.voice.connected())
      return this.voice.micPermission() === 'denied' ? 'live (no mic)' : 'live';
    return 'ready';
  }

  get HintText() {
    if (!this.voice.connected())
      return 'Click Start call — the agent greets you, then just talk. Click again to hang up.';
    if (this.voice.micPermission() === 'denied')
      return 'Connected — listening to the agent. Enable your mic to talk back.';
    return 'the agent will greet you — just talk. Click End call to hang up.';
  }

  getHintText() {
    return this.HintText;
  }

  private log(
    text: string,
    type: LogEvent['type'] = 'info',
    id: string = crypto.randomUUID(),
  ) {
    const time = new Date().toISOString().slice(11, 23);
    this.eventLog.update((v) => {
      const index = v.findIndex((m) => m.id === id);
      const newLogs = v.slice();

      if (index >= 0) {
        newLogs[index] = { ...newLogs[index], text };
      } else {
        newLogs.push({ time, text, type });
      }

      if (newLogs.length > 200) newLogs.shift();
      return newLogs;
    });

    setTimeout(() => {
      if (this.eventsContainer) {
        const el = this.eventsContainer.nativeElement;
        el.scrollTop = el.scrollHeight;
      }
    }, 10);
  }

  private startCanvasMonitor() {
    let lastDraw = 0;

    const loop = (timestamp: number) => {
      this.rafId = requestAnimationFrame(loop);

      if (timestamp - lastDraw < 1000 / 30) return;
      lastDraw = timestamp;

      this.monMic[this.monIdx] = this.voice.micLevel() / 100;
      this.monAgent[this.monIdx] = this.voice.agentLevel() / 100;

      this.monIdx = (this.monIdx + 1) % this.MON_SAMPLES;
      this.drawMonitor();
    };

    this.rafId = requestAnimationFrame(loop);
  }

  private drawMonitor() {
    if (!this.canvasRef) return;
    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.parentElement!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (
      canvas.width !== Math.round(rect.width * dpr) ||
      canvas.height !== Math.round(140 * dpr)
    ) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(140 * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, 140);

    const cs = getComputedStyle(document.body);
    const colGrid = cs.getPropertyValue('--grid').trim() || '#222a3a';
    const colMic = cs.getPropertyValue('--c1').trim() || '#7ab1ff';
    const colAgent = cs.getPropertyValue('--c4').trim() || '#d186ff';

    ctx.strokeStyle = colGrid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 70);
    ctx.lineTo(rect.width, 70);
    ctx.stroke();

    const drawTrace = (
      buf: Float32Array,
      color: string,
      multiplier: number,
    ) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      for (let i = 0; i < this.MON_SAMPLES; i++) {
        const readIdx = (this.monIdx + i) % this.MON_SAMPLES;
        const x = (i / this.MON_SAMPLES) * rect.width;
        const y = 70 + multiplier * buf[readIdx] * 66;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    drawTrace(this.monMic, colMic, -1);
    drawTrace(this.monAgent, colAgent, 1);
  }

  voiceAgentsQuery = rxResource({
    stream: () => this.service.getAgencyWithAgents(),
  });

  loadPrivileges() {
    this._stateService.getPrivilegesByPage('Voice Agent').subscribe({
      next: (loaded_privileges: any) => {
        console.log(
          'Loaded privileges for Voice Agent by page: ',
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
          this.cdRef.detectChanges();
        }
      },
    });
  }

  get disableControls(): boolean {
    // first need check: Privilege
    if (!this.isPrivilegeExecute) {
      return true;
    }

    // Second check: Voice and Loading states
    return (
      !this.activeAgentId() ||
      this.voice.connecting() ||
      this.voiceAgentsQuery.isLoading()
    );
  }
}
