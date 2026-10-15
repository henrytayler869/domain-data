"use client";

import { useEffect, useState } from "react";

interface PipelineStatus {
  alerts?: string[];
  healthy?: boolean;
  ageMin?: number | null;
  waybackPaused?: "ai_credit" | "apify_credit" | null;
}

const POLL_MS = 2 * 60 * 1000;

/**
 * Thanh cảnh báo đỏ trên mọi trang khi bộ điều phối tự lành gặp sự cố:
 * hết credit AI (OpenAI)/Apify (Wayback tạm dừng), Apify từ chối tạo run, hoặc tick ngừng chạy.
 * Không có sự cố → không hiện gì.
 */
export function PipelineAlert() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/pipeline/status", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as PipelineStatus;
        if (alive) setStatus(data);
      } catch { /* mạng lỗi tạm — giữ trạng thái cũ */ }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!status) return null;
  const messages = [...(status.alerts ?? [])];
  if (status.healthy === false) {
    messages.push(`Bộ điều phối tự lành không chạy ${status.ageMin != null ? `(tick cuối ${status.ageMin} phút trước)` : ""} — kiểm tra cron trên VPS.`);
  }
  if (!messages.length) return null;

  return (
    <div role="alert" className="shrink-0 border-b border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
      {messages.map((m, i) => (
        <p key={i}>⚠️ {m}</p>
      ))}
    </div>
  );
}
