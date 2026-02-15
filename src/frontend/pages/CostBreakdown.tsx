/**
 * Cost Breakdown Page
 * Visualize costs by actor, tool, and time period
 */

import React, { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import '../styles/CostBreakdown.css';

interface CostReport {
  totalCost: number;
  totalTokens: number;
  activityCount: number;
  actorCosts: Record<string, { cost: number; tokens: number; actions: number }>;
  toolCosts: Record<string, { cost: number; count: number }>;
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

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7c7c', '#a4de6c', '#d084d0'];

export const CostBreakdown: React.FC = () => {
  const [costReport, setCostReport] = useState<CostReport | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch cost report
  useEffect(() => {
    const fetchCostReport = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/cost-report');
        if (!response.ok) throw new Error('Failed to fetch cost report');
        const data = await response.json();
        setCostReport(data);

        // Try to get session from query params or use first available session
        const params = new URLSearchParams(window.location.search);
        const sessionId = params.get('sessionId');
        if (sessionId) {
          setSessionId(sessionId);
          const summaryResponse = await fetch(`/api/sessions/${sessionId}`);
          if (summaryResponse.ok) {
            const summary = await summaryResponse.json();
            setSessionSummary(summary.summary);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    };

    fetchCostReport();
    const interval = setInterval(fetchCostReport, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  if (isLoading) {
    return <div className="loading-container">Loading cost data...</div>;
  }

  if (error) {
    return <div className="error-banner">{error}</div>;
  }

  if (!costReport) {
    return <div className="empty-state">No cost data available</div>;
  }

  // Prepare data for charts
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

  return (
    <div className="cost-breakdown">
      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="card">
          <div className="card-label">Total Cost</div>
          <div className="card-value">${costReport.totalCost.toFixed(4)}</div>
          <div className="card-detail">{costReport.totalTokens.toLocaleString()} tokens</div>
        </div>
        <div className="card">
          <div className="card-label">Activities</div>
          <div className="card-value">{costReport.activityCount}</div>
          <div className="card-detail">
            ${(costReport.totalCost / costReport.activityCount).toFixed(6)} per activity
          </div>
        </div>
        <div className="card">
          <div className="card-label">Actors</div>
          <div className="card-value">{Object.keys(costReport.actorCosts).length}</div>
          <div className="card-detail">{Object.keys(costReport.toolCosts).length} tools</div>
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
        {/* Cost by Actor */}
        {actorChartData.length > 0 && (
          <div className="chart-container">
            <h3>Cost by Actor</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={actorChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                <YAxis label={{ value: 'Cost ($)', angle: -90, position: 'insideLeft' }} />
                <Tooltip formatter={(value) => `$${Number(value).toFixed(4)}`} />
                <Bar dataKey="cost" fill="#8884d8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Cost by Tool (Top 10) */}
        {toolChartData.length > 0 && (
          <div className="chart-container">
            <h3>Cost by Tool (Top 10)</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={toolChartData}
                layout="vertical"
                margin={{ top: 5, right: 30, left: 150 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" label={{ value: 'Cost ($)', position: 'insideBottomRight', offset: -5 }} />
                <YAxis dataKey="name" type="category" width={140} />
                <Tooltip formatter={(value) => `$${Number(value).toFixed(4)}`} />
                <Bar dataKey="cost" fill="#82ca9d" />
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
                <Tooltip formatter={(value) => `$${Number(value).toFixed(4)}`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Action Count by Tool */}
        {toolChartData.length > 0 && (
          <div className="chart-container">
            <h3>Action Count by Tool</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={toolChartData.slice(0, 8)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                <YAxis label={{ value: 'Count', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <Bar dataKey="count" fill="#ffc658" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Detailed Tables */}
      <div className="tables-section">
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
