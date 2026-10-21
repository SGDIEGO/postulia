import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { Download, LogOut, RefreshCw, Save, ServerCog, Upload, UserRound } from "lucide-react";
import { formatDateTimeEs } from "@postulia/shared";
import { Button, Card, Field, Input, Spinner, Toggle, cn } from "~/components/ui";
import { login, logout, register, ensureApiPermission } from "~/lib/auth";
import { pingServer } from "~/lib/api";
import { db, type LocalApplication } from "~/lib/db";
import { useSettingsRow, useExtensionStatus } from "~/lib/hooks";
import { normalizeApiUrl, updateSettings } from "~/lib/settings";
import { syncNow, pullRemoteChanges } from "~/lib/sync";
import { exportCsv, exportJson, importCsv, importJson, downloadFile } from "~/lib/transfer";
import { useLiveQuery } from "dexie-react-hooks";
import { deleteReminder } from "~/lib/repository";

export function SettingsView({ onRefreshStatus }: { onRefreshStatus: () => void }) {
  const settings = useSettingsRow();
  const { status, syncNow: syncFromStatus, syncing } = useExtensionStatus();

  const [apiUrl, setApiUrl] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [followUpDays, setFollowUpDays] = useState(7);

  const deleted = useLiveQuery(
    async () => db.applications.filter((application) => Boolean(application.deletedAt)).toArray(),
    [],
    [] as LocalApplication[],
  );

  useEffect(() => {
    if (!settings) return;
    setApiUrl(settings.apiUrl);
    setFollowUpDays(settings.followUpDays);
  }, [settings]);

  async function saveServer() {
    setBusy("server");
    setError(null);
    setInfo(null);
    const normalized = normalizeApiUrl(apiUrl);

    try {
      if (!normalized) {
        await updateSettings({ apiUrl: "" });
        setInfo("URL del servidor borrada. La app seguirá funcionando en local.");
        return;
      }

      const granted = await ensureApiPermission(normalized);
      if (!granted) {
        setError(
          "Chrome no dio permiso para acceder a ese dominio. Acepta el permiso para sincronizar.",
        );
        return;
      }

      const health = await pingServer(normalized);
      await updateSettings({ apiUrl: normalized });
      setApiUrl(normalized);
      setInfo(
        health.ok
          ? `Conexión correcta${health.database === "down" ? " (la base de datos del servidor no responde)" : ""}.`
          : "No se pudo verificar el servidor. Revisa la URL y que el API esté desplegado.",
      );
      onRefreshStatus();
    } finally {
      setBusy(null);
    }
  }

  async function submitAuth() {
    setBusy("auth");
    setError(null);
    setInfo(null);
    const normalized = normalizeApiUrl(apiUrl);

    try {
      if (!normalized) {
        setError("Primero configura y guarda la URL del servidor.");
        return;
      }

      const granted = await ensureApiPermission(normalized);
      if (!granted) {
        setError("Falta el permiso para acceder al servidor.");
        return;
      }
      await updateSettings({ apiUrl: normalized });

      if (mode === "login") {
        await login({ email: email.trim(), password });
        setInfo("Sesión iniciada. Ya puedes sincronizar.");
      } else {
        await register({
          email: email.trim(),
          password,
          ...(name.trim() ? { name: name.trim() } : {}),
        });
        setInfo("Cuenta creada y sesión iniciada.");
      }

      setPassword("");
      onRefreshStatus();
      void syncNow().then(() => onRefreshStatus());
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "No se pudo iniciar sesión");
    } finally {
      setBusy(null);
    }
  }

  async function handleLogout() {
    setBusy("logout");
    try {
      await logout();
      setInfo("Sesión cerrada. Tus datos locales se mantienen.");
      onRefreshStatus();
    } finally {
      setBusy(null);
    }
  }

  async function handleExport(kind: "json" | "csv") {
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === "json") {
      downloadFile(`postulia-backup-${stamp}.json`, await exportJson(), "application/json");
    } else {
      downloadFile(
        `postulia-postulaciones-${stamp}.csv`,
        await exportCsv(),
        "text/csv;charset=utf-8",
      );
    }
    setInfo(`Exportación ${kind.toUpperCase()} lista.`);
  }

  async function handleImport(file: File) {
    setBusy("import");
    setError(null);
    try {
      const text = await file.text();
      if (file.name.toLowerCase().endsWith(".json")) {
        const result = await importJson(text);
        setInfo(`Importadas ${result.applications} postulaciones desde JSON.`);
      } else {
        const result = await importCsv(text);
        setInfo(
          `Importadas ${result.imported} filas${result.skipped ? `, ${result.skipped} omitidas` : ""}.`,
        );
      }
    } catch (importError) {
      setError(
        importError instanceof Error ? importError.message : "No se pudo importar el archivo",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!settings) {
    return (
      <div className="p-8">
        <Spinner label="Cargando ajustes…" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Servidor" actions={<ServerCog size={16} className="text-slate-400" />}>
        <div className="space-y-3">
          <Field
            label="URL del API de Postulia"
            hint="Ejemplo: https://api.postulia.tudominio.com (sin barra final)"
          >
            <Input
              value={apiUrl}
              onChange={(event) => setApiUrl(event.target.value)}
              placeholder="https://api.tudominio.com"
            />
          </Field>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void saveServer()} disabled={busy === "server"}>
              <Save size={14} /> Guardar y probar
            </Button>
            <span className="text-xs text-slate-400">
              {status?.lastSyncAt
                ? `Último sync: ${formatDateTimeEs(status.lastSyncAt)}`
                : "Sin sincronizaciones"}
            </span>
          </div>

          {settings.lastSyncError && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {settings.lastSyncError}
            </p>
          )}
        </div>
      </Card>

      <Card title="Cuenta" actions={<UserRound size={16} className="text-slate-400" />}>
        {settings.user ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <p className="font-medium text-slate-800">
                {settings.user.name ?? settings.user.email}
              </p>
              <p className="text-xs text-slate-500">{settings.user.email}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void syncFromStatus()}
                disabled={syncing}
              >
                <RefreshCw size={14} className={syncing ? "animate-spin" : undefined} />
                Sincronizar ahora
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void handleLogout()}
                disabled={busy === "logout"}
              >
                <LogOut size={14} /> Cerrar sesión
              </Button>
            </div>
            <p className="text-xs text-slate-400">
              Cambios pendientes: {status?.pending ?? 0}. Los datos viven en tu navegador y se
              respaldan en tu servidor.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode("login")}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium",
                  mode === "login" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600",
                )}
              >
                Iniciar sesión
              </button>
              <button
                type="button"
                onClick={() => setMode("register")}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium",
                  mode === "register" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600",
                )}
              >
                Crear cuenta
              </button>
            </div>

            {mode === "register" && (
              <Field label="Nombre">
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
            )}
            <Field label="Correo">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username"
              />
            </Field>
            <Field
              label="Contraseña"
              hint={mode === "register" ? "Mínimo 10 caracteres" : undefined}
            >
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </Field>

            <Button size="sm" onClick={() => void submitAuth()} disabled={busy === "auth"}>
              {mode === "login" ? "Entrar" : "Crear cuenta"}
            </Button>

            <p className="text-xs text-slate-400">
              Puedes usar Postulia sin cuenta: todo se guarda en local y sincronizas cuando quieras.
            </p>
          </div>
        )}
      </Card>

      <Card title="Preferencias">
        <div className="space-y-3">
          <Toggle
            label="Sincronización automática cada 5 minutos"
            checked={settings.syncEnabled}
            onChange={(value) => void updateSettings({ syncEnabled: value })}
          />
          <Toggle
            label="Notificaciones de recordatorios"
            checked={settings.notificationsEnabled}
            onChange={(value) => {
              void updateSettings({ notificationsEnabled: value });
              if (value && "Notification" in window) {
                void Notification.requestPermission().catch(() => undefined);
              }
            }}
          />

          <Field label="Días para sugerir seguimiento" hint="Se crea un recordatorio al postular">
            <Input
              type="number"
              min={1}
              max={60}
              value={followUpDays}
              onChange={(event) => setFollowUpDays(Number(event.target.value))}
              onBlur={() => {
                const days = Math.min(60, Math.max(1, followUpDays || 7));
                setFollowUpDays(days);
                void updateSettings({ followUpDays: days });
              }}
            />
          </Field>
        </div>
      </Card>

      <Card title="Datos">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void handleExport("json")}>
              <Download size={14} /> Exportar JSON
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void handleExport("csv")}>
              <Download size={14} /> Exportar CSV
            </Button>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-slate-500">Importar respaldo o CSV</p>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500 hover:border-brand-400">
              <Upload size={14} />
              {busy === "import" ? "Importando…" : "Seleccionar archivo .json o .csv"}
              <input
                type="file"
                accept=".json,.csv,text/csv,application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleImport(file);
                  event.target.value = "";
                }}
              />
            </label>
            <p className="mt-1 text-[11px] text-slate-400">
              El CSV admite columnas: puesto, empresa, enlace, portal, estado, ubicacion, modalidad,
              salario, moneda, contrato, fecha_postulacion, etiquetas, reclutador,
              contacto_reclutador, notas.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void (async () => {
                  await updateSettings({ lastPulledAt: null });
                  await pullRemoteChanges();
                  setInfo("Descarga completa desde el servidor finalizada.");
                  onRefreshStatus();
                })();
              }}
            >
              <RefreshCw size={14} /> Forzar descarga completa
            </Button>
          </div>
        </div>
      </Card>

      <Card title={`Papelera (${deleted?.length ?? 0})`} className="lg:col-span-2">
        {!deleted || deleted.length === 0 ? (
          <p className="text-xs text-slate-400">No hay postulaciones eliminadas.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {deleted.map((application) => (
              <li key={application.id} className="flex items-center gap-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-700">{application.jobTitle}</p>
                  <p className="truncate text-xs text-slate-500">{application.company}</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void db.applications.update(application.id, { deletedAt: null, dirty: 1 })
                  }
                >
                  Restaurar
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (
                      !window.confirm("¿Eliminar definitivamente esta postulación y su historial?")
                    ) {
                      return;
                    }
                    void (async () => {
                      await db.events.where("applicationId").equals(application.id).delete();
                      const reminders = await db.reminders
                        .where("applicationId")
                        .equals(application.id)
                        .toArray();
                      for (const reminder of reminders) await deleteReminder(reminder.id);
                      await db.applications.delete(application.id);
                    })();
                  }}
                >
                  Borrar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {(error || info) && (
        <div className="lg:col-span-2">
          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}
          {info && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{info}</p>
          )}
        </div>
      )}

      <Card title="Acerca de" className="lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <p>
            Postulia v{browser.runtime.getManifest().version} · Extensión de Chrome con API propia
            (Fastify + PostgreSQL).
          </p>
          <p>
            ¿Necesitas ayuda? Consulta el README del repositorio:{" "}
            <span className="font-mono">github.com/SGDIEGO/postulia</span>
          </p>
        </div>
      </Card>
    </div>
  );
}
