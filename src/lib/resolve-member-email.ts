import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { memberEmailAliases, members } from "@/db/schema";

export type MemberEmailResolution =
  | { kind: "member"; canonicalEmail: string; memberId: string }
  | { kind: "ignored"; reason: "ignored" }
  | { kind: "unknown" };

export async function resolveMemberEmail(
  inputEmail: string,
): Promise<MemberEmailResolution> {
  const email = inputEmail.trim().toLowerCase();

  const [direct] = await db
    .select({ id: members.id, email: members.email })
    .from(members)
    .where(eq(members.email, email))
    .limit(1);

  if (direct) {
    return {
      kind: "member",
      canonicalEmail: direct.email,
      memberId: direct.id,
    };
  }

  const [alias] = await db
    .select({
      status: memberEmailAliases.status,
      memberId: memberEmailAliases.memberId,
    })
    .from(memberEmailAliases)
    .where(eq(memberEmailAliases.email, email))
    .limit(1);

  if (!alias) return { kind: "unknown" };
  if (alias.status === "ignored") return { kind: "ignored", reason: "ignored" };

  if (alias.memberId) {
    const [linked] = await db
      .select({ id: members.id, email: members.email })
      .from(members)
      .where(eq(members.id, alias.memberId))
      .limit(1);
    if (linked) {
      return {
        kind: "member",
        canonicalEmail: linked.email,
        memberId: linked.id,
      };
    }
  }

  return { kind: "unknown" };
}
