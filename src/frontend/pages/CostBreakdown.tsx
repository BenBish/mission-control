/**
 * Cost Breakdown Page
 * Visualize costs by actor, model, and time period
 * Includes scanner status and backfill controls
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import '../styles/CostBreakdown.css';

interface CostReport {
  totalCost: number;
  totalTokens: number;
  activityCount: number;
  actorCosts: Record<string, { cost: number; tokens: number; actions: number }>;
  toolCosts: Record<string, { cost: number; count: number }>;
  generationSummary?: {
    totalCost: number;
    totalGenerations: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    byAgent: Record<string, { cost: number; generations: number; tokens: number }>;
    byModel: Record<string, { cost: number; generations: number; tokens: number }>;
  };
}

interface SessionSummary {
  sessionId: string;
  startTime: string;
  endTime?: string;
  stats: {
    totalActions: number;
    successRate: number;
    totalTokens: number;
    totalCost: number;
    avgActionDuration: number;
  };
  actors: Record<string, any>;
  topTools: Array<{ name: string; count: number; cost: number }>;
}

interface ScannerStatus {
  scanner: {
    running: boolean;
    lastScanTime: string | null;
    lastResult: {
      filesScanned: number;
      newGenerations: number;
      totalCost: number;
      errors: string[];
    } | null;
  };
  pricing: {
    source: 'api' | 'static';
    lastFetch: string | null;
    modelCount: number;
  };
  generations: {
    total: number;
    totalCost: number;
  };
}

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7c7c', '#a4de6c', '#d084d0', '#ff8042', '#00C49F'];

export const CostBreakdown: React.FC = () => {
  const [costReport, setCostReport] = useState<CostReport | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [scannerStatus, setScannerStatus] = useState<ScannerStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const [costRes, statusRes] = await Promise.all([
        fetch('/api/cost-report'),
        fetch('/api/cost/status'),
      ]);

      if (costRes.ok) {
        setCostReport(await costRes.json());
      }
      if (statusRes.ok) {
        setScannerStatus(await statusRes.json());
      }

      const params = new URLSearchParams(window.location.search);
      const sid = params.get('sessionId');
      if (sid) {
        setSessionId(sid);
        const summaryRes = await fetch(`/api/sessions/${sid}`);
        if (summaryRes.ok) {
          const summary = await summaryRes.json();
          setSessionSummary(summary.summary);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleBackfill = async () => {
    setIsBackfilling(true);
    try {
      const res = await fetch('/api/cost/backfill', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        await fetchData();
      } else {
        setError(data.error || 'Backfill failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backfill request failed');
    } finally {
      setIsBackfilling(false);
    }
  };

  const handleScan = async () => {
    try {
      await fetch('/api/cost/scan', { method: 'POST' });
      await fetchData();
    } catch {
      // Silent failure for manual scan
    }
  };

  if (isLoading) {
    return <div className="loading-container">Loading cost data...</div>;
  }

  if (error) {
    return <div className="error-banner">{error}</div>;
  }

  if (!costReport) {
    return <div className="empty-state">No cost data available</div>;
  }

  const genSummary = costReport.generationSummary;
  const totalCost = genSummary?.totalCost ?? costReport.totalCost;
  const totalGenerations = genSummary?.totalGenerations ?? 0;

  // Prepare chart data
  const actorChartData = Object.entries(costReport.actorCosts).map(([actorId, data]) => ({
    name: actorId,
    cost: data.cost,
    tokens: data.tokens,
    actions: data.actions,
  }));

  const toolChartData = Object.entries(costReport.toolCosts)
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 10)
    .map(([toolName, data]) => ({
      name: toolName,
      cost: data.cost,
      count: data.count,
    }));

  const actorPieData = Object.entries(costReport.actorCosts).map(([actorId, data]) => ({
    name: actorId,
    value: data.cost,
  }));

  // Model cost data from generation summary
  const modelChartData = genSummary
    ? Object.entries(genSummary.byModel)
        .sort((a, b) => b[1].cost - a[1].cost)
        .map(([model, data]) => ({
          name: model.split('/').pop() || model,
          fullName: model,
          cost: data.cost,
          generations: data.generations,
          tokens: data.tokens,
        }))
    : [];

  // Agent cost data from generation summary
  const agentGenData = genSummary
    ? Object.entries(genSummary.byAgent)
        .sort((a, b) => b[1].cost - a[1].cost)
        .map(([agent, data]) => ({
          name: agent,
          cost: data.cost,
          generations: data.generations,
          tokens: data.tokens,
        }))
    : [];

  // Cache savings calculation
  const cacheReadTokens = genSummary?.totalCacheReadTokens ?? 0;
  const totalInputTokens = genSummary?.totalInputTokens ?? 0;
  const cacheHitRate = totalInputTokens > 0
    ? (cacheReadTokens / (totalInputTokens + cacheReadTokens) * 100)
    : 0;

  return (
    <div className="cost-breakdown">
      {/* Scanner Status Banner */}
      {scannerStatus && (
        <div className="scanner-status">
          <div className="scanner-info">
            <span className={`status-dot ${scannerStatus.scanner.running ? 'running' : 'stopped'}`} />
            <span>
              Scanner {scannerStatus.scanner.running ? 'active' : 'stopped'}
              {scannerStatus.scanner.lastScanTime && (
                <> &middot; Last scan: {new Date(scannerStatus.scanner.lastScanTime).toLocaleTimeString()}</>
              )}
              {scannerStatus.generations.total > 0 && (
                <> &middot; {scannerStatus.generations.total} generations tracked</>
              )}
              &middot; Pricing: {scannerStatus.pricing.source} ({scannerStatus.pricing.modelCount} models)
            </span>
          </div>
          <div className="scanner-actions">
            <button onClick={handleScan} className="btn-secondary" title="Run incremental scan">
              Scan Now
            </button>
            <button
              onClick={handleBackfill}
              disabled={isBackfilling}
              className="btn-primary"
              title="Full rescan of all session logs"
            >
              {isBackfilling ? 'Backfilling...' : 'Run Backfill'}
            </button>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="card">
          <div className="card-label">Total Cost</div>
          <div className="card-value">${totalCost.toFixed(4)}</div>
          <div className="card-detail">
            {totalGenerations > 0
              ? `${totalGenerations} LLM generations`
              : `${costReport.totalTokens.toLocaleString()} tokens`
            }
          </div>
        </div>
        <div className="card">
          <div className="card-label">Activities</div>
          <div className="card-value">{costReport.activityCount}</div>
          <div className="card-detail">
            {costReport.activityCount > 0
              ? `$${(totalCost / Math.max(costReport.activityCount, 1)).toFixed(6)} avg`
              : 'No activities yet'
            }
          </div>
        </div>
        <div className="card">
          <div className="card-label">Cache Savings</div>
          <div className="card-value">{cacheHitRate.toFixed(1)}%</div>
          <div className="card-detail">{cacheReadTokens.toLocaleString()} cached tokens</div>
        </div>
        {sessionSummary && (
          <div className="card">
            <div className="card-label">Success Rate</div>
            <div className="card-value">{sessionSummary.stats.successRate.toFixed(1)}%</div>
            <div className="card-detail">{sessionSummary.stats.totalActions} actions</div>
          </div>
        )}
      </div>

      {/* Charts Section */}
      <div className="charts-grid">
        {/* Cost by Model (from generation summary) */}
        {modelChartData.length > 0 && (
          <div className="chart-container">
            <h3>Cost by Model</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={modelChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                <YAxis label={{ value: 'Cost ($)', angle: -90, position: 'insideLeft' }} />
                <Tooltip
                  formatter={(value: any) => `$${Number(value).toFixed(4)}`}
                  labelFormatter={(label: any) => {
                    const item = modelChartData.find(d => d.name === label);
                    return item?.fullName ?? label;
                  }}
                />
                <Bar dataKey="cost" fill="#8884d8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Cost by Agent (from generation summary) */}
        {agentGenData.length > 0 && (
          <div className="chart-container">
            <h3>Cost by Agent (from logs)</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={agentGenData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                <YAxis label={{ value: 'Cost ($)', angle: -90, position: 'insideLeft' }} />
                <Tooltip formatter={(value: any) => `$${Number(value).toFixed(4)}`} />
                <Bar dataKey="cost" fill="#82ca9d" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Cost by Actor (from activities) */}
        {actorChartData.length > 0 && (
          <div className="chart-container">
            <h3>Cost by Actor (activities)</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={actorChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                <YAxis label={{ value: 'Cost ($)', angle: -90, position: 'insideLeft' }} />
                <Tooltip formatter={(value: any) => `$${Number(value).toFixed(4)}`} />
                <Bar dataKey="cost" fill="#ffc658" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Cost Distribution (Pie) */}
        {actorPieData.length > 0 && (
          <div className="chart-container">
            <h3>Cost Distribution by Actor</h3>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={actorPieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: $${Number(value).toFixed(2)}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {actorPieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: any) => `$${Number(value).toFixed(4)}`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Detailed Tables */}
      <div className="tables-section">
        {/* Model Costs Table (from generations) */}
        {modelChartData.length > 0 && (
          <div className="table-container">
            <h3>Model Costs Detail</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Generations</th>
                  <th>Total Cost</th>
                  <th>Tokens</th>
                  <th>Cost/Gen</th>
                </tr>
              </thead>
              <tbody>
                {modelChartData.map((row) => (
                  <tr key={row.fullName}>
                    <td title={row.fullName}>{row.name}</td>
                    <td>{row.generations}</td>
                    <td>${row.cost.toFixed(4)}</td>
                    <td>{row.tokens.toLocaleString()}</td>
                    <td>${(row.cost / row.generations).toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Actor Details Table */}
        {actorChartData.length > 0 && (
          <div className="table-container">
            <h3>Actor Costs Detail</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Actor</th>
                  <th>Actions</th>
                  <th>Total Cost</th>
                  <th>Tokens</th>
                  <th>Cost/Action</th>
                </tr>
              </thead>
              <tbody>
                {actorChartData
                  .sort((a, b) => b.cost - a.cost)
                  .map((row) => (
                    <tr key={row.name}>
                      <td>{row.name}</td>
                      <td>{row.actions}</td>
                      <td>${row.cost.toFixed(4)}</td>
                      <td>{row.tokens.toLocaleString()}</td>
                      <td>${(row.cost / row.actions).toFixed(6)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Tool Details Table */}
        {toolChartData.length > 0 && (
          <div className="table-container">
            <h3>Tool Costs Detail</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Count</th>
                  <th>Total Cost</th>
                  <th>Cost/Call</th>
                </tr>
              </thead>
              <tbody>
                {toolChartData.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>{row.count}</td>
                    <td>${row.cost.toFixed(4)}</td>
                    <td>${(row.cost / row.count).toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
