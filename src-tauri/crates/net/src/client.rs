use std::sync::{Arc, RwLock};

use reqwest::{redirect, Method, Request, Response};
use url::Url;

use crate::activity::{ActivityLog, RequestOutcome, RequestRecord};
use crate::{NetError, NetPolicy};

const MAX_REDIRECTS: usize = 10;

/// The app's single HTTP client. Cheap to share: hold it in Tauri managed
/// state (or an `Arc`) and call it from anywhere.
///
/// There is deliberately no way to get at the inner `reqwest::Client` or a
/// `RequestBuilder`, both of which could send without going through the
/// policy. Build a [`Request`] with [`NetClient::new_request`], adjust its
/// headers or body, and hand it to [`NetClient::send`].
pub struct NetClient {
    policy: Arc<RwLock<NetPolicy>>,
    log: Arc<ActivityLog>,
    http: reqwest::Client,
}

impl NetClient {
    pub fn new(policy: NetPolicy) -> Result<Self, NetError> {
        let policy = Arc::new(RwLock::new(policy));
        let log = Arc::new(ActivityLog::default());

        // Each hop is re-checked, so an allowed host can't redirect a request
        // to one the policy blocks (or out of loopback while offline).
        let redirect_policy = {
            let policy = Arc::clone(&policy);
            let log = Arc::clone(&log);
            redirect::Policy::custom(move |attempt| {
                if attempt.previous().len() >= MAX_REDIRECTS {
                    return attempt.error("too many redirects");
                }
                let verdict = read(&policy).check(attempt.url());
                match verdict {
                    Ok(()) => attempt.follow(),
                    Err(e) => {
                        let mut record = RequestRecord::new(
                            "GET",
                            attempt.url(),
                            "redirect",
                            RequestOutcome::Blocked,
                        );
                        record.error = Some(e.to_string());
                        log.push(record);
                        attempt.error(e)
                    }
                }
            })
        };

        // The one sanctioned construction site; see src-tauri/clippy.toml.
        #[allow(clippy::disallowed_methods)]
        let http = reqwest::Client::builder()
            .redirect(redirect_policy)
            .user_agent(concat!("Ostralith/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| NetError::Http {
                message: e.to_string(),
            })?;

        Ok(Self { policy, log, http })
    }

    pub fn policy(&self) -> NetPolicy {
        read(&self.policy).clone()
    }

    pub fn set_policy(&self, policy: NetPolicy) {
        *self.policy.write().unwrap_or_else(|e| e.into_inner()) = policy;
    }

    /// Flips offline mode and returns the resulting policy.
    pub fn set_offline(&self, offline: bool) -> NetPolicy {
        let mut policy = self.policy.write().unwrap_or_else(|e| e.into_inner());
        policy.offline = offline;
        policy.clone()
    }

    pub fn is_offline(&self) -> bool {
        read(&self.policy).offline
    }

    /// Pre-flight check without sending anything or touching the log. Useful
    /// for greying out UI that would need the network.
    pub fn check(&self, url: &str) -> Result<(), NetError> {
        read(&self.policy).check(&parse(url)?)
    }

    /// A request for `url` with no headers or body yet. Parsing only, so it
    /// succeeds offline too; the policy is applied by [`NetClient::send`].
    pub fn new_request(&self, method: Method, url: &str) -> Result<Request, NetError> {
        Ok(Request::new(method, parse(url)?))
    }

    pub async fn get(&self, url: &str, purpose: &str) -> Result<Response, NetError> {
        let request = self.new_request(Method::GET, url)?;
        self.send(request, purpose).await
    }

    /// Checks `request` against the policy, sends it, and logs the attempt.
    /// `purpose` is a short tag shown in the activity log, such as
    /// `model-download`.
    pub async fn send(&self, request: Request, purpose: &str) -> Result<Response, NetError> {
        let url = request.url().clone();
        let method = request.method().to_string();

        let verdict = read(&self.policy).check(&url);
        if let Err(e) = verdict {
            let mut record = RequestRecord::new(&method, &url, purpose, RequestOutcome::Blocked);
            record.error = Some(e.to_string());
            self.log.push(record);
            return Err(e);
        }

        let mut record = RequestRecord::new(&method, &url, purpose, RequestOutcome::Sent);
        match self.http.execute(request).await {
            Ok(response) => {
                record.status = Some(response.status().as_u16());
                record.bytes = response.content_length().map(|n| n as f64);
                self.log.push(record);
                Ok(response)
            }
            Err(e) => {
                let e = NetError::Http {
                    message: error_chain(&e),
                };
                record.error = Some(e.to_string());
                self.log.push(record);
                Err(e)
            }
        }
    }

    /// Applies the policy to a request that a third-party library will send
    /// with its own HTTP stack (the Tauri updater, libgit2), and logs it.
    /// Call it immediately before handing control to that library, and
    /// don't proceed on `Err`.
    pub fn authorize_external(
        &self,
        method: &str,
        url: &str,
        purpose: &str,
    ) -> Result<(), NetError> {
        let url = parse(url)?;
        let verdict = read(&self.policy).check(&url);
        let outcome = match verdict {
            Ok(()) => RequestOutcome::Sent,
            Err(_) => RequestOutcome::Blocked,
        };
        let mut record = RequestRecord::new(method, &url, purpose, outcome);
        record.error = verdict.as_ref().err().map(ToString::to_string);
        self.log.push(record);
        verdict
    }

    /// The activity log, oldest first.
    pub fn activity(&self) -> Vec<RequestRecord> {
        self.log.snapshot()
    }

    pub fn clear_activity(&self) {
        self.log.clear();
    }
}

fn read(policy: &RwLock<NetPolicy>) -> std::sync::RwLockReadGuard<'_, NetPolicy> {
    policy.read().unwrap_or_else(|e| e.into_inner())
}

fn parse(url: &str) -> Result<Url, NetError> {
    Url::parse(url).map_err(|e| NetError::InvalidUrl {
        message: format!("{url}: {e}"),
    })
}

/// reqwest's top-level message is often just "error sending request"; the
/// cause chain carries the useful part (a policy denial, DNS failure, …).
fn error_chain(err: &dyn std::error::Error) -> String {
    let mut message = err.to_string();
    let mut source = err.source();
    while let Some(cause) = source {
        message.push_str(": ");
        message.push_str(&cause.to_string());
        source = cause.source();
    }
    message
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    use super::*;

    /// A one-shot HTTP server on a random loopback port that answers the
    /// first request with `response`. Returns its base URL.
    fn serve_once(response: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 4096];
                let mut seen = Vec::new();
                while !seen.windows(4).any(|w| w == b"\r\n\r\n") {
                    match stream.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => seen.extend_from_slice(&buf[..n]),
                    }
                }
                let _ = stream.write_all(response.as_bytes());
            }
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn offline_blocks_before_any_io_and_logs_it() {
        let client = NetClient::new(NetPolicy::default()).unwrap();
        // Unresolvable on purpose: if the policy let this through, the test
        // would fail with a DNS error instead of `Offline`.
        let err = client
            .get("https://ostralith.invalid/models?token=x", "test")
            .await
            .unwrap_err();
        assert_eq!(
            err,
            NetError::Offline {
                host: "ostralith.invalid".into()
            }
        );

        let log = client.activity();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].outcome, RequestOutcome::Blocked);
        assert_eq!(log[0].purpose, "test");
        assert_eq!(log[0].url, "https://ostralith.invalid/models");
    }

    #[tokio::test]
    async fn loopback_is_reachable_while_offline() {
        let base =
            serve_once("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
        let client = NetClient::new(NetPolicy::default()).unwrap();
        let response = client.get(&format!("{base}/health"), "test").await.unwrap();
        assert_eq!(response.status().as_u16(), 200);
        assert_eq!(response.text().await.unwrap(), "ok");

        let log = client.activity();
        assert_eq!(log[0].outcome, RequestOutcome::Sent);
        assert_eq!(log[0].status, Some(200));
        assert_eq!(log[0].bytes, Some(2.0));
    }

    #[tokio::test]
    async fn redirects_out_of_loopback_are_blocked_while_offline() {
        let base = serve_once(
            "HTTP/1.1 302 Found\r\nLocation: https://ostralith.invalid/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
        let client = NetClient::new(NetPolicy::default()).unwrap();
        let err = client.get(&base, "test").await.unwrap_err();
        assert!(
            matches!(&err, NetError::Http { message } if message.contains("offline")),
            "{err:?}"
        );
        assert!(client
            .activity()
            .iter()
            .any(|r| r.outcome == RequestOutcome::Blocked && r.host == "ostralith.invalid"));
    }

    #[test]
    fn set_offline_updates_the_live_policy() {
        let client = NetClient::new(NetPolicy::default()).unwrap();
        assert!(client.is_offline());
        let policy = client.set_offline(false);
        assert!(!policy.offline);
        assert!(!client.is_offline());
        assert_eq!(client.check("https://example.com/"), Ok(()));
        client.set_policy(NetPolicy {
            allowed_hosts: vec![],
            ..client.policy()
        });
        assert!(matches!(
            client.check("https://example.com/"),
            Err(NetError::HostNotAllowed { .. })
        ));
    }

    #[test]
    fn external_requests_are_checked_and_logged() {
        let client = NetClient::new(NetPolicy::default()).unwrap();
        assert!(matches!(
            client.authorize_external("GET", "https://updates.example/latest.json", "updater"),
            Err(NetError::Offline { .. })
        ));
        client.set_offline(false);
        assert_eq!(
            client.authorize_external("GET", "https://updates.example/latest.json", "updater"),
            Ok(())
        );
        let log = client.activity();
        assert_eq!(
            log.iter().map(|r| r.outcome).collect::<Vec<_>>(),
            vec![RequestOutcome::Blocked, RequestOutcome::Sent]
        );
        assert!(log[0].error.is_some());
        assert_eq!(log[1].error, None);
    }

    #[test]
    fn check_rejects_garbage_urls() {
        let client = NetClient::new(NetPolicy::default()).unwrap();
        assert!(matches!(
            client.check("not a url"),
            Err(NetError::InvalidUrl { .. })
        ));
    }
}
