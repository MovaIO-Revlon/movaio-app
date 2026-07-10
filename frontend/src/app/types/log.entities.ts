export enum LogType {
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
  DEBUG = 'DEBUG',
}

export interface ILogBase {
  id: string;
  message: string;
  project: string;
  timestamp: string;
  type: LogType;
}

export interface IRequestLog extends ILogBase {
  rtype: 'request';
  request_id: string;
  source: string;
  method: string;
  path: string;
  query: string;
  body: string;
  headers: string;
  user: string;
  ip: string;
}

export interface IResponseLog extends ILogBase {
  rtype: 'response';
  request_id: string;
  status: string;
  desc: string;
  body: string;
  headers: string;
}

export interface IEventLog extends ILogBase {
  rtype: 'event';
  request_id: string;
  desc: string;
  body: string;
  status?: string;
}

export type TLog = IRequestLog | IResponseLog | IEventLog;

export interface ILogQuery {
  fromDate?: string;
  toDate?: string;
  project?: string;
}

interface ILogBaseEvent {
  message?: string;
}
interface ILogQueryStartEvent extends ILogBaseEvent {
  filters: ILogQuery;
  type: 'start';
}
interface ILogQueryProgressEvent extends ILogBaseEvent {
  files_count?: number;
  files_processed?: number;
  total_files?: number;
  type: 'progress';
}
interface ILogQueryLogsEvent extends ILogBaseEvent {
  data: TLog[];
  count: number;
  type: 'logs';
}

interface ILogQueryEndEvent extends ILogBaseEvent {
  files_processed: 1;
  total: number;
  type: 'end';
}

export type TLogQueryResponse =
  | ILogQueryStartEvent
  | ILogQueryProgressEvent
  | ILogQueryLogsEvent
  | ILogQueryEndEvent;
