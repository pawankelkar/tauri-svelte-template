//! Repositories: the only place SQL lives.
//!
//! Every function takes a `&Connection`. Reads can run on any connection
//! ([`Db::read`](crate::Db::read)); writes should run inside
//! [`Db::write`](crate::Db::write), whose transaction derefs to a
//! connection, so a batch of calls commits (or rolls back) together.

pub mod headings;
pub mod links;
pub mod meta;
pub mod notes;
pub mod tags;
pub mod tasks;
