import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { useForm, type DefaultValues, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { WarningCircle } from '@phosphor-icons/react';
import { ApiError } from '../lib/api';

/** react-hook-form wired to a shared zod schema: the browser checks exactly what the server checks. */
export function useZodForm<S extends z.ZodType<FieldValues, FieldValues>>(schema: S, defaults?: DefaultValues<z.input<S>>) {
  return useForm<z.input<S>, unknown, z.output<S>>({
    resolver: zodResolver(schema as never) as never,
    defaultValues: defaults,
    mode: 'onTouched',
    reValidateMode: 'onChange',
  });
}

/** Put the server's field errors next to the fields; return a message for the form-level banner. */
export function applyServerError<T extends FieldValues>(form: UseFormReturn<T, unknown, unknown>, e: unknown): string {
  if (e instanceof ApiError) {
    let placed = false;
    for (const [k, msg] of Object.entries(e.fields ?? {})) {
      try {
        form.setError(k as Path<T>, { type: 'server', message: msg });
        placed = true;
      } catch {
        /* field not on this form */
      }
    }
    return placed && Object.keys(e.fields).length > 1 ? 'Some fields need attention.' : e.message;
  }
  return 'Something went wrong. Try again.';
}

function errorOf(form: UseFormReturn<FieldValues, unknown, unknown>, name: string): string | undefined {
  const parts = name.split('.');
  let cur: unknown = form.formState.errors;
  for (const p of parts) cur = (cur as Record<string, unknown> | undefined)?.[p];
  const msg = (cur as { message?: string } | undefined)?.message;
  return typeof msg === 'string' ? msg : undefined;
}

interface BaseProps {
  form: UseFormReturn<never, unknown, unknown>;
  name: string;
  label: ReactNode;
  hint?: ReactNode;
  optional?: boolean;
  className?: string;
}

function FieldShell({ id, label, hint, error, optional, className = '', children }: { id: string; label: ReactNode; hint?: ReactNode; error?: string; optional?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>
        {label} {optional && <span className="opt">(optional)</span>}
      </label>
      {children}
      {hint && !error && (
        <span className="field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className="field-error" id={`${id}-err`} role="alert">
          <WarningCircle size={16} weight="bold" aria-hidden style={{ flex: 'none', marginTop: 1 }} />
          {error}
        </span>
      )}
    </div>
  );
}

export function TextField({ form, name, label, hint, optional, className, prefix, suffix, ...input }: BaseProps & InputHTMLAttributes<HTMLInputElement> & { prefix?: string; suffix?: string }) {
  const id = useId();
  const f = form as unknown as UseFormReturn<FieldValues, unknown, unknown>;
  const error = errorOf(f, name);
  const el = (
    <input
      id={id}
      className={`input ${input.inputMode === 'numeric' || input.type === 'number' ? 'num' : ''} ${className?.includes('mono') ? 'mono' : ''}`}
      aria-invalid={!!error}
      aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
      {...input}
      {...f.register(name)}
    />
  );
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional} className={className}>
      {prefix || suffix ? (
        <div className="input-affix">
          {prefix && <span className="affix">{prefix}</span>}
          {el}
          {suffix && <span className="affix">{suffix}</span>}
        </div>
      ) : (
        el
      )}
    </FieldShell>
  );
}

export function SelectField({ form, name, label, hint, optional, className, options, placeholder, ...rest }: BaseProps & SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string | number; label: string }[]; placeholder?: string }) {
  const id = useId();
  const f = form as unknown as UseFormReturn<FieldValues, unknown, unknown>;
  const error = errorOf(f, name);
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional} className={className}>
      <select id={id} className="select" aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} {...rest} {...f.register(name)}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function TextArea({ form, name, label, hint, optional, className, ...rest }: BaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  const f = form as unknown as UseFormReturn<FieldValues, unknown, unknown>;
  const error = errorOf(f, name);
  return (
    <FieldShell id={id} label={label} hint={hint} error={error} optional={optional} className={className}>
      <textarea id={id} className="textarea" aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} {...rest} {...f.register(name)} />
    </FieldShell>
  );
}

export function CheckField({ form, name, label, hint, className }: Omit<BaseProps, 'optional'>) {
  const id = useId();
  const f = form as unknown as UseFormReturn<FieldValues, unknown, unknown>;
  const error = errorOf(f, name);
  return (
    <div className={`field ${className ?? ''}`}>
      <label className="check" htmlFor={id} aria-invalid={!!error}>
        <input id={id} type="checkbox" {...f.register(name)} aria-describedby={error ? `${id}-err` : undefined} />
        <span>
          {label}
          {hint && <span className="field-hint" style={{ display: 'block', fontWeight: 400 }}>{hint}</span>}
        </span>
      </label>
      {error && (
        <span className="field-error" id={`${id}-err`} role="alert">
          <WarningCircle size={16} weight="bold" aria-hidden />
          {error}
        </span>
      )}
    </div>
  );
}

/** Radio cards for small choice sets. */
export function ChoiceField({ form, name, label, options, className, hint }: Omit<BaseProps, 'optional'> & { options: { value: string; label: string; sub?: string }[] }) {
  const f = form as unknown as UseFormReturn<FieldValues, unknown, unknown>;
  const error = errorOf(f, name);
  const id = useId();
  return (
    <fieldset className={`field ${className ?? ''}`} style={{ border: 0, padding: 0, margin: 0 }} aria-describedby={error ? `${id}-err` : undefined}>
      <legend className="field-label" style={{ marginBottom: 6 }}>
        {label}
      </legend>
      <div className="choice-grid">
        {options.map((o) => (
          <label key={o.value} className="choice">
            <input type="radio" value={o.value} {...f.register(name)} />
            <strong>{o.label}</strong>
            {o.sub && <span>{o.sub}</span>}
          </label>
        ))}
      </div>
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && (
        <span className="field-error" id={`${id}-err`} role="alert">
          <WarningCircle size={16} weight="bold" aria-hidden />
          {error}
        </span>
      )}
    </fieldset>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="form-error" role="alert">
      {message}
    </div>
  );
}

/** Small hook for submit state + server error banner. */
export function useSubmit() {
  const [error, setError] = useState<string | null>(null);
  return { error, setError };
}
