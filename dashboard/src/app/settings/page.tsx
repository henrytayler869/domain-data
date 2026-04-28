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
  Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SettingsData {
  dataforseoLogin: string;
  hasPassword: boolean;
  passwordHint: string;
  hasAhrefsKey: boolean;
  ahrefsKeyHint: string;
}

interface DfsTestResult {
  ok: boolean;
  error?: string;
  login?: string;
  money_balance?: number | null;
  api_calls_today?: number | null;
}

interface AhrefsTestResult {
  ok: boolean;
  error?: string;
  plan?: string | null;
  unitsUsed?: number | null;
  unitsLimit?: number | null; // null = unlimited
  expiresAt?: string | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  // ── Current saved values ─────────────────────────────────────────────────────
  const [saved, setSaved] = useState<SettingsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── DataforSEO form state ─────────────────────────────────────────────────────
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // ── DataforSEO action state ───────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "ok" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<DfsTestResult | null>(null);

  // ── Ahrefs form state ─────────────────────────────────────────────────────────
  const [ahrefsKey, setAhrefsKey] = useState("");
  const [showAhrefsKey, setShowAhrefsKey] = useState(false);

  // ── Ahrefs action state ───────────────────────────────────────────────────────
  const [ahrefsSaving, setAhrefsSaving] = useState(false);
  const [ahrefsSaveStatus, setAhrefsSaveStatus] = useState<"idle" | "ok" | "error">("idle");
  const [ahrefsSaveError, setAhrefsSaveError] = useState<string | null>(null);
  const [ahrefsTesting, setAhrefsTesting] = useState(false);
  const [ahrefsTestResult, setAhrefsTestResult] = useState<AhrefsTestResult | null>(null);

  // ─── Load current settings ─────────────────────────────────────────────────────

  const loadSettings = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSaved(data as SettingsData);
      setLogin(data.dataforseoLogin ?? "");
      // Never pre-fill secret fields — user must re-enter to change
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Không tải được settings");
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // ─── Save DataforSEO ──────────────────────────────────────────────────────────

  const handleSaveDfs = async () => {
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

  // ─── Test DataforSEO ──────────────────────────────────────────────────────────

  const handleTestDfs = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test");
      const data = await res.json();
      setTestResult(data as DfsTestResult);
    } catch (err) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : "Lỗi kết nối",
      });
    } finally {
      setTesting(false);
    }
  };

  // ─── Save Ahrefs ──────────────────────────────────────────────────────────────

  const handleSaveAhrefs = async () => {
    setAhrefsSaving(true);
    setAhrefsSaveStatus("idle");
    setAhrefsSaveError(null);
    setAhrefsTestResult(null);

    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ahrefsApiKey: ahrefsKey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAhrefsSaveStatus("ok");
      setAhrefsKey("");
      await loadSettings();
      setTimeout(() => setAhrefsSaveStatus("idle"), 3000);
    } catch (err) {
      setAhrefsSaveStatus("error");
      setAhrefsSaveError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setAhrefsSaving(false);
    }
  };

  // ─── Test Ahrefs ─────────────────────────────────────────────────────────────

  const handleTestAhrefs = async () => {
    setAhrefsTesting(true);
    setAhrefsTestResult(null);
    try {
      const res = await fetch("/api/settings/test-ahrefs");
      const data = await res.json();
      setAhrefsTestResult(data as AhrefsTestResult);
    } catch (err) {
      setAhrefsTestResult({
        ok: false,
        error: err instanceof Error ? err.message : "Lỗi kết nối",
      });
    } finally {
      setAhrefsTesting(false);
    }
  };

  // ─── Dirty checks ─────────────────────────────────────────────────────────────

  const isDfsDirty =
    login.trim() !== (saved?.dataforseoLogin ?? "") || password.trim() !== "";
  const isAhrefsDirty = ahrefsKey.trim() !== "";

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cài đặt</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cấu hình API credentials cho các dịch vụ bên ngoài.
        </p>
      </div>

      {/* Load error */}
      {loadError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <XCircle className="h-4 w-4 shrink-0" />
          {loadError}
        </div>
      )}

      {/* ── DataforSEO card ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card shadow-sm">
        {/* Card header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <KeyRound className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">DataforSEO API</h2>
            <p className="text-xs text-muted-foreground">
              Dùng cho Option 1 — Aged Domain (Backlink DB)
            </p>
          </div>

          {/* Connection status badge */}
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

        {/* Form */}
        <div className="px-6 py-5 space-y-4">
          {/* Login */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Login (Email)
            </label>
            <Input
              type="email"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="your@email.com"
              autoComplete="username"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              Password
              {saved?.hasPassword && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  (Hiện tại:{" "}
                  <code className="font-mono bg-muted px-1 rounded">
                    {saved.passwordHint}
                  </code>
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

          {/* Link */}
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

          {/* Save feedback */}
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

          {/* Buttons */}
          <div className="flex items-center gap-3 pt-1">
            <Button
              onClick={handleSaveDfs}
              disabled={saving || !isDfsDirty}
              className="gap-2"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Đang lưu..." : "Lưu"}
            </Button>

            <Button
              variant="outline"
              onClick={handleTestDfs}
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

        {/* DataforSEO test result */}
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

      {/* ── Ahrefs card ──────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card shadow-sm">
        {/* Card header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500/10">
            <Link2 className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Ahrefs API</h2>
            <p className="text-xs text-muted-foreground">
              Dùng cho Option 2 — Aged Domain (DR trực tiếp từ Ahrefs)
            </p>
          </div>

          {/* Status badge */}
          {saved && (
            <div className="ml-auto">
              {saved.hasAhrefsKey ? (
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

        {/* Form */}
        <div className="px-6 py-5 space-y-4">
          {/* API Key */}
          <div>
            <label className="block text-sm font-medium mb-1.5">
              API Key
              {saved?.hasAhrefsKey && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  (Hiện tại:{" "}
                  <code className="font-mono bg-muted px-1 rounded">
                    {saved.ahrefsKeyHint}
                  </code>
                  {" "}— để trống nếu không muốn đổi)
                </span>
              )}
            </label>
            <div className="relative">
              <Input
                type={showAhrefsKey ? "text" : "password"}
                value={ahrefsKey}
                onChange={(e) => setAhrefsKey(e.target.value)}
                placeholder={saved?.hasAhrefsKey ? "Để trống = giữ nguyên" : "Nhập Ahrefs API Key"}
                autoComplete="off"
                className="pr-10 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowAhrefsKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showAhrefsKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Link */}
          <p className="text-xs text-muted-foreground">
            Lấy API Key tại{" "}
            <a
              href="https://app.ahrefs.com/account/api"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              app.ahrefs.com/account/api
            </a>
          </p>

          {/* Save feedback */}
          {ahrefsSaveStatus === "ok" && (
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              Đã lưu thành công
            </div>
          )}
          {ahrefsSaveStatus === "error" && ahrefsSaveError && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <XCircle className="h-4 w-4" />
              {ahrefsSaveError}
            </div>
          )}

          {/* Buttons */}
          <div className="flex items-center gap-3 pt-1">
            <Button
              onClick={handleSaveAhrefs}
              disabled={ahrefsSaving || !isAhrefsDirty}
              className="gap-2"
            >
              {ahrefsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {ahrefsSaving ? "Đang lưu..." : "Lưu"}
            </Button>

            <Button
              variant="outline"
              onClick={handleTestAhrefs}
              disabled={ahrefsTesting || !saved?.hasAhrefsKey}
              className="gap-2"
            >
              {ahrefsTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
              {ahrefsTesting ? "Đang kiểm tra..." : "Test kết nối"}
            </Button>
          </div>
        </div>

        {/* Ahrefs test result */}
        {ahrefsTestResult && (
          <div
            className={cn(
              "mx-6 mb-5 rounded-lg border px-4 py-3 text-sm",
              ahrefsTestResult.ok
                ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300"
                : "border-destructive/40 bg-destructive/10 text-destructive"
            )}
          >
            {ahrefsTestResult.ok ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 font-medium">
                  <CheckCircle2 className="h-4 w-4" />
                  Kết nối thành công
                  {ahrefsTestResult.plan && (
                    <span className="font-normal">— {ahrefsTestResult.plan}</span>
                  )}
                </div>
                {ahrefsTestResult.unitsUsed != null && (
                  <div className="text-xs opacity-80 pl-6">
                    API units tháng này: {ahrefsTestResult.unitsUsed.toLocaleString()}
                    {ahrefsTestResult.unitsLimit != null
                      ? <span className="text-muted-foreground"> / {ahrefsTestResult.unitsLimit.toLocaleString()}</span>
                      : <span className="text-muted-foreground"> (không giới hạn)</span>
                    }
                    {ahrefsTestResult.expiresAt && (
                      <span className="ml-2 text-muted-foreground">
                        · hết hạn {new Date(ahrefsTestResult.expiresAt).toLocaleDateString("vi-VN")}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4" />
                {ahrefsTestResult.error}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
