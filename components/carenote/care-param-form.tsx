'use client';

// Controlled form for a CareNote ParamSchema. Behaviour ported from CareNote's
// components/params/* (read-only reference, not imported) — one widget per
// FieldType, restyled with this repo's Tailwind tokens.
import { useState } from 'react';
import type { ComponentType } from 'react';
import type { ParamField, ParamSchema, ParamValue } from '@/lib/carenote/types';

interface FieldProps {
  field: ParamField;
  value: ParamValue | undefined;
  onChange: (value: ParamValue | undefined) => void;
  error?: string;
}

const inputClass = (error?: string) =>
  `w-full min-w-0 rounded-md border bg-transparent px-2 py-1 text-sm ${error ? 'border-danger' : 'border-border'}`;

function NumberField({ field, value, onChange, error }: FieldProps) {
  const numValue = typeof value === 'number' ? value : '';
  return (
    <div>
      <input
        type="number"
        value={numValue}
        step={field.step ?? 'any'}
        min={field.min}
        max={field.max}
        placeholder={field.placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === '' ? undefined : Number(raw));
        }}
        className={`${inputClass(error)} max-w-32`}
      />
      {error && <p className="mt-0.5 text-xs text-danger">{error}</p>}
    </div>
  );
}

function TextField({ field, value, onChange, error }: FieldProps) {
  const strValue = typeof value === 'string' ? value : '';
  return (
    <div>
      <input
        type="text"
        value={strValue}
        placeholder={field.placeholder}
        maxLength={200}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        className={inputClass(error)}
      />
      {error && <p className="mt-0.5 text-xs text-danger">{error}</p>}
    </div>
  );
}

/** Tap-to-pick chips for a free-text field (부위): reuses past values verbatim so
 * CareNote's per-region grouping isn't split by spelling. */
export interface ParamPick {
  key: string;
  options: string[];
  selected: string[];
  /** New-record mode: several picks → one record per value. */
  multiple: boolean;
  onChange: (selected: string[]) => void;
}

function PickField({ field, pick, error }: { field: ParamField; pick: ParamPick; error?: string }) {
  const [draft, setDraft] = useState('');
  const options = [...pick.options, ...pick.selected.filter((v) => !pick.options.includes(v))];

  function toggle(v: string) {
    if (pick.selected.includes(v)) pick.onChange(pick.selected.filter((x) => x !== v));
    else pick.onChange(pick.multiple ? [...pick.selected, v] : [v]);
  }

  function addDraft() {
    const v = draft.trim();
    if (!v) return;
    if (!pick.selected.includes(v)) pick.onChange(pick.multiple ? [...pick.selected, v] : [v]);
    setDraft('');
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {options.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {options.map((v) => {
            const on = pick.selected.includes(v);
            return (
              <button
                key={v}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(v)}
                className={`rounded-full border px-2 py-0.5 text-xs ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-border text-foreground/70'}`}
              >
                {on ? '✓ ' : ''}
                {v}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex min-w-0 gap-1.5">
        <input
          type="text"
          value={draft}
          maxLength={200}
          placeholder={options.length > 0 ? '새 부위 추가' : field.placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addDraft();
            }
          }}
          className={inputClass(error)}
        />
        <button type="button" onClick={addDraft} className="shrink-0 text-sm text-accent">
          추가
        </button>
      </div>
      {pick.multiple && pick.selected.length > 1 && (
        <p className="text-xs text-foreground/50">부위 {pick.selected.length}곳 — 부위별로 따로 기록돼요.</p>
      )}
      {error && <p className="mt-0.5 text-xs text-danger">{error}</p>}
    </div>
  );
}

function TextareaField({ field, value, onChange, error }: FieldProps) {
  const strValue = typeof value === 'string' ? value : '';
  return (
    <div>
      <textarea
        value={strValue}
        placeholder={field.placeholder}
        maxLength={2000}
        rows={3}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        className={inputClass(error)}
      />
      {error && <p className="mt-0.5 text-xs text-danger">{error}</p>}
    </div>
  );
}

const CUSTOM = '__custom__';

/** allowCustom fields expose a "직접 입력" option that swaps to a free-text input. */
function SelectField({ field, value, onChange, error }: FieldProps) {
  const options = field.options ?? [];
  const strValue = typeof value === 'string' ? value : '';
  const isCustomValue = strValue !== '' && !options.includes(strValue);
  const [customMode, setCustomMode] = useState(isCustomValue);

  return (
    <div className="flex flex-col gap-1">
      <select
        value={customMode ? CUSTOM : strValue}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustomMode(true);
            onChange(undefined);
          } else {
            setCustomMode(false);
            onChange(e.target.value === '' ? undefined : e.target.value);
          }
        }}
        className={inputClass(error)}
      >
        <option value="">선택 안 함</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        {field.allowCustom && <option value={CUSTOM}>직접 입력</option>}
      </select>
      {customMode && field.allowCustom && (
        <input
          type="text"
          value={strValue}
          placeholder={field.placeholder}
          maxLength={100}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
          className={inputClass()}
        />
      )}
      {error && <p className="mt-0.5 text-xs text-danger">{error}</p>}
    </div>
  );
}

function MultiSelectField({ field, value, onChange, error }: FieldProps) {
  const options = field.options ?? [];
  const selected = Array.isArray(value) ? (value as string[]) : [];

  function toggle(opt: string) {
    const next = selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt];
    onChange(next.length > 0 ? next : undefined);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <label
            key={opt}
            className="flex min-w-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-sm"
          >
            <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} />
            <span className="truncate">{opt}</span>
          </label>
        ))}
      </div>
      {error && <p className="mt-0.5 text-xs text-danger">{error}</p>}
    </div>
  );
}

/** Region label + number input rows, with an auto-computed total and a
 * "+ 부위 추가" row to add regions beyond field.regions. */
function RegionUnitsField({ field, value, onChange, error }: FieldProps) {
  const values: Record<string, number> =
    typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, number>) : {};
  const baseRegions = field.regions ?? [];
  const extraRegions = Object.keys(values).filter((k) => !baseRegions.includes(k));
  const rows = [...baseRegions, ...extraRegions];
  const [newRegion, setNewRegion] = useState('');

  function setRegion(name: string, amount: number | undefined) {
    const next = { ...values };
    if (amount === undefined || Number.isNaN(amount)) delete next[name];
    else next[name] = amount;
    onChange(next);
  }

  function addRegion() {
    const name = newRegion.trim().slice(0, 20);
    if (!name || rows.includes(name)) return;
    onChange({ ...values, [name]: 0 });
    setNewRegion('');
  }

  const total = Object.values(values).reduce((sum, n) => sum + n, 0);

  return (
    <div className="flex flex-col gap-2">
      {rows.map((region) => (
        <div key={region} className="flex min-w-0 items-center gap-2">
          <span className="w-20 min-w-0 shrink-0 truncate text-sm text-foreground/70">{region}</span>
          <input
            type="number"
            min={0}
            step={field.step ?? 1}
            value={values[region] ?? ''}
            onChange={(e) => setRegion(region, e.target.value === '' ? undefined : Number(e.target.value))}
            className={`${inputClass()} max-w-24`}
          />
          {field.unit && <span className="shrink-0 text-xs text-foreground/50">{field.unit}</span>}
        </div>
      ))}
      <div className="flex min-w-0 items-center gap-2">
        <input
          type="text"
          value={newRegion}
          onChange={(e) => setNewRegion(e.target.value)}
          placeholder="부위 이름"
          maxLength={20}
          className={`${inputClass()} max-w-32`}
        />
        <button type="button" onClick={addRegion} className="shrink-0 text-sm text-accent">
          + 부위 추가
        </button>
      </div>
      <p className="text-sm font-medium text-foreground/80">
        합계 {total}
        {field.unit ?? ''}
      </p>
      {error && <p className="mt-0.5 text-xs text-danger">{error}</p>}
    </div>
  );
}

function CheckboxField({ value, onChange, error }: FieldProps) {
  const checked = value === true;
  return (
    <div>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {error && <p className="mt-0.5 text-xs text-danger">{error}</p>}
    </div>
  );
}

const FIELD_RENDERERS: Record<ParamField['type'], ComponentType<FieldProps>> = {
  number: NumberField,
  text: TextField,
  textarea: TextareaField,
  select: SelectField,
  multiselect: MultiSelectField,
  region_units: RegionUnitsField,
  checkbox: CheckboxField,
};

interface CareParamFormProps {
  schema: ParamSchema;
  values: Record<string, ParamValue>;
  onChange: (values: Record<string, ParamValue>) => void;
  /** Keyed by 'params.<key>' per PLAN_CARENOTE.md §1's fieldErrors shape. */
  fieldErrors?: Record<string, string>;
  /** Renders `pick.key` as chips instead of a plain text input. */
  pick?: ParamPick | null;
}

export function CareParamForm({ schema, values, onChange, fieldErrors, pick }: CareParamFormProps) {
  function setFieldValue(key: string, value: ParamValue | undefined) {
    const next = { ...values };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {schema.fields.map((field) => {
        const Renderer = FIELD_RENDERERS[field.type];
        return (
          <div key={field.key} className="flex min-w-0 flex-col gap-1">
            <label className="text-xs font-medium text-foreground/70">
              {field.label}
              {field.required && <span className="text-danger"> *</span>}
              {field.unit && field.type !== 'region_units' && (
                <span className="ml-1 font-normal text-foreground/40">({field.unit})</span>
              )}
            </label>
            {pick && pick.key === field.key ? (
              <PickField field={field} pick={pick} error={fieldErrors?.[`params.${field.key}`]} />
            ) : (
              <Renderer
                field={field}
                value={values[field.key]}
                onChange={(v) => setFieldValue(field.key, v)}
                error={fieldErrors?.[`params.${field.key}`]}
              />
            )}
            {field.help && <p className="text-xs text-foreground/40">{field.help}</p>}
          </div>
        );
      })}
    </div>
  );
}
