import { useMemo, useState } from "react";
import { faMagnifyingGlass, faPlus } from "@fortawesome/free-solid-svg-icons";
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
import { Button, EmptyState, Input, Select, cn } from "~/components/ui";
import { useApplications, useTags } from "~/lib/hooks";

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
  const [sort, setSort] = useState<"updatedAt" | "appliedAt" | "company">("updatedAt");

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <FaIcon
            icon={faMagnifyingGlass}
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por puesto, empresa, nota o etiqueta…"
            className="pl-8"
          />
        </div>

        <Select
          value={status}
          onChange={(event) => setStatus(event.target.value as ApplicationStatus | "")}
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
          className="w-36"
        >
          <option value="">Todos los portales</option>
          {SOURCES.map((option) => (
            <option key={option} value={option}>
              {SOURCE_LABELS[option]}
            </option>
          ))}
        </Select>

        <Select value={tag} onChange={(event) => setTag(event.target.value)} className="w-36">
          <option value="">Todas las etiquetas</option>
          {tags.map((item) => (
            <option key={item.id} value={item.name}>
              {item.name}
            </option>
          ))}
        </Select>

        <Select
          value={sort}
          onChange={(event) => setSort(event.target.value as typeof sort)}
          className="w-40"
        >
          <option value="updatedAt">Más recientes</option>
          <option value="appliedAt">Fecha de postulación</option>
          <option value="company">Empresa (A-Z)</option>
        </Select>
      </div>

      {applications && applications.length === 0 ? (
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
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Puesto / Empresa</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="hidden px-4 py-2 font-medium md:table-cell">Portal</th>
                <th className="hidden px-4 py-2 font-medium lg:table-cell">Etiquetas</th>
                <th className="hidden px-4 py-2 font-medium sm:table-cell">Postulada</th>
                <th className="px-4 py-2 font-medium">Actualizada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((application) => (
                <tr
                  key={application.id}
                  onClick={() => onOpenApplication(application.id)}
                  className="cursor-pointer hover:bg-slate-50"
                >
                  <td className="max-w-72 px-4 py-2.5">
                    <p className="truncate font-medium text-slate-800">{application.jobTitle}</p>
                    <p className="truncate text-xs text-slate-500">{application.company}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={application.status} />
                  </td>
                  <td className="hidden px-4 py-2.5 text-xs text-slate-600 md:table-cell">
                    {SOURCE_LABELS[application.source]}
                  </td>
                  <td className="hidden px-4 py-2.5 lg:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {application.tags.slice(0, 3).map((item) => (
                        <span
                          key={item}
                          className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
                        >
                          {item}
                        </span>
                      ))}
                      {application.tags.length > 3 && (
                        <span className="text-[11px] text-slate-400">
                          +{application.tags.length - 3}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="hidden px-4 py-2.5 text-xs text-slate-600 sm:table-cell">
                    {formatDateEs(application.appliedAt)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">
                    <span title={formatDateEs(application.updatedAt)}>
                      {relativeTimeEs(application.updatedAt)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              Ninguna postulación coincide con los filtros.
            </p>
          )}
        </div>
      )}

      <p className="text-right text-xs text-slate-400">
        {filtered.length} de {applications?.length ?? 0} postulaciones
      </p>
    </div>
  );
}
