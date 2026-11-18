import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faArrowsRotate,
  faBriefcase,
  faCalendarCheck,
  faChartColumn,
  faChevronLeft,
  faChevronRight,
  faGear,
  faPlus,
  faTableColumns,
  faTableList,
} from "@fortawesome/free-solid-svg-icons";
import { formatDateTimeEs } from "@postulia/shared";
import { ApplicationDetail } from "~/components/ApplicationDetail";
import { ApplicationForm } from "~/components/ApplicationForm";
import { FaIcon } from "~/components/FaIcon";
import { Button, IconButton, cn } from "~/components/ui";
import { useExtensionStatus } from "~/lib/hooks";
import { Overview } from "./views/Overview";
import { ApplicationsView } from "./views/ApplicationsView";
import { KanbanView } from "./views/KanbanView";
import { RemindersView } from "./views/RemindersView";
import { SettingsView } from "./views/SettingsView";
import type { DashboardTab } from "./types";

type Tab = DashboardTab;

const NAV: { id: Tab; label: string; icon: IconDefinition }[] = [
  { id: "overview", label: "Resumen", icon: faChartColumn },
  { id: "applications", label: "Postulaciones", icon: faTableList },
  { id: "kanban", label: "Kanban", icon: faTableColumns },
  { id: "reminders", label: "Recordatorios", icon: faCalendarCheck },
  { id: "settings", label: "Ajustes", icon: faGear },
];

/** Título y subtítulo de cada vista, en un solo sitio. */
const VIEW_META: Record<Tab, { title: string; description: string }> = {
  overview: {
    title: "Resumen",
    description: "Tu proceso de búsqueda de empleo en un vistazo",
  },
  applications: {
    title: "Postulaciones",
    description: "Historial completo, búsqueda y filtros",
  },
  kanban: {
    title: "Kanban",
    description: "Mueve las postulaciones entre etapas",
  },
  reminders: {
    title: "Recordatorios",
    description: "Seguimientos pendientes y vencidos",
  },
  settings: {
    title: "Ajustes",
    description: "Cuenta, datos, papelera y acerca de",
  },
};

const SIDEBAR_WIDTH_EXPANDED = 240; // w-60
const SIDEBAR_WIDTH_COLLAPSED = 64; // w-16: deja respirar los iconos
/** Por debajo de este ancho el panel no cabe con la barra desplegada. */
const AUTO_COLLAPSE_BREAKPOINT = 960;

export function DashboardApp() {
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarPreference, setSidebarPreference] = useState<boolean | null>(null);
  const { status, refresh, syncing, syncNow } = useExtensionStatus();

  // Preferencia guardada del usuario. `null` = todavía no decidió, así que
  // mandan las reglas automáticas.
  useEffect(() => {
    if (typeof browser !== "undefined" && browser.storage?.sync) {
      browser.storage.sync.get(["sidebarCollapsed"], (result: { sidebarCollapsed?: boolean }) => {
        if (result.sidebarCollapsed !== undefined) {
          setSidebarPreference(result.sidebarCollapsed);
          setSidebarCollapsed(result.sidebarCollapsed);
        }
      });
    }
  }, []);

  // En ventanas estrechas la barra se contrae sola: es una extensión y suele
  // abrirse en una pestaña pequeña.
  useEffect(() => {
    if (sidebarPreference !== null) return;

    const media = window.matchMedia(`(max-width: ${AUTO_COLLAPSE_BREAKPOINT}px)`);
    const apply = () => setSidebarCollapsed(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [sidebarPreference]);

  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    setSidebarPreference(next);
    if (typeof browser !== "undefined" && browser.storage?.sync) {
      browser.storage.sync.set({ sidebarCollapsed: next });
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const applicationId = params.get("app");
    const requestedTab = params.get("tab") as Tab | null;
    if (applicationId) setSelectedId(applicationId);
    if (requestedTab && NAV.some((item) => item.id === requestedTab)) setTab(requestedTab);
  }, []);

  const pending = status?.pending ?? 0;
  // Sin servidor configurado no hay nada que sincronizar: los datos viven en
  // este navegador y no tiene sentido mostrar contadores de cola ni sesión.
  const localOnly = Boolean(status) && !status?.apiUrl;
  const statusLoaded = Boolean(status);
  const sidebarWidth = sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;
  const meta = VIEW_META[tab];

  return (
    <div className="flex min-h-screen bg-surface-muted text-ink">
      <aside
        className="flex shrink-0 flex-col border-r border-line bg-surface transition-all duration-200 ease-in-out"
        style={{ width: sidebarWidth }}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-4">
          {sidebarCollapsed ? (
            <span className="mx-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white">
              <FaIcon icon={faBriefcase} size={18} />
            </span>
          ) : (
            <>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white">
                  <FaIcon icon={faBriefcase} size={18} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-title font-bold tracking-tight text-ink">Postulia</p>
                  <p className="truncate text-label text-ink-muted">
                    Seguimiento de postulaciones
                  </p>
                </div>
              </div>
              <IconButton
                label="Contraer barra lateral"
                icon={faChevronLeft}
                onClick={toggleSidebar}
              />
            </>
          )}
        </div>

        {sidebarCollapsed && (
          <div className="mb-1 flex justify-center">
            <IconButton label="Expandir barra lateral" icon={faChevronRight} onClick={toggleSidebar} />
          </div>
        )}

        <nav className="flex-1 space-y-1 overflow-hidden px-2" aria-label="Secciones">
          {NAV.map((item) => {
            const active = tab === item.id;
            const overdue = status?.reminders.overdue ?? 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-9 w-full items-center gap-3 rounded-control px-3 py-2 text-title font-medium transition-colors",
                  active
                    ? "bg-brand-50 text-brand-700"
                    : "text-ink-soft hover:bg-surface-sunken hover:text-ink",
                  sidebarCollapsed && "justify-center px-0",
                )}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <span className="relative">
                  <FaIcon icon={item.icon} size={18} />
                  {sidebarCollapsed && item.id === "reminders" && overdue > 0 && (
                    <span
                      className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-danger ring-2 ring-surface"
                      aria-hidden="true"
                    />
                  )}
                </span>
                {!sidebarCollapsed && (
                  <>
                    <span className="truncate">{item.label}</span>
                    {item.id === "reminders" && overdue > 0 && (
                      <span className="ml-auto rounded-full bg-danger-soft px-1.5 text-label font-semibold text-danger">
                        {overdue}
                        <span className="sr-only"> recordatorios vencidos</span>
                      </span>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </nav>

        {!sidebarCollapsed && statusLoaded && !localOnly && (
          <div className="border-t border-line p-3">
            <div className="rounded-control bg-surface-muted p-3 text-label text-ink-muted">
              <p className="flex items-center justify-between font-medium text-ink-soft">
                <span>Servidor</span>
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    status?.lastSyncError
                      ? "bg-rose-500"
                      : status?.loggedIn
                        ? "bg-emerald-500"
                        : "bg-line-strong",
                  )}
                  title={status?.lastSyncError ?? (status?.loggedIn ? "Conectado" : "Sin sesión")}
                />
              </p>
              <p className="mt-1 truncate">{status?.email ?? "Sin iniciar sesión"}</p>
              <p className="mt-1">
                {pending > 0
                  ? `${pending} ${pending === 1 ? "cambio pendiente" : "cambios pendientes"}`
                  : "Todo sincronizado"}
              </p>
              <p className="mt-0.5 text-label text-ink-subtle">
                {status?.lastSyncAt
                  ? `Última sincronización: ${formatDateTimeEs(status.lastSyncAt)}`
                  : "—"}
              </p>
              {status?.lastSyncError && (
                <p className="mt-1 line-clamp-2 text-label text-danger">{status.lastSyncError}</p>
              )}
            </div>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-6 py-3">
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-ink">{meta.title}</h1>
            <p className="text-label text-ink-muted">{meta.description}</p>
          </div>

          <div className="flex items-center gap-2">
            {status?.loggedIn && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void syncNow()}
                loading={syncing}
                title="Sincronizar ahora"
              >
                {!syncing && <FaIcon icon={faArrowsRotate} size={14} />}
                {syncing ? "Sincronizando…" : "Sincronizar"}
              </Button>
            )}
            {/* En Ajustes no tiene sentido crear postulaciones. */}
            {tab !== "settings" && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <FaIcon icon={faPlus} size={14} /> Nueva postulación
              </Button>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-6 py-5">
          {tab === "overview" && <Overview onOpenApplication={setSelectedId} onGoTo={setTab} />}
          {tab === "applications" && (
            <ApplicationsView
              onOpenApplication={setSelectedId}
              onCreate={() => setCreating(true)}
            />
          )}
          {tab === "kanban" && <KanbanView onOpenApplication={setSelectedId} />}
          {tab === "reminders" && <RemindersView onOpenApplication={setSelectedId} />}
          {tab === "settings" && <SettingsView onRefreshStatus={refresh} />}
        </main>
      </div>

      <ApplicationForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={(application) => {
          refresh();
          setSelectedId(application.id);
        }}
      />

      <ApplicationDetail applicationId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
