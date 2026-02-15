/**
 * Mission Control Dashboard
 * Main React application
 */

import React, { useState, useEffect } from 'react';
import { ActivityFeed } from './pages/ActivityFeed';
import { CostBreakdown } from './pages/CostBreakdown';
import { ActivityDetail } from './pages/ActivityDetail';
import './styles/App.css';

export type Page = 'feed' | 'costs' | 'detail';

export interface SelectedActivity {
  id: string;
  [key: string]: any;
}

export const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<Page>('feed');
  const [selectedActivity, setSelectedActivity] = useState<SelectedActivity | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Health check on mount
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch('/api/health');
        setIsConnected(response.ok);
      } catch (error) {
        console.error('Health check failed:', error);
        setIsConnected(false);
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleActivityClick = (activity: SelectedActivity) => {
    setSelectedActivity(activity);
    setCurrentPage('detail');
  };

  const handleBackToFeed = () => {
    setSelectedActivity(null);
    setCurrentPage('feed');
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <div className="header-content">
          <h1>🎯 Mission Control</h1>
          <div className="header-status">
            <span className={`connection-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
              {isConnected ? '●' : '○'} {isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="app-nav">
        <button
          className={`nav-button ${currentPage === 'feed' ? 'active' : ''}`}
          onClick={() => {
            setCurrentPage('feed');
            setSelectedActivity(null);
          }}
        >
          📊 Activity Feed
        </button>
        <button
          className={`nav-button ${currentPage === 'costs' ? 'active' : ''}`}
          onClick={() => setCurrentPage('costs')}
        >
          💰 Cost Breakdown
        </button>
      </nav>

      {/* Main Content */}
      <main className="app-main">
        {currentPage === 'feed' && (
          <ActivityFeed onActivityClick={handleActivityClick} />
        )}
        {currentPage === 'costs' && <CostBreakdown />}
        {currentPage === 'detail' && selectedActivity && (
          <ActivityDetail activity={selectedActivity} onBack={handleBackToFeed} />
        )}
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <p>Mission Control Activity Feed v0.2.0 (Phase 1.5)</p>
      </footer>
    </div>
  );
};

export default App;
