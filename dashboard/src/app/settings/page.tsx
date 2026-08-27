"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Save,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Loader2,
  KeyRound,
  Wifi,
  Webhook,
  Cloud,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SettingsData {
  dataforseoLogin: string;
  hasPassword: boolean;
  passwordHint: string;
  n8nWebhookUrl: string;
}

interface TestResult {
  ok: boolean;
  error?: string;
  login?: string;
  money_balance?: number | null;
  api_calls_today?: number | null;
}

interface ApifyData {
  hasApifyToken: boolean;
  apifyTokenHint: string;
  apifyActorId: string;
}

interface ApifyTestResult {
  ok: boolean;
  error?: string;
  username?: string | null;
  monthlyUsageUsd?: number | null;
  maxMonthlyUsageUsd?: number | null;
  maxConcurrentRuns?: number | null;
  actorId?: string;
  actorOk?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [saved, setSaved] = useState<SettingsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "ok" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const [n8nUrl, setN8nUrl] = useState("");
  const [savingN8n, setSavingN8n] = useState(false);
  const [n8nStatus, setN8nStatus] = useState<"idle" | "ok" | "error">("idle");

  // Apify
  const [apify, setApify] = useState<ApifyData | null>(null);
  const [apifyToken, setApifyToken] = useState("");
  const [apifyActor, setApifyActor] = useState("");
  const [showApifyToken, setShowApifyToken] = useState(false);
  const [savingApify, setSavingApify] = useState(false);
  const [apifyStatus, setApifyStatus] = useState<"idle" | "ok" | "error">("idle");
  const [testingApify, setTestingApify] = useState(false);
  const [apifyTest, setApifyTest] = useState<ApifyTestResult | null>(null);

  const loadApify = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/apify", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) { setApify(data as ApifyData); setApifyActor(data.apifyActorId ?? ""); }
    } catch { /* ignore */ }
  }, []);

  const saveApify = async () => {
    setSavingApify(true); setApifyStatus("idle"); setApifyTest(null);
    try {
      const res = await fetch("/api/settings/apify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(apifyToken.trim() ? { apifyToken: apifyToken.trim() } : {}), apifyActorId: apifyActor.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setApifyStatus("ok"); setApifyToken(""); await loadApify(); setTimeout(() => setApifyStatus("idle"), 3000);
    } catch { setApifyStatus("error"); } finally { setSavingApify(false); }
  };

  const testApify = async () => {
    setTestingApify(true); setApifyTest(null);
    try {
      const res = await fetch("/api/settings/apify/test", { cache: "no-store" });
      setApifyTest(await res.json() as ApifyTestResult);
    } catch (e) { setApifyTest({ ok: false, error: e instanceof Error ? e.message : "Lỗi kết nối" }); }
    finally { setTestingApify(false); }
  };

  // ─── Load ─────────────────────────────────────────────────────────────────────

  const loadSettings = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSaved(data as SettingsData);
      setLogin(data.dataforseoLogin ?? "");
      setN8nUrl(data.n8nWebhookUrl ?? "");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Không tải được settings");
    }
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);
  useEffect(() => { loadApify(); }, [loadApify]);

  // ─── Save ─────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus("idle");
    setSaveError(null);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataforseoLogin: login.trim(),
          ...(password.trim() ? { dataforseoPassword: password.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSaveStatus("ok");
      setPassword("");
      await loadSettings();
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err) {
      setSaveStatus("error");
      setSaveError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setSaving(false);
    }
  };

  // ─── Test ─────────────────────────────────────────────────────────────────────

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test");
      const data = await res.json();
      setTestResult(data as TestResult);
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : "Lỗi kết nối" });
    } finally {
      setTesting(false);
    }
  };

  const saveN8n = async () => {
    setSavingN8n(true); setN8nStatus("idle");
    try {
      const res = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n8nWebhookUrl: n8nUrl.trim() }) });
      if (!res.ok) throw new Error((await res.json()).error);
      setN8nStatus("ok"); await loadSettings(); setTimeout(() => setN8nStatus("idle"), 3000);
    } catch { setN8nStatus("error"); } finally { setSavingN8n(false); }
  };

  const isDirty =
    login.trim() !== (saved?.dataforseoLogin ?? "") || password.trim() !== "";

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cài đặt</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cấu hình API credentials cho các dịch vụ bên ngoài.
        </p>
      </div>

      {loadError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <XCircle className="h-4 w-4 shrink-0" />
          {loadError}
        </div>
      )}

      {/* DataforSEO card */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center gap-3 px-6 py-4 border-b">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <KeyRound className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">DataforSEO API</h2>
            <p className="text-xs text-muted-foreground">
              Dùng cho Aged Domain (Backlink DB) + Domain Picker (Upload Result → DataforSEO)
            </p>
          </div>
          {saved && (
            <div className="ml-auto">
              {saved.hasPassword && saved.dataforseoLogin ? (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                  Đã cấu hình
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 rounded-full border border-amber-200 dark:border-amber-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                  Chưa cấu hình
                </span>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Login (Email)</label>
            <Input
              type="email"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="your@email.com"
              autoComplete="username"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">
              Password
              {saved?.hasPassword && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  (Hiện tại:{" "}
                  <code className="font-mono bg-muted px-1 rounded">{saved.passwordHint}</code>
                  {" "}— để trống nếu không muốn đổi)
                </span>
              )}
            </label>
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={saved?.hasPassword ? "Để trống = giữ nguyên" : "Nhập password"}
                autoComplete="current-password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Lấy credentials tại{" "}
            <a
              href="https://app.dataforseo.com/api-access"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              app.dataforseo.com/api-access
            </a>
          </p>

          {saveStatus === "ok" && (
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              Đã lưu thành công
            </div>
          )}
          {saveStatus === "error" && saveError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <XCircle className="h-4 w-4" />
              {saveError}
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <Button onClick={handleSave} disabled={saving || !isDirty} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Đang lưu..." : "Lưu"}
            </Button>
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testing || (!saved?.hasPassword && !password)}
              className="gap-2"
            >
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
              {testing ? "Đang kiểm tra..." : "Test kết nối"}
            </Button>
            <button
              onClick={loadSettings}
              className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
              title="Tải lại"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {testResult && (
          <div
            className={cn(
              "mx-6 mb-5 rounded-lg border px-4 py-3 text-sm",
              testResult.ok
                ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300"
                : "border-destructive/40 bg-destructive/10 text-destructive"
            )}
          >
            {testResult.ok ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="h-4 w-4" />
                  Kết nối thành công — {testResult.login}
                </div>
                {(testResult.money_balance != null || testResult.api_calls_today != null) && (
                  <div className="text-xs opacity-80 pl-6">
                    {testResult.money_balance != null && (
                      <span>Balance: ${testResult.money_balance.toFixed(2)}</span>
                    )}
                    {testResult.money_balance != null && testResult.api_calls_today != null && (
                      <span className="mx-2">·</span>
                    )}
                    {testResult.api_calls_today != null && (
                      <span>API calls hôm nay: {testResult.api_calls_today.toLocaleString()}</span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4" />
                {testResult.error}
              </div>
            )}
          </div>
        )}
      </div>

      {/* N8N Webhook (DataForSEO) card */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center gap-3 px-6 py-4 border-b">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Webhook className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Webhook N8N — DataForSEO</h2>
            <p className="text-xs text-muted-foreground">Domain Picker Bước 5: gửi domain Clean tới workflow N8N để check DataForSEO.</p>
          </div>
          {saved && (
            <span className={cn("ml-auto inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border",
              saved.n8nWebhookUrl ? "text-emerald-600 bg-emerald-50 border-emerald-200" : "text-amber-600 bg-amber-50 border-amber-200")}>
              <span className={cn("w-1.5 h-1.5 rounded-full inline-block", saved.n8nWebhookUrl ? "bg-emerald-500" : "bg-amber-500")} />
              {saved.n8nWebhookUrl ? "Đã cấu hình" : "Chưa cấu hình"}
            </span>
          )}
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">Webhook URL</label>
            <Input type="url" value={n8nUrl} onChange={(e) => setN8nUrl(e.target.value)} placeholder="https://n8n.example.com/webhook/xxxxxxxx" />
            <p className="text-xs text-muted-foreground mt-1.5">Webapp POST <code className="bg-muted px-1 rounded">{`{ domains: [...] }`}</code> tới URL này khi xuất Clean ở Bước 5.</p>
          </div>
          {n8nStatus === "ok" && <div className="flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" />Đã lưu</div>}
          {n8nStatus === "error" && <div className="flex items-center gap-2 text-sm text-destructive"><XCircle className="h-4 w-4" />Lưu lỗi</div>}
          <Button onClick={saveN8n} disabled={savingN8n || n8nUrl.trim() === (saved?.n8nWebhookUrl ?? "")} className="gap-2">
            {savingN8n ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Lưu
          </Button>
        </div>
      </div>

      {/* Apify card */}
      <div className="rounded-xl border bg-card shadow-sm">
        <div className="flex items-center gap-3 px-6 py-4 border-b">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Cloud className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Apify API</h2>
            <p className="text-xs text-muted-foreground">Wayback Machine actor — đổi token khi tài khoản Apify hết credit (không cần redeploy).</p>
          </div>
          {apify && (
            <span className={cn("ml-auto inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border",
              apify.hasApifyToken ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800" : "text-amber-600 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800")}>
              <span className={cn("w-1.5 h-1.5 rounded-full inline-block", apify.hasApifyToken ? "bg-emerald-500" : "bg-amber-500")} />
              {apify.hasApifyToken ? "Đã cấu hình" : "Chưa cấu hình"}
            </span>
          )}
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5">
              API Token
              {apify?.hasApifyToken && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  (Hiện tại: <code className="font-mono bg-muted px-1 rounded">{apify.apifyTokenHint}</code> — để trống nếu không đổi)
                </span>
              )}
            </label>
            <div className="relative">
              <Input
                type={showApifyToken ? "text" : "password"}
                value={apifyToken}
                onChange={(e) => setApifyToken(e.target.value)}
                placeholder={apify?.hasApifyToken ? "Để trống = giữ nguyên" : "apify_api_..."}
                autoComplete="off"
                className="pr-10 font-mono"
              />
              <button type="button" onClick={() => setShowApifyToken((v) => !v)} tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                {showApifyToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Actor ID <span className="text-xs font-normal text-muted-foreground">(để trống = mặc định wayback actor)</span></label>
            <Input value={apifyActor} onChange={(e) => setApifyActor(e.target.value)} placeholder="henry_tayler_869~wayback-machine-actor" className="font-mono" />
          </div>
          <p className="text-xs text-muted-foreground">
            Lấy token tại <a href="https://console.apify.com/settings/integrations" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:opacity-80">console.apify.com/settings/integrations</a>
          </p>

          {apifyStatus === "ok" && <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" />Đã lưu — pipeline dùng token mới ngay</div>}
          {apifyStatus === "error" && <div className="flex items-center gap-2 text-sm text-destructive"><XCircle className="h-4 w-4" />Lưu lỗi</div>}

          <div className="flex items-center gap-3 pt-1">
            <Button onClick={saveApify} disabled={savingApify || (!apifyToken.trim() && apifyActor.trim() === (apify?.apifyActorId ?? ""))} className="gap-2">
              {savingApify ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{savingApify ? "Đang lưu..." : "Lưu"}
            </Button>
            <Button variant="outline" onClick={testApify} disabled={testingApify || !apify?.hasApifyToken} className="gap-2">
              {testingApify ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}{testingApify ? "Đang kiểm tra..." : "Test + xem credit"}
            </Button>
          </div>
        </div>

        {apifyTest && (
          <div className={cn("mx-6 mb-5 rounded-lg border px-4 py-3 text-sm",
            apifyTest.ok
              ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300"
              : "border-destructive/40 bg-destructive/10 text-destructive")}>
            {apifyTest.ok ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="h-4 w-4" />Token OK — {apifyTest.username}
                </div>
                <div className="text-xs opacity-80 pl-6 flex flex-wrap gap-x-3 gap-y-0.5">
                  {(apifyTest.monthlyUsageUsd != null) && (
                    <span>Đã dùng: ${apifyTest.monthlyUsageUsd.toFixed(2)}{apifyTest.maxMonthlyUsageUsd != null ? ` / $${apifyTest.maxMonthlyUsageUsd}` : ""}</span>
                  )}
                  {apifyTest.maxConcurrentRuns != null && <span>· Concurrent tối đa: {apifyTest.maxConcurrentRuns}</span>}
                  <span>· Actor: {apifyTest.actorOk ? "✓ truy cập được" : "✗ không thấy/không quyền"}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2"><XCircle className="h-4 w-4" />{apifyTest.error}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
