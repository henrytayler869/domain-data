"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface GnameAccountOption {
  id: string;
  label: string;
}

interface GnameAccountsView {
  defaultId: string | null;
  accounts: (GnameAccountOption & { appid: string })[];
}

const LS_KEY = "gname-buy-account";

/**
 * Tài khoản Gname dùng để MUA trên trang hiện tại. Mặc định = tài khoản mặc định
 * trong Settings; lựa chọn của user nhớ trong localStorage (chỉ trình duyệt này).
 */
export function useGnameAccount() {
  const [accounts, setAccounts] = useState<GnameAccountOption[]>([]);
  const [accountId, setAccountIdState] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/gname", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as GnameAccountsView;
        if (cancelled) return;
        const list = data.accounts.map((a) => ({ id: a.id, label: a.label }));
        setAccounts(list);
        let saved: string | null = null;
        try { saved = localStorage.getItem(LS_KEY); } catch { /* storage bị chặn */ }
        const pick = list.find((a) => a.id === saved)?.id ?? data.defaultId ?? list[0]?.id ?? null;
        setAccountIdState(pick);
      } catch { /* không tải được → server dùng tài khoản mặc định */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const setAccountId = (id: string) => {
    setAccountIdState(id);
    try { localStorage.setItem(LS_KEY, id); } catch { /* ignore */ }
  };

  const label = accounts.find((a) => a.id === accountId)?.label ?? null;
  return { accounts, accountId, setAccountId, label };
}

/** Ô chọn tài khoản Gname — chỉ hiện khi có từ 2 tài khoản trở lên. */
export function GnameAccountSelect({
  accounts,
  value,
  onChange,
  disabled,
  className,
}: {
  accounts: GnameAccountOption[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  if (accounts.length < 2) return null;
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      title="Tài khoản Gname dùng để mua (trừ tiền tài khoản này)"
      className={cn("h-8 rounded-md border bg-background px-2 text-xs", className)}
    >
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>Gname: {a.label}</option>
      ))}
    </select>
  );
}
