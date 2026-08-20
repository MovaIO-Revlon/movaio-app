import { FormControl } from '@angular/forms';

export type ApiSuccess<T, K extends string = 'data'> = { [Key in K]: T } & {
  success: true;
  message: string;
  data: T;
};

export interface ApiError {
  success: false;
  message: string;
  error: any;
  details?: string;
}

export type ApiResponse<T, K extends string = 'data'> = ApiSuccess<T, K>;

export type FormModel<T> = {
  [K in keyof T]: FormControl<T[K]>;
};

export type KeyOfUnion<T> = T extends T ? keyof T : never;

export type ArrayIfy<T> = T extends unknown ? T[] : never;
