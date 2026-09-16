"use client";

/**
 * AlertsTab.tsx
 *
 * Paginated alerts list with level-coded badges, severity colour strip,
 * and acknowledge buttons. Pulls from /api/alerts and posts acknowledges
 * to /api/alerts/[id]/acknowledge.
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertOctagon,
  AlertTriangle,
  Bell,
  BellRing,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type AlertLevel =
  | "INFO"
  | "WATCH"
  | "ADVISORY"
  | "WARNING"
  | "SEVERE_WARNING"
  | "EMERGENCY";

interface AlertRow {
  id: string;
  alertId: string;
  level: AlertLevel;
  status: string;
  title: string;
  cityId: string | null;
  latitude: number | null;
  longitude: number | null;
  locationName: string | null;
  reason: string | null;
  expectedRainfallMm: number | null;
  floodProbability: number | null;
  expectedInundationM: number | null;
  recommendedAction: string | null;
  triggeredAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

interface AlertsApiResponse {
  ok: boolean;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  filters: { level: string; status: string; cityId: string };
  alerts: AlertRow[];
}

const LEVEL_COLOR: Record<AlertLevel, string> = {
  INFO: "#3B82F6",
  WATCH: "#06B6D4",
  ADVISORY: "#FACC15",
  WARNING: "#F97316",
  SEVERE_WARNING: "#DC2626",
  EMERGENCY: "#7F1D1D",
};

const LEVEL_ICON: Record<AlertLevel, React.ReactNode> = {
  INFO: <Info className="size-3.5" />,
  WATCH: <Bell className="size-3.5" />,
  ADVISORY: <AlertTriangle className="size-3.5" />,
  WARNING: <AlertTriangle className="size-3.5" />,
  SEVERE_WARNING: <ShieldAlert className="size-3.5" />,
  EMERGENCY: <AlertOctagon className="size-3.5" />,
};

const LEVEL_RANK: Record<AlertLevel, number> = {
  INFO: 0,
  WATCH: 1,
  ADVISORY: 2,
  WARNING: 3,
  SEVERE_WARNING: 4,
  EMERGENCY: 5,
};

const PAGE_SIZE = 20;

export default function AlertsTab() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [levelFilter, setLevelFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (levelFilter !== "all") params.set("level", levelFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const r = await fetch(`/api/alerts?${params.toString()}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`alerts ${r.status}`);
      const j = (await r.json()) as AlertsApiResponse;
      setAlerts(j.alerts);
      setTotal(j.total);
      setTotalPages(j.totalPages);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, levelFilter, statusFilter]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  async function acknowledge(a: AlertRow) {
    try {
      const r = await fetch(`/api/alerts/${a.alertId}/acknowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledgedBy: "operator" }),
      });
      if (!r.ok) throw new Error(`ack ${r.status}`);
      toast({
        title: "Alert acknowledged",
        description: `${a.alertId} → acknowledged`,
      });
      fetchAlerts();
    } catch (err) {
      toast({
        title: "Acknowledge failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BellRing className="size-5 text-amber-400" />
            <div>
              <div className="text-sm font-semibold">Flood alerts</div>
              <div className="text-xs text-muted-foreground">
                {total} alerts in DB · page {page} of {Math.max(1, totalPages)}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-[10px] uppercase text-muted-foreground">
                Level
              </label>
              <Select
                value={levelFilter}
                onValueChange={(v) => {
                  setLevelFilter(v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all levels</SelectItem>
                  <SelectItem value="INFO">INFO</SelectItem>
                  <SelectItem value="WATCH">WATCH</SelectItem>
                  <SelectItem value="ADVISORY">ADVISORY</SelectItem>
                  <SelectItem value="WARNING">WARNING</SelectItem>
                  <SelectItem value="SEVERE_WARNING">SEVERE_WARNING</SelectItem>
                  <SelectItem value="EMERGENCY">EMERGENCY</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase text-muted-foreground">
                Status
              </label>
              <Select
                value={statusFilter}
                onValueChange={(v) => {
                  setStatusFilter(v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all</SelectItem>
                  <SelectItem value="active">active</SelectItem>
                  <SelectItem value="acknowledged">acknowledged</SelectItem>
                  <SelectItem value="expired">expired</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="icon" onClick={fetchAlerts} title="Refresh">
              <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
            </Button>
          </div>
        </div>
      </Card>

      {/* List */}
      {error && (
        <Card className="border-destructive/40 p-4 text-sm text-destructive">
          Error: {error}
        </Card>
      )}

      <div className="flex flex-col gap-2">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))
        ) : alerts.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="mx-auto mb-2 size-8 text-emerald-400" />
            No alerts match the current filters.
          </Card>
        ) : (
          alerts.map((a) => {
            const color = LEVEL_COLOR[a.level];
            const acked = a.status === "acknowledged";
            return (
              <Card
                key={a.id}
                className="gap-2 p-3"
                style={{ borderLeft: `4px solid ${color}` }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="gap-1 text-xs"
                    style={{ borderColor: color, color }}
                  >
                    {LEVEL_ICON[a.level]}
                    <span className="font-semibold">{a.level}</span>
                  </Badge>
                  <span className="text-sm font-semibold text-foreground">
                    {a.title}
                  </span>
                  {a.locationName && (
                    <Badge variant="secondary" className="text-xs">
                      {a.locationName}
                    </Badge>
                  )}
                  <Badge
                    variant={acked ? "default" : "outline"}
                    className="text-[10px]"
                  >
                    {a.status}
                  </Badge>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {new Date(a.triggeredAt).toLocaleString("en-IN", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                </div>

                {a.reason && (
                  <div className="text-xs text-muted-foreground">{a.reason}</div>
                )}

                <div className="grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-4">
                  <Stat label="Expected rain" value={`${a.expectedRainfallMm ?? "—"} mm`} />
                  <Stat
                    label="Flood prob"
                    value={
                      a.floodProbability != null
                        ? `${Math.round(a.floodProbability * 100)}%`
                        : "—"
                    }
                  />
                  <Stat
                    label="Inundation"
                    value={
                      a.expectedInundationM != null
                        ? `${(a.expectedInundationM * 100).toFixed(1)} cm`
                        : "—"
                    }
                  />
                  <Stat
                    label="Acknowledged by"
                    value={a.acknowledgedBy ?? "—"}
                  />
                </div>

                {a.recommendedAction && (
                  <div className="rounded-md bg-muted/40 p-2 text-xs text-foreground">
                    <span className="font-semibold text-muted-foreground">
                      Action:
                    </span>{" "}
                    {a.recommendedAction}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2">
                  {!acked && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => acknowledge(a)}
                    >
                      <CheckCircle2 className="size-3.5" />
                      Acknowledge
                    </Button>
                  )}
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Pager */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          <ChevronLeft className="size-4" />
          Prev
        </Button>
        <span className="text-xs text-muted-foreground">
          Page {page} of {Math.max(1, totalPages)}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card/40 px-2 py-1">
      <div className="text-[9px] uppercase text-muted-foreground">{label}</div>
      <div className="font-semibold text-foreground">{value}</div>
    </div>
  );
}
