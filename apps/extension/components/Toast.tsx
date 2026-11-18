import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  faCircleCheck,
  faCircleInfo,
  faCircleXmark,
  faTriangleExclamation,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { FaIcon } from "./FaIcon";
import { cn } from "./ui";

export type ToastTone = "success" | "error" | "warning" | "info";

export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milisegundos antes de cerrarse solo. 0 = no se cierra solo. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastRecord extends ToastInput {
  id: number;
}

const TONE_STYLES: Record<ToastTone, { icon: IconDefinition; className: string }> = {
  success: { icon: faCircleCheck, className: "text-emerald-600" },
  error: { icon: faCircleXmark, className: "text-rose-600" },
  warning: { icon: faTriangleExclamation, className: "text-amber-600" },
  info: { icon: faCircleInfo, className: "text-brand-600" },
};

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

export function ToastProvider({
  children,
  placement = "top-right",
}: {
  children: ReactNode;
  /** El sidepanel es estrecho: los avisos van abajo para no tapar la cabecera. */
  placement?: "top-right" | "bottom";
}) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = ++counter.current;
      setToasts((current) => [...current.slice(-2), { ...input, id }]);
      const duration = input.duration ?? 4500;
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className={cn(
          "pointer-events-none fixed z-[60] flex w-full max-w-sm flex-col gap-2 p-3",
          placement === "top-right" ? "right-0 top-0" : "bottom-0 left-0",
        )}
      >
        {toasts.map((toast) => {
          const tone = toast.tone ?? "info";
          const style = TONE_STYLES[tone];
          return (
            <div
              key={toast.id}
              role="status"
              className="pointer-events-auto flex items-start gap-2 rounded-card border border-line bg-surface p-3 shadow-pop"
            >
              <FaIcon icon={style.icon} size={16} className={cn("mt-0.5", style.className)} />
              <div className="min-w-0 flex-1">
                <p className="text-body font-semibold text-ink">{toast.title}</p>
                {toast.description && (
                  <p className="mt-0.5 break-words text-label text-ink-muted">
                    {toast.description}
                  </p>
                )}
                {toast.action && (
                  <button
                    type="button"
                    onClick={() => {
                      toast.action?.onClick();
                      dismiss(toast.id);
                    }}
                    className="mt-1.5 text-label font-semibold text-brand-600 hover:underline"
                  >
                    {toast.action.label}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Cerrar aviso"
                className="-mr-1 -mt-1 rounded-control p-1 text-ink-subtle transition hover:bg-surface-sunken hover:text-ink"
              >
                <FaIcon icon={faXmark} size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/** Acceso al sistema de avisos. Fuera del proveedor devuelve un no-op. */
export function useToast(): (toast: ToastInput) => void {
  const push = useContext(ToastContext);
  return push ?? (() => undefined);
}
