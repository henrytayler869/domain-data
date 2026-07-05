/**
 * Giá mua Gname theo TLD (bảng gname_pricing). Pipeline `gname price` ghi vào đây;
 * webapp chỉ ĐỌC (không gọi Gname trực tiếp — Gname cần IP whitelist, Vercel không có).
 */
import { supabase } from "./supabase";

export interface GnamePrice {
  tld: string;
  register: number | null;
  renew: number | null;
  backorder: number | null;
  deposit: number | null;
  channel: string | null;
  updatedAt: string | null;
}

interface Row {
  tld: string;
  register: number | null;
  renew: number | null;
  backorder: number | null;
  deposit: number | null;
  channel: string | null;
  updated_at: string | null;
}

export async function readGnamePricing(): Promise<GnamePrice[]> {
  const sb = supabase();
  const { data, error } = await sb.from("gname_pricing").select("*");
  if (error) return []; // bảng có thể chưa tồn tại → coi như chưa có giá
  return (data as Row[] | null ?? []).map((r) => ({
    tld: r.tld,
    register: r.register,
    renew: r.renew,
    backorder: r.backorder,
    deposit: r.deposit,
    channel: r.channel,
    updatedAt: r.updated_at,
  }));
}
