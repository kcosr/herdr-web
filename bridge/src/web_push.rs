use std::fs;
use std::path::PathBuf;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::Serialize;

use crate::push_subscriptions::PushSubscriptionRecord;
use crate::store_util::{default_store_dir, ensure_private_dir, set_private_file_permissions};

#[derive(Debug)]
pub enum WebPushError {
    KeyGen(String),
    Io(std::io::Error),
}

impl From<std::io::Error> for WebPushError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err)
    }
}

#[derive(Debug, Clone)]
pub struct VapidKeyMaterial {
    pub public_key_b64url: String,
    pub private_key_pem: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PushPayload {
    pub title: String,
    pub body: String,
    pub workspace_id: String,
    pub pane_id: String,
    pub agent_status: String,
}

pub enum WebPushSendResult {
    Ok,
    Gone,
    Failed(String),
}

/// Generate a P-256 VAPID keypair: PEM private key + uncompressed base64url public key.
pub fn generate_vapid_material() -> Result<VapidKeyMaterial, WebPushError> {
    use p256::ecdsa::SigningKey;
    use p256::pkcs8::EncodePrivateKey;
    use rand_core::OsRng;

    let signing = SigningKey::random(&mut OsRng);
    let verifying = signing.verifying_key();
    let public_point = verifying.to_encoded_point(false); // uncompressed 0x04||X||Y
    let public_key_b64url = URL_SAFE_NO_PAD.encode(public_point.as_bytes());
    let private_key_pem = signing
        .to_pkcs8_pem(Default::default())
        .map_err(|e| WebPushError::KeyGen(e.to_string()))?
        .to_string();
    Ok(VapidKeyMaterial {
        public_key_b64url,
        private_key_pem,
    })
}

fn vapid_dir() -> PathBuf {
    default_store_dir("HERDR_WEB_VAPID_DIR", "vapid", "herdr-web-vapid")
}

/// Load persisted VAPID material or create and persist it on first use (0600).
pub fn load_or_create_vapid() -> Result<VapidKeyMaterial, WebPushError> {
    let dir = vapid_dir();
    ensure_private_dir(&dir)?;
    let pem_path = dir.join("vapid-private.pem");
    let pub_path = dir.join("vapid-public.b64url");
    if let (Ok(pem), Ok(pubkey)) = (fs::read_to_string(&pem_path), fs::read_to_string(&pub_path)) {
        if !pem.trim().is_empty() && !pubkey.trim().is_empty() {
            return Ok(VapidKeyMaterial {
                public_key_b64url: pubkey.trim().to_string(),
                private_key_pem: pem,
            });
        }
    }
    let material = generate_vapid_material()?;
    fs::write(&pem_path, material.private_key_pem.as_bytes())?;
    set_private_file_permissions(&pem_path)?;
    fs::write(&pub_path, material.public_key_b64url.as_bytes())?;
    set_private_file_permissions(&pub_path)?;
    Ok(material)
}

#[derive(Clone)]
pub struct WebPushSender {
    material: VapidKeyMaterial,
}

impl WebPushSender {
    pub fn new(material: VapidKeyMaterial) -> Self {
        Self { material }
    }

    pub fn public_key_b64url(&self) -> &str {
        &self.material.public_key_b64url
    }

    /// Send one encrypted, VAPID-signed push. `Gone` (HTTP 404/410 style
    /// endpoint-invalid errors) tells the caller to prune the subscription.
    pub async fn send(
        &self,
        record: &PushSubscriptionRecord,
        payload: &PushPayload,
    ) -> WebPushSendResult {
        use web_push::{
            ContentEncoding, IsahcWebPushClient, SubscriptionInfo, SubscriptionKeys,
            VapidSignatureBuilder, WebPushClient as _, WebPushMessageBuilder,
        };

        let subscription = SubscriptionInfo {
            endpoint: record.endpoint.clone(),
            keys: SubscriptionKeys {
                p256dh: record.keys.p256dh.clone(),
                auth: record.keys.auth.clone(),
            },
        };
        let body = match serde_json::to_vec(payload) {
            Ok(bytes) => bytes,
            Err(e) => return WebPushSendResult::Failed(e.to_string()),
        };
        let sig = match VapidSignatureBuilder::from_pem(
            self.material.private_key_pem.as_bytes(),
            &subscription,
        )
        .and_then(|b| b.build())
        {
            Ok(sig) => sig,
            Err(e) => return WebPushSendResult::Failed(e.to_string()),
        };
        let mut builder = WebPushMessageBuilder::new(&subscription);
        builder.set_payload(ContentEncoding::Aes128Gcm, &body);
        builder.set_vapid_signature(sig);
        let message = match builder.build() {
            Ok(m) => m,
            Err(e) => return WebPushSendResult::Failed(e.to_string()),
        };
        let client = match IsahcWebPushClient::new() {
            Ok(c) => c,
            Err(e) => return WebPushSendResult::Failed(e.to_string()),
        };
        match client.send(message).await {
            Ok(_) => WebPushSendResult::Ok,
            Err(web_push::WebPushError::EndpointNotFound)
            | Err(web_push::WebPushError::EndpointNotValid) => WebPushSendResult::Gone,
            Err(e) => WebPushSendResult::Failed(e.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_serializes_expected_fields() {
        let payload = PushPayload {
            title: "Agent blocked".to_string(),
            body: "codex — Reviewing changes".to_string(),
            workspace_id: "w1".to_string(),
            pane_id: "w1:p1".to_string(),
            agent_status: "blocked".to_string(),
        };
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["title"], "Agent blocked");
        assert_eq!(json["pane_id"], "w1:p1");
        assert_eq!(json["agent_status"], "blocked");
    }

    #[test]
    fn vapid_keygen_produces_urlsafe_public_key() {
        let material = generate_vapid_material().unwrap();
        // base64url: no '+', '/', or '=' padding
        assert!(!material.public_key_b64url.is_empty());
        assert!(!material.public_key_b64url.contains('+'));
        assert!(!material.public_key_b64url.contains('/'));
        assert!(!material.public_key_b64url.contains('='));
        assert!(!material.private_key_pem.is_empty());
    }
}
