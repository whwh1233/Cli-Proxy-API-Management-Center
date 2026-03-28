/**
 * Generic hook for quota data fetching and management.
 */

import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthFileItem } from '@/types';
import { useQuotaStore } from '@/stores';
import { getStatusFromError } from '@/utils/quota';
import type { QuotaConfig } from './quotaConfigs';

type QuotaScope = 'page' | 'all';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

const QUOTA_REFRESH_BATCH_SIZE = 20;

interface LoadQuotaResult<TData> {
  name: string;
  status: 'success' | 'error';
  data?: TData;
  error?: string;
  errorStatus?: number;
}

interface ExecuteQuotaLoadOptions<TState, TData> {
  targets: AuthFileItem[];
  scope: QuotaScope;
  fetchQuota: (file: AuthFileItem, t: ReturnType<typeof useTranslation>['t']) => Promise<TData>;
  t: ReturnType<typeof useTranslation>['t'];
  buildLoadingState: () => TState;
  buildSuccessState: (data: TData) => TState;
  buildErrorState: (message: string, status?: number) => TState;
  batchSize?: number;
  isRequestCurrent?: () => boolean;
}

const chunkQuotaTargets = (targets: AuthFileItem[], scope: QuotaScope, batchSize: number) => {
  if (scope !== 'all' || targets.length <= batchSize) {
    return [targets];
  }

  const batches: AuthFileItem[][] = [];
  for (let index = 0; index < targets.length; index += batchSize) {
    batches.push(targets.slice(index, index + batchSize));
  }
  return batches;
};

export async function executeQuotaLoad<TState, TData>(
  {
    targets,
    scope,
    fetchQuota,
    t,
    buildLoadingState,
    buildSuccessState,
    buildErrorState,
    batchSize = QUOTA_REFRESH_BATCH_SIZE,
    isRequestCurrent = () => true
  }: ExecuteQuotaLoadOptions<TState, TData>,
  setQuota: QuotaSetter<Record<string, TState>>,
  setLoading: (loading: boolean, scope?: QuotaScope | null) => void
) {
  setLoading(true, scope);

  try {
    if (targets.length === 0) return;

    setQuota((prev) => {
      const nextState = { ...prev };
      targets.forEach((file) => {
        nextState[file.name] = buildLoadingState();
      });
      return nextState;
    });

    const batches = chunkQuotaTargets(targets, scope, batchSize);

    for (const batch of batches) {
      const results = await Promise.all(
        batch.map(async (file): Promise<LoadQuotaResult<TData>> => {
          try {
            const data = await fetchQuota(file, t);
            return { name: file.name, status: 'success', data };
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : t('common.unknown_error');
            const errorStatus = getStatusFromError(err);
            return { name: file.name, status: 'error', error: message, errorStatus };
          }
        })
      );

      if (!isRequestCurrent()) return;

      setQuota((prev) => {
        const nextState = { ...prev };
        results.forEach((result) => {
          if (result.status === 'success') {
            nextState[result.name] = buildSuccessState(result.data as TData);
          } else {
            nextState[result.name] = buildErrorState(
              result.error || t('common.unknown_error'),
              result.errorStatus
            );
          }
        });
        return nextState;
      });
    }
  } finally {
    setLoading(false);
  }
}

export function useQuotaLoader<TState, TData>(config: QuotaConfig<TState, TData>) {
  const { t } = useTranslation();
  const quota = useQuotaStore(config.storeSelector);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;

  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);

  const loadQuota = useCallback(
    async (
      targets: AuthFileItem[],
      scope: QuotaScope,
      setLoading: (loading: boolean, scope?: QuotaScope | null) => void
    ) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      const requestId = ++requestIdRef.current;

      try {
        await executeQuotaLoad<TState, TData>(
          {
            targets,
            scope,
            fetchQuota: config.fetchQuota,
            t,
            buildLoadingState: config.buildLoadingState,
            buildSuccessState: config.buildSuccessState,
            buildErrorState: config.buildErrorState,
            isRequestCurrent: () => requestId === requestIdRef.current
          },
          setQuota,
          setLoading
        );
      } finally {
        if (requestId === requestIdRef.current) {
          loadingRef.current = false;
        }
      }
    },
    [config, setQuota, t]
  );

  return { quota, loadQuota };
}
