/**
 * Ahrefs MCP client — gọi Ahrefs API qua endpoint MCP (JSON-RPC over HTTP + SSE),
 * ĐÚNG cách N8N đang làm (HTTP request tới https://api.ahrefs.com/mcp/mcp + Bearer token).
 * Dùng cho rating: Ahrefs trả referring domains KÈM DR sẵn (khỏi đối chiếu backlink_db).
 *
 * Auth: header `Authorization: Bearer <MCP token>`. Response là text/event-stream →
 * parse các dòng `data:` lấy JSON-RPC result (giống node Prepare/Eval của N8N).
 */

const MCP_URL = "https://api.ahrefs.com/mcp/mcp";

// Parse JSON-RPC từ body (SSE `data:` lines hoặc JSON thuần) — sao y N8N.
function extractJsonRpc(raw: string): { result?: unknown; error?: { message?: string } } | null {
  if (!raw) return null;
  const dataLines = raw.split(/\r?\n/).filter((l) => l.startsWith("data:"));
  if (dataLines.length) {
    for (let i = dataLines.length - 1; i >= 0; i--) {
      try { return JSON.parse(dataLines[i].replace(/^data:\s*/, "")); } catch { /* thử dòng khác */ }
    }
  }
  try { return JSON.parse(raw); } catch { /* không phải JSON */ }
  return null;
}

// Rút payload tool từ JSON-RPC result (structuredContent, hoặc content[].text = JSON string).
function extractToolPayload(rpc: ReturnType<typeof extractJsonRpc>): Record<string, unknown> | null {
  if (!rpc) return null;
  if (rpc.error) return { __error: rpc.error.message || JSON.stringify(rpc.error) };
  const result = rpc.result as { structuredContent?: unknown; content?: { type: string; text?: string }[] } | undefined;
  if (!result) return null;
  if (result.structuredContent) return result.structuredContent as Record<string, unknown>;
  if (Array.isArray(result.content)) {
    const tb = result.content.find((c) => c.type === "text");
    if (tb?.text) { try { return JSON.parse(tb.text) as Record<string, unknown>; } catch { return { __raw: tb.text }; } }
  }
  return result as Record<string, unknown>;
}

async function mcpCall(token: string, name: string, args: Record<string, unknown>, id = 1): Promise<Record<string, unknown> | null> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  return extractToolPayload(extractJsonRpc(text));
}

export interface AhrefsRef { domain: string; dr: number; isSpam: boolean }
export interface AhrefsAnchor { text: string; refdomains: number; isSpam: boolean; topDr: number }

/** Còn credit không? true = còn, false = hết/lỗi quota. Sao y logic Eval Credit của N8N. */
export async function ahrefsCreditOk(token: string): Promise<boolean> {
  try {
    const payload = (await mcpCall(token, "subscription-info-limits-and-usage", {}, 99)) ?? {};
    const err = payload.__error as string | undefined;
    if (err && /unit|limit|quota|credit|subscription|forbidden|payment|401|402|403|429/i.test(String(err))) return false;
    const lu = (payload.limits_and_usage as Record<string, unknown>) ?? payload;
    // CHỈ so khi CẢ usage lẫn limit non-null. Ahrefs để units_limit_api_key = null
    // (không giới hạn riêng theo api key) → Number(null)=0 sẽ khiến usage>=0 luôn đúng
    // = báo hết credit nhầm. Phải guard null trước (giống Eval Credit của N8N).
    const overLimit = (usage: unknown, limit: unknown) =>
      usage != null && limit != null && Number(usage) >= Number(limit);
    if (overLimit(lu.units_usage_workspace, lu.units_limit_workspace)) return false;
    if (overLimit(lu.units_usage_api_key, lu.units_limit_api_key)) return false;
    return true;
  } catch { return false; }   // lỗi mạng/token → coi như không dùng được → thử token kế / DFS
}

/** Referring domains (đã lọc DR≥minDr) kèm DR + is_spam. Ném lỗi nếu MCP báo lỗi. */
export async function ahrefsRefDomains(token: string, target: string, minDr = 70): Promise<AhrefsRef[]> {
  const payload = (await mcpCall(token, "site-explorer-referring-domains", {
    target, mode: "subdomains", protocol: "both",
    select: "domain,domain_rating,is_spam,links_to_target",
    where: JSON.stringify({ field: "domain_rating", is: ["gte", minDr] }),
    order_by: "domain_rating:desc", limit: 100,
  }, 1)) ?? {};
  if (payload.__error) throw new Error(`refdomains: ${payload.__error}`);
  const rows = (payload.refdomains as { domain?: string; domain_rating?: number; is_spam?: boolean }[]) ?? [];
  return rows.map((r) => ({ domain: String(r.domain ?? "").toLowerCase(), dr: Math.round(r.domain_rating ?? 0), isSpam: !!r.is_spam }))
    .filter((r) => r.domain);
}

/** Anchors (top theo refdomains). Không ném lỗi — phụ trợ cho AI. */
export async function ahrefsAnchors(token: string, target: string): Promise<AhrefsAnchor[]> {
  try {
    const payload = (await mcpCall(token, "site-explorer-anchors", {
      target, mode: "subdomains", protocol: "both",
      select: "anchor,refdomains,refpages,links_to_target,is_spam,top_domain_rating",
      order_by: "refdomains:desc", limit: 30,
    }, 2)) ?? {};
    if (payload.__error) return [];
    const rows = (payload.anchors as { anchor?: string; refdomains?: number; is_spam?: boolean; top_domain_rating?: number }[]) ?? [];
    return rows.slice(0, 20).map((a) => ({ text: a.anchor ?? "", refdomains: a.refdomains ?? 0, isSpam: !!a.is_spam, topDr: Math.round(a.top_domain_rating ?? 0) }));
  } catch { return []; }
}
