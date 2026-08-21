import React, { useEffect, useState } from 'react';
import type { BridgeHttpUrl } from './bridgeApi';
import {
  TerminalConnection,
  getConnectionsForTerminal,
  setConnectionPriority,
  setConnectionNickname,
} from './connectionManager';

interface Props {
  terminalId: string;
  httpUrl?: BridgeHttpUrl;
  onConnectionsChange?: (connections: TerminalConnection[]) => void;
}

export default function ConnectionConflictCard({ terminalId, httpUrl, onConnectionsChange }: Props) {
  const [connections, setConnections] = useState<TerminalConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingNickname, setEditingNickname] = useState<string | null>(null);
  const [newNickname, setNewNickname] = useState('');

  useEffect(() => {
    if (!httpUrl) return;
    loadConnections();
    const interval = setInterval(loadConnections, 2000);
    return () => clearInterval(interval);
  }, [terminalId, httpUrl]);

  async function loadConnections() {
    if (!httpUrl) return;
    try {
      const conns = await getConnectionsForTerminal(httpUrl, terminalId);
      setConnections(conns.sort((a, b) => b.priority - a.priority));
      onConnectionsChange?.(conns);
    } catch (e) {
      console.debug('Failed to load connections:', e);
    }
  }

  async function handlePriorityChange(clientId: string, newPriority: number) {
    if (!httpUrl) return;
    try {
      setLoading(true);
      await setConnectionPriority(httpUrl, terminalId, clientId, newPriority);
      await loadConnections();
    } catch (e) {
      console.error('Failed to set priority:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleNicknameChange(clientId: string, nickname: string) {
    if (!httpUrl) return;
    try {
      setLoading(true);
      await setConnectionNickname(httpUrl, terminalId, clientId, nickname);
      await loadConnections();
      setEditingNickname(null);
      setNewNickname('');
    } catch (e) {
      console.error('Failed to set nickname:', e);
    } finally {
      setLoading(false);
    }
  }

  if (connections.length === 0) {
    return null;
  }

  if (connections.length === 1) {
    const conn = connections[0];
    return (
      <div className="connection-card single">
        <div className="connection-header">
          <span className="connection-badge">✓ Connected</span>
          <code className="connection-id">{conn.nickname}</code>
        </div>
      </div>
    );
  }

  return (
    <div className="connection-card conflict">
      <div className="connection-header">
        <span className="connection-badge conflict">⚠ Multiple Connections</span>
      </div>
      <div className="connection-list">
        {connections.map((conn, idx) => (
          <div key={conn.client_id} className="connection-item">
            <div className="connection-details">
              <div className="connection-nickname">
                {editingNickname === conn.client_id ? (
                  <input
                    autoFocus
                    value={newNickname}
                    onChange={(e) => setNewNickname(e.target.value)}
                    onBlur={() => {
                      if (newNickname && newNickname !== conn.nickname) {
                        handleNicknameChange(conn.client_id, newNickname);
                      } else {
                        setEditingNickname(null);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        if (newNickname && newNickname !== conn.nickname) {
                          handleNicknameChange(conn.client_id, newNickname);
                        }
                      } else if (e.key === 'Escape') {
                        setEditingNickname(null);
                      }}
                    }
                    className="nickname-input"
                  />
                ) : (
                  <span
                    onClick={() => {
                      setEditingNickname(conn.client_id);
                      setNewNickname(conn.nickname);
                    }}
                    className="nickname-text editable"
                    title="Click to edit"
                  >
                    {conn.nickname}
                  </span>
                )}
              </div>
              <div className="connection-meta">
                <span className="connection-priority">Priority: {conn.priority}</span>
                <span className="connection-time">
                  {idx === 0 && '(Active)'}
                </span>
              </div>
            </div>
            <div className="connection-controls">
              <button
                onClick={() => handlePriorityChange(conn.client_id, conn.priority + 1)}
                disabled={loading}
                title="Increase priority"
                className="priority-btn"
              >
                ↑
              </button>
              <button
                onClick={() => handlePriorityChange(conn.client_id, Math.max(0, conn.priority - 1))}
                disabled={loading}
                title="Decrease priority"
                className="priority-btn"
              >
                ↓
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="connection-info">
        <small>
          {connections.length} clients connected. Highest priority ({connections[0]?.priority ?? 0}) is active.
        </small>
      </div>
    </div>
  );
}
