/**
 * Filter Panel Component
 * Provides filtering options for activities
 */

import React, { useState } from 'react';
import { ActivityFilter } from '../../types/activity';
import '../styles/FilterPanel.css';

interface FilterPanelProps {
  filter: ActivityFilter;
  onChange: (filter: Partial<ActivityFilter>) => void;
}

export const FilterPanel: React.FC<FilterPanelProps> = ({ filter, onChange }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleStatusChange = (status: string) => {
    onChange({
      status: status === 'all' ? undefined : (status as any),
      offset: 0,
    });
  };

  const handleActorTypeChange = (type: string) => {
    onChange({
      actorType: type === 'all' ? undefined : (type as any),
      offset: 0,
    });
  };

  const handleToolChange = (tool: string) => {
    onChange({
      toolName: tool === 'all' ? undefined : tool,
      offset: 0,
    });
  };

  const handleReset = () => {
    onChange({
      sessionId: undefined,
      actorId: undefined,
      actorType: undefined,
      actionType: undefined,
      toolName: undefined,
      status: undefined,
      startTime: undefined,
      endTime: undefined,
      offset: 0,
    });
  };

  return (
    <div className="filter-panel">
      <button className="filter-toggle" onClick={() => setIsExpanded(!isExpanded)}>
        ⚙ {isExpanded ? 'Hide' : 'Show'} Filters
        {Object.values(filter).some((v) => v !== undefined && v !== 0 && v !== 100) && (
          <span className="filter-active-indicator">✓</span>
        )}
      </button>

      {isExpanded && (
        <div className="filter-content">
          <div className="filter-group">
            <label>Status</label>
            <div className="filter-options">
              <button
                className={`filter-option ${!filter.status ? 'active' : ''}`}
                onClick={() => handleStatusChange('all')}
              >
                All
              </button>
              <button
                className={`filter-option ${filter.status === 'success' ? 'active' : ''}`}
                onClick={() => handleStatusChange('success')}
              >
                ✓ Success
              </button>
              <button
                className={`filter-option ${filter.status === 'failure' ? 'active' : ''}`}
                onClick={() => handleStatusChange('failure')}
              >
                ✗ Failure
              </button>
              <button
                className={`filter-option ${filter.status === 'pending' ? 'active' : ''}`}
                onClick={() => handleStatusChange('pending')}
              >
                ⏳ Pending
              </button>
            </div>
          </div>

          <div className="filter-group">
            <label>Actor Type</label>
            <div className="filter-options">
              <button
                className={`filter-option ${!filter.actorType ? 'active' : ''}`}
                onClick={() => handleActorTypeChange('all')}
              >
                All
              </button>
              <button
                className={`filter-option ${filter.actorType === 'orchestrator' ? 'active' : ''}`}
                onClick={() => handleActorTypeChange('orchestrator')}
              >
                🎯 Orchestrator
              </button>
              <button
                className={`filter-option ${filter.actorType === 'subagent' ? 'active' : ''}`}
                onClick={() => handleActorTypeChange('subagent')}
              >
                🤖 Subagent
              </button>
              <button
                className={`filter-option ${filter.actorType === 'user' ? 'active' : ''}`}
                onClick={() => handleActorTypeChange('user')}
              >
                👤 User
              </button>
            </div>
          </div>

          <div className="filter-group">
            <label htmlFor="actor-input">Actor ID</label>
            <input
              id="actor-input"
              type="text"
              placeholder="Filter by actor ID..."
              value={filter.actorId || ''}
              onChange={(e) =>
                onChange({
                  actorId: e.target.value || undefined,
                  offset: 0,
                })
              }
              className="filter-input"
            />
          </div>

          <div className="filter-group">
            <label htmlFor="tool-input">Tool Name</label>
            <input
              id="tool-input"
              type="text"
              placeholder="Filter by tool..."
              value={filter.toolName || ''}
              onChange={(e) =>
                onChange({
                  toolName: e.target.value || undefined,
                  offset: 0,
                })
              }
              className="filter-input"
            />
          </div>

          <div className="filter-group">
            <label htmlFor="session-input">Session ID</label>
            <input
              id="session-input"
              type="text"
              placeholder="Filter by session..."
              value={filter.sessionId || ''}
              onChange={(e) =>
                onChange({
                  sessionId: e.target.value || undefined,
                  offset: 0,
                })
              }
              className="filter-input"
            />
          </div>

          <div className="filter-actions">
            <button className="reset-button" onClick={handleReset}>
              Clear All Filters
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
