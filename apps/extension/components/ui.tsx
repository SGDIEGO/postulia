import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { FaIcon } from "~/components/FaIcon";

export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type ButtonSize = "xs" | "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
  secondary: "bg-surface text-ink-soft border border-line-strong hover:bg-surface-muted",
  ghost: "text-ink-muted hover:bg-surface-sunken hover:text-ink",
  danger: "bg-danger text-white hover:bg-rose-700 shadow-sm",
  subtle: "bg-surface-sunken text-ink-soft hover:bg-line",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  xs: "min-h-8 px-2.5 py-1 text-label",
  sm: "min-h-9 px-3 py-1.5 text-label",
  md: "min-h-10 px-3.5 py-2 text-title",
};

export function Button({
  variant = "primary",
  size = "md",
  iconOnly = false,
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-control font-semibold transition",
        "disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON_SIZES[size],
        iconOnly && (size === "md" ? "min-w-10 px-0" : "min-w-9 px-0"),
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {loading && <Spinner size="sm" />}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  icon,
  size = 16,
  variant = "ghost",
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
  /** Texto accesible obligatorio: estos botones no tienen texto visible. */
  label: string;
  icon: IconDefinition;
  size?: number;
  variant?: ButtonVariant;
}) {
  return (
    <Button
      {...props}
      variant={variant}
      size="sm"
      iconOnly
      aria-label={label}
      title={label}
      className={className}
    >
      <FaIcon icon={icon} size={size} />
    </Button>
  );
}

const CONTROL_BASE =
  "w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-title text-ink " +
  "placeholder:text-ink-subtle transition outline-none " +
  "focus:border-brand-500 focus:ring-2 focus:ring-brand-100 " +
  "aria-invalid:border-danger aria-invalid:ring-2 aria-invalid:ring-danger-soft " +
  "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(CONTROL_BASE, className)} />;
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select {...props} className={cn(CONTROL_BASE, "pr-8", className)}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(CONTROL_BASE, "min-h-24", className)} />;
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)} htmlFor={htmlFor}>
      <span className="mb-1 block text-label font-medium text-ink-muted">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="mt-1 block text-label text-danger">
          {error}
        </span>
      ) : (
        hint && <span className="mt-1 block text-label text-ink-muted">{hint}</span>
      )}
    </label>
  );
}

export function Card({
  title,
  actions,
  description,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  actions?: ReactNode;
  description?: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn("rounded-card border border-line bg-surface p-4 shadow-card", className)}
    >
      {(title || actions) && (
        <header className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            {title && <h2 className="text-title font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-label text-ink-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function Badge({
  children,
  color,
  className,
}: {
  children: ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-label font-medium",
        !color && "bg-surface-sunken text-ink-soft",
        className,
      )}
      style={color ? { backgroundColor: `${color}1a`, color } : undefined}
    >
      {children}
    </span>
  );
}

/** Diálogo accesible: foco atrapado, Escape, cierre en el fondo y foco restaurado. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );
    (focusable ?? panel)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;

      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      ).filter((item) => item.offsetParent !== null);
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = overflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 sm:p-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "w-full rounded-card bg-surface shadow-pop outline-none",
          size === "lg" ? "max-w-3xl" : "max-w-xl",
        )}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 id={titleId} className="text-title font-semibold text-ink">
            {title}
          </h2>
          <IconButton label="Cerrar" icon={faXmark} onClick={onClose} />
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>
        )}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Eliminar",
  cancelLabel = "Cancelar",
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-body text-ink-soft">{description}</p>
    </Modal>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: IconDefinition;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line-strong bg-surface/70 px-6 py-10 text-center">
      {icon && (
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <FaIcon icon={icon} size={18} />
        </span>
      )}
      <p className="text-title font-semibold text-ink">{title}</p>
      {description && <p className="max-w-md text-label text-ink-muted">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function Spinner({ label, size = "md" }: { label?: string; size?: "sm" | "md" }) {
  return (
    <span className="inline-flex items-center gap-2 text-body text-ink-muted" role="status">
      <span
        className={cn(
          "animate-spin rounded-full border-2 border-line border-t-brand-600",
          size === "sm" ? "h-3 w-3" : "h-4 w-4",
        )}
      />
      {label && <span>{label}</span>}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("block animate-pulse rounded-control bg-surface-sunken", className)}
    />
  );
}

/** Esqueleto de lista para no mover el layout mientras cargan los datos. */
export function SkeletonList({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-control bg-surface p-3">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex items-center justify-between gap-3 text-title text-ink-soft",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      )}
    >
      <span className="min-w-0">
        <span className="block font-medium text-ink">{label}</span>
        {description && (
          <span className="mt-0.5 block text-label font-normal text-ink-muted">{description}</span>
        )}
      </span>
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden="true"
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-brand-300 peer-focus-visible:ring-offset-2",
          checked ? "bg-brand-600" : "bg-line-strong",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition",
            checked ? "left-5" : "left-0.5",
          )}
        />
      </span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex rounded-control bg-surface-sunken p-1"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-8 rounded-[calc(var(--radius-control)-2px)] px-3 py-1 text-label font-medium transition",
              active ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const KPI_TONES = {
  brand: "bg-brand-50 text-brand-600",
  amber: "bg-amber-50 text-amber-600",
  emerald: "bg-emerald-50 text-emerald-600",
  violet: "bg-violet-50 text-violet-600",
} as const;

export function KpiCard({
  icon,
  label,
  value,
  hint,
  tone = "brand",
}: {
  icon: IconDefinition;
  label: string;
  value: number | string;
  hint?: string;
  tone?: keyof typeof KPI_TONES;
}) {
  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <span className="text-label font-medium text-ink-muted">{label}</span>
        <span
          className={cn("flex h-7 w-7 items-center justify-center rounded-lg", KPI_TONES[tone])}
        >
          <FaIcon icon={icon} size={15} />
        </span>
      </div>
      <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
      {hint && <p className="text-label text-ink-muted">{hint}</p>}
    </div>
  );
}
