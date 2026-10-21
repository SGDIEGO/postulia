import type { FastifyInstance } from "fastify";
import {
  ACTIVE_STATUSES,
  APPLICATION_STATUSES,
  SOURCES,
  startOfWeek,
  type ApplicationStatus,
  type Source,
  type StatsSummary,
} from "@postulia/shared";

const WEEKS_BACK = 12;

export default async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  app.get("/api/stats", async (request) => {
    const userId = request.user.sub;
    const baseWhere = { userId, deletedAt: null } as const;

    const [total, byStatusRows, bySourceRows, appliedRows, interviewEvents, pendingReminders] =
      await Promise.all([
        app.prisma.application.count({ where: baseWhere }),
        app.prisma.application.groupBy({
          by: ["status"],
          where: baseWhere,
          _count: { _all: true },
        }),
        app.prisma.application.groupBy({
          by: ["source"],
          where: baseWhere,
          _count: { _all: true },
        }),
        app.prisma.application.findMany({
          where: { ...baseWhere, appliedAt: { not: null } },
          select: { appliedAt: true },
        }),
        app.prisma.applicationEvent.findMany({
          where: { userId, type: "interview", deletedAt: null },
          select: { applicationId: true, occurredAt: true },
        }),
        app.prisma.reminder.count({
          where: {
            userId,
            deletedAt: null,
            done: false,
            dueAt: { lte: new Date(Date.now() + 86_400_000) },
          },
        }),
      ]);

    const byStatus = Object.fromEntries(
      APPLICATION_STATUSES.map((status) => [status, 0]),
    ) as Record<ApplicationStatus, number>;
    for (const row of byStatusRows) {
      if ((APPLICATION_STATUSES as readonly string[]).includes(row.status)) {
        byStatus[row.status as ApplicationStatus] = row._count._all;
      }
    }

    const bySource = SOURCES.map((source) => ({
      source: source as Source,
      count: bySourceRows.find((row) => row.source === source)?._count._all ?? 0,
    })).filter((entry) => entry.count > 0);

    /* Postulaciones por semana (últimas 12 semanas) */
    const buckets = new Map<string, number>();
    for (let index = WEEKS_BACK - 1; index >= 0; index -= 1) {
      const weekStart = startOfWeek(new Date(Date.now() - index * 7 * 86_400_000));
      buckets.set(weekStart.toISOString().slice(0, 10), 0);
    }
    for (const row of appliedRows) {
      if (!row.appliedAt) continue;
      const key = startOfWeek(row.appliedAt).toISOString().slice(0, 10);
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const weekly = [...buckets.entries()].map(([weekStart, count]) => ({ weekStart, count }));

    /* Tasa de respuesta: entrevistas u ofertas sobre el total */
    const responded = byStatus.interview + byStatus.offer;
    const responseRate = total > 0 ? responded / total : 0;

    /* Días promedio hasta la primera entrevista */
    let avgDaysToInterview: number | null = null;
    if (interviewEvents.length > 0) {
      const applications = await app.prisma.application.findMany({
        where: {
          userId,
          id: { in: [...new Set(interviewEvents.map((event) => event.applicationId))] },
        },
        select: { id: true, appliedAt: true, createdAt: true },
      });
      const referenceById = new Map(
        applications.map((application) => [
          application.id,
          (application.appliedAt ?? application.createdAt).getTime(),
        ]),
      );
      const deltas: number[] = [];
      const seen = new Set<string>();
      for (const event of interviewEvents) {
        if (seen.has(event.applicationId)) continue;
        seen.add(event.applicationId);
        const reference = referenceById.get(event.applicationId);
        if (!reference) continue;
        deltas.push((event.occurredAt.getTime() - reference) / 86_400_000);
      }
      if (deltas.length > 0) {
        avgDaysToInterview = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
      }
    }

    const active = ACTIVE_STATUSES.reduce((sum, status) => sum + byStatus[status], 0);

    const summary: StatsSummary = {
      total,
      active,
      byStatus,
      bySource,
      weekly,
      responseRate,
      avgDaysToInterview,
      pendingReminders,
    };

    return summary;
  });
}
