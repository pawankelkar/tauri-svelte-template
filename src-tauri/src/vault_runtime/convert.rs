//! Crate types to IPC types.

use ostralith_store::BacklinkRow;
use ostralith_sync::{Snapshot, Status};
use ostralith_vault::{EntryKind, TreeEntry};

use crate::commands::backup::{BackupStatus, SnapshotInfo};
use crate::commands::search::TextPart;
use crate::commands::vault::{Backlink, FsChange, FsChangeKind, TreeNode, TreeNodeKind};

pub fn tree_node(entry: TreeEntry) -> TreeNode {
    TreeNode {
        path: entry.path.into_string(),
        name: entry.name,
        kind: match entry.kind {
            EntryKind::Folder => TreeNodeKind::Folder,
            EntryKind::Note => TreeNodeKind::Note,
            EntryKind::File => TreeNodeKind::File,
        },
        mtime: entry.mtime,
        children: entry.children.into_iter().map(tree_node).collect(),
    }
}

pub fn backlink(row: BacklinkRow) -> Backlink {
    Backlink {
        source_path: row.source_path,
        source_title: row.source_title,
        line: row.line,
        context: row.context,
    }
}

pub fn fs_change(change: &ostralith_vault::FsChange) -> FsChange {
    use ostralith_vault::FsChangeKind as K;
    FsChange {
        path: change.path.to_string(),
        kind: match change.kind {
            K::Created => FsChangeKind::Created,
            K::Modified => FsChangeKind::Modified,
            K::Removed => FsChangeKind::Removed,
            K::Renamed => FsChangeKind::Renamed,
        },
        old_path: change.old_path.as_ref().map(ToString::to_string),
    }
}

pub fn text_parts(parts: Vec<ostralith_index::TextPart>) -> Vec<TextPart> {
    parts
        .into_iter()
        .map(|p| TextPart {
            text: p.text,
            highlight: p.highlight,
        })
        .collect()
}

pub fn snapshot(s: Snapshot) -> SnapshotInfo {
    SnapshotInfo {
        id: s.id,
        message: s.message,
        time: s.time_ms,
        files_changed: s.files_changed,
    }
}

pub fn backup_status(s: Status) -> BackupStatus {
    BackupStatus {
        initialized: true,
        changed_files: s.changed_files,
        last_snapshot: s.last_snapshot.map(snapshot),
        remote: s.remote,
        ahead: s.ahead,
    }
}

pub fn uninitialized_backup() -> BackupStatus {
    BackupStatus {
        initialized: false,
        changed_files: 0,
        last_snapshot: None,
        remote: None,
        ahead: 0,
    }
}
