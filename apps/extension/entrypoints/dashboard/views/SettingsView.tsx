import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import {
  faArrowsRotate,
  faCloud,
  faDownload,
  faEnvelope,
  faFloppyDisk,
  faPaperPlane,
  faRobot,
  faRightFromBracket,
  faSliders,
  faUpload,
  faUser,
} from "@fortawesome/free-solid-svg-icons";
import { formatDateTimeEs, type UserSettings } from "@postulia/shared";
import { FaIcon } from "~/components/FaIcon";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Segmented,
  Select,
  Spinner,
  Toggle,
  cn,
} from "~/components/ui";
import { useToast } from "~/components/Toast";
import {
  cancelVerification,
  checkVerification,
  ensureApiPermission,
  login,
  logout,
  register,
  resendVerification,
  type AuthOutcome,
} from "~/lib/auth";
import { pingServer } from "~/lib/api";
import { apiRequest } from "~/lib/api";
import { db, type LocalApplication } from "~/lib/db";
import { useSettingsRow, useExtensionStatus } from "~/lib/hooks";
import { sendMessage } from "~/lib/messaging";
import { normalizeApiUrl, updateSettings } from "~/lib/settings";
import { syncNow, pullRemoteChanges } from "~/lib/sync";
import { hydrateCvMetadata, hydrateUserSettings, saveUserSettings } from "~/lib/user-config";
import { exportCsv, exportJson, importCsv, importJson, downloadFile } from "~/lib/transfer";
import { useLiveQuery } from "dexie-react-hooks";
import { deleteReminder } from "~/lib/repository";

interface GeminiModelOption {
  id: string;
  displayName: string;
  description: string;
}

/** Texto de la cuenta atrás del enlace de confirmación. */
function remainingLabel(expiresAt: string, now: number): string {
  const diff = new Date(expiresAt).getTime() - now;
  if (diff <= 0) return "Enlace caducado";
  const minutes = Math.floor(diff / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1000);
  return `Caduca en ${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function SettingsView({ onRefreshStatus }: { onRefreshStatus: () => void }) {
  const settings = useSettingsRow();
  const toast = useToast();
  const { status, syncNow: syncFromStatus, syncing } = useExtensionStatus();

  const [apiUrl, setApiUrl] = useState("");
  const [iaProvider, setIaProvider] = useState("");
  const [iaApiKey, setIaApiKey] = useState("");
  const [iaModel, setIaModel] = useState("");
  const [iaModels, setIaModels] = useState<GeminiModelOption[]>([]);
  const [iaDefaultModel, setIaDefaultModel] = useState("");
  const [iaConfigured, setIaConfigured] = useState(false);
  const [iaModelsBusy, setIaModelsBusy] = useState(false);
  const [iaModelsError, setIaModelsError] = useState<string | null>(null);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [followUpDaysDraft, setFollowUpDaysDraft] = useState("7");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [tick, setTick] = useState(Date.now());
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [resendAvailableAt, setResendAvailableAt] = useState(0);

  const deleted = useLiveQuery(
    async () => db.applications.filter((application) => Boolean(application.deletedAt)).toArray(),
    [],
    [] as LocalApplication[],
  );

  useEffect(() => {
    if (!settings) return;
    setApiUrl(settings.apiUrl);
    setIaProvider(settings.iaProvider ?? "");
    setIaApiKey(settings.iaApiKey ?? "");
    setIaModel(settings.iaModel ?? "");
  }, [settings]);

  useEffect(() => {
    if (!settings) return;
    setFollowUpDaysDraft(String(settings.followUpDays));
  }, [settings?.followUpDays]);

  const accessToken = settings?.accessToken ?? null;

  useEffect(() => {
    if (!accessToken) return;
    // En serie para no pisar la misma fila de ajustes con escrituras concurrentes.
    void (async () => {
      await hydrateUserSettings();
      await hydrateCvMetadata();
      await loadIAConfig();
      await loadIAModels();
    })();
  }, [accessToken]);

  const pending = settings?.pendingVerification ?? null;

  // Cualquier mensaje de éxito existente se muestra como aviso flotante.
  useEffect(() => {
    if (!info) return;
    toast({ title: info, tone: "success" });
    setInfo(null);
  }, [info, toast]);

  // Cuenta atrás del enlace de confirmación.
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending?.verificationToken]);

  // Sondeo del estado: en cuanto se abre el enlace del correo, la sesión
  // entra sola sin volver a escribir la contraseña.
  useEffect(() => {
    if (!pending) return;
    let alive = true;

    const poll = async () => {
      const result = await checkVerification().catch(() => null);
      if (!alive || !result) return;
      if (result.status === "verified") {
        toast({
          title: "Correo confirmado",
          description: `Sesión iniciada como ${result.user.email}.`,
          tone: "success",
        });
        setPassword("");
        rescheduleAlarms();
        onRefreshStatus();
        void syncNow().then(() => onRefreshStatus());
      } else if (result.status === "verified_no_session") {
        toast({
          title: "Correo confirmado",
          description: "Ya puedes iniciar sesión con tu correo y contraseña.",
          tone: "success",
        });
        setMode("login");
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [pending?.verificationToken]);

  async function refreshVerification(manual = false): Promise<void> {
    if (manual) setVerificationBusy(true);
    try {
      const result = await checkVerification();
      if (result.status === "verified") {
        toast({
          title: "Correo confirmado",
          description: `Sesión iniciada como ${result.user.email}.`,
          tone: "success",
        });
        rescheduleAlarms();
        onRefreshStatus();
      } else if (result.status === "verified_no_session") {
        toast({ title: "Correo confirmado", description: "Inicia sesión.", tone: "success" });
        setMode("login");
      } else if (result.status === "pending") {
        if (manual) {
          toast({
            title: "Todavía no está confirmado",
            description: "Abre el enlace del correo y vuelve a intentarlo.",
            tone: "warning",
          });
        }
      } else if (result.status === "expired") {
        if (manual) {
          toast({
            title: "El enlace caducó",
            description: "Pide un correo nuevo con «Reenviar».",
            tone: "warning",
          });
        }
      } else if (manual) {
        toast({
          title: "No hay una verificación activa",
          description: "Vuelve a crear la cuenta.",
          tone: "error",
        });
      }
    } catch (checkError) {
      if (manual) {
        toast({
          title: "No se pudo comprobar",
          description: checkError instanceof Error ? checkError.message : undefined,
          tone: "error",
        });
      }
    } finally {
      if (manual) setVerificationBusy(false);
    }
  }

  async function resendEmail(): Promise<void> {
    setVerificationBusy(true);
    try {
      const updated = await resendVerification();
      setResendAvailableAt(Date.now() + 60_000);
      if (!updated) {
        toast({ title: "Tu correo ya estaba confirmado", tone: "success" });
        return;
      }
      toast({
        title: "Correo reenviado",
        description: `Revisa la bandeja de ${updated.email}.`,
        tone: "success",
      });
    } catch (resendError) {
      toast({
        title: "No se pudo reenviar",
        description: resendError instanceof Error ? resendError.message : undefined,
        tone: "error",
      });
    } finally {
      setVerificationBusy(false);
    }
  }

  async function loadIAConfig() {
    try {
      const data = await apiRequest<{
        provider: string | null;
        model: string | null;
        configured: boolean;
      }>("/api/users/ia-config");

      setIaProvider(data.provider ?? "");
      setIaModel(data.model ?? "");
      setIaConfigured(data.configured);
      await updateSettings({ iaProvider: data.provider, iaModel: data.model });
    } catch (loadError) {
      setIaModelsError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar la configuración de IA.",
      );
    }
  }

  async function loadIAModels() {
    setIaModelsBusy(true);
    setIaModelsError(null);
    try {
      const data = await apiRequest<{
        models: GeminiModelOption[];
        defaultModel: string;
        configured: boolean;
      }>("/api/users/ia-models");

      setIaModels(data.models ?? []);
      setIaDefaultModel(data.defaultModel ?? "");
      setIaConfigured(data.configured);
    } catch (loadError) {
      setIaModels([]);
      setIaModelsError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudieron cargar los modelos de Gemini.",
      );
    } finally {
      setIaModelsBusy(false);
    }
  }

  /** Reprograma las alarmas tras cambiar la sesión o la sincronización. */
  function rescheduleAlarms(): void {
    void sendMessage({ type: "postulia:alarms:reschedule" }).catch(() => undefined);
  }

  async function saveIAConfig() {
    setBusy("ia");
    setError(null);
    setInfo(null);
    try {
      const saved = await apiRequest<{
        provider: string | null;
        model: string | null;
        configured: boolean;
      }>("/api/users/ia-config", {
        method: "PUT",
        body: {
          provider: iaProvider || null,
          apiKey: iaApiKey || null,
          model: iaProvider ? iaModel || null : null,
        },
      });

      await updateSettings({
        iaProvider: saved.provider,
        iaModel: saved.model,
        iaApiKey: null,
      });
      setIaApiKey("");
      setIaConfigured(saved.configured);
      setInfo(
        saved.configured
          ? "Configuración de IA guardada."
          : "Proveedor guardado. Añade tu API key para generar correos.",
      );
      await loadIAModels();
      onRefreshStatus();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "No se pudo guardar la configuración de IA.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function uploadCV() {
    if (!cvFile) return;
    if (!settings?.apiUrl) {
      setError("Primero configura la URL de tu servidor en Ajustes.");
      return;
    }
    setBusy("cv");
    setError(null);
    setInfo(null);
    try {
      const formData = new FormData();
      formData.append("cv", cvFile);

      const response = await fetch(`${normalizeApiUrl(settings.apiUrl)}/api/users/cv`, {
        method: "POST",
        headers: {
          ...(settings.accessToken ? { Authorization: `Bearer ${settings.accessToken}` } : {}),
        },
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.error?.message || body?.message || `Error ${response.status} al subir el CV`,
        );
      }

      const data = await response.json();
      await updateSettings({
        cvText: data.cvText ?? null,
        cvFileName: cvFile.name,
        cvUploadedAt: data.uploadedAt ?? new Date().toISOString(),
      });
      setInfo(`CV "${cvFile.name}" subido y procesado correctamente.`);
      setCvFile(null);
      onRefreshStatus();
    } catch (cvError) {
      setError(cvError instanceof Error ? cvError.message : "No se pudo subir el CV.");
    } finally {
      setBusy(null);
    }
  }

  async function changePreference(patch: Partial<UserSettings>) {
    if (!settings) return;
    const previous: UserSettings = {
      syncEnabled: settings.syncEnabled,
      notificationsEnabled: settings.notificationsEnabled,
      emailNotificationsEnabled: settings.emailNotificationsEnabled,
      followUpDays: settings.followUpDays,
    };

    setBusy("prefs");
    setError(null);
    setInfo(null);
    // Cambio optimista: la UI responde al instante y se revierte si el PUT falla.
    await updateSettings(patch);

    try {
      await saveUserSettings(patch);
      setInfo("Preferencias guardadas en tu cuenta.");
    } catch (saveError) {
      await updateSettings(previous);
      setError(
        saveError instanceof Error ? saveError.message : "No se pudieron guardar las preferencias.",
      );
    } finally {
      setBusy(null);
    }
  }

  function saveFollowUpDays() {
    const days = Number(followUpDaysDraft);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      setError("Los días de seguimiento deben ser un número entero entre 1 y 365.");
      setFollowUpDaysDraft(String(settings?.followUpDays ?? 7));
      return;
    }
    void changePreference({ followUpDays: days });
  }

  async function submitAuth() {
    setBusy("auth");
    setError(null);
    const normalized = normalizeApiUrl(apiUrl);

    try {
      if (!normalized) {
        setError("No hay una URL de servidor configurada en esta copia de la extensión.");
        return;
      }

      const granted = await ensureApiPermission(normalized);
      if (!granted) {
        setError("Falta el permiso para acceder al servidor. Acepta el aviso de Chrome.");
        return;
      }
      await updateSettings({ apiUrl: normalized });

      const outcome: AuthOutcome =
        mode === "login"
          ? await login({ email: email.trim(), password })
          : await register({
              email: email.trim(),
              password,
              ...(name.trim() ? { name: name.trim() } : {}),
            });

      setPassword("");

      if (outcome.status === "verification_required") {
        setResendAvailableAt(Date.now() + 60_000);
        toast({
          title: "Revisa tu correo",
          description: `Te enviamos un enlace a ${outcome.verification.email}. Caduca en 30 minutos.`,
          tone: "info",
          duration: 7000,
        });
        return;
      }

      toast({ title: "Sesión iniciada", tone: "success" });
      rescheduleAlarms();
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
      rescheduleAlarms();
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

  if (settings === undefined) {
    return (
      <div className="p-8">
        <Spinner label="Cargando ajustes…" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {settings.apiUrl ? (
        <>
          {settings.apiUrl && settings.accessToken ? (
            <Card
              title="IA y correo"
              actions={<FaIcon icon={faRobot} size={16} className="text-ink-subtle" />}
            >
              <div className="space-y-3">
                <Field label="Proveedor de IA">
                  <Select
                    value={iaProvider}
                    onChange={(event) => setIaProvider(event.target.value)}
                  >
                    <option value="">Selecciona un proveedor</option>
                    <option value="gemini">Gemini</option>
                  </Select>
                </Field>

                <Field label="API key de IA">
                  <Input
                    type="password"
                    value={iaApiKey}
                    onChange={(event) => setIaApiKey(event.target.value)}
                    placeholder="Pega aquí tu API key de Gemini"
                    autoComplete="off"
                  />
                </Field>

                <div>
                  <span className="mb-1 block text-label font-medium text-ink-muted">
                    Modelo de Gemini
                  </span>
                  <div className="flex items-center gap-2">
                    <Select
                      value={iaModel}
                      onChange={(event) => setIaModel(event.target.value)}
                      disabled={!iaConfigured || iaModelsBusy}
                    >
                      <option value="">
                        {iaDefaultModel
                          ? `Modelo por defecto (${iaDefaultModel})`
                          : "Modelo por defecto del servidor"}
                      </option>
                      {iaModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.displayName} · {model.id}
                        </option>
                      ))}
                      {iaModel && !iaModels.some((model) => model.id === iaModel) ? (
                        <option value={iaModel}>{iaModel} (guardado)</option>
                      ) : null}
                    </Select>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void loadIAModels()}
                      disabled={iaModelsBusy || !iaConfigured}
                    >
                      <FaIcon icon={faArrowsRotate} size={13} />
                      {iaModelsBusy ? "Cargando…" : "Recargar"}
                    </Button>
                  </div>
                </div>

                {iaModelsError ? (
                  <p className="rounded-lg bg-rose-50 px-3 py-2 text-label text-rose-700">
                    {iaModelsError}
                  </p>
                ) : null}

                <p
                  className={cn(
                    "rounded-lg px-3 py-2 text-label",
                    iaConfigured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
                  )}
                >
                  {iaConfigured ? "API key configurada" : "Sin API key"}
                </p>

                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => void saveIAConfig()} disabled={busy === "ia"}>
                    <FaIcon icon={faFloppyDisk} size={14} /> Guardar configuración IA
                  </Button>
                </div>

                <div className="border-t border-slate-100 pt-3 space-y-3">
                  <Field label="CV (PDF - subir una vez)">
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line-strong bg-surface-muted px-3 py-2 text-label text-ink-muted hover:border-brand-400">
                      <FaIcon icon={faUpload} size={14} />
                      {busy === "cv"
                        ? "Procesando CV…"
                        : cvFile
                          ? `Seleccionado: ${cvFile.name}`
                          : "Seleccionar archivo .pdf"}
                      <input
                        type="file"
                        accept=".pdf"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) setCvFile(file);
                        }}
                      />
                    </label>
                  </Field>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => void uploadCV()}
                      disabled={busy === "cv" || !cvFile || !settings.apiUrl}
                    >
                      <FaIcon icon={faCloud} size={14} /> Subir CV al servidor
                    </Button>
                  </div>

                  {settings.cvFileName && (
                    <p className="rounded-lg bg-emerald-50 px-3 py-2 text-label text-emerald-700">
                      CV cargado: <strong>{settings.cvFileName}</strong>{" "}
                      {settings.cvUploadedAt && <>· {formatDateTimeEs(settings.cvUploadedAt)}</>}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          ) : null}

          {settings.accessToken ? (
            <Card
              title="Preferencias"
              actions={<FaIcon icon={faSliders} size={16} className="text-ink-subtle" />}
            >
              <div className="space-y-3">
                <Toggle
                  label="Sincronización automática"
                  description="Sube y baja tus postulaciones entre equipos."
                  checked={settings.syncEnabled}
                  onChange={(value) => void changePreference({ syncEnabled: value })}
                />
                <Toggle
                  label="Notificaciones en el navegador"
                  description="Avisos de Chrome sobre ofertas nuevas y recordatorios vencidos."
                  checked={settings.notificationsEnabled}
                  onChange={(value) => void changePreference({ notificationsEnabled: value })}
                />
                <Toggle
                  label="Avisos por correo"
                  description="Correos del servidor con recordatorios y resúmenes. No afecta a la confirmación de tu cuenta."
                  checked={settings.emailNotificationsEnabled}
                  onChange={(value) => void changePreference({ emailNotificationsEnabled: value })}
                />

                <Field label="Días para hacer seguimiento" hint="Entre 1 y 365 días">
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={365}
                      value={followUpDaysDraft}
                      onChange={(event) => setFollowUpDaysDraft(event.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={saveFollowUpDays}
                      disabled={busy === "prefs"}
                    >
                      <FaIcon icon={faFloppyDisk} size={14} /> Guardar
                    </Button>
                  </div>
                </Field>
              </div>
            </Card>
          ) : null}

          {pending && (
            <Card
              title="Confirma tu correo"
              className="lg:col-span-2"
              actions={<FaIcon icon={faEnvelope} size={16} className="text-brand-600" />}
            >
              <div className="space-y-3">
                <div className="flex items-start gap-3 rounded-control bg-brand-50 p-3">
                  <FaIcon icon={faPaperPlane} size={16} className="mt-0.5 text-brand-600" />
                  <div className="min-w-0">
                    <p className="text-body text-ink">
                      Enviamos un enlace de confirmación a{" "}
                      <strong className="break-all">{pending.email}</strong>.
                    </p>
                    <p className="mt-0.5 text-label text-ink-muted">
                      Ábrelo desde este navegador: la sesión se iniciará sola en cuanto confirmes.
                      Si no lo ves, revisa la carpeta de spam.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    className={cn(
                      new Date(pending.expiresAt).getTime() <= tick
                        ? "bg-rose-50 text-rose-700"
                        : "bg-surface-sunken text-ink-soft",
                    )}
                  >
                    {remainingLabel(pending.expiresAt, tick)}
                  </Badge>
                  <Button
                    size="sm"
                    loading={verificationBusy}
                    onClick={() => void refreshVerification(true)}
                  >
                    Ya lo confirmé
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void resendEmail()}
                    disabled={verificationBusy || Date.now() < resendAvailableAt}
                  >
                    <FaIcon icon={faEnvelope} size={13} /> Reenviar correo
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void cancelVerification();
                      setError(null);
                      toast({ title: "Espera cancelada", description: "Puedes crear otra cuenta.", tone: "info" });
                    }}
                    disabled={verificationBusy}
                  >
                    Usar otra cuenta
                  </Button>
                </div>

                <p className="text-label text-ink-muted">
                  Los correos de confirmación caducan a los 30 minutos. Nunca compartas este enlace.
                </p>
              </div>
            </Card>
          )}

          <Card
            title="Cuenta"
            actions={<FaIcon icon={faUser} size={16} className="text-ink-subtle" />}
          >
            {settings.user ? (
              <div className="space-y-3">
                <div className="rounded-lg bg-surface-muted px-3 py-2 text-sm">
                  <p className="font-medium text-ink">
                    {settings.user.name ?? settings.user.email}
                  </p>
                  <p className="text-label text-ink-muted">{settings.user.email}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void syncFromStatus()}
                    disabled={syncing}
                  >
                    <FaIcon
                      icon={faArrowsRotate}
                      size={14}
                      className={syncing ? "animate-spin" : undefined}
                    />
                    Sincronizar ahora
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleLogout()}
                    disabled={busy === "logout"}
                  >
                    <FaIcon icon={faRightFromBracket} size={14} /> Cerrar sesión
                  </Button>
                </div>
                <p className="text-label text-ink-subtle">Cambios pendientes: {status?.pending ?? 0}</p>
              </div>
            ) : pending ? (
              <div className="space-y-2 text-body text-ink-muted">
                <p className="font-medium text-ink">Estamos esperando tu confirmación</p>
                <p className="text-label">
                  La cuenta de {pending.email} se activará al abrir el enlace del correo. La sesión
                  se iniciará automáticamente.
                </p>
              </div>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitAuth();
                }}
              >
                <Segmented
                  label="Tipo de acceso"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "login", label: "Iniciar sesión" },
                    { value: "register", label: "Crear cuenta" },
                  ]}
                />

                {mode === "register" && (
                  <Field label="Nombre" hint="Opcional; se usa para saludarte en los correos.">
                    <Input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      autoComplete="name"
                    />
                  </Field>
                )}
                <Field label="Correo">
                  <Input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="username"
                    required
                  />
                </Field>
                <Field
                  label="Contraseña"
                  hint={mode === "register" ? "Mínimo 10 caracteres." : undefined}
                >
                  <Input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    required
                  />
                </Field>

                <Button
                  type="submit"
                  size="sm"
                  loading={busy === "auth"}
                  disabled={!email.trim() || !password}
                >
                  {mode === "login" ? "Entrar" : "Crear cuenta"}
                </Button>

                {mode === "register" && (
                  <p className="text-label text-ink-muted">
                    Te enviaremos un correo para confirmar la cuenta. El enlace dura 30 minutos y
                    solo entonces podrás iniciar sesión.
                  </p>
                )}
              </form>
            )}
          </Card>
        </>
      ) : null}

      <Card title="Datos" className="lg:col-span-2">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void handleExport("json")}>
              <FaIcon icon={faDownload} size={14} /> Exportar JSON
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void handleExport("csv")}>
              <FaIcon icon={faDownload} size={14} /> Exportar CSV
            </Button>
          </div>

          <div>
            <p className="mb-1 text-label font-medium text-ink-muted">Importar respaldo o CSV</p>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-line-strong bg-surface-muted px-3 py-2 text-label text-ink-muted hover:border-brand-400">
              <FaIcon icon={faUpload} size={14} />
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
          </div>

          {settings.apiUrl && (
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
                <FaIcon icon={faArrowsRotate} size={14} /> Forzar descarga completa
              </Button>
            </div>
          )}
        </div>
      </Card>

      <Card title={`Papelera (${deleted?.length ?? 0})`} className="lg:col-span-2">
        {!deleted || deleted.length === 0 ? (
          <p className="text-label text-ink-subtle">No hay postulaciones eliminadas.</p>
        ) : (
          <ul className="divide-y divide-line">
            {deleted.map((application) => (
              <li key={application.id} className="flex items-center gap-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink-soft">{application.jobTitle}</p>
                  <p className="truncate text-label text-ink-muted">{application.company}</p>
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
        <div className="flex flex-wrap items-center justify-between gap-2 text-label text-ink-muted">
          <p>Postulia v{browser.runtime.getManifest().version}</p>
          <div className="flex flex-wrap gap-3">
            <a
              href="https://github.com/SGDIEGO/postulia"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand-600 hover:underline"
            >
              Repositorio
            </a>
            <a
              href="https://github.com/SGDIEGO/postulia/blob/main/PRIVACY.md"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand-600 hover:underline"
            >
              Política de privacidad
            </a>
          </div>
        </div>
      </Card>
    </div>
  );
}
