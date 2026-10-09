import { handle, json } from "@/lib/api";
import { treasuryBooks } from "@/lib/treasury";

/** The books: treasury wallet, fee share, buybacks and burns, all with signatures. */
export const GET = handle(async () => json({ ok: true, ...(await treasuryBooks()) }));
