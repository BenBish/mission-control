import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

/** MTD daily trend chart — mounts only when the container has positive size (BSH-98 Recharts fix). */
export function DailySpendTrendChart({
  points,
}: {
  points: Array<{
    day: string;
    costUsd: number;
    priorPeriodCostUsd: number | null;
    deltaUsd: number | null;
  }>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.clientWidth);
      const h = Math.floor(el.clientHeight);
      setBox((prev) =>
        prev.w === w && prev.h === h
          ? prev
          : { w: Math.max(0, w), h: Math.max(0, h) },
      );
    };
    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(
    () =>
      points.map((p) => ({
        ...p,
        priorPlot: p.priorPeriodCostUsd ?? undefined,
      })),
    [points],
  );

  return (
    <div
      ref={hostRef}
      className="h-56 w-full min-w-0 min-h-[14rem] overflow-hidden"
      data-testid="daily-spend-trend-chart"
    >
      {box.w > 0 && box.h > 0 ? (
        <ResponsiveContainer width={box.w} height={box.h} debounce={50}>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 11 }}
              tickFormatter={(value: string) => {
                const d = new Date(value + "T00:00:00Z");
                return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
              }}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => `$${v.toFixed(0)}`}
              width={40}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload as {
                  costUsd: number;
                  priorPeriodCostUsd: number | null;
                  deltaUsd: number | null;
                };
                return (
                  <div className="rounded-lg border bg-background p-3 shadow-md text-sm">
                    <p className="font-medium mb-1">{label}</p>
                    <p>This month: ${row.costUsd.toFixed(4)}</p>
                    {row.priorPeriodCostUsd != null && (
                      <p className="text-muted-foreground">
                        Prior month: ${row.priorPeriodCostUsd.toFixed(4)}
                        {row.deltaUsd != null && (
                          <>
                            {" "}
                            ({row.deltaUsd >= 0 ? "+" : ""}
                            {row.deltaUsd.toFixed(4)})
                          </>
                        )}
                      </p>
                    )}
                  </div>
                );
              }}
            />
            <Legend />
            <Area
              type="monotone"
              dataKey="priorPlot"
              stroke="#94a3b8"
              fill="#94a3b8"
              fillOpacity={0.08}
              strokeDasharray="4 4"
              name="Prior month"
              connectNulls={false}
            />
            <Area
              type="monotone"
              dataKey="costUsd"
              stroke="#10b981"
              fill="#10b981"
              fillOpacity={0.15}
              name="This month"
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}
