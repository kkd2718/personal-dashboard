// CareNote workspace API types (PLAN_CARENOTE.md §1). Fixed contract from CareNote's M24 —
// don't rename fields to match this repo's style.

export type CategoryKey = 'laser' | 'lifting' | 'booster' | 'botox' | 'filler' | 'etc';

export type FieldType = 'number' | 'text' | 'textarea' | 'select' | 'multiselect' | 'region_units' | 'checkbox';

export interface ParamField {
  key: string;
  label: string;
  type: FieldType;
  unit?: string;
  required?: boolean;
  step?: number;
  min?: number;
  max?: number;
  options?: string[];
  allowCustom?: boolean;
  regions?: string[];
  placeholder?: string;
  help?: string;
}

export interface ParamSchema {
  version: 1;
  fields: ParamField[];
}

export type ParamValue = string | number | boolean | string[] | Record<string, number>;

export interface Person {
  id: number;
  name: string;
  color: string;
  relation: string | null;
  birthYear: number | null;
  memo: string | null;
  sortOrder: number;
  active: boolean;
  createdAt: string;
}

export interface ProcedureType {
  id: number;
  name: string;
  category: CategoryKey;
  paramSchema: ParamSchema;
  intervalMinDays: number | null;
  intervalMaxDays: number | null;
  seriesDefaultCount: number | null;
  seriesRestDays: number | null;
  sessionGraceDays: number | null;
  note: string | null;
  sortOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CareRecord {
  id: number;
  personId: number;
  procedureTypeId: number;
  date: string;
  params: Record<string, ParamValue>;
  seriesIndex: number | null;
  seriesTotal: number | null;
  cost: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Normalized client-side error. Branch on `code`, never `message`. */
export interface CareApiError {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
  status: number;
}

export interface CareRecordInput {
  personId: number;
  procedureTypeId: number;
  date: string;
  params: Record<string, ParamValue>;
  seriesIndex?: number | null;
  seriesTotal?: number | null;
  cost?: number | null;
  note?: string | null;
}

export type CareRecordPatch = Partial<CareRecordInput>;
