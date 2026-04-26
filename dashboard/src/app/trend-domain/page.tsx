"use client";

import { useState, useCallback } from "react";
import { Search, ExternalLink, RefreshCw, Globe2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Domain } from "@/app/api/domains/route";

const ALL_TLDS = [
  "de.com",
  "uk.net",
  "gb.net",
  "us.com",
  "eu.com",
  "mex.com",
  "ru.com",
  "co.com",
  "us.org",
];

export default function TrendDomainPage() {
  const [priceMin, setPriceMin] = useState(0);
  const [priceMax, setPriceMax] = useState(200);
  const [selectedTlds, setSelectedTlds] = useState<Set<string>>(
    new Set(ALL_TLDS)
  );
  const [domains, setDomains] = useState<Domain[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  const toggleTld = (tld: string) => {
    setSelectedTlds((prev) => {
      const next = new Set(prev);
      if (next.has(tld)) {
        next.delete(tld);
      } else {
        next.add(tld);
      }
      return next;
    });
  };

  const fetchDomains = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        priceMin: String(priceMin),
        priceMax: String(priceMax),
        tlds: Array.from(selectedTlds).join(","),
      });
      const res = await fetch(`/api/domains?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch");
      setDomains(data.domains);
      setLastFetched(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [priceMin, priceMax, selectedTlds]);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Trend Domain — Marketplace
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Buy Now domains from Namecheap filtered by TLD &amp; price.
            {lastFetched && (
              <span className="ml-2">
                Last fetched: {lastFetched.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Filter card */}
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wider">
          Filters
        </h2>

        {/* Price range */}
        <div className="mb-5">
          <label className="block text-sm font-medium mb-2">
            Price Range (USD)
          </label>
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                $
              </span>
              <Input
                type="number"
                min={0}
                value={priceMin}
                onChange={(e) => setPriceMin(Number(e.target.value))}
                className="pl-7"
                placeholder="0"
              />
            </div>
            <span className="text-muted-foreground">—</span>
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                $
              </span>
              <Input
                type="number"
                min={0}
                value={priceMax}
                onChange={(e) => setPriceMax(Number(e.target.value))}
                className="pl-7"
                placeholder="200"
              />
            </div>
          </div>
        </div>

        {/* TLD toggles */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium">TLDs</label>
            <div className="flex gap-2 text-xs">
              <button
                className="text-primary underline-offset-4 hover:underline"
                onClick={() => setSelectedTlds(new Set(ALL_TLDS))}
              >
                Select all
              </button>
              <span className="text-muted-foreground">·</span>
              <button
                className="text-primary underline-offset-4 hover:underline"
                onClick={() => setSelectedTlds(new Set())}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {ALL_TLDS.map((tld) => (
              <button
                key={tld}
                onClick={() => toggleTld(tld)}
                className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                  selectedTlds.has(tld)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50"
                }`}
              >
                .{tld}
              </button>
            ))}
          </div>
        </div>

        {/* Search button */}
        <div className="mt-5 flex justify-end">
          <Button
            onClick={fetchDomains}
            disabled={loading || selectedTlds.size === 0}
            className="gap-2"
          >
            {loading ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {loading ? "Loading…" : "Search Domains"}
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Results */}
      {(loading || domains !== null) && (
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <div className="flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {loading
                  ? "Loading…"
                  : `${domains?.length ?? 0} domain${(domains?.length ?? 0) !== 1 ? "s" : ""} found`}
              </span>
            </div>
            {!loading && domains && domains.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                Sorted by price ↑
              </Badge>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[45%]">Domain</TableHead>
                <TableHead>TLD</TableHead>
                <TableHead>Price</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <Skeleton className="h-4 w-48" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-16" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-12" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Skeleton className="h-8 w-20 ml-auto" />
                      </TableCell>
                    </TableRow>
                  ))
                : domains?.map((d) => (
                    <TableRow key={d.domainName}>
                      <TableCell className="font-medium">
                        {d.domainName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs font-mono">
                          .{d.tld}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-semibold text-green-600 dark:text-green-400">
                        {d.priceText}
                      </TableCell>
                      <TableCell className="text-right">
                        <a
                          href={d.buyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            buttonVariants({ size: "sm", variant: "outline" }),
                            "gap-1.5"
                          )}
                        >
                          Buy
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
              {!loading && domains?.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center py-12 text-muted-foreground"
                  >
                    No domains found for the selected filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Empty state */}
      {!loading && domains === null && !error && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center gap-3">
          <Globe2 className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            Set your filters and click{" "}
            <strong>Search Domains</strong> to find available domains.
          </p>
        </div>
      )}
    </div>
  );
}
