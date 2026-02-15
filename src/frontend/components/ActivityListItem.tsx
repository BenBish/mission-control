/**
 * Activity List Item Component
 * Displays a single activity in the feed
 */

import React from 'react';
import { Activity } from '../../types/activity';
import '../styles/ActivityListItem.css';

interface ActivityListItemProps {
  activity: Activity;
  onClick: () => void;
}

export const ActivityListItem: React.FC<ActivityListItemProps> = ({ activity, onClick }) => {
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return '✓';
      case 'failure':
        return '✗';
      case 'pending':
        return '⏳';
      case 'partial':
        return '⚠';
      default:
        return '•';
    }
  };

  const getActorIcon = (type: string) => {
    switch (type) {
      case 'orchestrator':
        return '🎯';
      case 'subagent':
        return '🤖';
      case 'user':
        return '👤';
      case 'system':
        return '⚙';
      default:
        return '•';
    }
  };

  const getActionTypeIcon = (type: string) => {
    switch (type) {
      case 'tool_call':
        return '🔧';
      case 'delegation':
        return '📤';
      case 'api_call':
        return '🌐';
      case 'decision':
        return '🤔';
      case 'message':
        return '💬';
      case 'user_request':
        return '❓';
      default:
        return '•';
    }
  };

  return (
    <div className={`activity-item activity-${activity.status}`} onClick={onClick}>
      <div className="item-header">
        <div className="item-left">
          {/* Time */}
          <span className="item-time">{formatTime(activity.timestamp)}</span>

          {/* Status Icon */}
          <span className={`status-icon status-${activity.status}`}>
            {getStatusIcon(activity.status)}
          </span>

          {/* Description */}
          <span className="item-description">{activity.description}</span>
        </div>

        <div className="item-right">
          {/* Cost */}
          {activity.cost && (
            <span className="item-cost">${activity.cost.usd.toFixed(4)}</span>
          )}

          {/* Chevron */}
          <span className="item-chevron">›</span>
        </div>
      </div>

      {/* Metadata Row */}
      <div className="item-metadata">
        <span className="metadata-tag">
          {getActorIcon(activity.actor.type)} {activity.actor.id}
        </span>

        {activity.toolName && (
          <span className="metadata-tag">
            {getActionTypeIcon(activity.actionType)} {activity.toolName}
          </span>
        )}

        {activity.durationMs !== undefined && (
          <span className="metadata-tag">⏱ {activity.durationMs}ms</span>
        )}

        {activity.tokens && (
          <span className="metadata-tag">📊 {activity.tokens.totalTokens} tokens</span>
        )}
      </div>
    </div>
  );
};
