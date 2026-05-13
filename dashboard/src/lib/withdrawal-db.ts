/**
 * Withdrawals — rút tiền từ doanh thu (1 record / lần rút).
 * Backed by Supabase (table: withdrawals).
 */

import { supabase } from "./supabase";

const TABLE = "withdrawals";

export type WithdrawalStatus = "paid" | "progressing" | "under_review";
export type WithdrawalWallet = "evault" | "gname" | null;

export interface Withdrawal {
  id: string;
  withdrawnAt: string;
  amount: number;
  currency: string;
  status: WithdrawalStatus;
  notes: string | null;
  wallet: WithdrawalWallet;
  createdAt: string;
}

interface DbRow {
  id: string;
  withdrawn_at: string;
  amount: number;
  currency: string;
  status: WithdrawalStatus;
  notes: string | null;
  wallet: WithdrawalWallet;
  created_at: string;
}

function rowToEntry(r: DbRow): Withdrawal {
  return {
    id: r.id,
    withdrawnAt: r.withdrawn_at,
    amount: Number(r.amount),
    currency: r.currency,
    status: r.status,
    notes: r.notes,
    wallet: r.wallet ?? null,
    createdAt: r.created_at,
  };
}

export async function readAll(): Promise<Withdrawal[]> {
  const sb = supabase();
  const { data, error } = await sb
    .from(TABLE)
    .select("*")
    .order("withdrawn_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as DbRow[] ?? []).map(rowToEntry);
}

export interface AddInput {
  withdrawnAt: string;
  amount: number;
  currency?: string;
  status: WithdrawalStatus;
  notes?: string | null;
  wallet?: WithdrawalWallet;
}

export async function addEntry(input: AddInput): Promise<Withdrawal> {
  const sb = supabase();
  const { data, error } = await sb.from(TABLE).insert({
    withdrawn_at: input.withdrawnAt,
    amount: input.amount,
    currency: (input.currency ?? "USD").toUpperCase().trim(),
    status: input.status,
    notes: input.notes ?? null,
    wallet: input.wallet ?? null,
  }).select().single();
  if (error) throw new Error(error.message);
  return rowToEntry(data as DbRow);
}

export interface UpdateInput {
  withdrawnAt?: string;
  amount?: number;
  currency?: string;
  status?: WithdrawalStatus;
  notes?: string | null;
  wallet?: WithdrawalWallet;
}

export async function updateEntry(id: string, patch: UpdateInput): Promise<void> {
  const sb = supabase();
  const updates: Record<string, unknown> = {};
  if (patch.withdrawnAt !== undefined) updates.withdrawn_at = patch.withdrawnAt;
  if (patch.amount !== undefined) updates.amount = patch.amount;
  if (patch.currency !== undefined) updates.currency = patch.currency.toUpperCase().trim();
  if (patch.status !== undefined) updates.status = patch.status;
  if (patch.notes !== undefined) updates.notes = patch.notes;
  if (patch.wallet !== undefined) updates.wallet = patch.wallet;
  if (Object.keys(updates).length === 0) return;
  const { error } = await sb.from(TABLE).update(updates).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteEntry(id: string): Promise<void> {
  const sb = supabase();
  const { error } = await sb.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(error.message);
}
