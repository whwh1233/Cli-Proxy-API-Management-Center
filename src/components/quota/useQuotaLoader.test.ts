import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { AuthFileItem } from '@/types';
import { executeQuotaLoad } from './useQuotaLoader';

type TestQuotaState =
  | { status: 'loading' }
  | { status: 'success'; value: string }
  | { status: 'error'; error: string; errorStatus?: number };

const createFiles = (count: number): AuthFileItem[] =>
  Array.from({ length: count }, (_, index) => ({
    name: `file-${index + 1}`,
    type: 'codex'
  }));

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
};

describe('executeQuotaLoad', () => {
  it('refreshes all-scope targets in batches of 20', async () => {
    const targets = createFiles(45);
    const deferredByName = new Map<string, ReturnType<typeof createDeferred<string>>>();
    const startedNames: string[] = [];
    let quotaState: Record<string, TestQuotaState> = {};
    const snapshots: Array<Record<string, TestQuotaState>> = [];

    const setQuota = (
      updater:
        | Record<string, TestQuotaState>
        | ((prev: Record<string, TestQuotaState>) => Record<string, TestQuotaState>)
    ) => {
      quotaState = typeof updater === 'function' ? updater(quotaState) : updater;
      snapshots.push({ ...quotaState });
    };

    const setLoading = vi.fn();
    const fetchQuota = vi.fn((file: AuthFileItem) => {
      startedNames.push(file.name);
      const deferred = createDeferred<string>();
      deferredByName.set(file.name, deferred);
      return deferred.promise;
    });

    const task = executeQuotaLoad<TestQuotaState, string>({
      targets,
      scope: 'all',
      fetchQuota,
      t: ((key: string) => key) as TFunction,
      buildLoadingState: () => ({ status: 'loading' }),
      buildSuccessState: (value) => ({ status: 'success', value }),
      buildErrorState: (message, status) => ({
        status: 'error',
        error: message,
        errorStatus: status
      })
    }, setQuota, setLoading);

    await vi.waitFor(() => {
      expect(fetchQuota).toHaveBeenCalledTimes(20);
    });
    expect(startedNames).toEqual(targets.slice(0, 20).map((file) => file.name));

    targets.slice(0, 20).forEach((file) => deferredByName.get(file.name)?.resolve(`${file.name}-ok`));

    await vi.waitFor(() => {
      expect(fetchQuota).toHaveBeenCalledTimes(40);
    });
    expect(startedNames).toEqual(targets.slice(0, 40).map((file) => file.name));

    const firstBatchSnapshot = snapshots[snapshots.length - 1];
    expect(firstBatchSnapshot?.['file-1']).toEqual({ status: 'success', value: 'file-1-ok' });
    expect(firstBatchSnapshot?.['file-20']).toEqual({ status: 'success', value: 'file-20-ok' });
    expect(firstBatchSnapshot?.['file-21']).toEqual({ status: 'loading' });
    expect(firstBatchSnapshot?.['file-45']).toEqual({ status: 'loading' });

    targets.slice(20, 40).forEach((file) => deferredByName.get(file.name)?.resolve(`${file.name}-ok`));

    await vi.waitFor(() => {
      expect(fetchQuota).toHaveBeenCalledTimes(45);
    });
    expect(startedNames).toEqual(targets.map((file) => file.name));

    targets.slice(40).forEach((file) => deferredByName.get(file.name)?.resolve(`${file.name}-ok`));

    await task;

    expect(quotaState['file-41']).toEqual({ status: 'success', value: 'file-41-ok' });
    expect(quotaState['file-45']).toEqual({ status: 'success', value: 'file-45-ok' });
    expect(setLoading).toHaveBeenNthCalledWith(1, true, 'all');
    expect(setLoading).toHaveBeenLastCalledWith(false);
  });

  it('keeps paged scope as a single batch', async () => {
    const targets = createFiles(25);
    const deferredByName = new Map<string, ReturnType<typeof createDeferred<string>>>();
    const setLoading = vi.fn();
    let quotaState: Record<string, TestQuotaState> = {};

    const setQuota = (
      updater:
        | Record<string, TestQuotaState>
        | ((prev: Record<string, TestQuotaState>) => Record<string, TestQuotaState>)
    ) => {
      quotaState = typeof updater === 'function' ? updater(quotaState) : updater;
    };

    const fetchQuota = vi.fn((file: AuthFileItem) => {
      const deferred = createDeferred<string>();
      deferredByName.set(file.name, deferred);
      return deferred.promise;
    });

    const task = executeQuotaLoad<TestQuotaState, string>({
      targets,
      scope: 'page',
      fetchQuota,
      t: ((key: string) => key) as TFunction,
      buildLoadingState: () => ({ status: 'loading' }),
      buildSuccessState: (value) => ({ status: 'success', value }),
      buildErrorState: (message, status) => ({
        status: 'error',
        error: message,
        errorStatus: status
      })
    }, setQuota, setLoading);

    await vi.waitFor(() => {
      expect(fetchQuota).toHaveBeenCalledTimes(25);
    });

    targets.forEach((file) => deferredByName.get(file.name)?.resolve(`${file.name}-ok`));

    await task;

    expect(quotaState['file-1']).toEqual({ status: 'success', value: 'file-1-ok' });
    expect(quotaState['file-25']).toEqual({ status: 'success', value: 'file-25-ok' });
    expect(setLoading).toHaveBeenNthCalledWith(1, true, 'page');
    expect(setLoading).toHaveBeenLastCalledWith(false);
  });
});
