use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, ErrorKind, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::store_util::{
    copy_corrupt_once, default_store_dir, ensure_private_dir, now_ms_string, session_key,
    set_private_file_permissions, LockFile,
};

const PUSH_SUBSCRIPTIONS_STORE_VERSION: u32 = 1;
const MAX_PUSH_SUBSCRIPTION_RECORDS: usize = 100;

#[derive(Debug)]
pub enum PushSubscriptionsError {
    BadRequest(String),
    Io(io::Error),
    Store(String),
}

impl std::fmt::Display for PushSubscriptionsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadRequest(m) => write!(f, "{m}"),
            Self::Io(e) => write!(f, "{e}"),
            Self::Store(m) => write!(f, "{m}"),
        }
    }
}

impl From<io::Error> for PushSubscriptionsError {
    fn from(err: io::Error) -> Self {
        Self::Io(err)
    }
}

/// Holds push subscription secret material (`p256dh` and `auth`). These are
/// equivalent to private key material and must never be serialized into a
/// browser-facing HTTP response.
#[derive(Clone, Serialize, Deserialize)]
pub struct PushKeys {
    pub p256dh: String,
    pub auth: String,
}

impl std::fmt::Debug for PushKeys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PushKeys")
            .field("p256dh", &"<redacted>")
            .field("auth", &"<redacted>")
            .finish()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationPrefs {
    #[serde(default)]
    pub statuses: HashMap<String, bool>,
    #[serde(default = "default_scope")]
    pub scope_default: String,
    #[serde(default)]
    pub workspaces: HashMap<String, bool>,
    #[serde(default)]
    pub agents: HashMap<String, bool>,
}

impl Default for NotificationPrefs {
    fn default() -> Self {
        Self {
            statuses: HashMap::new(),
            scope_default: default_scope(),
            workspaces: HashMap::new(),
            agents: HashMap::new(),
        }
    }
}

fn default_scope() -> String {
    "off".to_string()
}

#[derive(Debug, Clone)]
pub struct PushSubscriptionInput {
    pub endpoint: String,
    pub keys: PushKeys,
    pub prefs: NotificationPrefs,
}

/// Holds a stored push subscription, including secret push keys (`auth`,
/// `p256dh`) and the push service `endpoint`. This data must never be
/// serialized into a browser-facing HTTP response.
#[derive(Clone, Serialize, Deserialize)]
pub struct PushSubscriptionRecord {
    pub endpoint: String,
    pub keys: PushKeys,
    pub prefs: NotificationPrefs,
    #[serde(default)]
    session_key: String,
    #[serde(default)]
    created_at: String,
}

impl std::fmt::Debug for PushSubscriptionRecord {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PushSubscriptionRecord")
            .field("endpoint", &"<redacted>")
            .field("keys", &self.keys)
            .field("prefs", &self.prefs)
            .field("session_key", &self.session_key)
            .field("created_at", &self.created_at)
            .finish()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PushSubscriptionsStore {
    version: u32,
    created_at: String,
    updated_at: String,
    subscriptions: Vec<PushSubscriptionRecord>,
}

#[derive(Clone)]
pub struct PushSubscriptionsManager {
    path: PathBuf,
    lock_path: PathBuf,
    session_key: String,
}

impl PushSubscriptionsManager {
    pub fn new() -> io::Result<Self> {
        let dir = default_store_dir(
            "HERDR_WEB_PUSH_SUBSCRIPTIONS_DIR",
            "push-subscriptions",
            "herdr-web-push-subscriptions",
        );
        ensure_private_dir(&dir)?;
        Ok(Self {
            path: dir.join("push-subscriptions.json"),
            lock_path: dir.join("push-subscriptions.lock"),
            session_key: session_key(),
        })
    }

    #[cfg(test)]
    fn for_test(dir: PathBuf, session_key: &str) -> io::Result<Self> {
        ensure_private_dir(&dir)?;
        Ok(Self {
            path: dir.join("push-subscriptions.json"),
            lock_path: dir.join("push-subscriptions.lock"),
            session_key: session_key.to_string(),
        })
    }

    pub fn upsert(&self, input: PushSubscriptionInput) -> Result<(), PushSubscriptionsError> {
        let endpoint = validate_endpoint(&input.endpoint)?;
        if input.keys.p256dh.trim().is_empty() || input.keys.auth.trim().is_empty() {
            return Err(PushSubscriptionsError::BadRequest(
                "push keys are required".to_string(),
            ));
        }
        let record = PushSubscriptionRecord {
            endpoint: endpoint.clone(),
            keys: input.keys,
            prefs: input.prefs,
            session_key: self.session_key.clone(),
            created_at: now_ms_string(),
        };
        self.with_store(|store, now| {
            store
                .subscriptions
                .retain(|s| !(s.session_key == record.session_key && s.endpoint == endpoint));
            store.subscriptions.push(record.clone());
            prune_oldest(store);
            store.updated_at = now;
            Ok(())
        })
    }

    pub fn remove(&self, endpoint: &str) -> Result<(), PushSubscriptionsError> {
        let endpoint = validate_endpoint(endpoint)?;
        self.with_store(|store, now| {
            store
                .subscriptions
                .retain(|s| !(s.session_key == self.session_key && s.endpoint == endpoint));
            store.updated_at = now;
            Ok(())
        })
    }

    pub fn prune(&self, endpoint: &str) -> Result<(), PushSubscriptionsError> {
        self.remove(endpoint)
    }

    pub fn list_for_send(&self) -> Result<Vec<PushSubscriptionRecord>, PushSubscriptionsError> {
        let _lock = LockFile::exclusive(&self.lock_path)?;
        let store = self.load_or_create_store()?;
        Ok(store
            .subscriptions
            .into_iter()
            .filter(|s| s.session_key == self.session_key)
            .collect())
    }

    fn with_store<F>(&self, mutate: F) -> Result<(), PushSubscriptionsError>
    where
        F: FnOnce(&mut PushSubscriptionsStore, String) -> Result<(), PushSubscriptionsError>,
    {
        let _lock = LockFile::exclusive(&self.lock_path)?;
        let mut store = self.load_or_create_store()?;
        mutate(&mut store, now_ms_string())?;
        write_json_atomic(&self.path, &store)
    }

    fn load_or_create_store(&self) -> Result<PushSubscriptionsStore, PushSubscriptionsError> {
        match fs::read(&self.path) {
            Ok(bytes) => match parse_store(&bytes) {
                Ok(store) => Ok(store),
                Err(err) => {
                    copy_corrupt_once(&self.path);
                    Err(err)
                }
            },
            Err(err) if err.kind() == ErrorKind::NotFound => {
                let now = now_ms_string();
                Ok(PushSubscriptionsStore {
                    version: PUSH_SUBSCRIPTIONS_STORE_VERSION,
                    created_at: now.clone(),
                    updated_at: now,
                    subscriptions: Vec::new(),
                })
            }
            Err(err) => Err(PushSubscriptionsError::Io(err)),
        }
    }
}

pub fn should_notify(
    prefs: &NotificationPrefs,
    status: &str,
    workspace_id: &str,
    pane_id: &str,
) -> bool {
    if prefs.statuses.get(status).copied() != Some(true) {
        return false;
    }
    if let Some(enabled) = prefs.agents.get(pane_id) {
        return *enabled;
    }
    if let Some(enabled) = prefs.workspaces.get(workspace_id) {
        return *enabled;
    }
    prefs.scope_default == "on"
}

fn validate_endpoint(endpoint: &str) -> Result<String, PushSubscriptionsError> {
    let endpoint = endpoint.trim();
    if endpoint.is_empty() {
        return Err(PushSubscriptionsError::BadRequest(
            "endpoint is required".to_string(),
        ));
    }
    if !endpoint.starts_with("https://") {
        return Err(PushSubscriptionsError::BadRequest(
            "endpoint must be https".to_string(),
        ));
    }
    Ok(endpoint.to_string())
}

fn prune_oldest(store: &mut PushSubscriptionsStore) {
    if store.subscriptions.len() <= MAX_PUSH_SUBSCRIPTION_RECORDS {
        return;
    }
    store
        .subscriptions
        .sort_by(|a, b| b.created_at.cmp(&a.created_at));
    store.subscriptions.truncate(MAX_PUSH_SUBSCRIPTION_RECORDS);
}

fn parse_store(bytes: &[u8]) -> Result<PushSubscriptionsStore, PushSubscriptionsError> {
    let store: PushSubscriptionsStore = serde_json::from_slice(bytes).map_err(|err| {
        PushSubscriptionsError::Store(format!("push subscriptions store is unreadable: {err}"))
    })?;
    if store.version != PUSH_SUBSCRIPTIONS_STORE_VERSION {
        return Err(PushSubscriptionsError::Store(format!(
            "unsupported push subscriptions store version: {}",
            store.version
        )));
    }
    Ok(store)
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), PushSubscriptionsError> {
    if let Some(parent) = path.parent() {
        ensure_private_dir(parent)?;
    }
    let temp_path = path.with_extension(format!("{}.tmp", std::process::id()));
    let bytes = serde_json::to_vec_pretty(value).map_err(|err| {
        PushSubscriptionsError::Store(format!("failed to serialize push subscriptions: {err}"))
    })?;
    let mut file = File::create(&temp_path)?;
    set_private_file_permissions(&temp_path)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temp_path, path)?;
    set_private_file_permissions(path)?;
    if let Some(parent) = path.parent() {
        File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::path::PathBuf;

    use crate::store_util::now_ms_string;

    fn prefs(statuses: &[(&str, bool)], scope_default: &str) -> NotificationPrefs {
        NotificationPrefs {
            statuses: statuses.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
            scope_default: scope_default.to_string(),
            workspaces: HashMap::new(),
            agents: HashMap::new(),
        }
    }

    #[test]
    fn should_notify_requires_status_enabled() {
        let p = prefs(&[("blocked", true), ("done", false)], "on");
        assert!(should_notify(&p, "blocked", "w1", "w1:p1"));
        assert!(!should_notify(&p, "done", "w1", "w1:p1"));
        assert!(!should_notify(&p, "working", "w1", "w1:p1"));
    }

    #[test]
    fn scope_default_off_blocks_unlisted_targets() {
        let p = prefs(&[("blocked", true)], "off");
        assert!(!should_notify(&p, "blocked", "w1", "w1:p1"));
    }

    #[test]
    fn workspace_opt_in_enables_target() {
        let mut p = prefs(&[("blocked", true)], "off");
        p.workspaces.insert("w1".to_string(), true);
        assert!(should_notify(&p, "blocked", "w1", "w1:p1"));
        assert!(!should_notify(&p, "blocked", "w2", "w2:p1"));
    }

    #[test]
    fn agent_entry_overrides_workspace() {
        let mut p = prefs(&[("blocked", true)], "off");
        p.workspaces.insert("w1".to_string(), true);
        p.agents.insert("w1:p1".to_string(), false);
        assert!(!should_notify(&p, "blocked", "w1", "w1:p1"));
        assert!(should_notify(&p, "blocked", "w1", "w1:p2"));
    }

    fn test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "herdr-web-push-subs-test-{name}-{}",
            now_ms_string()
        ))
    }

    #[test]
    fn upsert_replaces_by_endpoint_and_lists_for_send() {
        let manager = PushSubscriptionsManager::for_test(test_dir("upsert"), "session:a").unwrap();
        let input = |auth: &str| PushSubscriptionInput {
            endpoint: "https://push.example/a".to_string(),
            keys: PushKeys {
                p256dh: "BFabc".to_string(),
                auth: auth.to_string(),
            },
            prefs: prefs(&[("blocked", true)], "on"),
        };
        manager.upsert(input("k1")).unwrap();
        manager.upsert(input("k2")).unwrap();
        let all = manager.list_for_send().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].keys.auth, "k2");
    }

    #[test]
    fn remove_deletes_by_endpoint() {
        let manager = PushSubscriptionsManager::for_test(test_dir("remove"), "session:a").unwrap();
        manager
            .upsert(PushSubscriptionInput {
                endpoint: "https://push.example/a".to_string(),
                keys: PushKeys {
                    p256dh: "BFabc".to_string(),
                    auth: "k1".to_string(),
                },
                prefs: prefs(&[("blocked", true)], "on"),
            })
            .unwrap();
        manager.remove("https://push.example/a").unwrap();
        assert!(manager.list_for_send().unwrap().is_empty());
    }

    #[test]
    fn rejects_non_https_endpoint() {
        let manager =
            PushSubscriptionsManager::for_test(test_dir("bad-endpoint"), "session:a").unwrap();
        let result = manager.upsert(PushSubscriptionInput {
            endpoint: "http://push.example/a".to_string(),
            keys: PushKeys {
                p256dh: "BFabc".to_string(),
                auth: "k1".to_string(),
            },
            prefs: prefs(&[("blocked", true)], "on"),
        });
        assert!(matches!(result, Err(PushSubscriptionsError::BadRequest(_))));
    }
}
