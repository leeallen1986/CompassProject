import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

export function statusTone(status: string) {
  if (["approved", "verified", "active"].includes(status)) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (["submitted", "under_review"].includes(status)) return "bg-blue-50 text-blue-700 border-blue-200";
  if (["returned", "draft"].includes(status)) return "bg-amber-50 text-amber-700 border-amber-200";
  if (["rejected", "excluded", "merged"].includes(status)) return "bg-red-50 text-red-700 border-red-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

export function StatusBadge({ children, status }: { children: ReactNode; status?: string }) {
  return <span className={`inline-flex rounded border px-2 py-0.5 text-[10px] font-bold ${statusTone(status ?? "")}`}>{children}</span>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border bg-card p-4 ${className}`}>{children}</div>;
}

export function Field({ label, value, onChange, type = "text", placeholder, disabled }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number" | "date" | "url";
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type={type}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "any" : undefined}
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 disabled:bg-slate-100"
      />
    </label>
  );
}

export function Area({ label, value, onChange, placeholder, rows = 3 }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
      />
    </label>
  );
}

export function Select<T extends string>({ label, value, onChange, options, disabled }: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.target.value as T)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40 disabled:bg-slate-100"
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function Readiness({ title, issues }: { title: string; issues: string[] }) {
  const ready = issues.length === 0;
  return (
    <div className={`rounded-lg border p-3 ${ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
      <div className={`flex items-center gap-2 text-xs font-bold ${ready ? "text-emerald-800" : "text-amber-800"}`}>
        {ready ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}{title}
      </div>
      {!ready && <ul className="mt-2 space-y-1 text-xs text-amber-900">{issues.map(issue => <li key={issue}>• {issue}</li>)}</ul>}
    </div>
  );
}
