/**
 * Cliente Prisma falso en memoria para las pruebas de integración de la API.
 * Solo implementa lo que usan las rutas y evita necesitar PostgreSQL.
 */
type Row = Record<string, any>;

const clone = <T>(value: T): T => structuredClone(value);

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;

  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Row[]).some((clause) => matches(row, clause));
    if (key === "AND") return (condition as Row[]).every((clause) => matches(row, clause));
    if (key === "userId_name") {
      const composite = condition as Row;
      return Object.entries(composite).every(([field, value]) => row[field] === value);
    }

    const value = (row as Row)[key];

    if (condition === null) return value === null || value === undefined;
    if (condition instanceof Date) {
      return value instanceof Date && value.getTime() === condition.getTime();
    }
    if (Array.isArray(condition)) return condition.includes(value);

    if (typeof condition === "object" && condition !== null) {
      const clause = condition as Row;
      if ("in" in clause) return (clause.in as unknown[]).includes(value);
      if ("not" in clause) {
        if (clause.not === null) return value !== null && value !== undefined;
        return value !== clause.not;
      }
      if ("gt" in clause) return value > clause.gt;
      if ("gte" in clause) return value >= clause.gte;
      if ("lt" in clause) return value < clause.lt;
      if ("lte" in clause) return value <= clause.lte;
      if ("contains" in clause) {
        return (
          typeof value === "string" &&
          value.toLowerCase().includes(String(clause.contains).toLowerCase())
        );
      }
      if ("some" in clause) {
        return Array.isArray(value) && value.some((item: Row) => matches(item, clause.some));
      }
      if ("every" in clause) {
        return Array.isArray(value) && value.every((item: Row) => matches(item, clause.every));
      }
      return true;
    }

    return value === condition;
  });
}

function sortRows(rows: Row[], orderBy: Row | undefined): Row[] {
  if (!orderBy) return rows;
  const [field, direction] = Object.entries(orderBy)[0] as [string, "asc" | "desc"];
  return [...rows].sort((a, b) => {
    const left = a[field];
    const right = b[field];
    const result = left > right ? 1 : left < right ? -1 : 0;
    return direction === "desc" ? -result : result;
  });
}

export function createFakePrisma() {
  const users: Row[] = [];
  const refreshTokens: Row[] = [];
  const applications: Row[] = [];
  const events: Row[] = [];
  const reminders: Row[] = [];
  const tags: Row[] = [];
  const applicationTags: Row[] = [];

  let counter = 0;
  const nextId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

  const withTags = (row: Row, include?: Row): Row => {
    if (!include?.tags) return clone(row);
    return {
      ...clone(row),
      tags: applicationTags
        .filter((link) => link.applicationId === row.id)
        .map((link) => ({
          ...clone(link),
          tag: clone(tags.find((tag) => tag.id === link.tagId)!),
        })),
    };
  };

  const prisma: any = {
    user: {
      async findUnique({ where }: Row) {
        return clone(users.find((user) => matches(user, where))) ?? null;
      },
      async create({ data }: Row) {
        const row = {
          id: data.id ?? nextId(),
          name: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        users.push(row);
        return clone(row);
      },
    },

    refreshToken: {
      async create({ data }: Row) {
        const row = { id: nextId(), createdAt: new Date(), revokedAt: null, ...data };
        refreshTokens.push(row);
        return clone(row);
      },
      async findUnique({ where, include }: Row) {
        const row = refreshTokens.find((token) => matches(token, where));
        if (!row) return null;
        const result = clone(row);
        if (include?.user) {
          result.user = clone(users.find((user) => user.id === row.userId));
        }
        return result;
      },
      async update({ where, data }: Row) {
        const row = refreshTokens.find((token) => matches(token, where));
        if (!row) throw new Error("refreshToken no encontrado en el cliente falso");
        Object.assign(row, data);
        return clone(row);
      },
      async updateMany({ where, data }: Row) {
        const rows = refreshTokens.filter((token) => matches(token, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },

    application: {
      async findFirst({ where, include }: Row) {
        const row = applications.find((application) => matches(application, where));
        return row ? withTags(row, include) : null;
      },
      async findUnique({ where, include }: Row) {
        const row = applications.find((application) => matches(application, where));
        return row ? withTags(row, include) : null;
      },
      async findMany({ where, orderBy, take, skip, include }: Row) {
        const rows = sortRows(
          applications.filter((application) => matches(application, where)),
          orderBy,
        );
        return rows
          .slice(skip ?? 0, (skip ?? 0) + (take ?? rows.length))
          .map((row) => withTags(row, include));
      },
      async count({ where }: Row) {
        return applications.filter((application) => matches(application, where)).length;
      },
      async create({ data, include }: Row) {
        const now = new Date();
        const row: Row = {
          id: data.id ?? nextId(),
          createdAt: data.createdAt ?? now,
          updatedAt: data.updatedAt ?? now,
          deletedAt: null,
          ...data,
        };
        applications.push(row);
        return withTags(row, include);
      },
      async update({ where, data }: Row) {
        const row = applications.find((application) => matches(application, where));
        if (!row) throw new Error("application no encontrada en el cliente falso");
        Object.assign(row, data);
        row.updatedAt = new Date();
        return withTags(row);
      },
    },

    applicationEvent: {
      async create({ data }: Row) {
        const now = new Date();
        const row: Row = {
          id: data.id ?? nextId(),
          message: null,
          fromStatus: null,
          toStatus: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          ...data,
        };
        events.push(row);
        return clone(row);
      },
      async findUnique({ where }: Row) {
        return clone(events.find((event) => matches(event, where))) ?? null;
      },
      async findFirst({ where }: Row) {
        const row = events.find((event) => matches(event, where));
        return row ? clone(row) : null;
      },
      async findMany({ where, orderBy, take }: Row) {
        const rows = sortRows(
          events.filter((event) => matches(event, where)),
          orderBy,
        );
        return rows.slice(0, take ?? rows.length).map(clone);
      },
      async update({ where, data }: Row) {
        const row = events.find((event) => matches(event, where));
        if (!row) throw new Error("evento no encontrado en el cliente falso");
        Object.assign(row, data);
        row.updatedAt = new Date();
        return clone(row);
      },
    },

    reminder: {
      async create({ data }: Row) {
        const now = new Date();
        const row: Row = {
          id: data.id ?? nextId(),
          done: false,
          message: null,
          notifiedAt: null,
          createdAt: data.createdAt ?? now,
          updatedAt: data.updatedAt ?? now,
          deletedAt: null,
          ...data,
        };
        reminders.push(row);
        return clone(row);
      },
      async findUnique({ where }: Row) {
        return clone(reminders.find((reminder) => matches(reminder, where))) ?? null;
      },
      async findFirst({ where }: Row) {
        const row = reminders.find((reminder) => matches(reminder, where));
        return row ? clone(row) : null;
      },
      async findMany({ where, orderBy, take, include }: Row) {
        const rows = sortRows(
          reminders.filter((reminder) => matches(reminder, where)),
          orderBy,
        ).slice(0, take ?? Number.MAX_SAFE_INTEGER);

        return rows.map((row) => {
          const result = clone(row);
          if (include?.application?.select) {
            const application = applications.find((item) => item.id === row.applicationId);
            result.application = application
              ? { id: application.id, jobTitle: application.jobTitle, company: application.company }
              : null;
          }
          return result;
        });
      },
      async count({ where }: Row) {
        return reminders.filter((reminder) => matches(reminder, where)).length;
      },
      async update({ where, data }: Row) {
        const row = reminders.find((reminder) => matches(reminder, where));
        if (!row) throw new Error("recordatorio no encontrado en el cliente falso");
        Object.assign(row, data);
        row.updatedAt = new Date();
        return clone(row);
      },
    },

    tag: {
      async findFirst({ where }: Row) {
        const row = tags.find((tag) => matches(tag, where));
        return row ? clone(row) : null;
      },
      async findUnique({ where }: Row) {
        const row = tags.find((tag) => matches(tag, where));
        return row ? clone(row) : null;
      },
      async findMany({ where, orderBy }: Row) {
        const rows = sortRows(
          tags.filter((tag) => matches(tag, where)),
          orderBy,
        );
        return rows.map((row) => ({
          ...clone(row),
          _count: {
            applications: applicationTags.filter((link) => link.tagId === row.id).length,
          },
        }));
      },
      async create({ data }: Row) {
        const now = new Date();
        const row: Row = {
          id: data.id ?? nextId(),
          color: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          ...data,
        };
        tags.push(row);
        return clone(row);
      },
      async update({ where, data }: Row) {
        const row = tags.find((tag) => matches(tag, where));
        if (!row) throw new Error("etiqueta no encontrada en el cliente falso");
        Object.assign(row, data);
        row.updatedAt = new Date();
        return clone(row);
      },
    },

    applicationTag: {
      async findMany({ where }: Row) {
        return applicationTags.filter((link) => matches(link, where)).map(clone);
      },
      async createMany({ data, skipDuplicates }: Row) {
        let count = 0;
        for (const item of data as Row[]) {
          const exists = applicationTags.some(
            (link) => link.applicationId === item.applicationId && link.tagId === item.tagId,
          );
          if (exists && skipDuplicates) continue;
          applicationTags.push({ ...item });
          count += 1;
        }
        return { count };
      },
      async deleteMany({ where }: Row) {
        const keep = applicationTags.filter((link) => !matches(link, where));
        const removed = applicationTags.length - keep.length;
        applicationTags.length = 0;
        applicationTags.push(...keep);
        return { count: removed };
      },
    },

    async $queryRaw() {
      return [{ ok: 1 }];
    },
    async $connect() {},
    async $disconnect() {},
    async $transaction(input: unknown) {
      if (typeof input === "function") return (input as (client: unknown) => unknown)(prisma);
      return Promise.all(input as Promise<unknown>[]);
    },
  };

  return prisma;
}
