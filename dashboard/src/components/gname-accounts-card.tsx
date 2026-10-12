"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Globe, Loader2, Pencil, Plus, Trash2, Wifi, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface GnameAccountView {
  id: string;
  label: string;
  appid: string;
  hasAppkey: boolean;
  appkeyHint: string;
}

interface GnameCfgView {
  defaultId: string | null;
  accounts: GnameAccountView[];
}

interface GnameTestResult {
  ok: boolean;
  error?: string;
  channels?: number;
}

/** Settings → nhiều tài khoản Gname (appid + appkey), 1 tài khoản mặc định. */
export function GnameAccountsCard() {
  const [cfg, setCfg] = useState<GnameCfgView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, GnameTestResult>>({});

  const [newLabel, setNewLabel] = useState("");
  const [newAppid, setNewAppid] = useState("");
  const [newAppkey, setNewAppkey] = useState("");
  const [showKey, setShowKey] = useState(false);

  // Sửa tại chỗ 1 tài khoản: appkey trống = giữ appkey cũ.
  const [editId, setEditId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editAppid, setEditAppid] = useState("");
  const [editAppkey, setEditAppkey] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/gname", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setCfg(data as GnameCfgView);
      else setErr(data.error ?? "Không tải được tài khoản Gname");
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const action = async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/settings/gname", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      await load();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lỗi");
      return false;
    } finally { setBusy(false); }
  };

  const add = async () => {
    if (!newAppid.trim() || !newAppkey.trim()) return;
    if (await action({ action: "add", label: newLabel.trim(), appid: newAppid.trim(), appkey: newAppkey.trim() })) {
      setNewLabel(""); setNewAppid(""); setNewAppkey("");
    }
  };

  const startEdit = (a: GnameAccountView) => {
    setEditId(a.id); setEditLabel(a.label); setEditAppid(a.appid); setEditAppkey("");
  };

  const saveEdit = async () => {
    if (!editId) return;
    if (await action({ action: "update", id: editId, label: editLabel, appid: editAppid, appkey: editAppkey })) {
      setEditId(null);
      setTests((p) => { const n = { ...p }; delete n[editId]; return n; });
    }
  };

  const test = async (id: string) => {
    setTestingId(id);
    try {
      const res = await fetch(`/api/settings/gname/test?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = (await res.json()) as GnameTestResult;
      setTests((p) => ({ ...p, [id]: data }));
    } catch (e) {
      setTests((p) => ({ ...p, [id]: { ok: false, error: e instanceof Error ? e.message : "Lỗi" } }));
    } finally { setTestingId(null); }
  };

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-3 px-6 py-4 border-b">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <Globe className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-semibold">Gname API</h2>
          <p className="text-xs text-muted-foreground">Nhiều tài khoản. Tài khoản &quot;Mặc định&quot; dùng để check domain và là lựa chọn sẵn khi mua; lúc mua có thể chọn tài khoản khác.</p>
        </div>
        {cfg && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border text-muted-foreground bg-muted/40">
            {cfg.accounts.length} tài khoản
          </span>
        )}
      </div>
      <div className="px-6 py-5 space-y-3">
        {err && <div className="flex items-center gap-2 text-sm text-destructive"><XCircle className="h-4 w-4" />{err}</div>}
        {cfg && cfg.accounts.length === 0 && (
          <p className="text-sm text-muted-foreground italic">Chưa có tài khoản nào — thêm bên dưới.</p>
        )}

        {cfg?.accounts.map((a) => {
          const isDefault = a.id === cfg.defaultId;
          const t = tests[a.id];
          const editing = editId === a.id;
          return (
            <div key={a.id} className={cn("rounded-lg border px-4 py-3", isDefault ? "border-emerald-400/60 bg-emerald-50/50 dark:bg-emerald-950/20" : "bg-muted/20")}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{a.label}</span>
                {isDefault ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />Mặc định
                  </span>
                ) : (
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => action({ action: "default", id: a.id })}>Đặt mặc định</Button>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" disabled={testingId === a.id} onClick={() => test(a.id)}>
                    {testingId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}Test
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => (editing ? setEditId(null) : startEdit(a))} title="Sửa">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" disabled={busy}
                    onClick={() => { if (confirm(`Xoá tài khoản Gname "${a.label}"?`)) action({ action: "delete", id: a.id }); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground mt-1 font-mono break-all">appid {a.appid || "—"} · appkey {a.appkeyHint || "—"}</div>
              {editing && (
                <div className="mt-2 space-y-2">
                  <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder="Tên" className="h-8 text-sm" />
                  <Input value={editAppid} onChange={(e) => setEditAppid(e.target.value)} placeholder="appid" className="h-8 text-sm font-mono" />
                  <Input type="password" value={editAppkey} onChange={(e) => setEditAppkey(e.target.value)} placeholder="appkey mới (để trống = giữ nguyên)" autoComplete="off" className="h-8 text-sm font-mono" />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy} onClick={saveEdit} className="gap-2">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Lưu
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Huỷ</Button>
                  </div>
                </div>
              )}
              {t && (
                <div className={cn("mt-2 text-xs rounded px-2 py-1.5", t.ok ? "bg-emerald-100/60 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300" : "bg-destructive/10 text-destructive")}>
                  {t.ok ? `✓ Kết nối OK · ${t.channels ?? 0} kênh backorder` : `✗ ${t.error}`}
                </div>
              )}
            </div>
          );
        })}

        {/* Thêm tài khoản */}
        <div className="rounded-lg border border-dashed px-4 py-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Plus className="h-3.5 w-3.5" />Thêm tài khoản</p>
          <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Tên (vd: Gname chính)" className="h-8 text-sm" />
          <Input value={newAppid} onChange={(e) => setNewAppid(e.target.value)} placeholder="appid" autoComplete="off" className="h-8 text-sm font-mono" />
          <div className="relative">
            <Input type={showKey ? "text" : "password"} value={newAppkey} onChange={(e) => setNewAppkey(e.target.value)} placeholder="appkey" autoComplete="off" className="h-8 text-sm pr-9 font-mono" />
            <button type="button" onClick={() => setShowKey((v) => !v)} tabIndex={-1} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button size="sm" disabled={busy || !newAppid.trim() || !newAppkey.trim()} onClick={add} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Thêm
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Lấy appid/appkey trong trang API của tài khoản Gname. Mỗi tài khoản phải whitelist IP của VPS thì mới gọi được; bấm Test để kiểm tra.
        </p>
      </div>
    </div>
  );
}
