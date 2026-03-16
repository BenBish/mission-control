import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import type {
  Agent,
  AgentDetail,
  AgentsResponse,
  AgentDetailResponse,
  WorkspaceFile,
  AgentFilesResponse,
  AgentFileContentResponse,
} from "@/types/agent";

interface UseAgentsResult {
  agents: Agent[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useAgents(profileId?: string): UseAgentsResult {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const url = profileId
        ? `/api/agents?profile=${encodeURIComponent(profileId)}`
        : "/api/agents";
      const response = await apiFetch(url);
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
  }, [profileId]);

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

export function useAgent(id: string, profileId?: string): UseAgentResult {
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
        const url = profileId
          ? `/api/agents/${id}?profile=${encodeURIComponent(profileId)}`
          : `/api/agents/${id}`;
        const response = await apiFetch(url, {
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
          setError(
            err instanceof Error ? err.message : "Unknown error occurred",
          );
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
  }, [id, profileId]);

  return {
    agent,
    isLoading,
    error,
  };
}

interface UseAgentFilesResult {
  files: WorkspaceFile[];
  workspacePath: string | null;
  isLoading: boolean;
  error: string | null;
}

export function useAgentFiles(
  agentId: string,
  profileId?: string,
): UseAgentFilesResult {
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    let isMounted = true;

    const fetchFiles = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const url = profileId
          ? `/api/agents/${agentId}/files?profile=${encodeURIComponent(profileId)}`
          : `/api/agents/${agentId}/files`;
        const response = await apiFetch(url, {
          signal: abortController.signal,
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch files: ${response.statusText}`);
        }
        const data: AgentFilesResponse = await response.json();
        if (isMounted && !abortController.signal.aborted) {
          setFiles(data.files);
          setWorkspacePath(data.workspacePath);
        }
      } catch (err) {
        if (isMounted && !abortController.signal.aborted) {
          setError(
            err instanceof Error ? err.message : "Unknown error occurred",
          );
        }
      } finally {
        if (isMounted && !abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    if (agentId) {
      fetchFiles();
    }

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [agentId, profileId]);

  return { files, workspacePath, isLoading, error };
}

interface UseAgentFileContentResult {
  content: string | null;
  fileType: "markdown" | "json" | null;
  isLoading: boolean;
  error: string | null;
}

export function useAgentFileContent(
  agentId: string,
  filename: string | null,
  profileId?: string,
): UseAgentFileContentResult {
  const [content, setContent] = useState<string | null>(null);
  const [fileType, setFileType] = useState<"markdown" | "json" | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filename) {
      setContent(null);
      setFileType(null);
      return;
    }

    const abortController = new AbortController();
    let isMounted = true;

    const fetchContent = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const url = profileId
          ? `/api/agents/${agentId}/files/${encodeURIComponent(filename)}?profile=${encodeURIComponent(profileId)}`
          : `/api/agents/${agentId}/files/${encodeURIComponent(filename)}`;
        const response = await apiFetch(url, {
          signal: abortController.signal,
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.statusText}`);
        }
        const data: AgentFileContentResponse = await response.json();
        if (isMounted && !abortController.signal.aborted) {
          setContent(data.content);
          setFileType(data.type);
        }
      } catch (err) {
        if (isMounted && !abortController.signal.aborted) {
          setError(
            err instanceof Error ? err.message : "Unknown error occurred",
          );
        }
      } finally {
        if (isMounted && !abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    fetchContent();

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [agentId, filename, profileId]);

  return { content, fileType, isLoading, error };
}
