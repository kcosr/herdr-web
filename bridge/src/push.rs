//! Optional Web Push (VAPID) for agent attention alerts.
//!
//! Disabled when VAPID material cannot be loaded/generated. Subscriptions persist under the
//! herdr-web data directory so they survive bridge restarts.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::engine::general_purpose::{URL_SAFE_NO_PAD, STANDARD};
use base64::Engine;
use herdr_compat::api::schema::AgentStatus;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use web_push::{
    ContentEncoding, IsahcWebPushClient, SubscriptionInfo, Urgency, VapidSignatureBuilder,
    WebPushClient, WebPushMessageBuilder,
};

use crate::store_util::{default_store_dir, ensure_private_dir, set_private_file_permissions};

/// Minimal alert payload used by the activity watcher (avoids a web_bridge cycle).
#[derive(Debug, Clone)]
pub struct AgentPushAlert {
    pub pane_id: String,
    pub workspace_id: String,
    pub agent_status: AgentStatus,
    pub agent: Option<String>,
    pub title: Option<String>,
    pub display_agent: Option<String>,
}

const SUBSCRIPTIONS_FILE: &str = "push-subscriptions.json";
const VAPID_FILE: &str = "vapid.json";
const PUSH_TTL_SECS: u32 = 21_600;
const PUSH_TOPIC: &str = "herdr-web-herd";
const VAPID_SUBJECT: &str = "mailto:herdr-web@localhost";
const MAX_SUBSCRIPTIONS: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PushSubscriptionRecord {
    pub endpoint: String,
    pub keys: PushSubscriptionKeys,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PushSubscriptionKeys {
    pub p256dh: String,
    pub auth: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SubscriptionsFile {
    subscriptions: Vec<PushSubscriptionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct VapidFile {
    public_key: String,
    private_key: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WebPushCapability {
    pub version: u32,
    pub public_key: String,
}

#[derive(Debug, Serialize)]
struct PushPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    r#type: Option<&'static str>,
    title: String,
    body: String,
    tag: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pane_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    workspace_id: Option<String>,
    renotify: bool,
}

pub struct PushManager {
    enabled: bool,
    public_key: String,
    private_key: String,
    path: PathBuf,
    subscriptions: Mutex<HashMap<String, PushSubscriptionRecord>>,
}

impl PushManager {
    pub fn load() -> io::Result<Self> {
        let dir = default_store_dir("HERDR_WEB_PUSH_DIR", "push", "herdr-web-push");
        ensure_private_dir(&dir)?;
        let vapid = load_or_create_vapid(&dir)?;
        let path = dir.join(SUBSCRIPTIONS_FILE);
        let subscriptions = load_subscriptions(&path)?;
        if vapid.is_some() {
            info!(
                subscriptions = subscriptions.len(),
                "web push enabled with VAPID keys"
            );
        } else {
            info!("web push disabled (no VAPID keys)");
        }
        Ok(Self {
            enabled: vapid.is_some(),
            public_key: vapid
                .as_ref()
                .map(|keys| keys.public_key.clone())
                .unwrap_or_default(),
            private_key: vapid
                .as_ref()
                .map(|keys| keys.private_key.clone())
                .unwrap_or_default(),
            path,
            subscriptions: Mutex::new(subscriptions),
        })
    }

    pub fn capability(&self) -> Option<WebPushCapability> {
        if !self.enabled {
            return None;
        }
        Some(WebPushCapability {
            version: 1,
            public_key: self.public_key.clone(),
        })
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    pub fn subscribe(&self, subscription: PushSubscriptionRecord) -> io::Result<()> {
        if !self.enabled {
            return Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "web push is not configured",
            ));
        }
        if subscription.endpoint.trim().is_empty()
            || subscription.keys.p256dh.trim().is_empty()
            || subscription.keys.auth.trim().is_empty()
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "invalid push subscription",
            ));
        }
        let mut guard = self
            .subscriptions
            .lock()
            .expect("push subscriptions lock poisoned");
        guard.insert(subscription.endpoint.clone(), subscription);
        while guard.len() > MAX_SUBSCRIPTIONS {
            if let Some(oldest) = guard.keys().next().cloned() {
                guard.remove(&oldest);
            } else {
                break;
            }
        }
        save_subscriptions(&self.path, &guard)
    }

    pub fn unsubscribe(&self, endpoint: &str) -> io::Result<bool> {
        let mut guard = self
            .subscriptions
            .lock()
            .expect("push subscriptions lock poisoned");
        let removed = guard.remove(endpoint).is_some();
        if removed {
            save_subscriptions(&self.path, &guard)?;
        }
        Ok(removed)
    }

    pub async fn broadcast_alert(&self, alert: &AgentPushAlert) {
        if !self.enabled {
            return;
        }
        let Some(payload) = payload_for_alert(alert) else {
            return;
        };
        let body = match serde_json::to_string(&payload) {
            Ok(value) => value,
            Err(err) => {
                warn!(error = %err, "failed to serialize push payload");
                return;
            }
        };
        let subs: Vec<PushSubscriptionRecord> = self
            .subscriptions
            .lock()
            .expect("push subscriptions lock poisoned")
            .values()
            .cloned()
            .collect();
        if subs.is_empty() {
            return;
        }
        let client = match IsahcWebPushClient::new() {
            Ok(client) => client,
            Err(err) => {
                warn!(error = %err, "failed to create web push client");
                return;
            }
        };
        let mut dead = Vec::new();
        for sub in subs {
            match self.send_one(&client, &sub, body.as_bytes()).await {
                Ok(()) => {}
                Err(err) => {
                    warn!(endpoint = %sub.endpoint, error = %err, "web push delivery failed");
                    if is_gone_error(&err) {
                        dead.push(sub.endpoint);
                    }
                }
            }
        }
        if !dead.is_empty() {
            let mut guard = self
                .subscriptions
                .lock()
                .expect("push subscriptions lock poisoned");
            for endpoint in dead {
                guard.remove(&endpoint);
            }
            if let Err(err) = save_subscriptions(&self.path, &guard) {
                warn!(error = %err, "failed to prune dead push subscriptions");
            }
        }
    }

    async fn send_one(
        &self,
        client: &IsahcWebPushClient,
        sub: &PushSubscriptionRecord,
        payload: &[u8],
    ) -> Result<(), web_push::WebPushError> {
        let info = SubscriptionInfo::new(&sub.endpoint, &sub.keys.p256dh, &sub.keys.auth);
        let mut sig_builder = VapidSignatureBuilder::from_base64(&self.private_key, &info)?;
        sig_builder.add_claim("sub", VAPID_SUBJECT);
        let signature = sig_builder.build()?;
        let mut builder = WebPushMessageBuilder::new(&info);
        builder.set_payload(ContentEncoding::Aes128Gcm, payload);
        builder.set_ttl(PUSH_TTL_SECS);
        builder.set_urgency(Urgency::High);
        builder.set_topic(PUSH_TOPIC.to_string());
        builder.set_vapid_signature(signature);
        client.send(builder.build()?).await
    }
}

pub fn parse_subscription_body(value: serde_json::Value) -> Result<PushSubscriptionRecord, String> {
    let endpoint = value
        .get("endpoint")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "missing endpoint".to_string())?
        .to_string();
    let keys = value
        .get("keys")
        .ok_or_else(|| "missing keys".to_string())?;
    let p256dh = keys
        .get("p256dh")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "missing keys.p256dh".to_string())?
        .to_string();
    let auth = keys
        .get("auth")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "missing keys.auth".to_string())?
        .to_string();
    Ok(PushSubscriptionRecord {
        endpoint,
        keys: PushSubscriptionKeys { p256dh, auth },
    })
}

fn payload_for_alert(alert: &AgentPushAlert) -> Option<PushPayload> {
    if !matches!(
        alert.agent_status,
        AgentStatus::Blocked | AgentStatus::Done
    ) {
        return None;
    }
    let agent_label = alert
        .display_agent
        .as_deref()
        .or(alert.agent.as_deref())
        .or(alert.title.as_deref())
        .unwrap_or("Agent");
    let title_text = match alert.agent_status {
        AgentStatus::Blocked => format!("{agent_label} needs you"),
        AgentStatus::Done => format!("{agent_label} is done"),
        _ => return None,
    };
    let body = match alert.title.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        Some(value) if value != agent_label => format!("{} · {}", value, alert.pane_id),
        _ => alert.pane_id.clone(),
    };
    Some(PushPayload {
        r#type: None,
        title: title_text,
        body,
        tag: format!("herdr-web:agent:{}", alert.pane_id),
        pane_id: Some(alert.pane_id.clone()),
        workspace_id: Some(alert.workspace_id.clone()),
        renotify: true,
    })
}

fn load_or_create_vapid(dir: &Path) -> io::Result<Option<VapidFile>> {
    if let (Ok(public_key), Ok(private_key)) = (
        std::env::var("HERDR_WEB_VAPID_PUBLIC_KEY"),
        std::env::var("HERDR_WEB_VAPID_PRIVATE_KEY"),
    ) {
        if !public_key.trim().is_empty() && !private_key.trim().is_empty() {
            return Ok(Some(VapidFile {
                public_key: public_key.trim().to_string(),
                private_key: private_key.trim().to_string(),
            }));
        }
    }

    let path = dir.join(VAPID_FILE);
    if path.is_file() {
        let text = fs::read_to_string(&path)?;
        match serde_json::from_str::<VapidFile>(&text) {
            Ok(file)
                if !file.public_key.trim().is_empty() && !file.private_key.trim().is_empty() =>
            {
                return Ok(Some(file));
            }
            Ok(_) => warn!(path = %path.display(), "ignoring incomplete vapid.json"),
            Err(err) => warn!(path = %path.display(), error = %err, "ignoring corrupt vapid.json"),
        }
    }

    match generate_vapid_keys() {
        Ok(keys) => {
            write_json_private(&path, &keys)?;
            info!(path = %path.display(), "generated web push VAPID keys");
            Ok(Some(keys))
        }
        Err(err) => {
            warn!(error = %err, "failed to generate VAPID keys; web push disabled");
            Ok(None)
        }
    }
}

fn generate_vapid_keys() -> Result<VapidFile, String> {
    // web-push re-exports enough helpers via VapidSignatureBuilder; generate with openssl-free
    // base64 private key material accepted by from_base64_no_sub.
    use web_push::VapidSignatureBuilder as Builder;

    // Generate 32 random bytes for an ES256 private scalar via getrandom from the web-push tree.
    let mut raw = [0u8; 32];
    getrandom_fill(&mut raw)?;
    // Avoid an all-zero private key.
    if raw.iter().all(|b| *b == 0) {
        raw[0] = 1;
    }
    let private_key = URL_SAFE_NO_PAD.encode(raw);
    let builder = Builder::from_base64_no_sub(&private_key).map_err(|err| err.to_string())?;
    let public_key = URL_SAFE_NO_PAD.encode(builder.get_public_key());
    // Validate the private key can actually sign a dummy endpoint.
    let p256dh = URL_SAFE_NO_PAD.encode([1u8; 65]);
    let auth = URL_SAFE_NO_PAD.encode([2u8; 16]);
    let info = SubscriptionInfo::new("https://push.example.invalid/test", &p256dh, &auth);
    let mut sig = Builder::from_base64(&private_key, &info).map_err(|err| err.to_string())?;
    sig.add_claim("sub", VAPID_SUBJECT);
    let _ = sig.build().map_err(|err| err.to_string())?;
    Ok(VapidFile {
        public_key,
        private_key,
    })
}

fn getrandom_fill(buf: &mut [u8]) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::io::Read;
        let mut file = File::open("/dev/urandom").map_err(|err| err.to_string())?;
        file.read_exact(buf).map_err(|err| err.to_string())?;
        return Ok(());
    }
    #[cfg(not(unix))]
    {
        // Best-effort fallback for non-unix hosts used in local development.
        use std::time::{SystemTime, UNIX_EPOCH};
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        for (index, byte) in buf.iter_mut().enumerate() {
            *byte = ((nanos >> ((index % 16) * 8)) as u8).wrapping_add(index as u8);
        }
        Ok(())
    }
}

fn load_subscriptions(path: &Path) -> io::Result<HashMap<String, PushSubscriptionRecord>> {
    if !path.is_file() {
        return Ok(HashMap::new());
    }
    let text = fs::read_to_string(path)?;
    let parsed: SubscriptionsFile = serde_json::from_str(&text).map_err(|err| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("invalid push subscriptions file: {err}"),
        )
    })?;
    Ok(parsed
        .subscriptions
        .into_iter()
        .map(|sub| (sub.endpoint.clone(), sub))
        .collect())
}

fn save_subscriptions(
    path: &Path,
    subscriptions: &HashMap<String, PushSubscriptionRecord>,
) -> io::Result<()> {
    let file = SubscriptionsFile {
        subscriptions: subscriptions.values().cloned().collect(),
    };
    write_json_private(path, &file)
}

fn write_json_private<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        ensure_private_dir(parent)?;
    }
    let json = serde_json::to_vec_pretty(value)
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
    let temp_path = path.with_extension(format!(
        "tmp-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    {
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&temp_path)?;
        file.write_all(&json)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
    }
    set_private_file_permissions(&temp_path)?;
    fs::rename(&temp_path, path)?;
    set_private_file_permissions(path)?;
    Ok(())
}

fn is_gone_error(err: &web_push::WebPushError) -> bool {
    let text = err.to_string().to_ascii_lowercase();
    text.contains("410")
        || text.contains("404")
        || text.contains("gone")
        || text.contains("not found")
        || text.contains("unsubscribed")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_subscription_bodies() {
        let value = serde_json::json!({
            "endpoint": "https://push.example/x",
            "keys": { "p256dh": "abc", "auth": "def" }
        });
        let sub = parse_subscription_body(value).unwrap();
        assert_eq!(sub.endpoint, "https://push.example/x");
        assert_eq!(sub.keys.p256dh, "abc");
    }

    #[test]
    fn payload_only_for_attention_statuses() {
        let blocked = AgentPushAlert {
            pane_id: "w1:p1".into(),
            workspace_id: "w1".into(),
            agent_status: AgentStatus::Blocked,
            agent: Some("claude".into()),
            title: Some("need input".into()),
            display_agent: Some("Claude".into()),
        };
        let payload = payload_for_alert(&blocked).unwrap();
        assert_eq!(payload.title, "Claude needs you");
        assert!(payload_for_alert(&AgentPushAlert {
            pane_id: "w1:p1".into(),
            workspace_id: "w1".into(),
            agent_status: AgentStatus::Working,
            agent: None,
            title: None,
            display_agent: None,
        })
        .is_none());
    }

    #[test]
    fn generates_vapid_material() {
        let keys = generate_vapid_keys().expect("vapid generation");
        assert!(!keys.public_key.is_empty());
        assert!(!keys.private_key.is_empty());
        // Public applicationServerKey is URL-safe base64 without padding.
        assert!(URL_SAFE_NO_PAD.decode(&keys.public_key).is_ok() || STANDARD.decode(&keys.public_key).is_ok());
    }
}
