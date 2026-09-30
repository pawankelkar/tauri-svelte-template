//! `origin`: credentials, push and fetch.
//!
//! These are the only functions in the crate that may open a network
//! connection. The app must authorize [`authorization_url`] of the remote
//! with `NetClient::authorize_external` before calling them; this crate takes
//! that check as the caller's responsibility (it deliberately does not
//! depend on `ostralith-net`).

use std::cell::{Cell, RefCell};

use git2::{Cred, CredentialType, FetchOptions, PushOptions, RemoteCallbacks};

use super::{GitBackup, Status, REMOTE_NAME};
use crate::error::{remote_error, Result, SyncError};

/// How to authenticate to `origin`.
///
/// Offered in this order, each at most once per operation: the SSH agent
/// (for `ssh://` and `user@host:path` remotes), the HTTPS token (as a
/// username/password pair), then libgit2's default (NTLM/Negotiate).
#[derive(Clone)]
pub struct Credentials {
    /// Try keys from the running SSH agent (`SSH_AUTH_SOCK`).
    pub use_ssh_agent: bool,
    /// Username sent with the token. Defaults to the URL's username, else
    /// `x-access-token` (GitHub; GitLab and Gitea accept any username with a
    /// personal access token).
    pub https_username: Option<String>,
    /// Personal access token for HTTPS remotes.
    pub https_token: Option<String>,
}

impl Default for Credentials {
    fn default() -> Self {
        Self {
            use_ssh_agent: true,
            https_username: None,
            https_token: None,
        }
    }
}

impl Credentials {
    /// SSH agent only.
    pub fn ssh_agent() -> Self {
        Self::default()
    }

    /// SSH agent plus an HTTPS token.
    pub fn with_token(token: impl Into<String>) -> Self {
        Self {
            https_token: Some(token.into()),
            ..Self::default()
        }
    }
}

impl std::fmt::Debug for Credentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credentials")
            .field("use_ssh_agent", &self.use_ssh_agent)
            .field("https_username", &self.https_username)
            .field(
                "https_token",
                &self.https_token.as_ref().map(|_| "<redacted>"),
            )
            .finish()
    }
}

/// Commits on each side relative to the remote-tracking ref.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Divergence {
    /// Local commits `origin` doesn't have.
    pub ahead: u32,
    /// `origin` commits we don't have (as of the last fetch).
    pub behind: u32,
}

/// The URL to pass to `NetClient::authorize_external` before talking to
/// `remote`, or `None` if the remote is local (`file://`, a plain path) and
/// needs no network.
///
/// The network policy only understands `http(s)`, and its decision is
/// per host, so SSH-style remotes (`ssh://git@host/x`, `git@host:x`,
/// `git://host/x`) are mapped to `https://host/x`. Any user info (names,
/// tokens) is stripped so it never reaches the network activity log.
pub fn authorization_url(remote: &str) -> Option<String> {
    let remote = remote.trim();
    if remote.is_empty() || remote.starts_with("file://") {
        return None;
    }
    if let Some((scheme, rest)) = remote.split_once("://") {
        let scheme = scheme.to_ascii_lowercase();
        let (authority, path) = match rest.find('/') {
            Some(i) => (&rest[..i], &rest[i..]),
            None => (rest, "/"),
        };
        let host_port = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
        if host_port.is_empty() {
            return None;
        }
        return match scheme.as_str() {
            "http" | "https" => Some(format!("{scheme}://{host_port}{path}")),
            // SSH ports mean nothing to an https check; keep only the host.
            _ => {
                let host = strip_port(host_port);
                Some(format!("https://{host}{path}"))
            }
        };
    }
    // scp-like `[user@]host:path`. A `/` before the `:` means a local path,
    // and a single letter before it is a Windows drive (`C:\vault`).
    let colon = remote.find(':')?;
    let (before, path) = (&remote[..colon], &remote[colon + 1..]);
    if before.contains('/') || before.len() == 1 {
        return None;
    }
    let host = before.rsplit_once('@').map_or(before, |(_, h)| h);
    if host.is_empty() {
        return None;
    }
    Some(format!("https://{host}/{}", path.trim_start_matches('/')))
}

fn strip_port(host_port: &str) -> &str {
    if host_port.starts_with('[') {
        // IPv6 literal: keep the brackets, drop a trailing `:port`.
        return host_port.find(']').map_or(host_port, |i| &host_port[..=i]);
    }
    host_port.split(':').next().unwrap_or(host_port)
}

/// Refuse to persist a URL that embeds a password.
pub(super) fn validate_remote_url(url: &str) -> Result<()> {
    if let Some((_, rest)) = url.split_once("://") {
        let authority = rest.split('/').next().unwrap_or_default();
        if let Some((userinfo, _)) = authority.rsplit_once('@') {
            if userinfo.contains(':') {
                return Err(SyncError::InvalidRemote {
                    message: "the URL contains a password; use a token instead".into(),
                });
            }
        }
    }
    if url.chars().any(char::is_control) {
        return Err(SyncError::InvalidRemote {
            message: "the URL contains control characters".into(),
        });
    }
    Ok(())
}

/// Callbacks with a credentials handler that offers each kind at most once,
/// so a refused key fails fast instead of looping inside libgit2.
pub(super) fn callbacks<'a>(
    creds: &'a Credentials,
    exhausted: &'a Cell<bool>,
) -> RemoteCallbacks<'a> {
    let mut tried_username = false;
    let mut tried_agent = false;
    let mut tried_token = false;
    let mut tried_default = false;
    let mut cbs = RemoteCallbacks::new();
    cbs.credentials(move |_url, username_from_url, allowed| {
        let ssh_user = username_from_url.unwrap_or("git");
        if allowed.contains(CredentialType::USERNAME) && !tried_username {
            tried_username = true;
            return Cred::username(ssh_user);
        }
        if allowed.contains(CredentialType::SSH_KEY) && creds.use_ssh_agent && !tried_agent {
            tried_agent = true;
            return Cred::ssh_key_from_agent(ssh_user);
        }
        if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) && !tried_token {
            if let Some(token) = creds.https_token.as_deref() {
                tried_token = true;
                let user = creds
                    .https_username
                    .as_deref()
                    .or(username_from_url)
                    .unwrap_or("x-access-token");
                return Cred::userpass_plaintext(user, token);
            }
        }
        if allowed.contains(CredentialType::DEFAULT) && !tried_default {
            tried_default = true;
            return Cred::default();
        }
        exhausted.set(true);
        Err(git2::Error::new(
            git2::ErrorCode::Auth,
            git2::ErrorClass::Callback,
            "no accepted credentials (check the SSH agent or the access token)",
        ))
    });
    cbs
}

impl GitBackup {
    /// Push the current branch (`main`) to `origin` and return the new
    /// status (`ahead == 0` on success).
    ///
    /// **Network.** The caller must have run
    /// `NetClient::authorize_external("PUSH", &authorization_url(url)?, "git backup")`
    /// for [`remote_url`](Self::remote_url) and only call this if it passed
    /// (skip the check when `authorization_url` is `None`: local remote).
    ///
    /// Errors: `NoRemote`; `Auth` (credentials refused or none usable);
    /// `Network` (unreachable, TLS, DNS); `Rejected` (not a fast-forward:
    /// another device pushed first, so `pull` then push again).
    pub fn push(&self, credentials: &Credentials) -> Result<Status> {
        let mut remote = self
            .repo()
            .find_remote(REMOTE_NAME)
            .map_err(|_| SyncError::NoRemote)?;
        let branch = self.branch()?;
        let Some(head) = self.head_commit()?.map(|c| c.id()) else {
            return self.status();
        };
        let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");

        let exhausted = Cell::new(false);
        let rejected = RefCell::new(Vec::new());
        {
            let mut cbs = callbacks(credentials, &exhausted);
            cbs.push_update_reference(|refname, status| {
                if let Some(msg) = status {
                    rejected.borrow_mut().push(format!("{refname}: {msg}"));
                }
                Ok(())
            });
            let mut opts = PushOptions::new();
            opts.remote_callbacks(cbs);
            remote
                .push(&[refspec.as_str()], Some(&mut opts))
                .map_err(|e| remote_error(e, exhausted.get()))?;
        }
        let rejected = rejected.into_inner();
        if !rejected.is_empty() {
            return Err(SyncError::Rejected {
                message: rejected.join("; "),
            });
        }
        // libgit2 updates the tracking ref itself; make sure regardless, since
        // `ahead` is computed from it.
        self.repo()
            .reference(&self.tracking_ref(&branch), head, true, "ostralith: push")?;
        self.status()
    }

    /// Fetch the current branch from `origin` into
    /// `refs/remotes/origin/<branch>` and report how far apart the two are.
    ///
    /// **Network.** Same contract as [`push`](Self::push): authorize the
    /// remote URL first.
    pub fn fetch(&self, credentials: &Credentials) -> Result<Divergence> {
        let mut remote = self
            .repo()
            .find_remote(REMOTE_NAME)
            .map_err(|_| SyncError::NoRemote)?;
        let branch = self.branch()?;
        let refspec = format!("+refs/heads/{branch}:{}", self.tracking_ref(&branch));
        let exhausted = Cell::new(false);
        {
            let mut opts = FetchOptions::new();
            opts.remote_callbacks(callbacks(credentials, &exhausted));
            remote
                .fetch(
                    &[refspec.as_str()],
                    Some(&mut opts),
                    Some("ostralith: fetch"),
                )
                .map_err(|e| remote_error(e, exhausted.get()))?;
        }
        self.divergence()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::count;

    #[test]
    fn authorization_urls() {
        let cases = [
            (
                "https://github.com/me/notes.git",
                Some("https://github.com/me/notes.git"),
            ),
            (
                "https://me:tok@github.com/me/notes.git",
                Some("https://github.com/me/notes.git"),
            ),
            ("http://localhost:3000/x", Some("http://localhost:3000/x")),
            (
                "ssh://git@github.com/me/notes.git",
                Some("https://github.com/me/notes.git"),
            ),
            (
                "ssh://git@host.example:2222/n.git",
                Some("https://host.example/n.git"),
            ),
            (
                "git@github.com:me/notes.git",
                Some("https://github.com/me/notes.git"),
            ),
            (
                "github.com:me/notes.git",
                Some("https://github.com/me/notes.git"),
            ),
            ("file:///tmp/backup.git", None),
            ("/tmp/backup.git", None),
            ("./rel/backup.git", None),
            ("C:\\backup", None),
            ("", None),
        ];
        for (input, want) in cases {
            assert_eq!(authorization_url(input).as_deref(), want, "{input}");
        }
    }

    #[test]
    fn remote_urls_with_passwords_are_refused() {
        assert!(validate_remote_url("https://github.com/me/n.git").is_ok());
        assert!(validate_remote_url("https://me@github.com/me/n.git").is_ok());
        assert!(validate_remote_url("git@github.com:me/n.git").is_ok());
        assert!(matches!(
            validate_remote_url("https://me:secret@github.com/me/n.git"),
            Err(SyncError::InvalidRemote { .. })
        ));
    }

    #[test]
    fn debug_redacts_the_token() {
        let dbg = format!("{:?}", Credentials::with_token("hunter2"));
        assert!(!dbg.contains("hunter2"));
        assert!(dbg.contains("redacted"));
    }

    #[test]
    fn counts_saturate() {
        assert_eq!(count(3), 3);
    }
}
