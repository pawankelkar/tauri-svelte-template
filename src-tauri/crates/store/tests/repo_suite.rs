//! The repository suite, run once against a plain database and once against
//! an SQLCipher-encrypted one.

mod common;

use common::{index, link, note, Fixture};
use ostralith_store::repo::{headings, links, meta, notes, tags, tasks};
use ostralith_store::{
    BacklinkRow, Db, HeadingRecord, StoreError, TagCount, TaskRecord, SCHEMA_VERSION,
};

/// Expands each case into a module with a `plain` and an `encrypted` test.
macro_rules! both_modes {
    ($($name:ident($db:ident) $body:block)*) => {
        $(
            mod $name {
                use super::*;

                fn case($db: &Db) $body

                #[test]
                fn plain() {
                    case(&Fixture::plain().db);
                }

                #[test]
                fn encrypted() {
                    case(&Fixture::encrypted().db);
                }
            }
        )*
    };
}

fn table_count(db: &Db, table: &str) -> u32 {
    db.read(|conn| {
        Ok(
            conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                row.get(0)
            })?,
        )
    })
    .unwrap()
}

both_modes! {
    migrations_apply_on_open(db) {
        assert_eq!(db.stats().unwrap().schema_version, SCHEMA_VERSION);
        assert!(db.integrity_check().unwrap());
    }

    upsert_keeps_the_id_and_updates_fields(db) {
        let first = db.write(|tx| notes::upsert(tx, &note("A.md"))).unwrap();
        let mut changed = note("A.md");
        changed.title = "Renamed title".into();
        changed.hash = "new-hash".into();
        changed.frontmatter = Some(r#"{"tags":["x"]}"#.into());
        let second = db.write(|tx| notes::upsert(tx, &changed)).unwrap();
        assert_eq!(first, second);

        let row = db.read(|c| notes::get_by_path(c, "A.md")).unwrap().unwrap();
        assert_eq!(row.id, first);
        assert_eq!(row.title, "Renamed title");
        assert_eq!(row.hash, "new-hash");
        assert_eq!(row.size, Some(42));
        assert_eq!(row.frontmatter.as_deref(), Some(r#"{"tags":["x"]}"#));
        assert!(row.indexed_at.is_some());
        assert_eq!(db.read(notes::count).unwrap(), 1);
    }

    missing_notes_are_none(db) {
        assert!(db.read(|c| notes::get_by_path(c, "nope.md")).unwrap().is_none());
        assert!(db.read(|c| notes::id_for_path(c, "nope.md")).unwrap().is_none());
        assert!(!db.remove_note("nope.md").unwrap());
    }

    list_all_meta_is_sorted_by_path(db) {
        for path in ["b.md", "A/z.md", "a.md"] {
            index(db, path, &[]);
        }
        let paths: Vec<_> = db.list_all_meta().unwrap().into_iter().map(|m| m.path).collect();
        assert_eq!(paths, ["A/z.md", "a.md", "b.md"]);
        let meta = &db.list_all_meta().unwrap()[1];
        assert_eq!(meta.title, "a");
        assert_eq!(meta.hash, "hash-of-a.md");
        assert_eq!(db.stats().unwrap().note_count, 3);
    }

    index_note_replaces_everything_for_the_path(db) {
        let heading = HeadingRecord { level: 1, text: "Title".into(), slug: "title".into(), line: 0 };
        let task = TaskRecord { line: 2, text: "do it".into(), done: false };
        let id = db
            .index_note(
                &note("A.md"),
                &[link("B", Some("B.md"), 3), link("C", None, 4)],
                &["x".into(), "y".into(), "x".into()],
                std::slice::from_ref(&heading),
                std::slice::from_ref(&task),
            )
            .unwrap();
        db.read(|c| {
            assert_eq!(links::list_for_note(c, id)?.len(), 2);
            assert_eq!(tags::list_for_note(c, id)?, ["x", "y"]);
            assert_eq!(headings::list_for_note(c, id)?, std::slice::from_ref(&heading));
            assert_eq!(tasks::list_for_note(c, id)?, std::slice::from_ref(&task));
            Ok(())
        })
        .unwrap();

        let done = TaskRecord { done: true, ..task };
        let again = db
            .index_note(&note("A.md"), &[link("D", None, 1)], &["z".into()], &[], std::slice::from_ref(&done))
            .unwrap();
        assert_eq!(again, id);
        db.read(|c| {
            let l = links::list_for_note(c, id)?;
            assert_eq!(l.len(), 1);
            assert_eq!(l[0].target_raw, "D");
            assert_eq!(tags::list_for_note(c, id)?, ["z"]);
            assert!(headings::list_for_note(c, id)?.is_empty());
            assert_eq!(tasks::list_for_note(c, id)?, [done]);
            Ok(())
        })
        .unwrap();
    }

    link_fields_round_trip(db) {
        let mut l = link("B", Some("B.md"), 7);
        l.heading = Some("Section".into());
        l.alias = Some("shown".into());
        l.is_embed = true;
        let id = index(db, "A.md", std::slice::from_ref(&l));
        assert_eq!(db.read(|c| links::list_for_note(c, id)).unwrap(), [l]);
    }

    backlinks_lists_resolved_sources(db) {
        index(db, "Target.md", &[]);
        index(db, "z/Later.md", &[link("Target", Some("Target.md"), 5)]);
        index(db, "Earlier.md", &[link("Target", Some("Target.md"), 9), link("Target", Some("Target.md"), 2)]);
        index(db, "Other.md", &[link("Target", None, 0), link("Elsewhere", Some("Elsewhere.md"), 1)]);

        let rows = db.backlinks("Target.md").unwrap();
        let summary: Vec<_> = rows.iter().map(|r| (r.source_path.as_str(), r.line)).collect();
        assert_eq!(summary, [("Earlier.md", 2), ("Earlier.md", 9), ("z/Later.md", 5)]);
        assert_eq!(
            rows[0],
            BacklinkRow {
                source_path: "Earlier.md".into(),
                source_title: "Earlier".into(),
                line: 2,
                context: "see [[Target]]".into(),
            }
        );
        assert_eq!(
            db.read(|c| links::linking_sources(c, "Target.md")).unwrap(),
            ["Earlier.md", "z/Later.md"]
        );
        assert!(db.backlinks("Nobody.md").unwrap().is_empty());
    }

    deleting_a_note_cascades_to_its_rows(db) {
        let id = db
            .index_note(
                &note("A.md"),
                &[link("B", None, 0)],
                &["t".into()],
                &[HeadingRecord { level: 2, text: "H".into(), slug: "h".into(), line: 1 }],
                &[TaskRecord { line: 3, text: "t".into(), done: true }],
            )
            .unwrap();
        index(db, "Keep.md", &[link("B", None, 0)]);
        assert!(id > 0);
        assert!(db.remove_note("A.md").unwrap());
        assert_eq!(table_count(db, "notes"), 1);
        assert_eq!(table_count(db, "links"), 1);
        assert_eq!(table_count(db, "tags"), 0);
        assert_eq!(table_count(db, "headings"), 0);
        assert_eq!(table_count(db, "tasks"), 0);
    }

    removing_a_note_unresolves_links_to_it(db) {
        index(db, "B.md", &[]);
        index(db, "A.md", &[link("B", Some("B.md"), 0)]);
        db.remove_note("B.md").unwrap();
        assert!(db.backlinks("B.md").unwrap().is_empty());
        let unresolved = db.read(|c| links::unresolved_for(c, "B")).unwrap();
        assert_eq!(unresolved.len(), 1);
        assert_eq!(unresolved[0].source_path, "A.md");
    }

    renaming_a_note_moves_it_and_its_backlinks(db) {
        let id = index(db, "Old.md", &[]);
        index(db, "A.md", &[link("Old", Some("Old.md"), 0)]);
        assert!(db.rename_note("Old.md", "New.md").unwrap());
        assert!(db.read(|c| notes::get_by_path(c, "Old.md")).unwrap().is_none());
        assert_eq!(db.read(|c| notes::id_for_path(c, "New.md")).unwrap(), Some(id));
        assert_eq!(db.backlinks("New.md").unwrap().len(), 1);
        assert!(db.backlinks("Old.md").unwrap().is_empty());
    }

    renaming_a_folder_moves_everything_under_it(db) {
        index(db, "Projects/A.md", &[]);
        index(db, "Projects/Deep/B.md", &[]);
        index(db, "Projects2/C.md", &[]);
        index(db, "Projects.md", &[]);
        index(db, "Home.md", &[
            link("A", Some("Projects/A.md"), 0),
            link("B", Some("Projects/Deep/B.md"), 1),
            link("C", Some("Projects2/C.md"), 2),
        ]);

        assert_eq!(db.rename_folder("Projects", "Archive/2024/").unwrap(), 2);
        let paths: Vec<_> = db.list_all_meta().unwrap().into_iter().map(|m| m.path).collect();
        assert_eq!(
            paths,
            ["Archive/2024/A.md", "Archive/2024/Deep/B.md", "Home.md", "Projects.md", "Projects2/C.md"]
        );
        assert_eq!(db.backlinks("Archive/2024/Deep/B.md").unwrap().len(), 1);
        assert_eq!(db.backlinks("Projects2/C.md").unwrap().len(), 1);
        assert!(db.backlinks("Projects/A.md").unwrap().is_empty());
    }

    folder_names_with_like_wildcards_are_literal(db) {
        index(db, "a_b/x.md", &[]);
        index(db, "aXb/y.md", &[]);
        index(db, "100%/z.md", &[]);
        index(db, "100X/w.md", &[]);
        assert_eq!(db.rename_folder("a_b", "ab").unwrap(), 1);
        assert_eq!(db.remove_folder("100%").unwrap(), 1);
        let paths: Vec<_> = db.list_all_meta().unwrap().into_iter().map(|m| m.path).collect();
        assert_eq!(paths, ["100X/w.md", "aXb/y.md", "ab/x.md"]);
    }

    removing_a_folder_deletes_its_notes(db) {
        index(db, "Inbox/a.md", &[]);
        index(db, "Inbox/sub/b.md", &[]);
        index(db, "Home.md", &[link("a", Some("Inbox/a.md"), 0)]);
        assert_eq!(db.remove_folder("Inbox/").unwrap(), 2);
        assert_eq!(db.read(notes::count).unwrap(), 1);
        assert_eq!(db.read(links::unresolved_all).unwrap().len(), 1);
    }

    unresolved_links_can_be_resolved_later(db) {
        index(db, "A.md", &[link("Future", None, 0), link("future", None, 3), link("Other", None, 4)]);
        assert_eq!(db.read(links::unresolved_all).unwrap().len(), 3);
        assert_eq!(db.read(|c| links::unresolved_for(c, "FUTURE")).unwrap().len(), 2);

        index(db, "Future.md", &[]);
        assert_eq!(db.write(|tx| links::resolve_raw(tx, "Future", "Future.md")).unwrap(), 2);
        assert_eq!(db.backlinks("Future.md").unwrap().len(), 2);
        assert_eq!(db.read(links::unresolved_all).unwrap().len(), 1);

        assert_eq!(db.write(|tx| links::set_target_path(tx, "future", None)).unwrap(), 2);
        assert!(db.backlinks("Future.md").unwrap().is_empty());
    }

    link_targets_can_be_listed_and_set_one_by_one(db) {
        index(db, "B.md", &[link("a", Some("A.md"), 0)]);
        index(db, "A.md", &[link("x", None, 2), link("a", Some("A.md"), 1)]);

        let all = db.read(|c| links::targets(c, false)).unwrap();
        let summary: Vec<_> = all
            .iter()
            .map(|r| (r.source_path.as_str(), r.target_raw.as_str(), r.target_path.as_deref()))
            .collect();
        assert_eq!(
            summary,
            [("A.md", "a", Some("A.md")), ("A.md", "x", None), ("B.md", "a", Some("A.md"))]
        );

        let unresolved = db.read(|c| links::targets(c, true)).unwrap();
        assert_eq!(unresolved.len(), 1);
        assert_eq!(unresolved[0].target_raw, "x");

        assert!(db.write(|tx| links::set_target_by_id(tx, unresolved[0].id, Some("X.md"))).unwrap());
        assert!(db.write(|tx| links::set_target_by_id(tx, all[2].id, None)).unwrap());
        assert!(!db.write(|tx| links::set_target_by_id(tx, i64::MAX, None)).unwrap());
        let after = db.read(|c| links::targets(c, true)).unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].source_path, "B.md");
        assert_eq!(db.backlinks("A.md").unwrap().len(), 1);
    }

    tags_are_counted_and_queryable(db) {
        db.index_note(&note("a.md"), &[], &["work".into(), "idea".into()], &[], &[]).unwrap();
        db.index_note(&note("b.md"), &[], &["work".into()], &[], &[]).unwrap();
        let counts = db.read(tags::all_with_counts).unwrap();
        assert_eq!(
            counts,
            [
                TagCount { tag: "idea".into(), count: 1 },
                TagCount { tag: "work".into(), count: 2 },
            ]
        );
        assert_eq!(db.read(|c| tags::notes_with_tag(c, "work")).unwrap(), ["a.md", "b.md"]);
    }

    meta_is_a_key_value_store(db) {
        assert_eq!(db.read(|c| meta::get(c, "parser")).unwrap(), None);
        db.write(|tx| meta::set(tx, "parser", "1")).unwrap();
        db.write(|tx| meta::set(tx, "parser", "2")).unwrap();
        assert_eq!(db.read(|c| meta::get(c, "parser")).unwrap().as_deref(), Some("2"));
        assert!(db.write(|tx| meta::delete(tx, "parser")).unwrap());
        assert_eq!(db.read(|c| meta::get(c, "parser")).unwrap(), None);
    }

    a_failed_write_rolls_back(db) {
        let result: Result<(), StoreError> = db.write(|tx| {
            notes::upsert(tx, &note("A.md"))?;
            Err(StoreError::Key { message: "boom".into() })
        });
        assert!(result.is_err());
        assert_eq!(db.read(notes::count).unwrap(), 0);
    }

    read_connections_refuse_writes(db) {
        let result = db.read(|c| notes::upsert(c, &note("A.md")));
        assert!(matches!(result, Err(StoreError::Sqlite(_))), "{result:?}");
    }

    clear_empties_the_tables(db) {
        index(db, "a.md", &[link("b", None, 0)]);
        db.write(|tx| meta::set(tx, "k", "v")).unwrap();
        db.clear().unwrap();
        assert_eq!(table_count(db, "notes"), 0);
        assert_eq!(table_count(db, "links"), 0);
        assert_eq!(table_count(db, "meta"), 0);
        assert_eq!(db.stats().unwrap().schema_version, SCHEMA_VERSION);
    }

    stats_report_size_and_counts(db) {
        index(db, "a.md", &[]);
        let stats = db.stats().unwrap();
        assert_eq!(stats.note_count, 1);
        assert!(stats.size_bytes > 0);
    }

    reads_run_in_parallel_with_writes(db) {
        std::thread::scope(|s| {
            s.spawn(|| {
                for i in 0..50 {
                    index(db, &format!("n{i}.md"), &[]);
                }
            });
            for _ in 0..4 {
                s.spawn(|| {
                    for _ in 0..50 {
                        let n = db.read(notes::count).unwrap();
                        assert!(n <= 50);
                    }
                });
            }
        });
        assert_eq!(db.read(notes::count).unwrap(), 50);
    }
}
