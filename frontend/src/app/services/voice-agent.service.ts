import { Injectable, signal, OnDestroy, inject } from '@angular/core';
import { firstValueFrom, Subject } from 'rxjs';
import {
  Room,
  RoomEvent,
  Track,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  Participant,
  TranscriptionSegment,
  DisconnectReason,
} from 'livekit-client';
import { HttpClient } from '@angular/common/http';

export interface VoiceAgentConfig {
  agentId: string;
  startSessionUrl: string;
  endSessionUrl: string;
  userIdentity?: string;
  autoReconnect?: boolean;
  debug?: boolean;
  metadata?: {
    conversationId?: string;
    customerId?: string;
    source?: string;
  };
}

export enum VoiceState {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  LISTENING = 'LISTENING',
  THINKING = 'THINKING',
  SPEAKING = 'SPEAKING',
  ERROR = 'ERROR',
}

export interface VoiceMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
}

export interface VoiceMetrics {
  sessionDuration: number;
  totalMessages: number;
  lastLatency: number;
  reconnectCount: number;
  micLevel: number;
  agentLevel: number;
}

@Injectable({
  providedIn: 'root',
})
export class VoiceAgentService implements OnDestroy {
  private readonly http = inject(HttpClient);

  readonly state = signal<VoiceState>(VoiceState.IDLE);
  readonly connected = signal(false);
  readonly connecting = signal(false);
  readonly error = signal<string | null>(null);

  readonly interimUserText = signal('');
  readonly interimAgentText = signal('');

  readonly micLevel = signal(0);
  readonly agentLevel = signal(0);

  readonly micPermission = signal<'prompt' | 'granted' | 'denied'>('prompt');

  readonly metrics = signal<VoiceMetrics>({
    sessionDuration: 0,
    totalMessages: 0,
    lastLatency: 0,
    reconnectCount: 0,
    micLevel: 0,
    agentLevel: 0,
  });

  private messageSubject = new Subject<VoiceMessage>();
  readonly messages$ = this.messageSubject.asObservable();

  private config: VoiceAgentConfig | null = null;
  private room: Room | null = null;
  private audioContext: AudioContext | null = null;

  private micAnalyser: AnalyserNode | null = null;
  private agentAnalyser: AnalyserNode | null = null;
  private animationFrameId: number | null = null;

  private sessionData: { roomName?: string; sessionId?: string } = {};
  private sessionStartTime = 0;
  private messageCount = 0;

  private lastFinalUser = { text: '', time: 0 };
  private lastFinalAgent = { text: '', time: 0 };
  private readonly DUP_THRESHOLD_MS = 5000;

  constructor() {
    this.checkMicrophonePermission();
  }

  ngOnDestroy() {
    this.cleanup();

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {
        //
      });
    }

    this.audioContext = null;
  }

  initialize(config: VoiceAgentConfig): void {
    this.config = {
      autoReconnect: false,
      debug: false,
      ...config,
    };

    if (!this.audioContext) {
      this.audioContext = new (
        window.AudioContext || (window as any).webkitAudioContext
      )();
    }

    if (this.config.debug) {
      console.log('[VoiceAgent] Initialized with config:', this.config);
    }
  }

  async start(): Promise<void> {
    if (!this.config) {
      throw new Error('VoiceAgentService must be initialized before starting.');
    }
    if (this.connecting() || this.connected()) return;

    this.cleanup(false);
    this.connecting.set(true);
    this.error.set(null);
    this.state.set(VoiceState.CONNECTING);
    this.sessionStartTime = Date.now();

    try {
      await this.unlockAudio();
      const connectionData = await this.fetchSessionInfo();

      this.room = new Room({ adaptiveStream: true, dynacast: true });
      this.wireRoomEvents(this.room);

      await this.room.connect(connectionData.url, connectionData.token);
      this.sessionData = {
        roomName: connectionData.roomName,
        sessionId: connectionData.sessionId,
      };

      this.connected.set(true);
      this.connecting.set(false);
      this.state.set(VoiceState.LISTENING);

      await this.enableMicrophone();
      this.startAudioMonitoring();
    } catch (err: any) {
      this.handleError('Failed to start voice session: ' + err.message);
      this.cleanup();
    }
  }

  async stop(): Promise<void> {
    if (!this.connected() && !this.connecting()) return;

    if (this.config?.endSessionUrl && this.sessionData.roomName) {
      try {
        await firstValueFrom(
          this.http.post(this.config!.startSessionUrl, {
            roomName: this.sessionData.roomName,
          }),
        );
      } catch (e) {
        if (this.config?.debug)
          console.error(
            '[VoiceAgent] Error notifying backend of session end',
            e,
          );
      }
    }

    this.cleanup();
    this.state.set(VoiceState.IDLE);
  }

  toggle(): void {
    if (this.connected()) {
      this.stop();
    } else {
      this.start();
    }
  }

  async mute(): Promise<void> {
    if (this.room?.localParticipant) {
      await this.room.localParticipant.setMicrophoneEnabled(false);
    }
  }

  async unmute(): Promise<void> {
    if (this.room?.localParticipant) {
      await this.room.localParticipant.setMicrophoneEnabled(true);
    }
  }

  switchAgent(agentId: string): void {
    if (!this.config) return;
    this.config.agentId = agentId;
    if (this.connected()) {
      this.stop().then(() => this.start());
    }
  }

  async unlockAudio(): Promise<void> {
    if (this.audioContext?.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (e) {
        if (this.config?.debug)
          console.warn('[VoiceAgent] Audio unlock failed', e);
      }
    }
  }

  async checkMicrophonePermission(): Promise<void> {
    try {
      const result = await navigator.permissions.query({
        name: 'microphone' as PermissionName,
      });
      this.micPermission.set(result.state as 'prompt' | 'granted' | 'denied');
      result.onchange = () => {
        this.micPermission.set(result.state as 'prompt' | 'granted' | 'denied');
      };
    } catch {
      this.micPermission.set('prompt');
    }
  }

  async requestMicrophonePermission(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      this.micPermission.set('granted');
    } catch (e) {
      this.micPermission.set('denied');
    }
  }

  private async fetchSessionInfo(): Promise<{
    url: string;
    token: string;
    roomName: string;
    sessionId: string;
  }> {
    const payload = {
      agentId: this.config!.agentId,
      userIdentity:
        this.config!.userIdentity ||
        `user-${Math.random().toString(36).substring(7)}`,
      ...this.config!.metadata,
    };

    try {
      const data = await firstValueFrom(
        this.http.post<{
          livekitUrl: string;
          url: string;
          userToken: string;
          token: string;
          roomName: string;
          sessionId: string;
        }>(this.config!.startSessionUrl, payload),
      );

      return {
        url: data.livekitUrl || data.url,
        token: data.userToken || data.token,
        roomName: data.roomName,
        sessionId: data.sessionId,
      };
    } catch (error: any) {
      throw new Error(error.message || `HTTP Error occurred`);
    }
  }

  private wireRoomEvents(room: Room): void {
    room.on(RoomEvent.Disconnected, (reason) => {
      if (this.config?.debug) console.log('[VoiceAgent] Disconnected:', reason);
      this.cleanup();

      if (
        this.config?.autoReconnect &&
        reason &&
        ![
          DisconnectReason.CLIENT_INITIATED,
          DisconnectReason.ROOM_CLOSED,
          DisconnectReason.ROOM_DELETED,
          DisconnectReason.PARTICIPANT_REMOVED,
          DisconnectReason.DUPLICATE_IDENTITY,
          DisconnectReason.USER_REJECTED,
          DisconnectReason.USER_UNAVAILABLE,
        ].includes(reason)
      ) {
        this.handleReconnect();
      }
    });

    room.on(
      RoomEvent.TrackSubscribed,
      (
        track: RemoteTrack,
        pub: RemoteTrackPublication,
        participant: RemoteParticipant,
      ) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.autoplay = true;
          el.style.display = 'none';
          el.setAttribute('data-voice-agent', '1');
          document.body.appendChild(el);

          el.play().catch(() => this.unlockAudio().then(() => el.play()));
          this.agentAnalyser = this.createAnalyser(track.mediaStreamTrack);
        }
      },
    );

    room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) {
        track.detach().forEach((el) => el.remove());
        this.agentAnalyser = null;
      }
    });

    room.on(
      RoomEvent.TranscriptionReceived,
      (segments: TranscriptionSegment[], participant?: Participant) => {
        const isLocal =
          participant?.identity === room.localParticipant.identity;
        for (const seg of segments) {
          this.processTranscript(
            isLocal ? 'user' : 'assistant',
            seg.text,
            seg.final,
            seg.id,
          );
        }
      },
    );

    room.registerTextStreamHandler('lk.transcription', async (reader, info) => {
      const isLocal = info?.identity === room.localParticipant.identity;
      const segmentId =
        reader?.info?.attributes?.['lk.segment_id'] ?? this.getId();
      const isFinal =
        reader?.info?.attributes?.['lk.transcription_final'] === 'true';

      let buf = '';
      try {
        for await (const chunk of reader) {
          buf += chunk;
          this.processTranscript(
            isLocal ? 'user' : 'assistant',
            buf,
            false,
            segmentId,
          );
        }

        this.processTranscript(
          isLocal ? 'user' : 'assistant',
          buf,
          isFinal,
          segmentId,
        );
      } catch (e) {
        if (this.config?.debug)
          console.warn('[VoiceAgent] Text stream error:', e);
      }
    });
  }

  private async enableMicrophone(): Promise<void> {
    if (!this.room) return;
    try {
      await this.room.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      const pubs = Array.from(
        this.room.localParticipant.trackPublications.values(),
      );
      const micPub = pubs.find((p) => p.track && p.kind === Track.Kind.Audio);
      if (micPub?.track) {
        this.micAnalyser = this.createAnalyser(micPub.track.mediaStreamTrack);
      }
    } catch (err: any) {
      this.micPermission.set('denied');
      throw new Error('Microphone access denied or unavailable.');
    }
  }

  private getId() {
    return `vm-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private processTranscript(
    role: 'user' | 'assistant',
    text: string,
    isFinal: boolean,
    segmentId: string,
  ): void {
    if (!text.trim()) return;

    if (!isFinal) {
      if (role === 'user') {
        this.interimUserText.set(text);
      } else {
        this.interimAgentText.set(text);
        if (this.state() !== VoiceState.SPEAKING) {
          this.state.set(VoiceState.SPEAKING);
        }
      }
      return;
    }

    const cache = role === 'user' ? this.lastFinalUser : this.lastFinalAgent;
    const now = Date.now();
    if (cache.text === text && now - cache.time < this.DUP_THRESHOLD_MS) {
      return;
    }

    cache.text = text;
    cache.time = now;

    if (role === 'user') {
      this.interimUserText.set('');
      this.state.set(VoiceState.THINKING);
    } else {
      this.interimAgentText.set('');
      this.state.set(VoiceState.LISTENING);
    }

    this.messageCount++;
    this.messageSubject.next({
      id: segmentId,
      role,
      text,
      timestamp: new Date(),
    });

    this.updateMetrics();
  }

  private createAnalyser(track: MediaStreamTrack): AnalyserNode | null {
    if (!this.audioContext) return null;
    try {
      const stream = new MediaStream([track]);
      const src = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      return analyser;
    } catch (e) {
      if (this.config?.debug)
        console.warn('[VoiceAgent] Analyser creation failed', e);
      return null;
    }
  }

  private startAudioMonitoring(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }

    const sampleVolume = (analyser: AnalyserNode | null): number => {
      if (!analyser) return 0;
      const data = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const val = Math.abs(data[i] - 128);
        if (val > peak) peak = val;
      }
      return Math.min(100, Math.round((peak / 128) * 100 * 2.2));
    };

    const loop = () => {
      if (!this.connected()) return;

      const currentMic = sampleVolume(this.micAnalyser);
      const currentAgent = sampleVolume(this.agentAnalyser);

      this.micLevel.set(currentMic);
      this.agentLevel.set(currentAgent);

      if (this.state() === VoiceState.THINKING && currentAgent > 10) {
        this.state.set(VoiceState.SPEAKING);
      }

      this.updateMetrics();
      this.animationFrameId = requestAnimationFrame(loop);
    };

    loop();
  }

  private updateMetrics(): void {
    this.metrics.update((m) => ({
      ...m,
      sessionDuration: this.sessionStartTime
        ? Math.floor((Date.now() - this.sessionStartTime) / 1000)
        : 0,
      totalMessages: this.messageCount,
      micLevel: this.micLevel(),
      agentLevel: this.agentLevel(),
    }));
  }

  private handleReconnect(): void {
    if (this.metrics().reconnectCount >= 3) {
      this.handleError('Maximum reconnection attempts reached.');
      return;
    }

    this.metrics.update((m) => ({
      ...m,
      reconnectCount: m.reconnectCount + 1,
    }));
    setTimeout(() => {
      if (this.config?.debug)
        console.log('[VoiceAgent] Attempting reconnection...');
      this.start();
    }, 2000);
  }

  private handleError(msg: string): void {
    if (this.config?.debug) console.error('[VoiceAgent]', msg);
    this.error.set(msg);
    this.state.set(VoiceState.ERROR);
    this.connected.set(false);
    this.connecting.set(false);
  }

  private cleanup(full = true): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.room) {
      this.room.disconnect().catch(() => {});
      this.room = null;
    }

    this.micAnalyser = null;
    this.agentAnalyser = null;

    document
      .querySelectorAll('audio[data-voice-agent]')
      .forEach((el) => el.remove());

    this.interimUserText.set('');
    this.interimAgentText.set('');
    this.micLevel.set(0);
    this.agentLevel.set(0);
    this.connected.set(false);
    this.connecting.set(false);

    if (full) {
      this.sessionData = {};
      this.sessionStartTime = 0;
      this.messageCount = 0;
      this.metrics.set({
        sessionDuration: 0,
        totalMessages: 0,
        lastLatency: 0,
        reconnectCount: 0,
        micLevel: 0,
        agentLevel: 0,
      });
    }
  }
}
