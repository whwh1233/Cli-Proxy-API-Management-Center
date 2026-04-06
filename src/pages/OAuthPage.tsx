import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useNotificationStore, useThemeStore } from '@/stores';
import { oauthApi, type OAuthProvider } from '@/services/api/oauth';
// vertex API removed — only Codex OAuth remains
import { copyToClipboard } from '@/utils/clipboard';
import styles from './OAuthPage.module.scss';
import iconCodex from '@/assets/icons/codex.svg';

interface ProviderState {
  url?: string;
  state?: string;
  status?: 'idle' | 'waiting' | 'success' | 'error';
  error?: string;
  polling?: boolean;
  projectId?: string;
  projectIdError?: string;
  callbackUrl?: string;
  callbackSubmitting?: boolean;
  callbackStatus?: 'success' | 'error';
  callbackError?: string;
}

function getErrorStatus(error: unknown): number | undefined {
  if (error !== null && typeof error === 'object' && 'status' in error && typeof (error as Record<string, unknown>).status === 'number')
    return (error as Record<string, number>).status;
  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error !== null && typeof error === 'object' && 'message' in error && typeof (error as Record<string, unknown>).message === 'string')
    return (error as Record<string, string>).message;
  return typeof error === 'string' ? error : '';
}

const PROVIDERS: { id: OAuthProvider; titleKey: string; hintKey: string; urlLabelKey: string; icon: string | { light: string; dark: string } }[] = [
  { id: 'codex', titleKey: 'auth_login.codex_oauth_title', hintKey: 'auth_login.codex_oauth_hint', urlLabelKey: 'auth_login.codex_oauth_url_label', icon: iconCodex },
];

const CALLBACK_SUPPORTED: OAuthProvider[] = ['codex', 'anthropic', 'antigravity', 'gemini-cli'];
const getProviderI18nPrefix = (provider: OAuthProvider) => provider.replace('-', '_');
const getAuthKey = (provider: OAuthProvider, suffix: string) =>
  `auth_login.${getProviderI18nPrefix(provider)}_${suffix}`;

const getIcon = (icon: string | { light: string; dark: string }, theme: 'light' | 'dark') => {
  return typeof icon === 'string' ? icon : icon[theme];
};

export function OAuthPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const [states, setStates] = useState<Record<OAuthProvider, ProviderState>>({} as Record<OAuthProvider, ProviderState>);
  const timers = useRef<Record<string, number>>({});

  const clearTimers = useCallback(() => {
    Object.values(timers.current).forEach((timer) => window.clearInterval(timer));
    timers.current = {};
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  const updateProviderState = (provider: OAuthProvider, next: Partial<ProviderState>) => {
    setStates((prev) => ({
      ...prev,
      [provider]: { ...(prev[provider] ?? {}), ...next }
    }));
  };

  const startPolling = (provider: OAuthProvider, state: string) => {
    if (timers.current[provider]) {
      clearInterval(timers.current[provider]);
    }
    const timer = window.setInterval(async () => {
      try {
        const res = await oauthApi.getAuthStatus(state);
        if (res.status === 'ok') {
          updateProviderState(provider, { status: 'success', polling: false });
          showNotification(t(getAuthKey(provider, 'oauth_status_success')), 'success');
          window.clearInterval(timer);
          delete timers.current[provider];
        } else if (res.status === 'error') {
          updateProviderState(provider, { status: 'error', error: res.error, polling: false });
          showNotification(
            `${t(getAuthKey(provider, 'oauth_status_error'))} ${res.error || ''}`,
            'error'
          );
          window.clearInterval(timer);
          delete timers.current[provider];
        }
      } catch (err: unknown) {
        updateProviderState(provider, { status: 'error', error: getErrorMessage(err), polling: false });
        window.clearInterval(timer);
        delete timers.current[provider];
      }
    }, 3000);
    timers.current[provider] = timer;
  };

  const startAuth = async (provider: OAuthProvider) => {
    const geminiState = provider === 'gemini-cli' ? states[provider] : undefined;
    const rawProjectId = provider === 'gemini-cli' ? (geminiState?.projectId || '').trim() : '';
    const projectId = rawProjectId
      ? rawProjectId.toUpperCase() === 'ALL'
        ? 'ALL'
        : rawProjectId
      : undefined;
    // 项目 ID 可选：留空自动选择第一个可用项目；输入 ALL 获取全部项目
    if (provider === 'gemini-cli') {
      updateProviderState(provider, { projectIdError: undefined });
    }
    updateProviderState(provider, {
      status: 'waiting',
      polling: true,
      error: undefined,
      callbackStatus: undefined,
      callbackError: undefined,
      callbackUrl: ''
    });
    try {
      const res = await oauthApi.startAuth(
        provider,
        provider === 'gemini-cli' ? { projectId: projectId || undefined } : undefined
      );
      updateProviderState(provider, { url: res.url, state: res.state, status: 'waiting', polling: true });
      if (res.state) {
        startPolling(provider, res.state);
      }
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      updateProviderState(provider, { status: 'error', error: message, polling: false });
      showNotification(
        `${t(getAuthKey(provider, 'oauth_start_error'))}${message ? ` ${message}` : ''}`,
        'error'
      );
    }
  };

  const copyLink = async (url?: string) => {
    if (!url) return;
    const copied = await copyToClipboard(url);
    showNotification(
      t(copied ? 'notification.link_copied' : 'notification.copy_failed'),
      copied ? 'success' : 'error'
    );
  };

  const submitCallback = async (provider: OAuthProvider) => {
    const redirectUrl = (states[provider]?.callbackUrl || '').trim();
    if (!redirectUrl) {
      showNotification(t('auth_login.oauth_callback_required'), 'warning');
      return;
    }
    updateProviderState(provider, {
      callbackSubmitting: true,
      callbackStatus: undefined,
      callbackError: undefined
    });
    try {
      await oauthApi.submitCallback(provider, redirectUrl);
      updateProviderState(provider, { callbackSubmitting: false, callbackStatus: 'success' });
      showNotification(t('auth_login.oauth_callback_success'), 'success');
    } catch (err: unknown) {
      const status = getErrorStatus(err);
      const message = getErrorMessage(err);
      const errorMessage =
        status === 404
          ? t('auth_login.oauth_callback_upgrade_hint', {
              defaultValue: 'Please update CLI Proxy API or check the connection.'
            })
          : message || undefined;
      updateProviderState(provider, {
        callbackSubmitting: false,
        callbackStatus: 'error',
        callbackError: errorMessage
      });
      const notificationMessage = errorMessage
        ? `${t('auth_login.oauth_callback_error')} ${errorMessage}`
        : t('auth_login.oauth_callback_error');
      showNotification(notificationMessage, 'error');
    }
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('nav.oauth', { defaultValue: 'OAuth' })}</h1>

      <div className={styles.content}>
        {PROVIDERS.map((provider) => {
          const state = states[provider.id] || {};
          const canSubmitCallback = CALLBACK_SUPPORTED.includes(provider.id) && Boolean(state.url);
          return (
            <div key={provider.id}>
              <Card
                title={
                  <span className={styles.cardTitle}>
                    <img
                      src={getIcon(provider.icon, resolvedTheme)}
                      alt=""
                      className={styles.cardTitleIcon}
                    />
                    {t(provider.titleKey)}
                  </span>
                }
                extra={
                  <Button onClick={() => startAuth(provider.id)} loading={state.polling}>
                    {t('common.login')}
                  </Button>
                }
              >
                <div className={styles.cardContent}>
                  <div className={styles.cardHint}>{t(provider.hintKey)}</div>
                  {provider.id === 'gemini-cli' && (
                    <div className={styles.geminiProjectField}>
                      <Input
                        label={t('auth_login.gemini_cli_project_id_label')}
                        hint={t('auth_login.gemini_cli_project_id_hint')}
                        value={state.projectId || ''}
                        error={state.projectIdError}
                        disabled={Boolean(state.polling)}
                        onChange={(e) =>
                          updateProviderState(provider.id, {
                            projectId: e.target.value,
                            projectIdError: undefined
                          })
                        }
                        placeholder={t('auth_login.gemini_cli_project_id_placeholder')}
                      />
                    </div>
                  )}
                  {state.url && (
                    <div className={styles.authUrlBox}>
                      <div className={styles.authUrlLabel}>{t(provider.urlLabelKey)}</div>
                      <div className={styles.authUrlValue}>{state.url}</div>
                      <div className={styles.authUrlActions}>
                        <Button variant="secondary" size="sm" onClick={() => copyLink(state.url!)}>
                          {t(getAuthKey(provider.id, 'copy_link'))}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => window.open(state.url, '_blank', 'noopener,noreferrer')}
                        >
                          {t(getAuthKey(provider.id, 'open_link'))}
                        </Button>
                      </div>
                    </div>
                  )}
                  {canSubmitCallback && (
                    <div className={styles.callbackSection}>
                      <Input
                        label={t('auth_login.oauth_callback_label')}
                        hint={t('auth_login.oauth_callback_hint')}
                        value={state.callbackUrl || ''}
                        onChange={(e) =>
                          updateProviderState(provider.id, {
                            callbackUrl: e.target.value,
                            callbackStatus: undefined,
                            callbackError: undefined
                          })
                        }
                        placeholder={t('auth_login.oauth_callback_placeholder')}
                      />
                      <div className={styles.callbackActions}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => submitCallback(provider.id)}
                          loading={state.callbackSubmitting}
                        >
                          {t('auth_login.oauth_callback_button')}
                        </Button>
                      </div>
                      {state.callbackStatus === 'success' && state.status === 'waiting' && (
                        <div className="status-badge success">
                          {t('auth_login.oauth_callback_status_success')}
                        </div>
                      )}
                      {state.callbackStatus === 'error' && (
                        <div className="status-badge error">
                          {t('auth_login.oauth_callback_status_error')} {state.callbackError || ''}
                        </div>
                      )}
                    </div>
                  )}
                  {state.status && state.status !== 'idle' && (
                    <div className="status-badge">
                      {state.status === 'success'
                        ? t(getAuthKey(provider.id, 'oauth_status_success'))
                        : state.status === 'error'
                          ? `${t(getAuthKey(provider.id, 'oauth_status_error'))} ${state.error || ''}`
                          : t(getAuthKey(provider.id, 'oauth_status_waiting'))}
                    </div>
                  )}
                </div>
              </Card>
            </div>
          );
        })}

      </div>
    </div>
  );
}
