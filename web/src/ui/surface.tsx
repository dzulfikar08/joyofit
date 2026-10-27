/**
 * Copied from JoyoRogo (apps/web/src/components/kit/surface.tsx): Card, SectionTitle, Segmented and
 * FieldLabel, adapted for JoyoFit Studio. Cards are white and borderless on the paper canvas.
 */
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./utils";

/** White, borderless surface on the paper canvas. */
export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-3xl bg-card p-5", className)} {...props} />;
}

export function SectionTitle({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3 px-1", className)}>
      <h2 className="text-base font-bold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

/** Pill segmented control (radio group semantics). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: ReactNode; disabled?: boolean }>;
  /** Accessible group name. */
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("relative flex gap-1 overflow-x-auto rounded-full bg-muted p-1 scrollbar-none", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-8 flex-1 rounded-full px-2 py-1 text-[0.8125rem] leading-tight font-semibold sm:whitespace-nowrap transition-[background-color,color,box-shadow] duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
              active
                ? "bg-card text-foreground shadow-[0_1px_3px_oklch(0.3_0.02_85/12%)]"
                : "text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Field label used above inputs. */
export function FieldLabel({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      className={cn("mb-1.5 block px-1 text-[0.8125rem] font-semibold text-muted-foreground", className)}
      {...props}
    />
  );
}
