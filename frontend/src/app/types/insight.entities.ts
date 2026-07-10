export interface IInsight {
  _id: string;
  agent_id: string;
  agent_name: string;
  createdBy_ts: string;
  created_ts: string;
  current_ts: string;
  eventTracking_UniqueId: string;
  event_ai_accuracy: number;
  event_desc: string;
  event_id: string;
  event_name: string;
  event_output: string;
  event_status: string;
  input_source: string;
  is_human_verified: boolean;
}
