/**
 * Domain Inventory — kho domain đã mua + giá mua + meta snapshot.
 * Backed by Supabase (table: domain_inventory).
 */

import { supabase } from "./supabase";

const TABLE = "domain_inventory";

export interface InventoryEntry {
  domain: string;
  purchasePrice: number | null;
  purchasedAt: string;
  sellPrice: number | null;
  soldAt: string | null;
  expectedSellPrice: number | null;
  notes: string | null;
  source: string | null;
  rating: string | null;
  category: string | null;
  archivedAt: string | null;
  isBackorder: boolean;
  updatedAt: string;
}

interface DbRow {
  domain: string;
  purchase_price: number | null;
  purchased_at: string;
  sell_price: number | null;
  sold_at: string | null;
  expected_sell_price: number | null;
  notes: string | null;
  source: string | null;
  rating: string | null;
  category: string | null;
  archived_at: string | null;
  is_backorder: boolean | null;
  updated_at: string;
}

function rowToEntry(r: DbRow): InventoryEntry {
  return {
    domain: r.domain,
    purchasePrice: r.purchase_price === null ? null : Number(r.purchase_price),
    purchasedAt: r.purchased_at,
    sellPrice: r.sell_price === null ? null : Number(r.sell_price),
    soldAt: r.sold_at,
    expectedSellPrice: r.expected_sell_price === null ? null : Number(r.expected_sell_price),
    notes: r.notes,
    source: r.source,
    rating: r.rating,
    category: r.category,
    archivedAt: r.archived_at,
    isBackorder: !!r.is_backorder,
    updatedAt: r.updated_at,
  };
}

export async function readAll(): Promise<InventoryEntry[]> {
  const sb = supabase();
  const all: DbRow[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from(TABLE)
      .select("*")
      .order("purchased_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as DbRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all.map(rowToEntry);
}

export interface AddInput {
  domain: string;
  purchasePrice: number | null;
  notes?: string | null;
  source?: string | null;
  rating?: string | null;
  category?: string | null;
  isBackorder?: boolean;
}

export async function upsertEntries(entries: AddInput[]): Promise<{ added: number; total: number }> {
  const sb = supabase();
  if (!entries.length) {
    const { count } = await sb.from(TABLE).select("*", { count: "exact", head: true });
    return { added: 0, total: count ?? 0 };
  }

  const { count: countBefore } = await sb.from(TABLE).select("*", { count: "exact", head: true });
  const before = countBefore ?? 0;

  const BATCH = 500;
  for (let i = 0; i < entries.length; i += BATCH) {
    const slice = entries.slice(i, i + BATCH).map((e) => ({
      domain: e.domain.toLowerCase().trim(),
      purchase_price: e.purchasePrice,
      notes: e.notes ?? null,
      source: e.source ?? null,
      rating: e.rating ?? null,
      category: e.category ?? null,
      is_backorder: e.isBackorder ?? false,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await sb.from(TABLE).upsert(slice, { onConflict: "domain" });
    if (error) throw new Error(error.message);
  }
  const { count: countAfter } = await sb.from(TABLE).select("*", { count: "exact", head: true });
  const total = countAfter ?? 0;
  return { added: total - before, total };
}

// Flip the backorder flag in bulk. Used by "Confirm backorder" UI action.
export async function setBackorder(
  domains: string[],
  isBackorder: boolean,
): Promise<{ updated: number }> {
  const sb = supabase();
  const targets = Array.from(new Set(
    domains.map((d) => d.toLowerCase().trim()).filter(Boolean),
  ));
  if (!targets.length) return { updated: 0 };
  const { error } = await sb
    .from(TABLE)
    .update({ is_backorder: isBackorder, updated_at: new Date().toISOString() })
    .in("domain", targets);
  if (error) throw new Error(error.message);
  return { updated: targets.length };
}

// Bulk delete by domain — used when a backorder fails. Caller is responsible
// for separately marking those domains as excluded in target_assessment.
export async function deleteEntries(domains: string[]): Promise<{ deleted: number }> {
  const sb = supabase();
  const targets = Array.from(new Set(
    domains.map((d) => d.toLowerCase().trim()).filter(Boolean),
  ));
  if (!targets.length) return { deleted: 0 };
  const { error, count } = await sb
    .from(TABLE)
    .delete({ count: "exact" })
    .in("domain", targets);
  if (error) throw new Error(error.message);
  return { deleted: count ?? 0 };
}

export async function updateEntry(
  domain: string,
  patch: Partial<Pick<InventoryEntry, "purchasePrice" | "sellPrice" | "soldAt" | "expectedSellPrice" | "notes">>
): Promise<void> {
  const sb = supabase();
  const target = domain.toLowerCase().trim();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.purchasePrice !== undefined) updates.purchase_price = patch.purchasePrice;
  if (patch.sellPrice !== undefined) updates.sell_price = patch.sellPrice;
  if (patch.soldAt !== undefined) updates.sold_at = patch.soldAt;
  if (patch.expectedSellPrice !== undefined) updates.expected_sell_price = patch.expectedSellPrice;
  if (patch.notes !== undefined) updates.notes = patch.notes;
  const { error } = await sb.from(TABLE).update(updates).eq("domain", target);
  if (error) throw new Error(error.message);
}

// Bulk mark as sold — accepts {domain, sellPrice} pairs
export async function markSold(
  rows: { domain: string; sellPrice: number | null }[]
): Promise<{ updated: number }> {
  const sb = supabase();
  if (!rows.length) return { updated: 0 };
  const now = new Date().toISOString();
  let updated = 0;
  for (const r of rows) {
    const target = r.domain.toLowerCase().trim();
    if (!target) continue;
    const { error } = await sb.from(TABLE).update({
      sell_price: r.sellPrice,
      sold_at: r.sellPrice == null ? null : now,
      updated_at: now,
    }).eq("domain", target);
    if (error) throw new Error(error.message);
    updated++;
  }
  return { updated };
}

export async function deleteEntry(domain: string): Promise<number> {
  const sb = supabase();
  const target = domain.toLowerCase().trim();
  const { error, count } = await sb
    .from(TABLE)
    .delete({ count: "exact" })
    .eq("domain", target);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// Soft-archive: set archived_at = now() so the row drops out of the default
// Kho Domain view. Reversible via setArchived(domains, false).
export async function setArchived(
  domains: string[],
  archived: boolean,
): Promise<{ updated: number }> {
  const sb = supabase();
  const targets = Array.from(new Set(
    domains.map((d) => d.toLowerCase().trim()).filter(Boolean),
  ));
  if (!targets.length) return { updated: 0 };
  const now = new Date().toISOString();
  const { error } = await sb
    .from(TABLE)
    .update({ archived_at: archived ? now : null, updated_at: now })
    .in("domain", targets);
  if (error) throw new Error(error.message);
  return { updated: targets.length };
}
