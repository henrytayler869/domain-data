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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SettingsData {
  dataforseoLogin: string;
  hasPassword: boolean;
  passwordHint: string;
}

interface TestResult {
  ok: boolean;
  error?: string;
  login?: string;
  money_balance?: number | null;
  api_calls_today?: number | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  // ── Current saved values ─────────────────────────────────────────────────────
  const [saved, setSaved] = useState<SettingsData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Form state ───────────────────────────────────────────────────────────────
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // ── Action state ─────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "ok" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // ─── Load current settings ────────────────────────────────────────────────────

  const loadSettings = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSaved(data as SettingsData);
      setLogin(data.dataforseoLogin ?? "");
      // Never pre-fill password — user must enter it again to change
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Không tải được settings");
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // ─── Save ────────────────────────────────────────────────────────────────────

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
          // Only send password if user typed something
          ...(password.trim() ? { dataforseoPassword: password.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSaveStatus("ok");
      setPassword(""); // Clear after save
      await loadSettings(); // Refresh hint
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err) {
      setSaveStatus("error");
      setSaveError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setSaving(false);
    }
  };

  // ─── Test connection ─────────────────────────────────────────────────────────

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test");
      const data = await res.json();
      setTestResult(data as TestResult);
    } catch (err) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : "Lỗi kết nối",
      });
    } finally {
      setTesting(false);
    }
  };

  // ─── Dirty check ─────────────────────────────────────────────────────────────

  const isDirty =
    login.trim() !== (saved?.dataforseoLogin ?? "") || password.trim() !== "";

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

      {/* DataforSEO card */}
      <div className="rounded-xl border bg-card shadow-sm">
        {/* Card header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <KeyRound className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">DataforSEO API</h2>
            <p className="text-xs text-muted-foreground">
              Dùng cho tính năng phân tích Backlink (Aged Domain)
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
                {showPassword
                  ? <EyeOff className="h-4 w-4" />
                  : <Eye className="h-4 w-4" />
                }
              </button>
            </div>
          </div>

          {/* How to get API key */}
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
              onClick={handleSave}
              disabled={saving || !isDirty}
              className="gap-2"
            >
              {saving
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Save className="h-4 w-4" />
              }
              {saving ? "Đang lưu..." : "Lưu"}
            </Button>

            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testing || (!saved?.hasPassword && !password)}
              className="gap-2"
            >
              {testing
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Wifi className="h-4 w-4" />
              }
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

        {/* Test result */}
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
    </div>
  );
}
