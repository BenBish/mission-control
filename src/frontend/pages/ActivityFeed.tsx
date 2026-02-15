/**
 * Activity Feed Page
 * Display live activity feed with search and filtering
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Activity, ActivityFilter } from '../../types/activity';
import { ActivityListItem } from '../components/ActivityListItem';
import { FilterPanel } from '../components/FilterPanel';
import { useActivityStream } from '../hooks/useActivityStream';
import '../styles/ActivityFeed.css';

interface ActivityFeedProps {
  onActivityClick: (activity: Activity) => void;
}

export const ActivityFeed: React.FC<ActivityFeedProps> = ({ onActivityClick }) => {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [filteredActivities, setFilteredActivities] = useState<Activity[]>([]);
  const [filter, setFilter] = useState<ActivityFilter>({
    limit: 100,
    offset: 0,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Real-time stream connection
  const { isConnected, isStreaming } = useActivityStream((newActivity) => {
    setActivities((prev) => [newActivity, ...prev.slice(0, 99)]);
  });

  // Fetch initial activities
  useEffect(() => {
    const fetchActivities = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (filter.sessionId) params.append('sessionId', filter.sessionId);
        if (filter.actorId) params.append('actorId', filter.actorId);
        if (filter.toolName) params.append('toolName', filter.toolName);
        if (filter.status) params.append('status', filter.status);
        params.append('limit', (filter.limit || 100).toString());
        params.append('offset', (filter.offset || 0).toString());

        const response = await fetch(`/api/activities?${params}`);
        if (!response.ok) throw new Error('Failed to fetch activities');

        const data = await response.json();
        setActivities(data.activities || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    };

    fetchActivities();
  }, [filter]);

  // Filter activities locally
  useEffect(() => {
    let filtered = activities;

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((a) =>
        a.description.toLowerCase().includes(q) ||
        a.toolName?.toLowerCase().includes(q) ||
        a.actor.id.toLowerCase().includes(q) ||
        JSON.stringify(a.details).toLowerCase().includes(q)
      );
    }

    setFilteredActivities(filtered);
  }, [activities, searchQuery]);

  const handleFilterChange = (newFilter: Partial<ActivityFilter>) => {
    setFilter((prev) => ({ ...prev, ...newFilter }));
  };

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  return (
    <div className="activity-feed">
      {/* Search and Filter */}
      <div className="feed-toolbar">
        <div className="search-box">
          <input
            type="text"
            placeholder="🔍 Search activities..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="search-input"
          />
        </div>
        <FilterPanel filter={filter} onChange={handleFilterChange} />
        <div className="toolbar-status">
          {isLoading && <span className="status-badge loading">Loading...</span>}
          {isStreaming && <span className="status-badge streaming">🔴 Live</span>}
          <span className="count-badge">{filteredActivities.length} activities</span>
        </div>
      </div>

      {/* Error message */}
      {error && <div className="error-banner">{error}</div>}

      {/* Activity List */}
      <div className="activity-list">
        {filteredActivities.length === 0 ? (
          <div className="empty-state">
            <p>No activities found</p>
            {searchQuery && <p className="text-muted">Try adjusting your search</p>}
          </div>
        ) : (
          filteredActivities.map((activity) => (
            <ActivityListItem
              key={activity.id}
              activity={activity}
              onClick={() => onActivityClick(activity)}
            />
          ))
        )}
      </div>

      {/* Load more button */}
      {filteredActivities.length === filter.limit && (
        <div className="load-more-container">
          <button
            className="load-more-button"
            onClick={() => handleFilterChange({ offset: (filter.offset || 0) + (filter.limit || 100) })}
          >
            Load More...
          </button>
        </div>
      )}
    </div>
  );
};
