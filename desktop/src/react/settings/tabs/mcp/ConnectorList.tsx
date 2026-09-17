import React from 'react';
import { t } from '../../helpers';
import styles from '../../Settings.module.css';
import type { McpAgentConnectorConfig, McpConnector } from './types';

interface ConnectorListProps {
  connectors: McpConnector[];
  globalEnabled: boolean;
  loading?: boolean;
  /**
   * Every in-flight mutation key. A set rather than a single value, so two
   * connectors can be busy at once without one disabling the other's controls.
   */
  busyKeys: ReadonlySet<string>;
  agentConfig: {
    connectors?: Record<string, McpAgentConnectorConfig>;
    servers?: Record<string, McpAgentConnectorConfig>;
  };
  onOpen: (connectorId: string) => void;
  onAction: (connectorId: string, action: 'start' | 'stop') => void;
  onRemove: (connectorId: string) => void;
}

export function ConnectorList({
  connectors,
  globalEnabled,
  loading = false,
  busyKeys,
  agentConfig,
  onOpen,
  onAction,
  onRemove,
}: ConnectorListProps) {
  if (loading) {
    return <p className={styles['settings-muted-note']}>{t('status.loading')}</p>;
  }

  if (connectors.length === 0) {
    return <p className={styles['settings-muted-note']}>{t('settings.mcp.noConnectors')}</p>;
  }

  return (
    <div className={styles['skills-list-block']}>
      {connectors.map(connector => {
        const busy = (key: string) => busyKeys.has(`${key}-${connector.id}`);
        const enabledAgents = countEnabledAgents(agentConfig, connector.id);
        return (
          <div key={connector.id} className={`${styles['skills-list-item']} ${styles['mcp-list-item']}`}>
            {/* The whole summary is the way into the detail view; the action
                buttons beside it stop the click from bubbling here. */}
            <div
              className={styles['skills-list-info']}
              role="button"
              tabIndex={0}
              data-testid={`mcp-connector-row-${connector.id}`}
              onClick={() => onOpen(connector.id)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                onOpen(connector.id);
              }}
            >
              <div className={styles['skills-list-name']}>
                <span
                  className={`${styles['pv-status-dot']}${connector.status === 'running' ? ' ' + styles['on'] : ''}`}
                  aria-hidden="true"
                />
                {connector.name}
                <span className={styles['skills-list-name-hint']}>{statusLabel(connector)}</span>
              </div>
              <div className={styles['skills-list-desc']}>{connectorTarget(connector)}</div>
              <div className={styles['settings-muted-note']}>
                {transportLabel(connector.transport)}
                {' · '}
                {authLabel(connector)}
                {' · '}
                {connector.tools.length} {t('settings.mcp.toolsCount')}
                {' · '}
                {enabledAgents} {t('settings.mcp.enabledAgentsCount')}
              </div>
              {/* A connector that failed used to read only "failed". The reason
                  the runtime recorded is the whole point of looking here. */}
              {connector.error && (
                <div className={styles['settings-inline-error']} data-testid={`mcp-connector-error-${connector.id}`}>
                  {connector.error}
                </div>
              )}
            </div>
            <div className={`${styles['skills-list-actions']} ${styles['mcp-list-actions']}`}>
              {canStart(connector.status) ? (
                <button
                  className={styles['pv-add-form-btn']}
                  type="button"
                  disabled={!globalEnabled || busy('start')}
                  onClick={() => onAction(connector.id, 'start')}
                >
                  {t('settings.mcp.start')}
                </button>
              ) : (
                <button
                  className={styles['pv-add-form-btn']}
                  type="button"
                  disabled={busy('stop') || !canStop(connector.status)}
                  onClick={() => onAction(connector.id, 'stop')}
                >
                  {t('settings.mcp.stop')}
                </button>
              )}
              <button
                className={styles['pv-add-form-btn']}
                type="button"
                onClick={() => onOpen(connector.id)}
              >
                {t('settings.mcp.manage')}
              </button>
              {/* Removal sits apart from the reversible actions and carries the
                  danger styling, so it cannot be hit while aiming for stop. */}
              <span className={styles['mcp-list-danger-slot']}>
                <button
                  className={`${styles['pv-add-form-btn']} ${styles['danger']}`}
                  type="button"
                  disabled={busy('remove')}
                  onClick={() => onRemove(connector.id)}
                >
                  {t('common.remove')}
                </button>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function countEnabledAgents(
  agentConfig: ConnectorListProps['agentConfig'],
  connectorId: string,
): number {
  // The tab loads one agent's config at a time, so this counts whether the
  // agent currently in view has the connector on.
  const config = agentConfig.connectors?.[connectorId] || agentConfig.servers?.[connectorId];
  return config?.enabled === true ? 1 : 0;
}

function connectorTarget(connector: McpConnector): string {
  if (connector.transport === 'stdio') {
    return [connector.command, ...(connector.args || [])].filter(Boolean).join(' ');
  }
  return connector.url || connector.id;
}

function statusLabel(connector: McpConnector): string {
  switch (connector.status) {
    case 'running':
      return t('settings.mcp.statusRunning');
    case 'connecting':
      return t('settings.mcp.statusConnecting');
    case 'reconnecting':
      return t('settings.mcp.statusReconnecting');
    case 'failed':
      return t('settings.mcp.statusFailed');
    case 'needs-auth':
      return t('settings.mcp.statusNeedsAuth');
    case 'stopped':
    default:
      return t('settings.mcp.statusStopped');
  }
}

// Start is offered whenever the connector is not already live or actively
// trying to connect — including failed/needs-auth, so the user can retry.
function canStart(status: McpConnector['status']): boolean {
  return status === 'stopped' || status === 'failed' || status === 'needs-auth';
}

// Stop is offered whenever there is something to tear down: a live session, an
// in-flight connect, or a reconnect/needs-auth loop the user may want to halt.
function canStop(status: McpConnector['status']): boolean {
  return status === 'running'
    || status === 'connecting'
    || status === 'reconnecting'
    || status === 'needs-auth';
}

function transportLabel(transport: string): string {
  if (transport === 'stdio') return t('settings.mcp.modeLocal');
  if (transport === 'streamable-http') return t('settings.mcp.transportStreamable');
  if (transport === 'sse') return t('settings.mcp.transportSse');
  return t('settings.mcp.transportAuto');
}

function authLabel(connector: McpConnector): string {
  if (connector.authType === 'bearer') return t('settings.mcp.authBearer');
  if (connector.authType === 'oauth') {
    return connector.authStatus === 'connected'
      ? t('settings.mcp.oauthConnected')
      : t('settings.mcp.oauthDisconnected');
  }
  return t('settings.mcp.authNone');
}
