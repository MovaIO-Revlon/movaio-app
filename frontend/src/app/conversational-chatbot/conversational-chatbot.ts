import { Component, ElementRef, NgZone, ViewChild, AfterViewChecked, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import MarkdownIt from 'markdown-it';
import { HomeService } from '../services/home.service';
import { Header } from '../header/header';
import { trigger, state, style, transition, animate } from '@angular/animations';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text?: string;
  markdown?: string;
  plain?: string;
  html?: string;
  thinking?: boolean;
  attachments?: { name: string }[];
  suggested?: string[];
}

@Component({
  selector: 'app-conversational-chatbot',
  imports: [CommonModule, FormsModule, Header],
  templateUrl: './conversational-chatbot.html',
  styleUrl: './conversational-chatbot.css',
  animations: [
    trigger('slideDown', [
      transition(':enter', [
        style({ opacity: 0, maxHeight: '0', transform: 'translateY(-10px)' }),
        animate('300ms ease-out', style({ opacity: 1, maxHeight: '1000px', transform: 'translateY(0)' }))
      ]),
      transition(':leave', [
        animate('300ms ease-in', style({ opacity: 0, maxHeight: '0', transform: 'translateY(-10px)' }))
      ])
    ])
  ]
})
export class ConversationalChatbot implements OnInit, AfterViewChecked, OnDestroy {
  @ViewChild('messagesList') messagesList!: ElementRef;

  messages: Message[] = [];
  draft = '';
  isRecording = false;
  suggestions: string[] = [];
  pendingAttachments: { name: string; file?: File }[] = [];
  showThinking: boolean = false;
  chatResponses: any[] = [];
  private suggestionSub?: Subscription;
  private activeStreamSubscriptions: Subscription[] = [];
  private currentSessionId_tracker: string = '';

  agencies: any[] = [];
  filteredAgents: any[] = [];
  selectedAgencyId: any = null;
  selectedAgentId: any = null;
  agencyLoading = false;
  isRecentQueryCollapsed = false;
  currentSessionId: string = '';
  sidebarCollapsed: boolean = false;
  isThinkingCollapsed: boolean = false;
  hasRealLogs: boolean = false;
  logsDuringLoading: Array<{timestamp: string, message: string, type: string, source: string, icon: string, title: string, desc: string, originalData: any}> = [];
  isProcessingCompleted: boolean = false;
  completionMessageReceived: boolean = false;
  isLoading = false;

  private recognition: any = null;
  private lastUserMessage: Message | null = null;
  private readonly markdownParser = new MarkdownIt({ html: false, linkify: true, typographer: true });

  constructor(private readonly ngZone: NgZone,
    private readonly _homeService: HomeService,
    private readonly cdRef: ChangeDetectorRef,
    private readonly location: Location
  ) {
    // chat starts blank until an agent is selected
  }

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  toggleThinkingBox(messageIndex: number, event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (this.chatResponses[messageIndex]) {
      this.chatResponses[messageIndex].isThinkingBoxCollapsed = !this.chatResponses[messageIndex].isThinkingBoxCollapsed;
      this.cdRef.detectChanges();
    }
  }

  toggleThinkingLog(messageIndex: number, logIndex: number, event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const message = this.chatResponses[messageIndex];
    if (message && message.thinkingLogs && message.thinkingLogs[logIndex]) {
      message.thinkingLogs[logIndex].expanded = !message.thinkingLogs[logIndex].expanded;
      this.cdRef.detectChanges();
    }
  }

  ngOnInit(): void {
    this.loadAgencies();
  }

  ngAfterViewChecked(): void {
    // Only auto-scroll when actively streaming/loading responses
    if (this.isLoading || this.chatResponses.some(m => m.isLoading)) {
      this.scrollToBottom();
    }
  }

  get selectedAgency() {
    return this.agencies.find(a => a.agency_id == this.selectedAgencyId);
  }

  get selectedAgent() {
    return this.filteredAgents.find(agent => agent.agent_id == this.selectedAgentId);
  }
  selectRecentQuery(): void {
    if (this.selectedAgent?.recent_query) {
      this.draft = this.selectedAgent.recent_query;
      this.cdRef.detectChanges();
    }
  }

  toggleRecentQueryCollapse(): void {
    this.isRecentQueryCollapsed = !this.isRecentQueryCollapsed;
  }

  loadAgencies(): void {
    this.agencyLoading = true;
    this._homeService.getAgencyWithAgents().subscribe({
      next: (res: any) => {
        this.agencies = [...(res?.data || [])];
        for (let i = 0; i < this.agencies.length; i++) {
          this.agencies[i].interactiveAgentsCount = this.filterInteractiveAgents(this.agencies[i].agents || []).length;
        }
        console.log('Loaded agencies:', this.agencies);
        this.cdRef.detectChanges();
      },
      error: () => {
        this.agencies = [];
        this.cdRef.detectChanges();
      },
      complete: () => {
        this.agencyLoading = false;
        this.cdRef.detectChanges();
      }
    });
  }

  private filterInteractiveAgents(agents: any[] = []): any[] {
    return agents.filter(agent => agent.agent_type_id === 'CONVERSATIONAL');
  }

  private unsubscribeFromActiveStreams(): void {
    this.activeStreamSubscriptions.forEach(sub => {
      if (sub && !sub.closed) {
        sub.unsubscribe();
      }
    });
    this.activeStreamSubscriptions = [];
  }

  onAgencyChange(agencyId: any): void {
    // Unsubscribe from any active stream operations
    this.unsubscribeFromActiveStreams();
    
    this.selectedAgencyId = agencyId;
    this.selectedAgentId = null;
    this.sidebarCollapsed = false;
    this.filteredAgents = this.filterInteractiveAgents(this.selectedAgency?.agents || []);
    this.currentSessionId = '';
    this.currentSessionId_tracker = '';
    this.messages = [];
    this.chatResponses = [];
    this.suggestions = [];
    this.draft = '';
    this.pendingAttachments = [];
    this.isLoading = false;
    this.isProcessingCompleted = false;
    this.logsDuringLoading = [];
    this.cdRef.detectChanges();
  }

  onAgentChange(agentId: string): void {
    // Unsubscribe from any active stream operations
    this.unsubscribeFromActiveStreams();
    
    this.selectedAgentId = agentId;
    this.messages = [];
    this.chatResponses = [];
    this.suggestions = [];
    this.draft = '';
    this.pendingAttachments = [];
    this.isLoading = false;
    this.isProcessingCompleted = false;
    this.logsDuringLoading = [];

    if (agentId) {
      // this.sidebarCollapsed = true;
      this.currentSessionId = this.generateUUID();
      this.currentSessionId_tracker = this.currentSessionId;
      this.loadRecentQuerySuggestions(agentId);
      const welcomeText = `Welcome to ${this.selectedAgent?.name || 'Agent'}, Please type your query.`;
      this.chatResponses.push({
        id: this.id(),
        role: 'assistant',
        text: welcomeText,
        html: `<div class="streamed-response">${welcomeText}</div>`,
        showThinking: false,
        suggested: ['Show docs', 'Upload a file', 'Give me an example']
      });
    }
  }

  trackByAgency(index: number, agency: any) {
    return agency.agency_id;
  }

  trackByAgent(index: number, agent: any) {
    return agent.agent_id;
  }

  canSend(): boolean {
    return !!this.selectedAgentId && (((this.draft && this.draft.trim().length > 0) || this.pendingAttachments.length > 0));
  }

  onSend(): void {
    if (!this.selectedAgentId) return;
    const text = this.draft?.trim();
    if (!text && this.pendingAttachments.length === 0) return;

    const attachments = this.pendingAttachments.map(a => ({ name: a.name }));

    const userMsg: Message = { id: this.id(), role: 'user', text: text || (attachments.length ? `Sent ${attachments.length} file(s)` : ''), attachments };
    this.messages.push(userMsg);
    this.chatResponses.push({
       id: this.id(), role: 'user', text: text || (attachments.length ? `Sent ${attachments.length} file(s)` : ''), attachments 
    })
    this.lastUserMessage = userMsg;
    this.draft = '';
    this.pendingAttachments = [];

    this.askAssistant(userMsg);
  }
  onFileSelected(event: any): void {
    const files: FileList = event.target.files;
    if (!files || files.length === 0) return;
    const arr = Array.from(files).map(f => ({ name: f.name, file: f }));
    // add to pending attachments to show in composer before sending
    this.pendingAttachments.push(...arr);
  }

  removeAttachment(index: number): void {
    if (index >= 0 && index < this.pendingAttachments.length) this.pendingAttachments.splice(index, 1);
  }

  copyMessage(m: Message): void {
    let text = m.text || '';
    if (!text && m.html) {
      text = m.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (!text) return;

    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => { });
    }
  }

  downloadResponse(m: Message): void {
    let text = m.markdown || m.text || '';
    if (!text && m.plain) {
      text = m.plain;
    }
    if (!text && m.html) {
      text = m.html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (!text) return;

    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `assistant-response-${Date.now()}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  regenerate(m: Message): void {
    // If regenerating an assistant message, re-run the assistant using the last user message
    const seed = this.lastUserMessage;
    if (seed) this.askAssistant(seed, true);
  }

  startNewChat(): void {
    if (!this.selectedAgentId) return;

    this.currentSessionId = this.generateUUID();
    const welcomeText = `Welcome to ${this.selectedAgent?.name || 'Agent'}, Please type your query.`;
    this.chatResponses = [{
      id: this.id(),
      role: 'assistant',
      text: welcomeText,
      html: `<div class="streamed-response">${welcomeText}</div>`,
      showThinking: false,
      suggested: ['Show docs', 'Upload a file', 'Give me an example']
    }];
    this.draft = '';
    this.pendingAttachments = [];
    this.loadRecentQuerySuggestions(this.selectedAgentId);
    this.cdRef.detectChanges();
  }

  selectSuggestion(s: string): void {
    this.draft = s;
    this.cdRef.detectChanges();
  }

  private isRelevantQuery(query: string): boolean {
    if (!query || typeof query !== 'string') return false;
    
    const trimmed = query.trim();
    
    // Min length check (at least 15 chars)
    if (trimmed.length < 15) return false;
    
    // Max length check (should not be excessively long - reasonable limit is ~120 chars)
    if (trimmed.length > 120) return false;
    
    // Filter out queries with excessive repeated characters (e.g., "kkkkkk..." or "aaaaa...")
    // Check if any single character appears more than 4 times consecutively
    if (/(.)\1{4,}/g.test(trimmed)) return false;
    
    // Filter out queries that are mostly special characters or numbers
    // Allow alphanumeric, spaces, and common punctuation (.?!,:-@)
    const alphanumericAndValidChars = trimmed.replace(/[a-zA-Z0-9\s.?!,:\-@'"%]/g, '');
    if (alphanumericAndValidChars.length > trimmed.length * 0.3) return false; // More than 30% special chars
    
    // Filter out queries that are mostly numbers/symbols (no meaningful text)
    const hasLetters = /[a-zA-Z]/.test(trimmed);
    if (!hasLetters) return false;
    
    // Filter out queries with excessive whitespace
    const excessiveWhitespace = trimmed.replace(/\s+/g, ' ');
    if (excessiveWhitespace !== trimmed) return false;
    
    // Filter gibberish by checking vowel-to-consonant ratio and common patterns
    // Real English text has a certain balance; gibberish is often skewed
    const lowerTrimmed = trimmed.toLowerCase();
    const vowels = (lowerTrimmed.match(/[aeiou]/g) || []).length;
    const consonants = (lowerTrimmed.match(/[bcdfghjklmnpqrstvwxyz]/g) || []).length;
    
    // If vowel ratio is too low (< 0.2) or too high (> 0.5), it's likely gibberish
    if (consonants + vowels > 0) {
      const vowelRatio = vowels / (vowels + consonants);
      if (vowelRatio < 0.2 || vowelRatio > 0.5) return false; // Unnatural vowel distribution
    }
    
    // Check for excessively long consonant sequences (common in gibberish)
    // Real words rarely have more than 3 consonants in a row
    if (/[bcdfghjklmnpqrstvwxyz]{4,}/i.test(trimmed)) return false;
    
    // Check for common English word patterns/substrings
    // If the query contains no common letter patterns or words, reject it
    const commonPatterns = /\b(the|and|for|are|but|not|you|all|can|had|her|was|one|our|out|day|get|has|him|his|how|its|may|new|now|old|see|two|way|who|boy|did|its|let|put|say|she|too|use)\b/i;
    
    // If query is reasonably long but contains no common English words, it's likely gibberish
    if (trimmed.length > 30 && !commonPatterns.test(trimmed)) {
      return false;
    }
    
    return true;
  }

  private loadRecentQuerySuggestions(agentId: string | null): void {
    this.suggestionSub?.unsubscribe();
    this.suggestions = [];

    if (!agentId) {
      return;
    }

    const payload = { agent_id: agentId };
    this.suggestionSub = this._homeService.getRecentDataAgent(payload).subscribe({
      next: (res: any) => {
        const items = Array.isArray(res?.data) ? res.data : [];
        const queries = items
          .map((item: any) => item?.user_query)
          .filter((query: any) => this.isRelevantQuery(query));

        const uniqueQueries = queries.filter((query: string, index: number) => {
          const normalized = query.trim().toLowerCase();
          return normalized && queries.findIndex((item: string) => item.trim().toLowerCase() === normalized) === index;
        });

        this.suggestions = uniqueQueries.slice(-3).reverse();
        this.cdRef.detectChanges();
      },
      error: (err: any) => {
        console.error('Failed to load suggestions:', err);
        this.suggestions = [];
      }
    });
  }

  truncateSuggestion(text: string, maxLength = 60): string {
    if (!text) return '';
    return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
  }

  ngOnDestroy(): void {
    this.suggestionSub?.unsubscribe();
    this.unsubscribeFromActiveStreams();
    // Stop voice recognition if active
    if (this.recognition && this.isRecording) {
      this.recognition.stop();
      this.isRecording = false;
    }
  }

  toggleVoice(): void {
    const win: any = globalThis as any;
    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Voice input is not supported in this browser.');
      return;
    }

    if (!this.recognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';
      this.recognition.onresult = (evt: any) => {
        const transcript = Array.from(evt.results).map((r: any) => r[0].transcript).join('');
        this.ngZone.run(() => this.draft = transcript);
      };
      this.recognition.onend = () => {
        this.ngZone.run(() => this.isRecording = false);
      };
    }

    if (this.isRecording) {
      this.recognition.stop();
      this.isRecording = false;
    } else {
      this.recognition.start();
      this.isRecording = true;
    }
  }

  closeChat(): void {
    this.location.back();
  }

  private askAssistant(userMsg: Message, isRegenerate = false): void {
    // Add assistant thinking message
    // const thinkingMsg: Message = { id: this.id(), role: 'assistant', thinking: true };
    // this.messages.push(thinkingMsg);
    this.submitQuery(userMsg.text || '');

    // // Simulated delay for thinking/response
    // setTimeout(() => {
    //   // Replace thinking message with a fake response
    //   const index = this.messages.findIndex(m => m.id === thinkingMsg.id);
    //   if (index === -1) return;

    //   const replyText = this.simulateResponse(userMsg, isRegenerate);
    //   const replySuggested = ['Thanks', 'Explain more', 'Short summary'];
    //   const reply: Message = { id: thinkingMsg.id, role: 'assistant', text: replyText, suggested: replySuggested };
    //   this.messages[index] = reply;
    //   // expose suggested actions globally near the composer
    //   this.suggestions = replySuggested;
    // }, 1200 + Math.random() * 800);
  }

  private simulateResponse(userMsg: Message, isRegenerate: boolean): string {
    if (userMsg.attachments?.length) {
      return `I received ${userMsg.attachments.length} file(s). What would you like me to do with them?`;
    }
    if (isRegenerate) {
      return `Here's an alternative answer to: "${userMsg.text}"`;
    }
    return `Simulated response to: "${userMsg.text}"`;
  }

  private scrollToBottom(): void {
    try {
      const el = this.messagesList?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    } catch (error) { console.warn('scrollToBottom failed', error); }
  }

  private id(): string {
    return Math.random().toString(36).slice(2, 10);
  }

  private generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.trunc(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

stopProcessingAndShowResults() {
  this.isProcessingCompleted = true;
  this.isLoading = false;
  
  const currentIndex = this.chatResponses.length - 1;
  if (currentIndex >= 0) {
    // Ensure thinking logs are set if not already present
    if (!this.chatResponses[currentIndex].thinkingLogs || 
        this.chatResponses[currentIndex].thinkingLogs.length === 0) {
      this.chatResponses[currentIndex].thinkingLogs = this.logsDuringLoading.map(log => ({
        title: log.title,
        content: this.createLogDetails(log.originalData || log),
        expanded: false
      }));
    }

    // Ensure trace data is reflected in the current response
    if (this.chatResponses[currentIndex].traceDetails) {
      this.chatResponses[currentIndex].traceDetails = this.chatResponses[currentIndex].traceDetails;
      this.chatResponses[currentIndex].isLoadingExplanation = false; // Stop loading
      this.chatResponses[currentIndex].explanationDataLoaded = true;  // Data loaded
    }

    // Ensure log data is reflected in the current response
    if (this.chatResponses[currentIndex].logDetails) {
      this.chatResponses[currentIndex].logDetails = this.chatResponses[currentIndex].logDetails;
    }
  }

  this.cdRef.detectChanges();
}

isCompletionMessage(data: any): boolean {
  return (
    data?.type === 'msg' &&
    data?.data?.message?.toLowerCase()?.includes('completed')
  );
}

createLogStep(logData: any, agentName?: string): any {
  // Extract relevant information from the log data
  const eventType = logData.event_type || 'system_event';
  const feature = logData.feature || 'system';
  const status = logData.status || 'processing';
  const logAgentName = agentName || logData.agent_name || '';
  
  // Create a step-like structure
  return {
    timestamp: new Date().toLocaleTimeString(),
    icon: this.getStepIcon(eventType, status),
    title: this.createSimpleLogTitle(logData), 
    desc: this.getStepDescription(eventType, status, logData),
    message: this.formatLogData(logData),
    type: logData.level || logData.type || 'info',
    source: logAgentName,
    agentName: logAgentName, // Keep this for backward compatibility
    originalData: logData
  };
}

getStepIcon(eventType: string, status: string): string {
  const eventTypeLower = eventType.toLowerCase();
  const statusLower = status.toLowerCase();
  
  // Error states
  if (statusLower === 'error' || statusLower === 'failed') {
    return '❌';
  }
  
  // Success states
  if (statusLower === 'success' || statusLower === 'completed') {
    return '✅';
  }
  
  // Specific event types
  if (eventTypeLower === 'agent_process_start') {
    return '🚀';
  } else if (eventTypeLower === 'llm_generation') {
    return '🧠';
  } else if (eventTypeLower === 'kb_documents_retrieved') {
    return '📚';
  } else if (eventTypeLower === 'agent_process_complete') {
    return '🎉';
  }
  
  // Default processing icon
  return '⚙️';
}

getStepTitle(eventType: string, feature: string, logData: any): string {
  const eventTypeLower = eventType.toLowerCase();
  const formattedEventType = this.formatFieldName(eventType);
  
  if (eventTypeLower === 'agent_process_start') {
    return `Starting ${feature || 'process'}`;
  } else if (eventTypeLower === 'llm_generation') {
    return `Generating response using ${logData.model || 'AI model'}`;
  } else if (eventTypeLower === 'kb_documents_retrieved') {
    const docCount = Array.isArray(logData.documents) ? logData.documents.length : 0;
    return `Retrieved ${docCount} documents`;
  } else if (eventTypeLower === 'agent_process_complete') {
    return `Completed ${feature || 'process'}`;
  } else if (eventTypeLower === 'agent_process_error') {
    return `Error in ${feature || 'process'}`;
  }
  
  return formattedEventType;
}

getStepDescription(eventType: string, status: string, logData: any): string {
  const statusLower = status.toLowerCase();
  const eventTypeLower = eventType.toLowerCase();

  // 1. Handle Error Status
  if (statusLower === 'error' || statusLower === 'failed') {
    return logData.message || 'An error occurred during processing';
  }

  // 2. Handle Specific Event Types
  if (eventTypeLower === 'agent_process_start') {
    return `Starting process for ${logData.agent_name}`;
  } 
  
  if (eventTypeLower === 'llm_generation') {
    // Show model info if available
    if (logData.model) {
      return `Using model: ${logData.model}`;
    }
    return 'Generating response...';
  } 
  
  if (eventTypeLower === 'kb_documents_retrieved') {
    // Show document count if available
    if (logData.documents && Array.isArray(logData.documents)) {
      return `Found ${logData.documents.length} relevant documents`;
    }
    return 'Retrieving knowledge base documents...';
  } 
  
  if (eventTypeLower === 'agent_process_complete') {
    return `Process finished with status: ${status}`;
  }

  // 3. Handle Query Presence
  if (logData.query) {
    return `Processing query: "${logData.query}"`;
  }
  
  // 4. Fallback to message if present
  if (logData.message && logData.message.trim()) {
    return logData.message;
  }

  // 5. Final Fallback
  return 'Processing request';
}

formatLogData(logData: any): string {
  if (!logData || typeof logData !== 'object') {
    return String(logData || '');
  }
  
  // Create a formatted representation
  const formattedParts: string[] = [];
  
  // Add event type if present
  if (logData.event_type) {
    const formattedEventType = this.formatFieldName(logData.event_type);
    formattedParts.push(`<strong>${formattedEventType}</strong>`);
  }
  
  // Add feature if present
  if (logData.feature && logData.feature !== '__start__') {
    formattedParts.push(`<span class="text-primary">${logData.feature}</span>`);
  }
  
  // Add agent name if present
  if (logData.agent_name) {
    formattedParts.push(`<span class="text-info">by ${logData.agent_name}</span>`);
  }
  
  // Add model/provider for LLM generation
  if (logData.event_type === 'llm_generation' && logData.model) {
    formattedParts.push(`using <span class="text-warning">${logData.model}</span>`);
    if (logData.provider) {
      formattedParts.push(`(${logData.provider})`);
    }
  }
  
  // Add document count for knowledge base events
  if (logData.event_type === 'kb_documents_retrieved' && logData.documents) {
    const docCount = Array.isArray(logData.documents) ? logData.documents.length : 0;
    formattedParts.push(`<span class="text-success">${docCount} documents</span>`);
  }
  
  // Add query for knowledge base events
  if (logData.query) {
    formattedParts.push(`for: <em>"${logData.query}"</em>`);
  }
  
  // Add status with appropriate styling
  if (logData.status) {
    const statusClass = this.getStatusClass(logData.status);
    formattedParts.push(`<span class="${statusClass}">${logData.status}</span>`);
  }
  
  // Add message if present and not empty
  if (logData.message && logData.message.trim()) {
    formattedParts.push(`: ${logData.message}`);
  }
  
  // If we have no formatted parts, create a simple representation
  if (formattedParts.length === 0) {
    // Create a simple key-value representation
    const entries = Object.entries(logData)
      .filter(([key, value]) => value !== null && value !== undefined && value !== '')
      .slice(0, 3); // Limit to first 3 entries to avoid clutter
    
    if (entries.length > 0) {
      entries.forEach(([key, value]) => {
        const formattedKey = this.formatFieldName(key);
        const formattedValue = typeof value === 'object' ? 
          (Array.isArray(value) ? `${value.length} items` : 'object') : 
          String(value);
        formattedParts.push(`${formattedKey}: ${formattedValue}`);
      });
    } else {
      return 'System event';
    }
  }
  
  return formattedParts.join(' ');
}

formatFieldName(fieldName: string): string {
  if (!fieldName) return '';
  
  return fieldName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

getStatusClass(status: string): string {
  if (!status) return '';
  
  const statusLower = status.toLowerCase();
  if (statusLower === 'success' || statusLower === 'completed') {
    return 'text-success';
  } else if (statusLower === 'error' || statusLower === 'failed') {
    return 'text-danger';
  } else if (statusLower === 'warning' || statusLower === 'in_progress') {
    return 'text-warning';
  } else {
    return 'text-secondary';
  }
}

filterLogFields(logData: any): any {
  if (!logData || typeof logData !== 'object') {
    return logData;
  }
  
  // Create a copy to avoid modifying the original
  const filtered = { ...logData };
  
  // List of ID and timestamp fields to remove
  const fieldsToRemove = [
    'log_id',
    'run_id',
    'session_id',
    'timestamp',
    'trace_id'
  ];
  
  // Remove the ID and timestamp fields
  fieldsToRemove.forEach(field => {
    delete filtered[field];
  });
  
  return filtered;
}

createLogsHtml(logs: Array<any>): string {
  if (!logs || logs.length === 0) {
    return 'No process logs available.';
  }
  
  let html = '<div class="log-summary">';
  
  logs.forEach((log, index) => {
    const logData = log.originalData || log;
    
    // Create a title in the format "feature in agent_name"
    const title = this.createSimpleLogTitle(logData);
    
    // Create only the required fields for expanded view
    const detailsHtml = this.createSimpleLogDetails(logData);
    
    html += `<div class="log-entry">
      <details class="log-accordion mb-2 border rounded shadow-sm" id="log-accordion-${index}">
        <summary class="d-flex justify-content-between align-items-center px-3 py-2 bg-light cursor-pointer">
          <div class="d-flex align-items-center">
            <span class="log-icon me-2">${log.icon}</span>
            <strong class="me-2">${title}</strong>
            <span class="text-muted small">${log.timestamp}</span>
          </div>
          <i class="fa-solid fa-chevron-down transition-transform"></i>
        </summary>
        <div class="p-3 bg-white">
          ${detailsHtml}
        </div>
      </details>
    </div>`;
  });
  
  html += '</div>';
  
  return html;
}

createSimpleLogTitle(logData: any): string {
  const eventType = logData.event_type;
  const agentName = logData.agent_name;

  // 1. Format the event_type (e.g., "llm_generation" -> "Llm Generation")
  // If event_type is missing, this will return an empty string
  let title = this.formatFieldName(eventType || '');

  // 2. Append agent_name if it exists
  if (agentName && title) {
    return `${title} in ${agentName}`;
  }

  // 3. Return just the event_type title (or empty string if no event_type)
  return title;
}

createSimpleLogDetails(logData: any): string {
  if (!logData || typeof logData !== 'object') {
    return '<p class="text-muted">No details available</p>';
  }
  
  let html = '<div class="log-details-simple">';
  
  // Only show these three specific fields
  const fieldsToShow = [
    { key: 'event_type', label: 'Event Type' },
    { key: 'status', label: 'Status' },
    { key: 'timestamp', label: 'Timestamp' }
  ];
  
  fieldsToShow.forEach(field => {
    if (logData[field.key] !== undefined && logData[field.key] !== null && logData[field.key] !== '') {
      let value = logData[field.key];
      let valueClass = '';
      
      // Add styling for status
      if (field.key === 'status') {
        valueClass = this.getStatusClass(logData[field.key]);
      } else if (field.key === 'event_type') {
        valueClass = 'text-primary';
      } else if (field.key === 'timestamp') {
        valueClass = 'text-muted';
      }
      
      // Format the value
      let formattedValue: string;
      if (typeof value === 'object') {
        formattedValue = `<pre class="mb-0 mt-1 p-2 bg-light rounded small">${JSON.stringify(value, null, 2)}</pre>`;
      } else {
        formattedValue = String(value);
      }
      
      html += `
        <div class="log-field-simple mb-2">
          <div class="log-field-label-simple text-muted small">${field.label}:</div>
          <div class="log-field-value-simple ${valueClass}">${formattedValue}</div>
        </div>
      `;
    }
  });
  
  html += '</div>';
  return html;
}

createLogDetails(logData: any): string {
  if (!logData || typeof logData !== 'object') {
    return '<p class="text-muted">No details available</p>';
  }
  
  let html = '<div class="log-details">';
  
  // Only show these specific fields
  const fieldsToShow = [
    { key: 'event_type', label: 'Event Type' },
    { key: 'feature', label: 'Feature' },
    { key: 'status', label: 'Status' },
    { key: 'timestamp', label: 'Timestamp' }
  ];
  
  fieldsToShow.forEach(field => {
    if (logData[field.key] !== undefined && logData[field.key] !== null && logData[field.key] !== '') {
      let value = logData[field.key];
      
      // Format value (inline)
      let formattedValue: string;
      if (typeof value === 'object') {
         formattedValue = JSON.stringify(value);
      } else {
         formattedValue = String(value);
      }

      // Generate inline HTML: Label: Value
      // Removed valueClass to remove color
      html += `
        <div class="mb-1">
          <span class="text-muted small me-2">${field.label}:</span>
          <span class="small">${formattedValue}</span>
        </div>
      `;
    }
  });
  
  html += '</div>';
  return html;
}

extractTitleFromResponse(text:any, agentName?: string) { 
  let title = 'Response';

  if (typeof text !== 'string' || !text) {
    return agentName || title;
  }
  
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) {
    return agentName || title;
  }

  let titleLineIndex = lines.findIndex(item =>
    ['#', 'title:', "**"].some(s => item.toLowerCase().includes(s))
  );

  if (titleLineIndex === -1) {
    titleLineIndex = 0;
  }

  const line = lines[titleLineIndex];

  const parts = line.split(':').filter(Boolean);

  if (parts.length > 1) {
    title = parts[1];
  } else {
    title = parts[0];
  }

  const output = title.replace(/^[#* ]+|[#* ]+$/g, "");

  return output || agentName || title;
}

  submitQuery(text: string) {
    const agentId = this.selectedAgentId || '69a59f503eebff252d906780';
    const sessionId = this.currentSessionId || this.generateUUID();
    const eventId = this.generateUUID();
    const mapId = this.generateUUID();

    // Track this session to prevent updates if agency/agent changes
    this.currentSessionId_tracker = sessionId;

    const query = text.trim();
    if (!query) {
      return;
    }

    const payload: any = {
      userQuery: query,
      agent_id: agentId,
      user_id: 'NaveenKumar.ReddyR@movate.com',
      master_agent_id: '69a71759ad9aa4e5502916fc',
      session_id: sessionId,
      event_id: eventId,
      map_id: mapId,
      prompt_title: '',
      isSavedToRepo: false
    };
    console.log('Payload for chatbotAgent with session_id:', payload);

    this.showThinking = false;
    // Clear previous logs and reset flag
    this.logsDuringLoading = [];
    this.isThinkingCollapsed = false;   

    const streamIndex = this.chatResponses.push({
      isLoading: true,
      title: 'Generating...',
      html: 'Thinking<span class="dots">...</span>',
      plain: '',
      json: {},
      table: { headers: [], rows: [] },
      explanation: '',
      thinking: false,
      showThinking: false,
      isThinkingBoxCollapsed: true,
      traceDetails: null,
      logDetails: [],
      showChatMessages: false,
      showChatMessagesTab: false,
      activeTab: 'trace',
      isLoadingExplanation: true,
      explanationDataLoaded: false,
      role: 'assistant'
    }) - 1;
    this.cdRef.detectChanges();

    const unifiedResponse = this._homeService.chatbotAgentUnified(payload);
  // Handle trace details
  // let traceDetails: any = null;
  // let traceDetailsSubscription = unifiedResponse.traceDetails.subscribe({
  //   next: (chunk) => {
  //     if (chunk.type === 'trace_details') {
  //     traceDetails = chunk.data;
  //     this.chatResponses[streamIndex].traceDetails = traceDetails;
  //     this.chatResponses[streamIndex].isLoadingExplanation = false;
  //     this.chatResponses[streamIndex].explanationDataLoaded = true;
  //     this.cdRef.detectChanges();
  //   }
  //   },
  //   error: (err) => console.error('❌ Error in trace details:', err)
  // });

  // Handle log details
//   let logDetails: any[] = [];
//   let logDetailsSubscription = unifiedResponse.logDetails.subscribe({
//   next: (chunk) => {
//     if (this.isProcessingCompleted) return;
//     if (this.isCompletionMessage(chunk)) {
//       console.log('Metrics completed — showing thinking with logs');
//       this.isLoading = false;
//       this.isProcessingCompleted = true;
//       const logsHtml = this.createLogsHtml(this.logsDuringLoading);
//       if (this.chatResponses[streamIndex]) {
//         this.chatResponses[streamIndex].thinkingLogs = this.logsDuringLoading.map(log => ({
//           title: log.title,
//           content: this.createLogDetails(log.originalData || log),
//           expanded: false
//         }));
//       }
//       // ✅ IMMEDIATELY FORMAT THE RESPONSE WHEN showThinking BECOMES TRUE
//       this.formatAndSetResponse(streamIndex, accumulatedText);
//       this.showThinking = true;
//       this.cdRef.detectChanges();
//       return;
//     }
//     if (chunk.type === 'log') {
//       logDetails.push(chunk.data);
//       if (!this.hasRealLogs) this.hasRealLogs = true;
//       const logEntry = this.createLogStep(chunk.data);
//       this.logsDuringLoading.push(logEntry);
//       this.cdRef.detectChanges();
//       this.scrollToBottom();
//     }
//   },
//   error: (err) => {
//     console.error(' Error in log details:', err);
//     if (!this.isProcessingCompleted) this.stopProcessingAndShowResults();
//   }
// });

  // Handle log details
  let logDetails: any[] = [];
  const logDetailsSubscription = unifiedResponse.logDetails.subscribe({
    next: (chunk) => {
      // Check if session has changed - if so, ignore this update
      if (this.currentSessionId_tracker !== sessionId) return;
      
      if (this.isCompletionMessage(chunk)) {
        console.log('Metrics completed — showing thinking with logs');
        this.isLoading = false;
        this.isProcessingCompleted = true;
        const logsHtml = this.createLogsHtml(this.logsDuringLoading);
        if (this.chatResponses[streamIndex]) {
          this.chatResponses[streamIndex].thinkingLogs = this.logsDuringLoading.map(log => ({
            title: log.title,
            content: this.createLogDetails(log.originalData || log),
            expanded: false
          }));
        }
        // ✅ IMMEDIATELY FORMAT THE RESPONSE WHEN showThinking BECOMES TRUE
        // this.formatAndSetResponse(streamIndex, accumulatedText);
        this.showThinking = true;
        this.cdRef.detectChanges();
        return;
      }
      if (chunk.type === 'log') {
        logDetails.push(chunk.data);
        console.log('Received log chunk:', logDetails);
        if (!this.hasRealLogs) this.hasRealLogs = true;
        const logEntry = this.createLogStep(chunk.data);
        this.logsDuringLoading.push(logEntry);
        this.cdRef.detectChanges();
        this.scrollToBottom();
      }
    },
    error: (err) => {
      console.error(' Error in log details:', err);
      if (!this.isProcessingCompleted) this.stopProcessingAndShowResults();
    }
  });
  this.activeStreamSubscriptions.push(logDetailsSubscription);

  // Handle stream content
  let accumulatedText = '';
  let hasRenderedResponse = false;

  const renderStreamedText = (textChunk: string) => {
    // Check if session has changed - if so, ignore this update
    if (this.currentSessionId_tracker !== sessionId) return;
    
    accumulatedText += textChunk;
    // Convert both escaped (\\n) and literal (\n) to actual newlines
    const displayText = accumulatedText
      .replaceAll(String.raw`\n`, '\n')  // Handle literal \n
      .replaceAll(String.raw`\\n`, '\n'); // Handle escaped \\n
    const cleanedDisplay = displayText
      .replace(/```psv[\s\S]*?```/gi, '')
      .replace(/```\s*psv[\s\S]*?```/gi, '')
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();

    const markdownHtml = this.markdownParser.render(cleanedDisplay);
    const plainText = markdownHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const hasText = plainText.length > 0;

    this.chatResponses[streamIndex] = {
      ...this.chatResponses[streamIndex],
      isLoading: !hasText,
      event_id: eventId,
      map_id: mapId,
      markdown: cleanedDisplay,
      plain: hasText ? plainText : this.chatResponses[streamIndex].plain || '',
      text: hasText ? plainText : this.chatResponses[streamIndex].text || '',
      html: hasText ? `<div class="streamed-response">${markdownHtml}</div>` : this.chatResponses[streamIndex].html || '',
      title: this.selectedAgent?.name || 'Assistant',
      explanation: hasText ? plainText : this.chatResponses[streamIndex].explanation || '',
      thinking: !hasText,
      showThinking: !hasText,
      activeTab: 'trace',
      isLoadingExplanation: !hasText,
      explanationDataLoaded: hasText,
      role: 'assistant'
    };
    if (hasText) {
      hasRenderedResponse = true;
    }
    this.cdRef.detectChanges();
    // console.log('Updated chatResponses[streamIndex]:', this.chatResponses);
    if (this.chatResponses[streamIndex]) {
        this.chatResponses[streamIndex].thinkingLogs = this.logsDuringLoading.map(log => ({
          title: log.title,
          content: this.createLogDetails(log.originalData || log),
          expanded: false
        }));
      }
    this.cdRef.detectChanges();
    this.scrollToBottom();
  };

  const streamSubscription = unifiedResponse.stream.subscribe({
    next: (chunk) => {
      // Check if session has changed - if so, ignore this update
      if (this.currentSessionId_tracker !== sessionId) return;
      
      if (chunk === 'end' || chunk === '[DONE]' || chunk === '[done]') {
        return;
      }

      let textChunk = '';
      if (typeof chunk === 'string') {
        textChunk = chunk.replace(/^data:\s*/i, '').replaceAll(String.raw`\\"`, '"').replaceAll(String.raw`\\t`, ' ');
      } else if (chunk && typeof chunk === 'object' && 'data' in chunk) {
        textChunk = String((chunk as any).data || '');
      }

      if (!textChunk) {
        return;
      }

      this.ngZone.run(() => {
        renderStreamedText(textChunk);
      });
    },
    error: (err) => {
      this.ngZone.run(() => {
        console.error('❌ Streaming error:', err);
        const currentResponse = this.chatResponses[streamIndex] || {};
        const responseAlreadyRendered = hasRenderedResponse || (!!currentResponse.html && currentResponse.html.toString().trim() !== '');

        if (responseAlreadyRendered) {
          this.chatResponses[streamIndex] = {
            ...currentResponse,
            isLoading: false,
            isLoadingExplanation: false,
            explanationDataLoaded: true,
            thinking: false,
            showThinking: false
          };
        } else {
          this.chatResponses[streamIndex] = {
            ...currentResponse,
            html: '<div class="chat-line error">Failed to generate response.</div>',
            plain: 'Failed to generate response.',
            json: { error: true, message: 'Failed to generate response.' },
            table: { headers: [], rows: [] },
            title: 'Error',
            explanation: 'Failed to generate response',
            thinking: false,
            showThinking: false,
            isLoading: false,
            isLoadingExplanation: false,
            explanationDataLoaded: true
          };
        }
        this.cdRef.detectChanges();
      });
    },
    complete: () => {
      this.ngZone.run(() => {
        console.log(this.chatResponses, '✅ Streaming completed');
        this.chatResponses[streamIndex] = {
          ...this.chatResponses[streamIndex],
          isLoading: false,
          isLoadingExplanation: false,
          explanationDataLoaded: true,
          thinking: false,
          showThinking: false
        };
        this.cdRef.detectChanges();
      });
    }
  });
  this.activeStreamSubscriptions.push(streamSubscription);
}

// toggleThinkingItem(i: number) {
//     event.stopPropagation();
    
//       const logs = this.chatResponses[this.chatResponses.length - 1]?.thinkingLogs;
//       if (logs && logs[i]) {
//           logs[i].expanded = !logs[i].expanded;
          
//           this.cdRef.detectChanges();
          
//           if (logs[i].expanded) {
//               requestAnimationFrame(() => {
//                   setTimeout(() => {
//                       const collapseElement = document.getElementById('collapseExample');
//                       const thinkingItem = collapseElement?.querySelector(`.thinking-item:nth-child(${i + 1})`);
//                       if (thinkingItem) {
//                           const elementRect = thinkingItem.getBoundingClientRect();
//                           const containerRect = collapseElement.getBoundingClientRect();
                          
//                           const scrollTop = collapseElement.scrollTop;
//                           const targetScrollTop = scrollTop + (elementRect.top - containerRect.top) - 50;
                          
//                           collapseElement.scrollTo({
//                               top: targetScrollTop,
//                               behavior: 'smooth'
//                           });
//                       }
//                   }, 50);
//               });
//           }
//       }
//   }
}
