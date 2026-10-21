import {
  ACTIVE_STATUSES,
  APPLICATION_STATUSES,
  SOURCES,
  startOfWeek,
  type ApplicationStatus,
  type Source,
  type StatsSummary,
} from "@postulia/shared";
import { db } from "./db";

const WEEK_MS = 7 * 86_400_000;

export async function computeStats(): Promise<StatsSummary> {
  const applications = await db.applications.filter((item) => !item.deletedAt).toArray();

  const byStatus = Object.fromEntries(APPLICATION_STATUSES.map((status) => [status, 0])) as Record<
    ApplicationStatus,
    number
  >;

  for (const application of applications) {
    byStatus[application.status] += 1;
  }

  const sourceCounts = new Map<Source, number>();
  for (const application of applications) {
    sourceCounts.set(application.source, (sourceCounts.get(application.source) ?? 0) + 1);
  }

  const weeklyMap = new Map<string, number>();
  for (let index = 11; index >= 0; index -= 1) {
    const key = startOfWeek(new Date(Date.now() - index * WEEK_MS))
      .toISOString()
      .slice(0, 10);
    weeklyMap.set(key, 0);
  }
  for (const application of applications) {
    if (!application.appliedAt) continue;
    const key = startOfWeek(application.appliedAt).toISOString().slice(0, 10);
    if (weeklyMap.has(key)) weeklyMap.set(key, (weeklyMap.get(key) ?? 0) + 1);
  }

  const interviewFirstSeen = new Map<string, string>();
  const interviewEvents = await db.events
    .filter((event) => event.type === "interview" && !event.deletedAt)
    .toArray();
  for (const event of interviewEvents) {
    const current = interviewFirstSeen.get(event.applicationId);
    if (!current || event.occurredAt < current) {
      interviewFirstSeen.set(event.applicationId, event.occurredAt);
    }
  }

  const deltas: number[] = [];
  for (const [applicationId, occurredAt] of interviewFirstSeen) {
    const application = applications.find((item) => item.id === applicationId);
    const reference = application?.appliedAt ?? application?.createdAt;
    if (!reference) continue;
    deltas.push((new Date(occurredAt).getTime() - new Date(reference).getTime()) / 86_400_000);
  }

  const pendingReminders = await db.reminders
    .filter((reminder) => !reminder.done && !reminder.deletedAt)
    .count();

  const total = applications.length;
  const responded = byStatus.interview + byStatus.offer;

  return {
    total,
    active: ACTIVE_STATUSES.reduce((sum, status) => sum + byStatus[status], 0),
    byStatus,
    bySource: SOURCES.map((source) => ({ source, count: sourceCounts.get(source) ?? 0 })).filter(
      (entry) => entry.count > 0,
    ),
    weekly: [...weeklyMap.entries()].map(([weekStart, count]) => ({ weekStart, count })),
    responseRate: total > 0 ? responded / total : 0,
    avgDaysToInterview:
      deltas.length > 0 ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : null,
    pendingReminders,
  };
}
