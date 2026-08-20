export interface IAgent {
  _id: string;
  agent_id: string;
  agent_owner: string;
  agent_prompt: string;
  agent_type_id: string;
  agent_type_name: string;
  api_agent_id: string;
  agent_api_key: string;
  agent_api_url: string;
  agent_session_id: string;
  user_id: string;
  description: string;
  feedback: string;
  foundation_ethic_ai: any;
  foundation_guardrails_ai: any;
  foundation_resp_ai: any;
  isDeleted: boolean;
  knowledge_store_id: string;
  mcp_connector_id: string;
  mcp_connector_name: string;
  model: any;
  model_name: string;
  name: string;
  prompt_template: string;
  rating: number;
  ref_output: string;
  role_id: string;
  role_name: string;
  run_count: number;
  run_status: string;
  scheduleFrequency: string;
  schedulerTime: any;
  status: string;
  trending: boolean;
  updated_by: string;
  updated_ts: string;
  knowledge_store: { name: string };
  session_start_url?: string;
  session_end_url?: string;
  internal_tool: {
    connection_id: string;
    tool: string;
    tool_name: string;
  }[];
}

export interface IVoiceAgent {
  config: IConfig;
  createdAt: string;
  id: string;
  shared: boolean;
  updatedAt: string;
  updatedByUserId: string;
}

interface IConfig {
  agent_description: string;
  agent_goal: string;
  agent_instructions: string;
  agent_name: string;
  agent_role: string;
  api_key: string;
  audio_recording_enabled: boolean;
  avatar: {
    anam: {
      avatarId: string;
    };
    enabled: boolean;
    provider: string;
  };
  background_audio: {
    ambient: {
      enabled: boolean;
      source: string;
      volume: number;
    };
    enabled: boolean;
    tool_call: {
      enabled: boolean;
      sources: Source[];
    };
    turn_taking: {
      enabled: boolean;
      sources: {
        probability: number;
        source: string;
        volume: number;
      }[];
    };
  };
  conversation_start: {
    who: string;
  };
  engine: {
    kind: string;
    language: string;
    llm: string;
    voice: string;
  };
  engine_pipeline: {
    kind: string;
    language: string;
    llm: string;
    stt: string;
    tts: string;
    voice_id: string;
  };
  engine_realtime: {
    kind: string;
    language: string;
    llm: string;
    voice: string;
  };
  lyzr_tools: {
    action_names: string[];
    credential_id: string;
    persist_auth: boolean;
    provider_uuid: string;
    tool_name: string;
    tool_source: string;
  }[];
  noise_cancellation: {
    enabled: boolean;
    type: string;
  };
  preemptive_generation: boolean;
  prompt: string;
  pronunciation_correction: boolean;
  turn_detection: string;
  vad_enabled: boolean;
}
export interface Source {
  probability: number;
  source: string;
  volume: number;
}

export interface IAgency {
  agency_desc: string;
  agency_id: string;
  agency_name: string;
  agency_run_count: number;
  agency_type: string;
  agent_type_counts: Record<
    'Insight Agent' | 'Master Agent' | 'Task Agent' | 'Workflow Agent',
    number
  >;
  agents: IAgent[];
  assigned_to: string;
  avatar?: string;
  created_by?: string;
  created_ts?: string;
  last_run_ts?: string;
  provider_id?: string;
  provider_name: string;
  rating: number;
  trending_agency: boolean;
  updated_ts?: string;
  usage_count: number;
}
