import { NextRequest, NextResponse } from "next/server";
import { readSettings } from "@/lib/settings";
import { readDb as readBacklinks } from "@/lib/backlink-db";
import { upsertRows } from "@/lib/ahrefs-db";

const DATAFORSEO_ENDPOINT =
  "https://api.dataforseo.com/v3/backlinks/referring_domains/live";

interface DfsReferringDomain {
  domain: string;
  backlinks: number;
}

/**
 * POST /api/ahrefs-results/db/ingest-dataforseo
 * Body: { targets: string[], limitPerDomain?: number }
 *
 * DataforSEO chỉ trả về referring domains (KHÔNG có DR). Pipeline:
 *   1. Gọi DataforSEO referring_domains cho từng target (batch).
 *   2. Đối sánh mỗi ref domain với backlink_db → lấy DR đã thu thập.
 *   3. Chỉ giữ ref có trong backlink_db (DR đã biết), ghi vào ahrefs_results
 *      đúng format như upload Ahrefs → Wayback/Định giá/picker dùng như cũ.
 *
 * Chỉ target có ≥1 ref khớp DR mới xuất hiện trong panel (giống Ahrefs:
 * target không có ref nào thì không có gì để định giá).
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { targets?: string[]; limitPerDomain?: number };
    const targets = Array.from(new Set(
      (body.targets ?? [])
        .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
        .filter((d) => /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d)),
    ));
    const limitPerDomain = Math.min(Math.max(body.limitPerDomain ?? 1000, 1), 1000);
    if (!targets.length) {
      return NextResponse.json({ error: "Cần ít nhất 1 target domain hợp lệ" }, { status: 400 });
    }

    const settings = await readSettings();
    const login = settings.dataforseoLogin;
    const password = settings.dataforseoPassword;
    if (!login || !password) {
      return NextResponse.json(
        { error: "Chưa cấu hình DataforSEO. Vào Settings để nhập login + password." },
        { status: 400 },
      );
    }
    const auth = Buffer.from(`${login}:${password}`).toString("base64");

    // DR lookup từ backlink_db (681 ref domain DR 90+ đã thu thập).
    const backlinks = await readBacklinks();
    const drMap = new Map(backlinks.map((e) => [e.domain.toLowerCase(), e.dr]));

    const refsRows: { targetDomain: string; refDomain: string; domainRating: number }[] = [];
    let totalRefsSeen = 0;
    let totalMatched = 0;
    let dfsCost = 0;
    const errors: string[] = [];

    // Batch targets (DataforSEO nhận array tasks) — 100/request, tuần tự.
    const BATCH = 100;
    for (let i = 0; i < targets.length; i += BATCH) {
      const slice = targets.slice(i, i + BATCH);
      const tasks = slice.map((domain) => ({
        target: domain,
        limit: limitPerDomain,
        order_by: ["backlinks_count,desc"],
      }));
      let dfsData: {
        cost?: number;
        tasks?: {
          status_code: number;
          status_message: string;
          data?: { target?: string };
          result?: { items?: DfsReferringDomain[] }[];
        }[];
      };
      try {
        const res = await fetch(DATAFORSEO_ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
          body: JSON.stringify(tasks),
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) {
          errors.push(`DataforSEO HTTP ${res.status} (batch ${i / BATCH + 1})`);
          continue;
        }
        dfsData = await res.json();
      } catch (e) {
        errors.push(`Batch ${i / BATCH + 1}: ${e instanceof Error ? e.message : "fetch error"}`);
        continue;
      }
      dfsCost += dfsData.cost ?? 0;

      for (const task of dfsData.tasks ?? []) {
        const target = (task.data?.target ?? "").toLowerCase();
        if (!target) continue;
        if (task.status_code !== 20000 || !task.result?.[0]) continue;
        const items = task.result[0].items ?? [];
        for (const it of items) {
          totalRefsSeen++;
          const ref = (it.domain ?? "").toLowerCase().trim();
          const dr = drMap.get(ref);
          if (dr == null) continue; // ref không có trong dữ liệu DR đã thu thập → bỏ
          totalMatched++;
          refsRows.push({ targetDomain: target, refDomain: ref, domainRating: dr });
        }
      }
    }

    const refsResult = refsRows.length > 0
      ? await upsertRows(refsRows)
      : { added: 0, updated: 0, total: 0, uniqueTargets: 0 };

    return NextResponse.json({
      ok: true,
      targetsRequested: targets.length,
      refsSeen: totalRefsSeen,
      refsMatched: totalMatched,
      refsUnmatched: totalRefsSeen - totalMatched,
      refs: refsResult,
      dataforseoCost: dfsCost,
      errors,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
