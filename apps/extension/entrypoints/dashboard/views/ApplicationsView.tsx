import { useMemo, useState } from "react";
import { faMagnifyingGlass, faPlus, faXmark } from "@fortawesome/free-solid-svg-icons";
import {
  APPLICATION_STATUSES,
  SOURCE_LABELS,
  SOURCES,
  STATUS_LABELS,
  formatDateEs,
  relativeTimeEs,
  type ApplicationStatus,
  type Source,
} from "@postulia/shared";
import { FaIcon } from "~/components/FaIcon";
import { StatusBadge } from "~/components/StatusBadge";
import { Badge, Button, EmptyState, Input, Select, Skeleton, cn } from "~/components/ui";
import { useApplications, useTags } from "~/lib/hooks";

type SortKey = "updatedAt" | "appliedAt" | "company";

const SORT_LABELS: Record<SortKey, string> = {
  updatedAt: "Más recientes",
  appliedAt: "Fecha de postulación",
  company: "Empresa (A-Z)",
};

export function ApplicationsView({
  onOpenApplication,
  onCreate,
}: {
  onOpenApplication: (id: string) => void;
  onCreate: () => void;
}) {
  const applications = useApplications();
  const tags = useTags();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ApplicationStatus | "">("");
  const [source, setSource] = useState<Source | "">("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState<SortKey>("updatedAt");

  const filtered = useMemo(() => {
    if (!applications) return [];
    const search = query.trim().toLowerCase();

    return applications
      .filter((application) => {
        if (status && application.status !== status) return false;
        if (source && application.source !== source) return false;
        if (tag && !application.tags.includes(tag)) return false;
        if (!search) return true;
        return (
          application.jobTitle.toLowerCase().includes(search) ||
          application.company.toLowerCase().includes(search) ||
          (application.notes ?? "").toLowerCase().includes(search) ||
          application.tags.some((item) => item.toLowerCase().includes(search))
        );
      })
      .sort((a, b) => {
        if (sort === "company") return a.company.localeCompare(b.company);
        if (sort === "appliedAt") return (b.appliedAt ?? "").localeCompare(a.appliedAt ?? "");
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [applications, query, status, source, tag, sort]);

  const activeFilters = [
    status && { key: "status" as const, label: STATUS_LABELS[status] },
    source && { key: "source" as const, label: SOURCE_LABELS[source] },
    tag && { key: "tag" as const, label: tag },
    query.trim() && { key: "query" as const, label: `“${query.trim()}”` },
  ].filter(Boolean) as { key: "status" | "source" | "tag" | "query"; label: string }[];

  function clearFilter(key: "status" | "source" | "tag" | "query") {
    if (key === "status") setStatus("");
    if (key === "source") setSource("");
    if (key === "tag") setTag("");
    if (key === "query") setQuery("");
  }

  function clearAll() {
    setStatus("");
    setSource("");
    setTag("");
    setQuery("");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <FaIcon
            icon={faMagnifyingGlass}
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por puesto, empresa, nota o etiqueta…"
            aria-label="Buscar postulaciones"
            className="pl-8"
          />
        </div>

        <Select
          value={status}
          onChange={(event) => setStatus(event.target.value as ApplicationStatus | "")}
          aria-label="Filtrar por estado"
          className="w-40"
        >
          <option value="">Todos los estados</option>
          {APPLICATION_STATUSES.map((option) => (
            <option key={option} value={option}>
              {STATUS_LABELS[option]}
            </option>
          ))}
        </Select>

        <Select
          value={source}
          onChange={(event) => setSource(event.target.value as Source | "")}
          aria-label="Filtrar por portal"
          className="w-36"
        >
          <option value="">Todos los portales</option>
          {SOURCES.map((option) => (
            <option key={option} value={option}>
              {SOURCE_LABELS[option]}
            </option>
          ))}
        </Select>

        <Select
          value={tag}
          onChange={(event) => setTag(event.target.value)}
          aria-label="Filtrar por etiqueta"
          className="w-36"
        >
          <option value="">Todas las etiquetas</option>
          {tags.map((item) => (
            <option key={item.id} value={item.name}>
              {item.name}
            </option>
          ))}
        </Select>

        <Select
          value={sort}
          onChange={(event) => setSort(event.target.value as SortKey)}
          aria-label="Ordenar postulaciones"
          className="w-40"
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </Select>
      </div>

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-label text-ink-muted">Filtros:</span>
          {activeFilters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => clearFilter(filter.key)}
              className="group inline-flex min-h-8 items-center gap-1 rounded-full bg-brand-50 px-2.5 text-label font-medium text-brand-700 transition hover:bg-brand-100"
              aria-label={`Quitar filtro ${filter.label}`}
            >
              {filter.label}
              <FaIcon icon={faXmark} size={11} className="text-brand-600" />
            </button>
          ))}
          <Button size="xs" variant="ghost" onClick={clearAll}>
            Limpiar
          </Button>
        </div>
      )}

      {applications === undefined ? (
        <div className="space-y-2 rounded-card border border-line bg-surface p-3" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-9" />
          ))}
        </div>
      ) : applications.length === 0 ? (
        <EmptyState
          title="No hay postulaciones todavía"
          description="Captura ofertas con el botón flotante o añade una manualmente."
          action={
            <Button size="sm" onClick={onCreate} className="mt-2">
              <FaIcon icon={faPlus} size={14} /> Nueva postulación
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <table className="w-full text-left">
            <caption className="sr-only">
              Postulaciones guardadas, {filtered.length} visibles de {applications.length}
            </caption>
            <thead className="border-b border-line bg-surface-muted text-label uppercase tracking-wide text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  Puesto / Empresa
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Estado
                </th>
                <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">
                  Portal
                </th>
                <th scope="col" className="hidden px-4 py-2 font-medium lg:table-cell">
                  Etiquetas
                </th>
                <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
                  Postulada
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Actualizada
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((application) => (
                <tr
                  key={application.id}
                  className="transition hover:bg-surface-muted focus-within:bg-surface-muted"
                >
                  <td className="max-w-72 px-4 py-1.5">
                    {/* Enlace real: la tabla queda navegable con Tab y lector de pantalla. */}
                    <button
                      type="button"
                      onClick={() => onOpenApplication(application.id)}
                      className="block w-full text-left"
                    >
                      <span className="block truncate text-title font-medium text-ink">
                        {application.jobTitle}
                      </span>
                      <span className="block truncate text-label text-ink-muted">
                        {application.company}
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-1.5">
                    <StatusBadge status={application.status} />
                  </td>
                  <td className="hidden px-4 py-1.5 text-label text-ink-soft md:table-cell">
                    {SOURCE_LABELS[application.source]}
                  </td>
                  <td className="hidden px-4 py-1.5 lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {application.tags.slice(0, 3).map((item) => (
                        <Badge key={item}>{item}</Badge>
                      ))}
                      {application.tags.length > 3 && (
                        <span className="text-label text-ink-subtle">
                          +{application.tags.length - 3}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="hidden px-4 py-1.5 text-label text-ink-soft sm:table-cell">
                    {formatDateEs(application.appliedAt)}
                  </td>
                  <td className="px-4 py-1.5 text-label text-ink-muted">
                    <span title={formatDateEs(application.updatedAt)}>
                      {relativeTimeEs(application.updatedAt)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <p className="text-body text-ink-muted">Ninguna postulación coincide con los filtros.</p>
              <Button size="xs" variant="secondary" onClick={clearAll}>
                Limpiar filtros
              </Button>
            </div>
          )}
        </div>
      )}

      <p className={cn("text-right text-label text-ink-subtle")} aria-live="polite">
        {filtered.length} de {applications?.length ?? 0} postulaciones
      </p>
    </div>
  );
}
