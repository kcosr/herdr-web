use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use herdr_compat::api::schema::{AgentStatus, PaneInfo};
use serde::Serialize;

use crate::store_util::session_key;

const STARTUP_ACTIVITY_BASELINE_GRACE_MS: u128 = 1_000;

pub struct AgentActivityManager {
    session_key: String,
    tracker: Mutex<AgentActivityTracker>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentActivityListResponse {
    pub session_key: String,
    pub records: Vec<AgentActivityRecordResponse>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentActivityRecordResponse {
    pub pane_id: String,
    pub terminal_id: String,
    pub workspace_id: String,
    pub tab_id: String,
    pub agent_status: AgentStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_status_transition_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct PaneKey {
    pane_id: String,
    terminal_id: String,
}

#[derive(Debug, Clone)]
struct PaneIdentity {
    key: PaneKey,
}

#[derive(Debug, Clone)]
struct AgentActivityRecord {
    pane_id: String,
    terminal_id: String,
    workspace_id: String,
    tab_id: String,
    agent_status: AgentStatus,
    last_status_transition_at: Option<u128>,
    last_seen_at: u128,
}

#[derive(Debug, Default)]
struct AgentActivityTracker {
    records: HashMap<PaneKey, AgentActivityRecord>,
    pane_index: HashMap<String, PaneIdentity>,
    startup_baseline_until_ms: Option<u128>,
}

impl AgentActivityManager {
    pub fn new() -> Self {
        Self {
            session_key: session_key(),
            tracker: Mutex::new(AgentActivityTracker::default()),
        }
    }

    pub fn observe_snapshot(&self, panes: &[PaneInfo]) -> bool {
        self.tracker
            .lock()
            .expect("agent activity tracker lock poisoned")
            .observe_snapshot(panes, now_ms())
    }

    pub fn observe_status_event(&self, pane_id: &str, agent_status: AgentStatus) -> bool {
        self.tracker
            .lock()
            .expect("agent activity tracker lock poisoned")
            .observe_status_event(pane_id, agent_status, now_ms())
    }

    pub fn list(&self, panes: &[PaneInfo]) -> AgentActivityListResponse {
        let records = self
            .tracker
            .lock()
            .expect("agent activity tracker lock poisoned")
            .list(panes);
        AgentActivityListResponse {
            session_key: self.session_key.clone(),
            records,
        }
    }
}

impl AgentActivityTracker {
    fn observe_snapshot(&mut self, panes: &[PaneInfo], now: u128) -> bool {
        if panes.is_empty() {
            return false;
        }
        if self.startup_baseline_until_ms.is_none() {
            self.startup_baseline_until_ms = Some(now + STARTUP_ACTIVITY_BASELINE_GRACE_MS);
        }
        let in_startup_baseline = self
            .startup_baseline_until_ms
            .is_some_and(|baseline_until| now <= baseline_until);
        self.pane_index = pane_index(panes);

        let mut changed = false;
        let mut open_keys = HashSet::new();
        for pane in panes {
            let key = pane_key(pane);
            open_keys.insert(key.clone());
            let already_tracked = self.records.contains_key(&key);
            if !already_tracked && !is_agent_like(pane) {
                continue;
            }
            match self.records.get_mut(&key) {
                Some(record) => {
                    record.workspace_id = pane.workspace_id.clone();
                    record.tab_id = pane.tab_id.clone();
                    record.last_seen_at = now;
                    if record.agent_status != pane.agent_status {
                        record.agent_status = pane.agent_status;
                        record.last_status_transition_at = Some(now);
                        changed = true;
                    }
                }
                None => {
                    let last_status_transition_at = (!in_startup_baseline
                        && pane.agent_status != AgentStatus::Unknown)
                        .then_some(now);
                    if last_status_transition_at.is_some() {
                        changed = true;
                    }
                    self.records.insert(
                        key,
                        AgentActivityRecord {
                            pane_id: pane.pane_id.clone(),
                            terminal_id: pane.terminal_id.clone(),
                            workspace_id: pane.workspace_id.clone(),
                            tab_id: pane.tab_id.clone(),
                            agent_status: pane.agent_status,
                            last_status_transition_at,
                            last_seen_at: now,
                        },
                    );
                }
            }
        }

        self.records.retain(|_, record| {
            let keep = open_keys.contains(&PaneKey {
                pane_id: record.pane_id.clone(),
                terminal_id: record.terminal_id.clone(),
            });
            if !keep && record.last_status_transition_at.is_some() {
                changed = true;
            }
            keep
        });
        changed
    }

    fn observe_status_event(
        &mut self,
        pane_id: &str,
        agent_status: AgentStatus,
        now: u128,
    ) -> bool {
        let Some(identity) = self.pane_index.get(pane_id).cloned() else {
            return false;
        };
        match self.records.get_mut(&identity.key) {
            Some(record) => {
                record.last_seen_at = now;
                if record.agent_status == agent_status {
                    return false;
                }
                record.agent_status = agent_status;
                record.last_status_transition_at = Some(now);
                true
            }
            None => {
                if agent_status == AgentStatus::Unknown {
                    return false;
                }
                let key = identity.key;
                let terminal_id = key.terminal_id.clone();
                self.records.insert(
                    key,
                    AgentActivityRecord {
                        pane_id: pane_id.to_string(),
                        terminal_id,
                        workspace_id: String::new(),
                        tab_id: String::new(),
                        agent_status,
                        last_status_transition_at: Some(now),
                        last_seen_at: now,
                    },
                );
                true
            }
        }
    }

    fn list(&self, panes: &[PaneInfo]) -> Vec<AgentActivityRecordResponse> {
        let mut records = panes
            .iter()
            .filter_map(|pane| {
                let record = self.records.get(&pane_key(pane))?;
                Some(AgentActivityRecordResponse {
                    pane_id: pane.pane_id.clone(),
                    terminal_id: pane.terminal_id.clone(),
                    workspace_id: pane.workspace_id.clone(),
                    tab_id: pane.tab_id.clone(),
                    agent_status: record.agent_status,
                    last_status_transition_at: record.last_status_transition_at.map(ms_string),
                })
            })
            .collect::<Vec<_>>();
        records.sort_by(|a, b| {
            a.pane_id
                .cmp(&b.pane_id)
                .then_with(|| a.terminal_id.cmp(&b.terminal_id))
        });
        records
    }
}

fn pane_index(panes: &[PaneInfo]) -> HashMap<String, PaneIdentity> {
    panes
        .iter()
        .map(|pane| {
            (
                pane.pane_id.clone(),
                PaneIdentity {
                    key: pane_key(pane),
                },
            )
        })
        .collect()
}

fn pane_key(pane: &PaneInfo) -> PaneKey {
    PaneKey {
        pane_id: pane.pane_id.clone(),
        terminal_id: pane.terminal_id.clone(),
    }
}

fn is_agent_like(pane: &PaneInfo) -> bool {
    pane.agent.is_some()
        || pane.display_agent.is_some()
        || pane.title.is_some()
        || pane.agent_status != AgentStatus::Unknown
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn ms_string(value: u128) -> String {
    value.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn empty_first_snapshot_does_not_establish_baseline() {
        let mut tracker = AgentActivityTracker::default();

        assert!(!tracker.observe_snapshot(&[], 100));
        assert!(!tracker.observe_snapshot(&[agent_pane("pane-1", AgentStatus::Working)], 200));

        let records = tracker.list(&[agent_pane("pane-1", AgentStatus::Working)]);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].last_status_transition_at, None);
    }

    #[test]
    fn new_active_pane_after_baseline_gets_transition_timestamp() {
        let mut tracker = AgentActivityTracker::default();
        assert!(!tracker.observe_snapshot(&[agent_pane("pane-1", AgentStatus::Idle)], 100));

        assert!(tracker.observe_snapshot(
            &[
                agent_pane("pane-1", AgentStatus::Idle),
                agent_pane("pane-2", AgentStatus::Working),
            ],
            1_200,
        ));

        let records = tracker.list(&[
            agent_pane("pane-1", AgentStatus::Idle),
            agent_pane("pane-2", AgentStatus::Working),
        ]);
        let pane_two = records
            .iter()
            .find(|record| record.pane_id == "pane-2")
            .unwrap();
        assert_eq!(pane_two.last_status_transition_at.as_deref(), Some("1200"));
    }

    #[test]
    fn panes_observed_during_startup_grace_seed_without_timestamp() {
        let mut tracker = AgentActivityTracker::default();
        assert!(!tracker.observe_snapshot(&[agent_pane("pane-1", AgentStatus::Idle)], 100));

        assert!(!tracker.observe_snapshot(
            &[
                agent_pane("pane-1", AgentStatus::Idle),
                agent_pane("pane-2", AgentStatus::Working),
            ],
            500,
        ));

        let records = tracker.list(&[
            agent_pane("pane-1", AgentStatus::Idle),
            agent_pane("pane-2", AgentStatus::Working),
        ]);
        assert!(records
            .iter()
            .all(|record| record.last_status_transition_at.is_none()));
    }

    #[test]
    fn status_transition_updates_timestamp_once() {
        let mut tracker = AgentActivityTracker::default();
        tracker.observe_snapshot(&[agent_pane("pane-1", AgentStatus::Idle)], 100);

        assert!(tracker.observe_status_event("pane-1", AgentStatus::Working, 200));
        assert!(!tracker.observe_status_event("pane-1", AgentStatus::Working, 300));

        let records = tracker.list(&[agent_pane("pane-1", AgentStatus::Working)]);
        assert_eq!(records[0].last_status_transition_at.as_deref(), Some("200"));
    }

    #[test]
    fn snapshot_reconciliation_detects_missed_status_transition() {
        let mut tracker = AgentActivityTracker::default();
        tracker.observe_snapshot(&[agent_pane("pane-1", AgentStatus::Idle)], 100);

        assert!(tracker.observe_snapshot(&[agent_pane("pane-1", AgentStatus::Blocked)], 200));

        let records = tracker.list(&[agent_pane("pane-1", AgentStatus::Blocked)]);
        assert_eq!(records[0].last_status_transition_at.as_deref(), Some("200"));
    }

    #[test]
    fn ordinary_unknown_panes_are_not_tracked() {
        let mut tracker = AgentActivityTracker::default();

        assert!(!tracker.observe_snapshot(&[ordinary_pane("pane-1")], 100));

        assert!(tracker.list(&[ordinary_pane("pane-1")]).is_empty());
    }

    #[test]
    fn tracked_pane_transitioning_to_unknown_remains_visible() {
        let mut tracker = AgentActivityTracker::default();
        tracker.observe_snapshot(&[agent_pane("pane-1", AgentStatus::Working)], 100);

        assert!(tracker.observe_status_event("pane-1", AgentStatus::Unknown, 1_200));

        let mut pane = ordinary_pane("pane-1");
        pane.agent_status = AgentStatus::Unknown;
        let records = tracker.list(&[pane]);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].agent_status, AgentStatus::Unknown);
        assert_eq!(
            records[0].last_status_transition_at.as_deref(),
            Some("1200")
        );
    }

    #[test]
    fn pane_moves_update_location_without_transition() {
        let mut tracker = AgentActivityTracker::default();
        tracker.observe_snapshot(&[agent_pane("pane-1", AgentStatus::Idle)], 100);
        let mut moved = agent_pane("pane-1", AgentStatus::Idle);
        moved.workspace_id = "workspace-b".to_string();
        moved.tab_id = "tab-b".to_string();

        assert!(!tracker.observe_snapshot(&[moved.clone()], 200));

        let records = tracker.list(&[moved]);
        assert_eq!(records[0].workspace_id, "workspace-b");
        assert_eq!(records[0].tab_id, "tab-b");
        assert_eq!(records[0].last_status_transition_at, None);
    }

    #[test]
    fn transient_empty_snapshot_preserves_records() {
        let mut tracker = AgentActivityTracker::default();
        tracker.observe_snapshot(&[agent_pane("pane-1", AgentStatus::Idle)], 100);
        assert!(tracker.observe_status_event("pane-1", AgentStatus::Working, 1_200));

        assert!(!tracker.observe_snapshot(&[], 1_300));
        assert!(!tracker.observe_snapshot(&[agent_pane("pane-1", AgentStatus::Working)], 1_400));

        let records = tracker.list(&[agent_pane("pane-1", AgentStatus::Working)]);
        assert_eq!(records.len(), 1);
        assert_eq!(
            records[0].last_status_transition_at.as_deref(),
            Some("1200")
        );
    }

    #[test]
    fn reused_pane_id_does_not_inherit_terminal_activity() {
        let mut tracker = AgentActivityTracker::default();
        tracker.observe_snapshot(&[agent_pane("pane-1", AgentStatus::Idle)], 100);
        tracker.observe_status_event("pane-1", AgentStatus::Working, 200);
        let mut replacement = agent_pane("pane-1", AgentStatus::Working);
        replacement.terminal_id = "terminal-new".to_string();

        assert!(tracker.observe_snapshot(&[replacement.clone()], 1_500));

        let records = tracker.list(&[replacement]);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].terminal_id, "terminal-new");
        assert_eq!(
            records[0].last_status_transition_at.as_deref(),
            Some("1500")
        );
    }

    #[test]
    fn many_open_panes_are_not_rotated_or_restamped() {
        let mut tracker = AgentActivityTracker::default();
        let panes = (0..150)
            .map(|index| agent_pane(&format!("pane-{index:03}"), AgentStatus::Working))
            .collect::<Vec<_>>();

        assert!(!tracker.observe_snapshot(&panes, 100));
        assert!(!tracker.observe_snapshot(&panes, 1_500));

        let records = tracker.list(&panes);
        assert_eq!(records.len(), 150);
        assert!(records
            .iter()
            .all(|record| record.last_status_transition_at.is_none()));
    }

    fn agent_pane(pane_id: &str, status: AgentStatus) -> PaneInfo {
        let mut pane = pane_in_location(
            pane_id,
            &format!("terminal-{pane_id}"),
            "workspace-a",
            "tab-a",
        );
        pane.agent = Some("codex".to_string());
        pane.display_agent = Some("Codex".to_string());
        pane.agent_status = status;
        pane
    }

    fn ordinary_pane(pane_id: &str) -> PaneInfo {
        pane_in_location(
            pane_id,
            &format!("terminal-{pane_id}"),
            "workspace-a",
            "tab-a",
        )
    }

    fn pane_in_location(
        pane_id: &str,
        terminal_id: &str,
        workspace_id: &str,
        tab_id: &str,
    ) -> PaneInfo {
        PaneInfo {
            pane_id: pane_id.to_string(),
            terminal_id: terminal_id.to_string(),
            workspace_id: workspace_id.to_string(),
            tab_id: tab_id.to_string(),
            focused: false,
            cwd: None,
            foreground_cwd: None,
            label: None,
            agent: None,
            agent_session: None,
            title: None,
            display_agent: None,
            agent_status: AgentStatus::Unknown,
            terminal_title: None,
            terminal_title_stripped: None,
            state_labels: HashMap::new(),
            tokens: HashMap::new(),
            scroll: None,
            revision: 1,
        }
    }
}
