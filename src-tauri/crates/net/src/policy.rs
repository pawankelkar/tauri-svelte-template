use serde::{Deserialize, Serialize};
use specta::Type;
use url::{Host, Url};

use crate::NetError;

/// What the app may reach, persisted as `network.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct NetPolicy {
    /// Block every non-loopback request. On by default: a fresh install
    /// makes zero network calls until the user opts in (for example, to
    /// download a model).
    pub offline: bool,
    /// Let loopback requests through even when offline. Local model servers
    /// (MLX, llama-server, Ollama, LM Studio) live on 127.0.0.1, so turning
    /// this off disables them.
    pub allow_localhost: bool,
    /// Hosts reachable while online. An entry is an exact host
    /// (`huggingface.co`), a subdomain wildcard (`*.hf.co`, which does not
    /// match `hf.co` itself), or `*` for any host.
    pub allowed_hosts: Vec<String>,
}

impl Default for NetPolicy {
    fn default() -> Self {
        Self {
            offline: true,
            allow_localhost: true,
            allowed_hosts: vec!["*".to_string()],
        }
    }
}

impl NetPolicy {
    /// Whether `url` may be requested under this policy. Pure: does no IO.
    pub fn check(&self, url: &Url) -> Result<(), NetError> {
        match url.scheme() {
            "http" | "https" => {}
            scheme => {
                return Err(NetError::UnsupportedScheme {
                    scheme: scheme.to_string(),
                })
            }
        }
        let host = url.host().ok_or_else(|| NetError::InvalidUrl {
            message: format!("{url} has no host"),
        })?;

        // With allow_localhost off, loopback is treated like any other host.
        if self.allow_localhost && is_loopback(&host) {
            return Ok(());
        }

        let host = host_label(&host);
        if self.offline {
            return Err(NetError::Offline { host });
        }
        if self
            .allowed_hosts
            .iter()
            .any(|entry| host_matches(entry, &host))
        {
            Ok(())
        } else {
            Err(NetError::HostNotAllowed { host })
        }
    }
}

fn is_loopback(host: &Host<&str>) -> bool {
    match host {
        Host::Domain(domain) => {
            let domain = domain.trim_end_matches('.').to_ascii_lowercase();
            domain == "localhost" || domain.ends_with(".localhost")
        }
        Host::Ipv4(ip) => ip.is_loopback(),
        Host::Ipv6(ip) => {
            ip.is_loopback() || ip.to_ipv4_mapped().is_some_and(|v4| v4.is_loopback())
        }
    }
}

fn host_label(host: &Host<&str>) -> String {
    match host {
        Host::Domain(domain) => domain.trim_end_matches('.').to_ascii_lowercase(),
        Host::Ipv4(ip) => ip.to_string(),
        Host::Ipv6(ip) => ip.to_string(),
    }
}

fn host_matches(entry: &str, host: &str) -> bool {
    let entry = entry.trim().trim_end_matches('.').to_ascii_lowercase();
    if entry == "*" {
        return true;
    }
    match entry.strip_prefix("*.") {
        Some(suffix) => host.len() > suffix.len() && host.ends_with(&format!(".{suffix}")),
        None => entry == host,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    fn online(hosts: &[&str]) -> NetPolicy {
        NetPolicy {
            offline: false,
            allow_localhost: true,
            allowed_hosts: hosts.iter().map(|h| h.to_string()).collect(),
        }
    }

    #[test]
    fn defaults_to_offline_with_loopback_allowed() {
        let p = NetPolicy::default();
        assert!(p.offline);
        assert_eq!(
            p.check(&url("https://huggingface.co/x")),
            Err(NetError::Offline {
                host: "huggingface.co".into()
            })
        );
        assert_eq!(p.check(&url("http://127.0.0.1:8080/v1/models")), Ok(()));
        assert_eq!(p.check(&url("http://localhost:11434/")), Ok(()));
        assert_eq!(p.check(&url("http://[::1]:1234/")), Ok(()));
        assert_eq!(p.check(&url("http://[::ffff:127.0.0.1]/")), Ok(()));
        assert_eq!(p.check(&url("http://api.localhost/")), Ok(()));
    }

    #[test]
    fn loopback_can_be_blocked_too() {
        let p = NetPolicy {
            allow_localhost: false,
            ..NetPolicy::default()
        };
        assert_eq!(
            p.check(&url("http://127.0.0.1/")),
            Err(NetError::Offline {
                host: "127.0.0.1".into()
            })
        );
    }

    #[test]
    fn private_lan_addresses_are_not_loopback() {
        let p = NetPolicy::default();
        assert!(matches!(
            p.check(&url("http://192.168.1.10/")),
            Err(NetError::Offline { .. })
        ));
        assert!(matches!(
            p.check(&url("http://localhost.example.com/")),
            Err(NetError::Offline { .. })
        ));
    }

    #[test]
    fn online_requests_must_match_the_allowlist() {
        let p = online(&["huggingface.co", "*.hf.co"]);
        assert_eq!(p.check(&url("https://huggingface.co/a")), Ok(()));
        assert_eq!(p.check(&url("https://HuggingFace.co./a")), Ok(()));
        assert_eq!(p.check(&url("https://cdn-lfs.hf.co/a")), Ok(()));
        assert_eq!(
            p.check(&url("https://hf.co/a")),
            Err(NetError::HostNotAllowed {
                host: "hf.co".into()
            })
        );
        assert_eq!(
            p.check(&url("https://evilhf.co/a")),
            Err(NetError::HostNotAllowed {
                host: "evilhf.co".into()
            })
        );
        assert_eq!(
            p.check(&url("https://api.openai.com/")),
            Err(NetError::HostNotAllowed {
                host: "api.openai.com".into()
            })
        );
    }

    #[test]
    fn star_allows_any_host_when_online() {
        assert_eq!(online(&["*"]).check(&url("https://example.org/")), Ok(()));
        assert!(matches!(
            online(&[]).check(&url("https://example.org/")),
            Err(NetError::HostNotAllowed { .. })
        ));
    }

    #[test]
    fn only_http_schemes_are_allowed() {
        let p = online(&["*"]);
        for s in [
            "file:///etc/passwd",
            "ftp://example.com/",
            "ws://example.com/",
        ] {
            assert!(matches!(
                p.check(&url(s)),
                Err(NetError::UnsupportedScheme { .. })
            ));
        }
    }

    #[test]
    fn missing_fields_fill_from_defaults() {
        let p: NetPolicy = serde_json::from_str(r#"{"offline":false}"#).unwrap();
        assert!(!p.offline);
        assert!(p.allow_localhost);
        assert_eq!(p.allowed_hosts, vec!["*".to_string()]);
    }
}
