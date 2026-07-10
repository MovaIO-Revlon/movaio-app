export interface ILyzrTraceQuery {
  agent_id: string;
  start_date: string; // utc
  end_date: string; // utc
}

export interface ILyzrTraceDetailsQuery {
  agent_id: string;
  trace_id: string;
  request_id: string;
  project?: string;
}

export interface ILyzrGroupedLogsQuery {
  run_id: string;
  log_id: string;
  trace_id: string;
  agent_id: string;
}

export interface ILyzrTrace {
  trace_id: string;
  trace_start_time: string;
  action_cost: number;
  llm_input_tokens:number;
  llm_output_tokens:number;
  trace_duration: number;
  name: string;
  runs: [string, string][];
}

export interface ILyzrTraceDetails {
  trace_id: string;
  log_id: string;
  agent_id: string;
  session_id: string;
  user_id: string;
  run_id: string;
  org_id: string;
  api_key: string;
  latency_ms: number;
  created_at: string;
  start_time: string;
  end_time: string;
  stream: number;
  llm_provider: string;
  language_model: string;
  call_type: string;
  function_call: string;
  num_input_tokens: number;
  num_output_tokens: number;
  total_tokens: number;
  cost: number;
  llm_actions: number;
  tool_actions: number;
  actions: number;
  input_messages: InputMessage[];
  output_messages: OutputMessages;
  email: string;
  agent_name: string;

  chat_messages: {
    input_message: string;
    output_message: string;
  };

  // ── ADD THIS BLOCK ────────────────────────────────────────
  spans?: Span[];                // <-- main fix
  span_count?: number;
}

export interface Span {
  SpanName: string;
  SpanAttributes: Record<string, any>;

  // These are the actual top-level keys from the API
  'Events.Name'?: string[];                          // ← string literal type
  'Events.Attributes'?: Record<string, any>[];       // ← array of objects

  // Optional: keep the old nested shape if some responses use it
  Events?: {
    Name?: string[];
    Attributes?: Record<string, any>[];
  };
}

export interface InputMessage {
  role: string;
  content: string;
}

export interface OutputMessages {
  content: string;
  role: string;
}

export interface ILyzrGroupedLogsQuery {
  log_id: string;
  run_id: string;
  trace_id: string;
  agent_id: string;
}

export interface ILyzrGroupedLogDetailsQuery {
  log_id: string;
  run_id: string;
  trace_id: string;
  agent_id: string;
  feature: string;
}

export interface IGroupedLog {
  duration_seconds: number;
  end_time: string;
  feature: string;
  log_count: number;
  start_time: string;
}

export interface ILogDetail {
  data: {
    agent_name: string;
    session_id: string;
  };
  event_type: string;
  feature: string;
  level: string;
  message: string;
  status: string;
  timestamp: string;
}
// Add these interfaces to your types file
export interface IWorkflowTrace {
  agent_id: string;
  agent_name: string;
  trace_id: string;
  trace_summary: {
    action_cost: number;
    agent_id: string | null;
    llm_input_tokens: number;
    llm_output_tokens: number;
    name: string;
    total_spans: number;
    trace_duration: number;
    trace_end_time: string;
    trace_start_time: string;
  };
  trace_details: {
    spans: Array<{
      SpanName: string;
      SpanAttributes: Record<string, any>;
      "Events.Name": string[];
      "Events.Attributes": Record<string, any>[];
    }>;
  };
  captured_at: string;
  real_time_logs?: any[];
}

export interface IWorkflowTraceQuery {
  workflow_id: string;
  event_id: string;
  limit?: number;
  agents: Array<{
    agent_id: string;
    agent_name: string;
    task_index: number;
  }>;
   project?: string; 
}

export interface IWorkflowTraceResponse {
  message: string;
  success: boolean;
  data: {
    event_id: string;
    limit_per_agent: number;
    traces: IWorkflowTrace[];
    project_name?: string; 
    user_type?: string; 
    traces_captured: number;
    workflow_id: string;
  };
}