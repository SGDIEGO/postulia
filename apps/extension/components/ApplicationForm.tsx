import { useEffect, useState } from "react";
import {
  APPLICATION_STATUSES,
  CONTRACT_TYPES,
  CONTRACT_TYPE_LABELS,
  SOURCES,
  SOURCE_LABELS,
  STATUS_LABELS,
  WORK_MODES,
  WORK_MODE_LABELS,
  detectSource,
  type ApplicationInput,
  type ApplicationStatus,
  type ContractType,
  type Source,
  type WorkMode,
} from "@postulia/shared";
import type { LocalApplication } from "~/lib/db";
import { createApplication, updateApplication } from "~/lib/repository";
import { Button, Field, Input, Modal, Select, Textarea } from "./ui";

interface FormState {
  jobTitle: string;
  company: string;
  url: string;
  source: Source;
  status: ApplicationStatus;
  location: string;
  workMode: WorkMode | "";
  salary: string;
  currency: string;
  contractType: ContractType | "";
  appliedAt: string;
  tags: string;
  recruiterName: string;
  recruiterContact: string;
  cvVersion: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  jobTitle: "",
  company: "",
  url: "",
  source: "other",
  status: "applied",
  location: "",
  workMode: "",
  salary: "",
  currency: "",
  contractType: "",
  appliedAt: "",
  tags: "",
  recruiterName: "",
  recruiterContact: "",
  cvVersion: "",
  notes: "",
};

function toForm(application: LocalApplication): FormState {
  return {
    jobTitle: application.jobTitle,
    company: application.company,
    url: application.url ?? "",
    source: application.source,
    status: application.status,
    location: application.location ?? "",
    workMode: application.workMode ?? "",
    salary: application.salary ?? "",
    currency: application.currency ?? "",
    contractType: (application.contractType as ContractType | null) ?? "",
    appliedAt: application.appliedAt ? application.appliedAt.slice(0, 10) : "",
    tags: application.tags.join(", "),
    recruiterName: application.recruiterName ?? "",
    recruiterContact: application.recruiterContact ?? "",
    cvVersion: application.cvVersion ?? "",
    notes: application.notes ?? "",
  };
}

function toInput(form: FormState): ApplicationInput {
  return {
    jobTitle: form.jobTitle.trim(),
    company: form.company.trim(),
    url: form.url.trim() || null,
    source: form.source,
    status: form.status,
    location: form.location.trim() || null,
    workMode: form.workMode || null,
    salary: form.salary.trim() || null,
    currency: form.currency.trim() || null,
    contractType: form.contractType || null,
    appliedAt: form.appliedAt ? new Date(`${form.appliedAt}T12:00:00`).toISOString() : null,
    tags: form.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    recruiterName: form.recruiterName.trim() || null,
    recruiterContact: form.recruiterContact.trim() || null,
    cvVersion: form.cvVersion.trim() || null,
    notes: form.notes.trim() || null,
  };
}

export function ApplicationForm({
  open,
  onClose,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  initial?: LocalApplication | null;
  onSaved?: (application: LocalApplication) => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(initial ? toForm(initial) : EMPTY_FORM);
    setError(null);
  }, [open, initial]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.jobTitle.trim() || !form.company.trim()) {
      setError("El puesto y la empresa son obligatorios");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const input = toInput(form);
      const saved = initial
        ? await updateApplication(initial.id, input)
        : await createApplication(input);
      if (saved) onSaved?.(saved);
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "No se pudo guardar la postulación",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={initial ? "Editar postulación" : "Nueva postulación"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? "Guardando…" : initial ? "Guardar cambios" : "Crear postulación"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Puesto *">
          <Input
            value={form.jobTitle}
            onChange={(event) => update("jobTitle", event.target.value)}
            placeholder="Desarrollador Backend Senior"
          />
        </Field>

        <Field label="Empresa *">
          <Input
            value={form.company}
            onChange={(event) => update("company", event.target.value)}
            placeholder="Acme Corp"
          />
        </Field>

        <Field label="Enlace de la oferta" className="sm:col-span-2">
          <Input
            value={form.url}
            onChange={(event) => {
              const value = event.target.value;
              update("url", value);
              if (value) update("source", detectSource(value));
            }}
            placeholder="https://www.linkedin.com/jobs/view/…"
          />
        </Field>

        <Field label="Estado">
          <Select
            value={form.status}
            onChange={(event) => update("status", event.target.value as ApplicationStatus)}
          >
            {APPLICATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Portal">
          <Select
            value={form.source}
            onChange={(event) => update("source", event.target.value as Source)}
          >
            {SOURCES.map((source) => (
              <option key={source} value={source}>
                {SOURCE_LABELS[source]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Fecha de postulación">
          <Input
            type="date"
            value={form.appliedAt}
            onChange={(event) => update("appliedAt", event.target.value)}
          />
        </Field>

        <Field label="Ubicación">
          <Input
            value={form.location}
            onChange={(event) => update("location", event.target.value)}
            placeholder="Bogotá, Colombia"
          />
        </Field>

        <Field label="Modalidad">
          <Select
            value={form.workMode}
            onChange={(event) => update("workMode", event.target.value as WorkMode | "")}
          >
            <option value="">Sin especificar</option>
            {WORK_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {WORK_MODE_LABELS[mode]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Tipo de contrato">
          <Select
            value={form.contractType}
            onChange={(event) => update("contractType", event.target.value as ContractType | "")}
          >
            <option value="">Sin especificar</option>
            {CONTRACT_TYPES.map((type) => (
              <option key={type} value={type}>
                {CONTRACT_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Salario">
          <Input
            value={form.salary}
            onChange={(event) => update("salary", event.target.value)}
            placeholder="4.000.000 - 5.000.000"
          />
        </Field>

        <Field label="Moneda">
          <Input
            value={form.currency}
            onChange={(event) => update("currency", event.target.value)}
            placeholder="COP"
          />
        </Field>

        <Field label="Etiquetas" hint="Sepáralas con comas: backend, remoto, prioridad">
          <Input value={form.tags} onChange={(event) => update("tags", event.target.value)} />
        </Field>

        <Field label="Versión de CV">
          <Input
            value={form.cvVersion}
            onChange={(event) => update("cvVersion", event.target.value)}
            placeholder="CV-Backend-2026.pdf"
          />
        </Field>

        <Field label="Reclutador">
          <Input
            value={form.recruiterName}
            onChange={(event) => update("recruiterName", event.target.value)}
          />
        </Field>

        <Field label="Contacto del reclutador">
          <Input
            value={form.recruiterContact}
            onChange={(event) => update("recruiterContact", event.target.value)}
            placeholder="correo o teléfono"
          />
        </Field>

        <Field label="Notas" className="sm:col-span-2">
          <Textarea
            rows={4}
            value={form.notes}
            onChange={(event) => update("notes", event.target.value)}
            placeholder="Detalles de la oferta, requisitos, próximos pasos…"
          />
        </Field>
      </div>

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
    </Modal>
  );
}
