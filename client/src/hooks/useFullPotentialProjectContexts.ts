import { useEffect, useMemo, useState } from "react";
import {
  fetchAwardedProjectFullPotentialContexts,
  fetchProjectFullPotentialContexts,
  uniquePositiveProjectIds,
  type ProjectFullPotentialContext,
} from "@/lib/fullPotentialProjectContext";

interface ProjectContextHookResult {
  contextsByProjectId: Map<number, ProjectFullPotentialContext>;
  isLoading: boolean;
  error: string | null;
}

interface AwardedContextHookResult {
  contextsByAwardedProjectId: Map<number, ProjectFullPotentialContext>;
  isLoading: boolean;
  error: string | null;
}

export function useFullPotentialProjectContexts(
  projectIds: readonly number[],
  enabled = true,
): ProjectContextHookResult {
  const key = useMemo(
    () => uniquePositiveProjectIds(projectIds).join(","),
    [projectIds],
  );
  const ids = useMemo(
    () => key ? key.split(",").map(Number) : [],
    [key],
  );
  const [contextsByProjectId, setContextsByProjectId] = useState<Map<number, ProjectFullPotentialContext>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || ids.length === 0) {
      setContextsByProjectId(new Map());
      setIsLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    fetchProjectFullPotentialContexts(ids, controller.signal)
      .then(contexts => {
        if (!controller.signal.aborted) setContextsByProjectId(contexts);
      })
      .catch(loadError => {
        if (controller.signal.aborted) return;
        setContextsByProjectId(new Map());
        setError(loadError instanceof Error ? loadError.message : "Could not load Full Potential account context");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [enabled, key]);

  return { contextsByProjectId, isLoading, error };
}

export function useAwardedProjectFullPotentialContexts(
  enabled = true,
  limit = 500,
): AwardedContextHookResult {
  const [contextsByAwardedProjectId, setContextsByAwardedProjectId] = useState<Map<number, ProjectFullPotentialContext>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setContextsByAwardedProjectId(new Map());
      setIsLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    fetchAwardedProjectFullPotentialContexts(limit, controller.signal)
      .then(contexts => {
        if (!controller.signal.aborted) setContextsByAwardedProjectId(contexts);
      })
      .catch(loadError => {
        if (controller.signal.aborted) return;
        setContextsByAwardedProjectId(new Map());
        setError(loadError instanceof Error ? loadError.message : "Could not load awarded-project account context");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [enabled, limit]);

  return { contextsByAwardedProjectId, isLoading, error };
}
