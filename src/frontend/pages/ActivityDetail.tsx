/**
 * Activity Detail Page
 * Display detailed view of a single activity
 */

import React, { useState, useEffect } from 'react';
import { Activity } from '../../types/activity';
import '../styles/ActivityDetail.css';

interface ActivityDetailProps {
  activity: Activity;
  onBack: () => void;
}

export const ActivityDetail: React.FC<ActivityDetailProps> = ({ activity, onBack }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [fullActivity, setFullActivity] = useState<Activity>(activity);

  // Fetch full activity details if only ID was passed
  useEffect(() => {
    if (!activity.description && activity.id) {
      const fetchDetails = async () => {
        setIsLoading(true);
        try {
          const response = await fetch(`/api/activities/${activity.id}`);
          if (response.ok) {
            const data = await response.json();
            setFullActivity(data.activity);
          }
        } catch (error) {
          console.error('Failed to fetch activity details:', error);
        } finally {
          setIsLoading(false);
        }
      };

      fetchDetails();
    }
  }, [activity]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const formatJson = (obj: any) => {
    return JSON.stringify(obj, null, 2);
  };

  const statusColor = {
    success: '#4caf50',
    failure: '#f44336',
    pending: '#ff9800',
    partial: '#2196f3',
  };

  return (
    <div className="activity-detail">
      <button className="back-button" onClick={onBack}>
        ← Back to Feed
      </button>

      {isLoading ? (
        <div className="loading-container">Loading activity details...</div>
      ) : (
        <>
          {/* Header */}
          <div className="detail-header">
            <div className="header-left">
              <h2>{fullActivity.description}</h2>
              <span
                className="status-badge"
                style={{ backgroundColor: statusColor[fullActivity.status as keyof typeof statusColor] }}
              >
                {fullActivity.status}
              </span>
            </div>
            <div className="header-right">
              {fullActivity.cost && (
                <div className="cost-display">
                  <div className="cost-value">${fullActivity.cost.usd.toFixed(4)}</div>
                  <div className="cost-label">Cost</div>
                </div>
              )}
            </div>
          </div>

          {/* Metadata Cards */}
          <div className="metadata-grid">
            <div className="metadata-card">
              <div className="metadata-label">Activity ID</div>
              <div className="metadata-value code">{fullActivity.id}</div>
            </div>

            <div className="metadata-card">
              <div className="metadata-label">Session ID</div>
              <div className="metadata-value code">{fullActivity.sessionId}</div>
            </div>

            <div className="metadata-card">
              <div className="metadata-label">Actor</div>
              <div className="metadata-value">
                <strong>{fullActivity.actor.type}:</strong> {fullActivity.actor.id}
                {fullActivity.actor.role && ` (${fullActivity.actor.role})`}
              </div>
            </div>

            <div className="metadata-card">
              <div className="metadata-label">Action Type</div>
              <div className="metadata-value">{fullActivity.actionType}</div>
            </div>

            {fullActivity.toolName && (
              <div className="metadata-card">
                <div className="metadata-label">Tool</div>
                <div className="metadata-value">{fullActivity.toolName}</div>
              </div>
            )}

            <div className="metadata-card">
              <div className="metadata-label">Started</div>
              <div className="metadata-value">{formatDate(fullActivity.timestamp)}</div>
            </div>

            {fullActivity.completedAt && (
              <div className="metadata-card">
                <div className="metadata-label">Completed</div>
                <div className="metadata-value">{formatDate(fullActivity.completedAt)}</div>
              </div>
            )}

            {fullActivity.durationMs !== undefined && (
              <div className="metadata-card">
                <div className="metadata-label">Duration</div>
                <div className="metadata-value">{fullActivity.durationMs}ms</div>
              </div>
            )}

            {fullActivity.tokens && (
              <div className="metadata-card">
                <div className="metadata-label">Tokens</div>
                <div className="metadata-value">
                  {fullActivity.tokens.totalTokens}
                  {fullActivity.tokens.model && ` (${fullActivity.tokens.model})`}
                </div>
              </div>
            )}

            {fullActivity.cost && (
              <div className="metadata-card">
                <div className="metadata-label">Cost Breakdown</div>
                <div className="metadata-value">
                  Input: ${fullActivity.cost.breakdown?.inputCost.toFixed(6)}, Output: $
                  {fullActivity.cost.breakdown?.outputCost.toFixed(6)}
                </div>
              </div>
            )}
          </div>

          {/* Details Section */}
          <div className="detail-section">
            <h3>Details</h3>
            <div className="code-block">
              <pre>{formatJson(fullActivity.details)}</pre>
            </div>
          </div>

          {/* Result Section */}
          {fullActivity.result && (
            <div className="detail-section">
              <h3>Result</h3>
              <div className="result-info">
                {fullActivity.result.success !== undefined && (
                  <div className="result-line">
                    <strong>Success:</strong> {fullActivity.result.success ? 'Yes' : 'No'}
                  </div>
                )}
                {fullActivity.result.exitCode !== undefined && (
                  <div className="result-line">
                    <strong>Exit Code:</strong> {fullActivity.result.exitCode}
                  </div>
                )}
                {fullActivity.result.output && (
                  <div className="result-section">
                    <strong>Output:</strong>
                    <div className="code-block">
                      <pre>{fullActivity.result.output.substring(0, 1000)}</pre>
                    </div>
                  </div>
                )}
                {fullActivity.result.error && (
                  <div className="result-section">
                    <strong>Error:</strong>
                    <div className="code-block error">
                      <pre>{fullActivity.result.error}</pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* References */}
          {fullActivity.references && (
            <div className="detail-section">
              <h3>References</h3>
              <div className="code-block">
                <pre>{formatJson(fullActivity.references)}</pre>
              </div>
            </div>
          )}

          {/* Tags */}
          {fullActivity.tags && fullActivity.tags.length > 0 && (
            <div className="detail-section">
              <h3>Tags</h3>
              <div className="tags-container">
                {fullActivity.tags.map((tag) => (
                  <span key={tag} className="tag-badge">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
