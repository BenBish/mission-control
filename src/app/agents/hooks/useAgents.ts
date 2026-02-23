import { useState, useEffect, useCallback } from "react";
import type { Agent, AgentDetail, AgentsResponse, AgentDetailResponse } from "@/types/agent";

interface UseAgentsResult {
  agents: Agent[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useAgents(): UseAgentsResult {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/agents");
      if (!response.ok) {
        throw new Error(`Failed to fetch agents: ${response.statusText}`);
      }
      const data: AgentsResponse = await response.json();
      if (data.success) {
        setAgents(data.agents);
      } else {
        throw new Error("API returned unsuccessful response");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return {
    agents,
    isLoading,
    error,
    refetch: fetchAgents,
  };
}

interface UseAgentResult {
  agent: AgentDetail | null;
  isLoading: boolean;
  error: string | null;
}

export function useAgent(id: string): UseAgentResult {
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    let isMounted = true;

    const fetchAgent = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/agents/${id}`, {
          signal: abortController.signal,
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch agent: ${response.statusText}`);
        }
        const data: AgentDetailResponse = await response.json();
        if (isMounted && !abortController.signal.aborted) {
          if (data.success) {
            setAgent(data.agent);
          } else {
            throw new Error("API returned unsuccessful response");
          }
        }
      } catch (err) {
        if (isMounted && !abortController.signal.aborted) {
          setError(err instanceof Error ? err.message : "Unknown error occurred");
        }
      } finally {
        if (isMounted && !abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    if (id) {
      fetchAgent();
    }

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [id]);

  return {
    agent,
    isLoading,
    error,
  };
}
