/**
 * Generic quota section component.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { triggerHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { authFilesApi } from '@/services/api';
import { useNotificationStore, useQuotaStore, useThemeStore } from '@/stores';
import type { AuthFileItem, ResolvedTheme } from '@/types';
import { getStatusFromError } from '@/utils/quota';
import { getAuthFileStatusMessage } from '@/features/authFiles/constants';
import { QuotaCard } from './QuotaCard';
import type { AvailabilityTone, QuotaStatusState } from './QuotaCard';
import { useQuotaLoader } from './useQuotaLoader';
import type { QuotaConfig } from './quotaConfigs';
import { useGridColumns } from './useGridColumns';
import { IconRefreshCw } from '@/components/ui/icons';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

type ViewMode = 'paged' | 'all';
type StatusFilter = 'all' | 'unavailable' | 'weeklyLow';

const MAX_ITEMS_PER_PAGE = 25;
const MAX_SHOW_ALL_THRESHOLD = 3000;

interface QuotaPaginationState<T> {
  pageSize: number;
  totalPages: number;
  currentPage: number;
  pageItems: T[];
  setPageSize: (size: number) => void;
  goToPrev: () => void;
  goToNext: () => void;
  loading: boolean;
  loadingScope: 'page' | 'all' | null;
  setLoading: (loading: boolean, scope?: 'page' | 'all' | null) => void;
}

const useQuotaPagination = <T,>(items: T[], defaultPageSize = 6): QuotaPaginationState<T> => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(defaultPageSize);
  const [loading, setLoadingState] = useState(false);
  const [loadingScope, setLoadingScope] = useState<'page' | 'all' | null>(null);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(items.length / pageSize)),
    [items.length, pageSize]
  );

  const currentPage = useMemo(() => Math.min(page, totalPages), [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize]);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    setPage(1);
  }, []);

  const goToPrev = useCallback(() => {
    setPage((prev) => Math.max(1, prev - 1));
  }, []);

  const goToNext = useCallback(() => {
    setPage((prev) => Math.min(totalPages, prev + 1));
  }, [totalPages]);

  const setLoading = useCallback((isLoading: boolean, scope?: 'page' | 'all' | null) => {
    setLoadingState(isLoading);
    setLoadingScope(isLoading ? (scope ?? null) : null);
  }, []);

  return {
    pageSize,
    totalPages,
    currentPage,
    pageItems,
    setPageSize,
    goToPrev,
    goToNext,
    loading,
    loadingScope,
    setLoading
  };
};

interface QuotaSectionProps<TState extends QuotaStatusState, TData> {
  config: QuotaConfig<TState, TData>;
  files: AuthFileItem[];
  loading: boolean;
  disabled: boolean;
}

interface QuotaWindowLike {
  id?: string;
  usedPercent?: number | null;
}

export function QuotaSection<TState extends QuotaStatusState, TData>({
  config,
  files,
  loading,
  disabled
}: QuotaSectionProps<TState, TData>) {
  const { t } = useTranslation();
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;
  const { quota, loadQuota } = useQuotaLoader(config);

  /* Removed useRef */
  const [columns, gridRef] = useGridColumns(380); // Min card width 380px matches SCSS
  const [viewMode, setViewMode] = useState<ViewMode>('paged');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showTooManyWarning, setShowTooManyWarning] = useState(false);
  const [bulkAction, setBulkAction] = useState<'disable' | 'delete' | null>(null);

  const baseFiles = useMemo(() => files.filter((file) => config.filterFn(file)), [
    files,
    config
  ]);

  const getAvailabilityState = useCallback(
    (
      file: AuthFileItem,
      quotaEntry?: TState
    ): {
      tone: AvailabilityTone;
      label: string;
      reason: string | null;
      unavailable: boolean;
    } => {
      const statusMessage = getAuthFileStatusMessage(file);
      if (file.disabled) {
        return {
          tone: 'disabled',
          label: t('common.disabled', { defaultValue: '已禁用' }),
          reason: statusMessage || null,
          unavailable: false
        };
      }

      if (file.unavailable === true) {
        return {
          tone: 'error',
          label: t('quota_management.status_unavailable', { defaultValue: '不可用' }),
          reason:
            statusMessage ||
            t('quota_management.unavailable_backend', {
              defaultValue: '后端已标记该账号不可用'
            }),
          unavailable: true
        };
      }

      if (statusMessage) {
        return {
          tone: 'error',
          label: t('quota_management.status_unavailable', { defaultValue: '不可用' }),
          reason: statusMessage,
          unavailable: true
        };
      }

      if (quotaEntry?.status === 'error') {
        return {
          tone: 'error',
          label: t('quota_management.status_unavailable', { defaultValue: '不可用' }),
          reason: quotaEntry.error || t('common.unknown_error'),
          unavailable: true
        };
      }

      if (quotaEntry?.status === 'success') {
        return {
          tone: 'success',
          label: t('quota_management.status_available', { defaultValue: '可用' }),
          reason: null,
          unavailable: false
        };
      }

      if (quotaEntry?.status === 'loading') {
        return {
          tone: 'pending',
          label: t('common.loading', { defaultValue: '检测中' }),
          reason: null,
          unavailable: false
        };
      }

      return {
        tone: 'idle',
        label: t('quota_management.status_unchecked', { defaultValue: '未检测' }),
        reason: null,
        unavailable: false
      };
    },
    [t]
  );

  const unavailableFiles = useMemo(
    () => baseFiles.filter((file) => getAvailabilityState(file, quota[file.name]).unavailable),
    [baseFiles, getAvailabilityState, quota]
  );
  const getWeeklyRemainingPercent = useCallback((quotaEntry?: TState): number | null => {
    if (!quotaEntry || quotaEntry.status !== 'success') return null;

    const windows = (quotaEntry as TState & { windows?: QuotaWindowLike[] }).windows;
    const weeklyWindow = windows?.find((window) => window.id === 'weekly');
    if (!weeklyWindow) return null;

    const usedPercent = weeklyWindow.usedPercent;
    if (typeof usedPercent !== 'number' || Number.isNaN(usedPercent)) return null;

    return Math.max(0, Math.min(100, 100 - usedPercent));
  }, []);
  const weeklyLowFiles = useMemo(
    () =>
      baseFiles.filter((file) => {
        const remainingPercent = getWeeklyRemainingPercent(quota[file.name]);
        return remainingPercent !== null && remainingPercent < 40;
      }),
    [baseFiles, getWeeklyRemainingPercent, quota]
  );
  const disableTargets = useMemo(
    () => unavailableFiles.filter((file) => file.disabled !== true),
    [unavailableFiles]
  );
  const visibleFiles = useMemo(
    () =>
      statusFilter === 'unavailable'
        ? unavailableFiles
        : statusFilter === 'weeklyLow'
          ? weeklyLowFiles
          : baseFiles,
    [baseFiles, statusFilter, unavailableFiles, weeklyLowFiles]
  );
  const weeklyLowRatio = useMemo(() => {
    if (baseFiles.length === 0) return 0;
    return Math.round((weeklyLowFiles.length / baseFiles.length) * 100);
  }, [baseFiles.length, weeklyLowFiles.length]);
  const showAllAllowed = visibleFiles.length <= MAX_SHOW_ALL_THRESHOLD;
  const effectiveViewMode: ViewMode = viewMode === 'all' && !showAllAllowed ? 'paged' : viewMode;

  const {
    pageSize,
    totalPages,
    currentPage,
    pageItems,
    setPageSize,
    goToPrev,
    goToNext,
    loading: sectionLoading,
    setLoading
  } = useQuotaPagination(visibleFiles);

  useEffect(() => {
    if (showAllAllowed) return;
    if (viewMode !== 'all') return;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setViewMode('paged');
      setShowTooManyWarning(true);
    });

    return () => {
      cancelled = true;
    };
  }, [showAllAllowed, viewMode]);

  // Update page size based on view mode and columns
  useEffect(() => {
    if (effectiveViewMode === 'all') {
      setPageSize(Math.max(1, visibleFiles.length));
    } else {
      // Paged mode: 3 rows * columns, capped to avoid oversized pages.
      setPageSize(Math.min(columns * 3, MAX_ITEMS_PER_PAGE));
    }
  }, [effectiveViewMode, columns, visibleFiles.length, setPageSize]);

  const pendingQuotaRefreshRef = useRef(false);
  const prevFilesLoadingRef = useRef(loading);

  const handleRefresh = useCallback(() => {
    pendingQuotaRefreshRef.current = true;
    void triggerHeaderRefresh();
  }, []);

  useEffect(() => {
    const wasLoading = prevFilesLoadingRef.current;
    prevFilesLoadingRef.current = loading;

    if (!pendingQuotaRefreshRef.current) return;
    if (loading) return;
    if (!wasLoading) return;

    pendingQuotaRefreshRef.current = false;
    const scope = effectiveViewMode === 'all' ? 'all' : 'page';
    const targets = effectiveViewMode === 'all' ? visibleFiles : pageItems;
    if (targets.length === 0) return;
    loadQuota(targets, scope, setLoading);
  }, [loading, effectiveViewMode, visibleFiles, pageItems, loadQuota, setLoading]);

  useEffect(() => {
    if (loading) return;
    if (baseFiles.length === 0) {
      setQuota({});
      return;
    }
    setQuota((prev) => {
      const nextState: Record<string, TState> = {};
      baseFiles.forEach((file) => {
        const cached = prev[file.name];
        if (cached) {
          nextState[file.name] = cached;
        }
      });
      return nextState;
    });
  }, [baseFiles, loading, setQuota]);

  const refreshQuotaForFile = useCallback(
    async (file: AuthFileItem) => {
      if (disabled || file.disabled) return;
      if (quota[file.name]?.status === 'loading') return;

      setQuota((prev) => ({
        ...prev,
        [file.name]: config.buildLoadingState()
      }));

      try {
        const data = await config.fetchQuota(file, t);
        setQuota((prev) => ({
          ...prev,
          [file.name]: config.buildSuccessState(data)
        }));
        showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status = getStatusFromError(err);
        setQuota((prev) => ({
          ...prev,
          [file.name]: config.buildErrorState(message, status)
        }));
        showNotification(
          t('auth_files.quota_refresh_failed', { name: file.name, message }),
          'error'
        );
      }
    },
    [config, disabled, quota, setQuota, showNotification, t]
  );

  const handleBulkDisable = useCallback(() => {
    if (disabled || disableTargets.length === 0 || bulkAction) return;

    showConfirmation({
      title: t('quota_management.bulk_disable_title', { defaultValue: '禁用不可用账号' }),
      message: t('quota_management.bulk_disable_message', {
        defaultValue: '将禁用 {{count}} 个不可用账号，是否继续？',
        count: disableTargets.length
      }),
      confirmText: t('quota_management.bulk_disable_confirm', { defaultValue: '确认禁用' }),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        setBulkAction('disable');
        try {
          const results = await Promise.allSettled(
            disableTargets.map((file) => authFilesApi.setStatus(file.name, true))
          );
          const successCount = results.filter((result) => result.status === 'fulfilled').length;
          const failedCount = results.length - successCount;

          await triggerHeaderRefresh();

          showNotification(
            failedCount === 0
              ? t('quota_management.bulk_disable_success', {
                  defaultValue: '已禁用 {{count}} 个不可用账号',
                  count: successCount
                })
              : t('quota_management.bulk_disable_partial', {
                  defaultValue: '已禁用 {{success}} 个账号，另有 {{failed}} 个失败',
                  success: successCount,
                  failed: failedCount
                }),
            failedCount === 0 ? 'success' : 'warning'
          );
        } finally {
          setBulkAction(null);
        }
      }
    });
  }, [bulkAction, disableTargets, disabled, showConfirmation, showNotification, t]);

  const handleBulkDelete = useCallback(() => {
    if (disabled || unavailableFiles.length === 0 || bulkAction) return;

    showConfirmation({
      title: t('quota_management.bulk_delete_title', { defaultValue: '删除不可用账号' }),
      message: t('quota_management.bulk_delete_message', {
        defaultValue: '将删除 {{count}} 个不可用账号文件，是否继续？',
        count: unavailableFiles.length
      }),
      confirmText: t('quota_management.bulk_delete_confirm', { defaultValue: '确认删除' }),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        setBulkAction('delete');
        try {
          const result = await authFilesApi.deleteFiles(unavailableFiles.map((file) => file.name));
          await triggerHeaderRefresh();

          showNotification(
            result.failed.length === 0
              ? t('quota_management.bulk_delete_success', {
                  defaultValue: '已删除 {{count}} 个不可用账号',
                  count: result.deleted
                })
              : t('quota_management.bulk_delete_partial', {
                  defaultValue: '已删除 {{success}} 个账号，另有 {{failed}} 个删除失败',
                  success: result.deleted,
                  failed: result.failed.length
                }),
            result.failed.length === 0 ? 'success' : 'warning'
          );
        } finally {
          setBulkAction(null);
        }
      }
    });
  }, [bulkAction, disabled, showConfirmation, showNotification, t, unavailableFiles]);

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t(`${config.i18nPrefix}.title`)}</span>
      {visibleFiles.length > 0 && (
        <span className={styles.countBadge}>
          {visibleFiles.length}
        </span>
      )}
    </div>
  );

  const isRefreshing = sectionLoading || loading;
  const isBulkBusy = bulkAction !== null;

  return (
    <Card
      title={titleNode}
      extra={
        <div className={styles.headerActions}>
          <div className={styles.statusFilterBar}>
            <div className={styles.viewModeToggle}>
              <Button
                variant="secondary"
                size="sm"
                className={`${styles.viewModeButton} ${
                  statusFilter === 'all' ? styles.viewModeButtonActive : ''
                }`}
                onClick={() => setStatusFilter('all')}
              >
                {t('common.all', { defaultValue: '全部' })}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className={`${styles.viewModeButton} ${
                  statusFilter === 'unavailable' ? styles.viewModeButtonActive : ''
                }`}
                onClick={() => setStatusFilter('unavailable')}
              >
                {t('quota_management.filter_unavailable', {
                  defaultValue: '仅不可用 ({{count}})',
                  count: unavailableFiles.length
                })}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className={`${styles.viewModeButton} ${
                  statusFilter === 'weeklyLow' ? styles.viewModeButtonActive : ''
                }`}
                onClick={() => setStatusFilter('weeklyLow')}
              >
                {t('quota_management.filter_weekly_low', {
                  defaultValue: '周限额<40% ({{count}}/{{total}}, {{ratio}}%)',
                  count: weeklyLowFiles.length,
                  total: baseFiles.length,
                  ratio: weeklyLowRatio
                })}
              </Button>
            </div>
            <span className={styles.bulkSummary}>
              {statusFilter === 'weeklyLow'
                ? t('quota_management.weekly_low_summary', {
                    defaultValue: '周限额低于 40%：{{count}} 个，占全部 {{ratio}}%',
                    count: weeklyLowFiles.length,
                    ratio: weeklyLowRatio
                  })
                : t('quota_management.bulk_summary', {
                    defaultValue: '待删除 {{deleteCount}} 个，待禁用 {{disableCount}} 个',
                    deleteCount: unavailableFiles.length,
                    disableCount: disableTargets.length
                  })}
            </span>
          </div>
          <div className={styles.viewModeToggle}>
            <Button
              variant="secondary"
              size="sm"
              className={`${styles.viewModeButton} ${
                effectiveViewMode === 'paged' ? styles.viewModeButtonActive : ''
              }`}
              onClick={() => setViewMode('paged')}
            >
              {t('auth_files.view_mode_paged')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className={`${styles.viewModeButton} ${
                effectiveViewMode === 'all' ? styles.viewModeButtonActive : ''
              }`}
              onClick={() => {
                if (visibleFiles.length > MAX_SHOW_ALL_THRESHOLD) {
                  setShowTooManyWarning(true);
                } else {
                  setViewMode('all');
                }
              }}
            >
              {t('auth_files.view_mode_all')}
            </Button>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className={styles.bulkActionButton}
            onClick={handleBulkDisable}
            disabled={disabled || disableTargets.length === 0 || isBulkBusy}
            loading={bulkAction === 'disable'}
            title={t('quota_management.bulk_disable_title', { defaultValue: '禁用不可用账号' })}
            aria-label={t('quota_management.bulk_disable_title', { defaultValue: '禁用不可用账号' })}
          >
            {t('quota_management.bulk_disable_with_count', {
              defaultValue: '禁用不可用 ({{count}})',
              count: disableTargets.length
            })}
          </Button>
          <Button
            variant="danger"
            size="sm"
            className={styles.bulkActionButton}
            onClick={handleBulkDelete}
            disabled={disabled || unavailableFiles.length === 0 || isBulkBusy}
            loading={bulkAction === 'delete'}
            title={t('quota_management.bulk_delete_title', { defaultValue: '删除不可用账号' })}
            aria-label={t('quota_management.bulk_delete_title', { defaultValue: '删除不可用账号' })}
          >
            {t('quota_management.bulk_delete_with_count', {
              defaultValue: '删除不可用 ({{count}})',
              count: unavailableFiles.length
            })}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className={styles.refreshAllButton}
            onClick={handleRefresh}
            disabled={disabled || isRefreshing || isBulkBusy}
            loading={isRefreshing}
            title={t('quota_management.refresh_all_credentials')}
            aria-label={t('quota_management.refresh_all_credentials')}
          >
            {!isRefreshing && <IconRefreshCw size={16} />}
            {t('quota_management.refresh_all_credentials')}
          </Button>
        </div>
      }
    >
      {visibleFiles.length === 0 ? (
        <EmptyState
          title={
            statusFilter === 'unavailable'
              ? t('quota_management.empty_unavailable_title', { defaultValue: '没有不可用账号' })
              : statusFilter === 'weeklyLow'
                ? t('quota_management.empty_weekly_low_title', {
                    defaultValue: '没有周限额低于 40% 的账号'
                  })
              : t(`${config.i18nPrefix}.empty_title`)
          }
          description={
            statusFilter === 'unavailable'
              ? t('quota_management.empty_unavailable_desc', {
                  defaultValue: '当前结果里没有需要处理的不可用账号。'
                })
              : statusFilter === 'weeklyLow'
                ? t('quota_management.empty_weekly_low_desc', {
                    defaultValue: '当前结果里没有周剩余额度低于 40% 的账号。'
                  })
              : t(`${config.i18nPrefix}.empty_desc`)
          }
        />
      ) : (
        <>
          <div ref={gridRef} className={config.gridClassName}>
            {pageItems.map((item) => (
              <QuotaCard
                key={item.name}
                item={item}
                quota={quota[item.name]}
                resolvedTheme={resolvedTheme}
                i18nPrefix={config.i18nPrefix}
                cardIdleMessageKey={config.cardIdleMessageKey}
                cardClassName={config.cardClassName}
                defaultType={config.type}
                canRefresh={!disabled && !item.disabled}
                onRefresh={() => void refreshQuotaForFile(item)}
                availabilityLabel={getAvailabilityState(item, quota[item.name]).label}
                availabilityReason={getAvailabilityState(item, quota[item.name]).reason}
                availabilityTone={getAvailabilityState(item, quota[item.name]).tone}
                renderQuotaItems={config.renderQuotaItems}
              />
            ))}
          </div>
          {visibleFiles.length > pageSize && effectiveViewMode === 'paged' && (
            <div className={styles.pagination}>
              <Button
                variant="secondary"
                size="sm"
                onClick={goToPrev}
                disabled={currentPage <= 1}
              >
                {t('auth_files.pagination_prev')}
              </Button>
              <div className={styles.pageInfo}>
                {t('auth_files.pagination_info', {
                  current: currentPage,
                  total: totalPages,
                  count: visibleFiles.length
                })}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={goToNext}
                disabled={currentPage >= totalPages}
              >
                {t('auth_files.pagination_next')}
              </Button>
            </div>
          )}
        </>
      )}
      {showTooManyWarning && (
        <div className={styles.warningOverlay} onClick={() => setShowTooManyWarning(false)}>
          <div className={styles.warningModal} onClick={(e) => e.stopPropagation()}>
            <p>{t('auth_files.too_many_files_warning')}</p>
            <Button variant="primary" size="sm" onClick={() => setShowTooManyWarning(false)}>
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
