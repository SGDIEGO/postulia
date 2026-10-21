import type { PrismaClient } from "@prisma/client";
import { TAG_COLORS } from "@postulia/shared";

/**
 * Cliente Prisma "amplio": sirve tanto para `PrismaClient` como para el cliente
 * dentro de una transacción.
 */
export type Db = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/** Color estable por nombre de etiqueta. */
export function colorForTag(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 1_000_000_007;
  }
  return TAG_COLORS[hash % TAG_COLORS.length] ?? TAG_COLORS[0];
}
