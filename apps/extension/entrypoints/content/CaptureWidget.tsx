import { useState } from "react";
import type { ApplicationRecord, ApplicationStatus } from "@postulia/shared";
import { STATUS_LABELS } from "@postulia/shared";
import { extractJob } from "~/lib/extractors";
import type { ExtractedJobResult } from "~/lib/extractors/types";
import { sendMessage, type CaptureResponse, type DuplicateResponse } from "~/lib/messaging";

type Stage = "idle" | "loading" | "form" | "duplicate" | "saved" | "error";

const QUICK_STATUSES: ApplicationStatus[] = ["applied", "saved", "screening", "interview"];

export function CaptureWidget() {
  const [stage, setStage] = useState<Stage>("idle");
  const [job, setJob] = useState<ExtractedJobResult | null>(null);
  const [duplicate, setDuplicate] = useState<ApplicationRecord | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState<ApplicationRecord | null>(null);
  const [status, setStatus] = useState<ApplicationStatus>("applied");
  const [jobTitle, setJobTitle] = useState("");
  const [company, setCompany] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");

  function reset() {
    setStage("idle");
    setJob(null);
    setDuplicate(null);
    setMessage(null);
    setSaved(null);
  }

  async function openPanel() {
    setStage("loading");
    const extracted = extractJob(window.location.href, document);
    if (!extracted) {
      setMessage("No se detectó una oferta en esta página.");
      setStage("error");
      return;
    }

    setJob(extracted);
    setJobTitle(extracted.jobTitle ?? "");
    setCompany(extracted.company ?? "");
    setLocation(extracted.location ?? "");
    setStatus("applied");

    const duplicateCheck = await sendMessage<DuplicateResponse>({
      type: "postulia:duplicate-check",
      url: extracted.url,
    }).catch(() => ({ duplicate: false }) as DuplicateResponse);

    if (duplicateCheck.duplicate) {
      setDuplicate(duplicateCheck.application);
      setStage("duplicate");
      return;
    }

    setStage("form");
  }

  async function save(force = false) {
    if (!job) return;
    setStage("loading");

    const response = await sendMessage<CaptureResponse>({
      type: "postulia:capture",
      payload: {
        ...job,
        jobTitle: jobTitle.trim() || job.jobTitle,
        company: company.trim() || job.company,
        location: location.trim() || null,
        notes: notes.trim() || null,
        status,
        force,
      },
    }).catch<CaptureResponse>(() => ({ ok: false, error: "No se pudo contactar la extensión" }));

    if (response.ok) {
      setSaved(response.application);
      setStage("saved");
      return;
    }

    if ("duplicate" in response && response.duplicate) {
      setDuplicate(response.application);
      setStage("duplicate");
      return;
    }

    setMessage("error" in response ? response.error : "No se pudo guardar");
    setStage("error");
  }

  async function updateExisting() {
    if (!duplicate) return;
    setStage("loading");
    await sendMessage({ type: "postulia:update-status", id: duplicate.id, status });
    setSaved({ ...duplicate, status });
    setStage("saved");
  }

  if (stage === "idle") {
    return (
      <div className="fixed bottom-5 right-5 z-[2147483000] font-sans">
        <button
          type="button"
          onClick={() => void openPanel()}
          className="group flex items-center gap-2 rounded-full bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-900/20 transition hover:bg-brand-700"
        >
          <span className="text-base leading-none">💼</span>
          Guardar en Postulia
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-[2147483000] w-80 overflow-hidden rounded-xl border border-slate-200 bg-white font-sans text-slate-900 shadow-2xl">
      <header className="flex items-center justify-between bg-brand-600 px-4 py-3 text-white">
        <span className="text-sm font-semibold">Guardar en Postulia</span>
        <button type="button" onClick={reset} className="text-white/80 hover:text-white">
          ✕
        </button>
      </header>

      <div className="space-y-3 p-4 text-sm">
        {stage === "loading" && <p className="text-slate-500">Procesando…</p>}

        {stage === "error" && (
          <>
            <p className="text-rose-600">{message}</p>
            <button
              type="button"
              onClick={reset}
              className="w-full rounded-md bg-slate-100 px-3 py-2 font-medium hover:bg-slate-200"
            >
              Cerrar
            </button>
          </>
        )}

        {(stage === "form" || stage === "duplicate") && (
          <>
            {stage === "duplicate" && duplicate && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-800">
                Ya registraste <strong>{duplicate.jobTitle}</strong> en{" "}
                <strong>{duplicate.company}</strong> (estado actual:{" "}
                {STATUS_LABELS[duplicate.status]}).
              </p>
            )}

            <label className="block">
              <span className="text-xs font-medium text-slate-500">Puesto</span>
              <input
                value={jobTitle}
                onChange={(event) => setJobTitle(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-slate-500">Empresa</span>
              <input
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-slate-500">Ubicación</span>
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
              />
            </label>

            <div>
              <span className="text-xs font-medium text-slate-500">Estado</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {QUICK_STATUSES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setStatus(option)}
                    className={
                      option === status
                        ? "rounded-full bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white"
                        : "rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
                    }
                  >
                    {STATUS_LABELS[option]}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="text-xs font-medium text-slate-500">Notas (opcional)</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
              />
            </label>

            <div className="flex gap-2">
              {stage === "duplicate" ? (
                <>
                  <button
                    type="button"
                    onClick={() => void updateExisting()}
                    className="flex-1 rounded-md bg-brand-600 px-3 py-2 font-semibold text-white hover:bg-brand-700"
                  >
                    Actualizar estado
                  </button>
                  <button
                    type="button"
                    onClick={() => void save(true)}
                    className="rounded-md bg-slate-100 px-3 py-2 font-medium hover:bg-slate-200"
                  >
                    Guardar de nuevo
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void save(false)}
                  className="flex-1 rounded-md bg-brand-600 px-3 py-2 font-semibold text-white hover:bg-brand-700"
                >
                  Guardar postulación
                </button>
              )}
            </div>
          </>
        )}

        {stage === "saved" && (
          <>
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800">
              Guardado: <strong>{saved?.jobTitle}</strong> en <strong>{saved?.company}</strong>.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void sendMessage({ type: "postulia:open-dashboard" })}
                className="flex-1 rounded-md bg-brand-600 px-3 py-2 font-semibold text-white hover:bg-brand-700"
              >
                Abrir Postulia
              </button>
              <button
                type="button"
                onClick={reset}
                className="rounded-md bg-slate-100 px-3 py-2 font-medium hover:bg-slate-200"
              >
                Cerrar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
