import { NextRequest, NextResponse } from "next/server";
import { readSettings } from "@/lib/settings";
import { readDb as readBacklinks } from "@/lib/backlink-db";
import { upsertRows, upsertAssessments } from "@/lib/ahrefs-db";

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
    // Ref domain CHƯA có trong backlink_db (DR unknown) → gom lại để user
    // export, kiểm tra DR thủ công rồi upload lại. Lưu max backlinks để sắp xếp.
    const unmatchedMap = new Map<string, number>();
    // Mọi target đã query DataforSEO thành công → đánh dấu "đã check" (kể cả
    // 0 ref khớp) để lần upload Spamzilla sau loại chúng ra.
    const processedTargets = new Set<string>();
    let totalRefsSeen = 0;
    let totalMatched = 0;
    let dfsCost = 0;
    const errors: string[] = [];

    // referring_domains/live CHỈ nhận 1 task/request (gửi nhiều → 40000
    // "You can set only one task at a time"). Nên gọi 1 domain/request, chạy
    // song song có giới hạn concurrency.
    const CONCURRENCY = 6;
    let cursor = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const target = targets[cursor++];
        try {
          const res = await fetch(DATAFORSEO_ENDPOINT, {
            method: "POST",
            headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
            // Field đúng là "backlinks" — "backlinks_count" trả 40501 Invalid Field.
            body: JSON.stringify([{ target, limit: limitPerDomain, order_by: ["backlinks,desc"] }]),
            signal: AbortSignal.timeout(120_000),
          });
          if (!res.ok) {
            if (errors.length < 5) errors.push(`${target}: HTTP ${res.status}`);
            continue;
          }
          const dfsData = await res.json() as {
            cost?: number;
            tasks?: {
              status_code: number;
              status_message: string;
              result?: { items?: DfsReferringDomain[] }[];
            }[];
          };
          dfsCost += dfsData.cost ?? 0;
          const task = dfsData.tasks?.[0];
          if (!task || task.status_code !== 20000 || !task.result?.[0]) {
            if (task && task.status_code !== 20000 && errors.length < 5) {
              errors.push(`${target}: ${task.status_code} ${task.status_message}`);
            }
            continue;
          }
          processedTargets.add(target); // query thành công → đã check
          const items = task.result[0].items ?? [];
          for (const it of items) {
            totalRefsSeen++;
            const ref = (it.domain ?? "").toLowerCase().trim();
            if (!ref) continue;
            const dr = drMap.get(ref);
            if (dr == null) {
              // Chưa có DR — gom để export (giữ backlinks lớn nhất để ưu tiên).
              const prev = unmatchedMap.get(ref) ?? 0;
              if ((it.backlinks ?? 0) > prev) unmatchedMap.set(ref, it.backlinks ?? 0);
              continue;
            }
            totalMatched++;
            refsRows.push({ targetDomain: target, refDomain: ref, domainRating: dr });
          }
        } catch (e) {
          if (errors.length < 5) errors.push(`${target}: ${e instanceof Error ? e.message : "fetch error"}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()));

    const refsResult = refsRows.length > 0
      ? await upsertRows(refsRows)
      : { added: 0, updated: 0, total: 0, uniqueTargets: 0 };

    // Đánh dấu mọi target đã query là "đã check" (assessment row, không set
    // excluded_at) → listCheckedTargets nhận diện, kể cả target 0 ref khớp.
    if (processedTargets.size > 0) {
      await upsertAssessments(
        [...processedTargets].map((target) => ({
          targetDomain: target,
          rating: null,
          category: null,
          detail: "DataforSEO checked",
          excludedAt: null,
        })),
      );
    }

    // Unique unmatched ref domain, sắp xếp backlinks giảm dần, cap 5000 để
    // payload gọn. Đây là list user export → check DR thủ công → upload lại.
    const unmatchedRefs = [...unmatchedMap.entries()]
      .map(([domain, backlinks]) => ({ domain, backlinks }))
      .sort((a, b) => b.backlinks - a.backlinks)
      .slice(0, 5000);

    return NextResponse.json({
      ok: true,
      targetsRequested: targets.length,
      refsSeen: totalRefsSeen,
      refsMatched: totalMatched,
      refsUnmatched: totalRefsSeen - totalMatched,
      unmatchedUnique: unmatchedMap.size,
      unmatchedRefs,
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
