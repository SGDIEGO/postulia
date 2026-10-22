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
import { Button, cn } from "~/components/ui";
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

const SIDEBAR_WIDTH_EXPANDED = 240; // w-60
const SIDEBAR_WIDTH_COLLAPSED = 56; // w-14

export function DashboardApp() {
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { status, refresh, syncing, syncNow } = useExtensionStatus();

  // Cargar preferencia de sidebar colapsado
  useEffect(() => {
    if (typeof browser !== "undefined" && browser.storage?.sync) {
      browser.storage.sync.get(["sidebarCollapsed"], (result: { sidebarCollapsed?: boolean }) => {
        if (result.sidebarCollapsed !== undefined) {
          setSidebarCollapsed(result.sidebarCollapsed);
        }
      });
    }
  }, []);

  // Guardar preferencia
  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    if (typeof browser !== "undefined" && browser.storage?.sync) {
      browser.storage.sync.set({ sidebarCollapsed: next });
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const applicationId = params.get("app");
    const requestedTab = params.get("tab") as Tab | null;
    if (applicationId) setSelectedId(applicationId);
    if (requestedTab && NAV.some((item) => item.id === requestedTab)) setTab(requestedTab);
  }, []);

  const pending = status?.pending ?? 0;
  const sidebarWidth = sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside
        className="flex shrink-0 flex-col border-r border-slate-200 bg-white transition-all duration-200 ease-in-out"
        style={{ width: sidebarWidth }}
      >
        <div className="flex items-center justify-between px-3 py-4">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white">
                <FaIcon icon={faBriefcase} size={18} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold tracking-tight text-slate-900 truncate">Postulia</p>
                <p className="text-[11px] text-slate-500 truncate">Seguimiento de postulaciones</p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={toggleSidebar}
            className={cn(
              "rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 transition-transform duration-200",
              sidebarCollapsed && "rotate-180",
            )}
            title={sidebarCollapsed ? "Expandir barra lateral" : "Contraer barra lateral"}
            aria-label={sidebarCollapsed ? "Expandir barra lateral" : "Contraer barra lateral"}
          >
            <FaIcon icon={sidebarCollapsed ? faChevronRight : faChevronLeft} size={16} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 px-2" style={{ overflow: "hidden" }}>
          {NAV.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-brand-50 text-brand-700"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
                )}
                style={{ justifyContent: sidebarCollapsed ? "center" : "flex-start" }}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <FaIcon icon={item.icon} size={18} />
                {!sidebarCollapsed && (
                  <>
                    <span className="truncate">{item.label}</span>
                    {item.id === "reminders" && (status?.reminders.overdue ?? 0) > 0 && (
                      <span className="ml-auto rounded-full bg-rose-100 px-1.5 text-[10px] font-semibold text-rose-700">
                        {status?.reminders.overdue}
                      </span>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </nav>

        {!sidebarCollapsed && (
          <div className="border-t border-slate-200 p-3">
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              <p className="flex items-center justify-between font-medium text-slate-600">
                <span>Servidor</span>
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    status?.lastSyncError
                      ? "bg-rose-500"
                      : status?.loggedIn
                        ? "bg-emerald-500"
                        : "bg-slate-300",
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
              <p className="mt-0.5 text-[11px] text-slate-400">
                {status?.lastSyncAt
                  ? `Última sincronización: ${formatDateTimeEs(status.lastSyncAt)}`
                  : "—"}
              </p>
              {status?.lastSyncError && (
                <p className="mt-1 line-clamp-2 text-[11px] text-rose-600">
                  {status.lastSyncError}
                </p>
              )}
            </div>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3">
          <div>
            <h1 className="text-base font-semibold text-slate-900">
              {NAV.find((item) => item.id === tab)?.label}
            </h1>
            <p className="text-xs text-slate-500">
              {tab === "overview" && "Tu proceso de búsqueda de empleo en un vistazo"}
              {tab === "applications" && "Historial completo, búsqueda y filtros"}
              {tab === "kanban" && "Mueve las postulaciones entre etapas"}
              {tab === "reminders" && "Seguimientos pendientes y vencidos"}
              {tab === "settings" && "Servidor, cuenta, datos y preferencias"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void syncNow()}
              disabled={syncing}
              title="Sincronizar ahora"
            >
              <FaIcon
                icon={faArrowsRotate}
                size={14}
                className={syncing ? "animate-spin" : undefined}
              />
              {syncing ? "Sincronizando…" : "Sincronizar"}
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <FaIcon icon={faPlus} size={14} /> Nueva postulación
            </Button>
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
