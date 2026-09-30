use ostralith_index::{join_parts, Hit, IndexError, NoteDoc, SearchIndex};

fn note(path: &str, title: &str, body: &str) -> NoteDoc {
    NoteDoc {
        path: path.into(),
        title: title.into(),
        headings: Vec::new(),
        body: body.into(),
        tags: Vec::new(),
        mtime: 0.0,
    }
}

fn index_with(notes: &[NoteDoc]) -> SearchIndex {
    let index = SearchIndex::in_memory().unwrap();
    for n in notes {
        index.upsert(n).unwrap();
    }
    index.commit().unwrap();
    index
}

fn paths(hits: &[Hit]) -> Vec<&str> {
    let mut paths: Vec<&str> = hits.iter().map(|h| h.path.as_str()).collect();
    paths.sort_unstable();
    paths
}

fn search(index: &SearchIndex, query: &str) -> Vec<String> {
    let hits = index.search(query, 50).unwrap();
    let mut paths: Vec<String> = hits.into_iter().map(|h| h.path).collect();
    paths.sort_unstable();
    paths
}

fn highlighted(hit: &Hit) -> Vec<String> {
    hit.snippet
        .iter()
        .filter(|p| p.highlight)
        .map(|p| p.text.clone())
        .collect()
}

fn sample() -> SearchIndex {
    let mut rust = note(
        "Projects/Rust notes.md",
        "Rust notes",
        "Ownership and borrowing make memory safety possible without a garbage collector.",
    );
    rust.tags = vec!["#Rust".into(), "lang/Systems".into()];
    rust.headings = vec!["Borrow checker".into()];
    rust.mtime = 3.0;
    let mut ostra = note(
        "Projects/Ostralith/Plan.md",
        "Ostralith plan",
        "The big idea: local-first notes. Search must feel instant.",
    );
    ostra.tags = vec!["project".into()];
    ostra.mtime = 2.0;
    let mut cafe = note(
        "Journal/2024-05-01.md",
        "Café visit",
        "Met Zoë at the café. We talked about the big picture and the idea of notes.",
    );
    cafe.tags = vec!["journal".into(), "project/side".into()];
    cafe.mtime = 1.0;
    let mut archive = note(
        "Projects 2/Old.md",
        "Old stuff",
        "Archived draft about memory and notes.",
    );
    archive.mtime = 4.0;
    index_with(&[rust, ostra, cafe, archive])
}

#[test]
fn search_index_is_send_and_sync() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<SearchIndex>();
}

#[test]
fn upsert_replaces_and_remove_deletes() {
    let index = SearchIndex::in_memory().unwrap();
    index.upsert(&note("a.md", "A", "apple banana")).unwrap();
    index.upsert(&note("b.md", "B", "banana cherry")).unwrap();
    index.commit().unwrap();
    assert_eq!(index.doc_count(), 2);
    assert_eq!(search(&index, "banana "), ["a.md", "b.md"]);

    // Replacing a.md drops its old content.
    index.upsert(&note("a.md", "A", "durian")).unwrap();
    index.commit().unwrap();
    assert_eq!(index.doc_count(), 2);
    assert_eq!(search(&index, "banana "), ["b.md"]);
    assert_eq!(search(&index, "durian "), ["a.md"]);

    // Upserting twice in one batch still leaves one doc.
    index.upsert(&note("c.md", "C", "one")).unwrap();
    index.upsert(&note("c.md", "C", "two")).unwrap();
    index.commit().unwrap();
    assert_eq!(index.doc_count(), 3);
    assert!(search(&index, "one ").is_empty());

    index.remove("a.md").unwrap();
    index.remove("missing.md").unwrap();
    index.commit().unwrap();
    assert_eq!(index.doc_count(), 2);
    assert!(search(&index, "durian ").is_empty());
}

#[test]
fn writes_are_invisible_until_commit_and_rollback_discards() {
    let index = SearchIndex::in_memory().unwrap();
    index.upsert(&note("a.md", "A", "apple")).unwrap();
    assert_eq!(index.doc_count(), 0);
    assert!(search(&index, "apple ").is_empty());
    index.rollback().unwrap();
    index.commit().unwrap();
    assert_eq!(index.doc_count(), 0);
}

#[test]
fn remove_prefix_removes_a_folder_only() {
    let index = sample();
    index.remove_prefix("Projects/").unwrap();
    index.commit().unwrap();
    assert_eq!(
        search(&index, "notes "),
        ["Journal/2024-05-01.md", "Projects 2/Old.md"]
    );
    index.remove_prefix("Journal").unwrap();
    index.commit().unwrap();
    assert_eq!(index.doc_count(), 1);
}

#[test]
fn rename_and_clear() {
    let index = sample();
    let mut moved = note("Archive/Plan.md", "Ostralith plan", "local-first notes");
    moved.mtime = 9.0;
    index.rename("Projects/Ostralith/Plan.md", &moved).unwrap();
    index.commit().unwrap();
    assert_eq!(search(&index, "ostralith "), ["Archive/Plan.md"]);

    index.clear().unwrap();
    index.commit().unwrap();
    assert_eq!(index.doc_count(), 0);
    index.upsert(&note("x.md", "X", "fresh")).unwrap();
    index.commit().unwrap();
    assert_eq!(index.doc_count(), 1);
}

#[test]
fn words_are_anded_across_fields() {
    let index = sample();
    assert_eq!(
        search(&index, "memory notes "),
        ["Projects 2/Old.md", "Projects/Rust notes.md"]
    );
    assert_eq!(search(&index, "memory archived "), ["Projects 2/Old.md"]);
    // "rust" is only in a title, "borrow" only in a heading/body.
    assert_eq!(search(&index, "rust borrow "), ["Projects/Rust notes.md"]);
    assert!(search(&index, "memory zebra ").is_empty());
}

#[test]
fn title_outranks_body() {
    let index = index_with(&[
        note(
            "body.md",
            "Something",
            "a note about gardening and gardening",
        ),
        note("title.md", "Gardening", "a note about plants"),
    ]);
    let hits = index.search("gardening ", 10).unwrap();
    assert_eq!(hits[0].path, "title.md");
    assert!(hits[0].score > hits[1].score);
}

#[test]
fn phrases() {
    let index = sample();
    assert_eq!(
        search(&index, r#""big idea""#),
        ["Projects/Ostralith/Plan.md"]
    );
    // Both words appear in the journal, but not adjacent.
    assert_eq!(
        search(&index, "big idea "),
        ["Journal/2024-05-01.md", "Projects/Ostralith/Plan.md"]
    );
}

#[test]
fn tag_filters() {
    let index = sample();
    assert_eq!(search(&index, "tag:rust"), ["Projects/Rust notes.md"]);
    assert_eq!(search(&index, "#RUST"), ["Projects/Rust notes.md"]);
    assert_eq!(
        search(&index, "tag:lang/systems"),
        ["Projects/Rust notes.md"]
    );
    // A parent tag matches nested tags, but not tags that merely share a prefix.
    assert_eq!(
        search(&index, "#project"),
        ["Journal/2024-05-01.md", "Projects/Ostralith/Plan.md"]
    );
    assert!(search(&index, "#proj").is_empty());
    assert_eq!(
        search(&index, "#project notes -café"),
        ["Projects/Ostralith/Plan.md"]
    );
}

#[test]
fn filter_only_queries_are_ordered_by_recency() {
    let index = sample();
    let hits = index.search("path:projects", 10).unwrap();
    let order: Vec<&str> = hits.iter().map(|h| h.path.as_str()).collect();
    assert_eq!(
        order,
        [
            "Projects 2/Old.md",
            "Projects/Rust notes.md",
            "Projects/Ostralith/Plan.md"
        ]
    );
    // No body match: the snippet is the start of the body, unhighlighted.
    assert_eq!(
        join_parts(&hits[0].snippet),
        "Archived draft about memory and notes."
    );
    assert!(highlighted(&hits[0]).is_empty());
}

#[test]
fn path_prefix_filter() {
    let index = sample();
    assert_eq!(
        search(&index, "path:Projects/ notes"),
        ["Projects/Ostralith/Plan.md", "Projects/Rust notes.md"]
    );
    assert_eq!(
        search(&index, r#"path:"projects 2/""#),
        ["Projects 2/Old.md"]
    );
    assert_eq!(
        search(&index, "notes -path:Projects"),
        ["Journal/2024-05-01.md"]
    );
}

#[test]
fn exclusion() {
    let index = sample();
    assert_eq!(
        search(&index, "notes -memory"),
        ["Journal/2024-05-01.md", "Projects/Ostralith/Plan.md"]
    );
    assert_eq!(
        search(&index, r#"notes -"big picture" -memory"#),
        ["Projects/Ostralith/Plan.md"]
    );
    assert_eq!(
        search(&index, "notes NOT memory NOT café"),
        ["Projects/Ostralith/Plan.md"]
    );
    // Exclusion alone means "everything except".
    assert_eq!(search(&index, "-notes").len(), 0);
    assert_eq!(search(&index, "-zebra").len(), 4);
}

#[test]
fn or_alternatives() {
    let index = sample();
    assert_eq!(
        search(&index, "ownership OR archived"),
        ["Projects 2/Old.md", "Projects/Rust notes.md"]
    );
}

#[test]
fn prefix_matching_while_typing() {
    let index = sample();
    assert_eq!(search(&index, "ostra"), ["Projects/Ostralith/Plan.md"]);
    assert_eq!(search(&index, "local-fi"), ["Projects/Ostralith/Plan.md"]);
    assert_eq!(
        search(&index, r#""search must fe"#),
        ["Projects/Ostralith/Plan.md"]
    );
    // Once the word is finished (trailing space) it must match exactly.
    assert!(search(&index, "ostra ").is_empty());
    // Only the last word is a prefix.
    assert!(search(&index, "ostra plan").is_empty());
    assert_eq!(search(&index, "ownersh"), ["Projects/Rust notes.md"]);

    // Snippets highlight the expanded word.
    let hits = index.search("garb", 10).unwrap();
    assert_eq!(highlighted(&hits[0]), ["garbage"]);
}

#[test]
fn diacritics_fold_both_ways() {
    let index = sample();
    assert_eq!(search(&index, "cafe "), ["Journal/2024-05-01.md"]);
    assert_eq!(search(&index, "CAFÉ "), ["Journal/2024-05-01.md"]);
    assert_eq!(search(&index, "zoe "), ["Journal/2024-05-01.md"]);
    let hits = index.search("cafe ", 10).unwrap();
    assert_eq!(highlighted(&hits[0]), ["café"]);
}

#[test]
fn cjk_text() {
    let index = index_with(&[
        note("jp.md", "日本語のノート", "今日は東京で会議がありました。"),
        note("en.md", "English", "Tokyo meeting"),
    ]);
    assert_eq!(search(&index, "東京"), ["jp.md"]);
    assert_eq!(search(&index, "日本語"), ["jp.md"]);
    assert!(search(&index, "東京都").is_empty());
    let hits = index.search("会議", 10).unwrap();
    assert_eq!(highlighted(&hits[0]), ["会議"]);
}

#[test]
fn malformed_queries_never_error() {
    let index = sample();
    for query in [
        "\"unclosed",
        "AND OR",
        ":::",
        "(",
        ")",
        "((notes",
        "\"",
        "-",
        "tag:",
        "path:",
        "#",
        "*",
        "?",
        "notes AND",
        "OR notes",
        "~notes^2",
        "title:[a TO b]",
        "\\",
        "\u{0}",
        "a:b:c:d",
        "\"\"\"\"",
        "-\"",
        "NOT",
        "日本 \"語",
    ] {
        let result = index.search(query, 10);
        assert!(result.is_ok(), "{query:?} failed: {result:?}");
    }
    assert!(index.search("AND OR", 10).unwrap().is_empty());
    assert!(index.search(":::", 10).unwrap().is_empty());
    assert_eq!(
        search(&index, "((notes) memory"),
        ["Projects 2/Old.md", "Projects/Rust notes.md"]
    );
    assert_eq!(search(&index, "\"unclos"), Vec::<String>::new());
}

#[test]
fn empty_query_and_zero_limit() {
    let index = sample();
    assert!(index.search("", 10).unwrap().is_empty());
    assert!(index.search("   ", 10).unwrap().is_empty());
    assert!(index.search("notes", 0).unwrap().is_empty());
    assert_eq!(index.search("notes ", 2).unwrap().len(), 2);
}

#[test]
fn snippets_highlight_and_reassemble() {
    let long_body = format!(
        "{} The quick brown fox jumps over the lazy dog. {}",
        "Filler sentence number one. ".repeat(20),
        "More filler text here. ".repeat(20)
    );
    let index = index_with(&[note("fox.md", "Fox", &long_body)]);
    let hits = index.search("fox lazy", 10).unwrap();
    let hit = &hits[0];
    let text = join_parts(&hit.snippet);
    assert!(text.len() <= 200, "{text}");
    assert!(text.contains("quick brown fox jumps over the lazy dog"));
    assert_eq!(text, text.trim());
    assert_eq!(highlighted(hit), ["fox", "lazy"]);
    // Parts alternate and are never empty.
    assert!(hit.snippet.iter().all(|p| !p.text.is_empty()));
    assert!(hit
        .snippet
        .windows(2)
        .all(|w| w[0].highlight != w[1].highlight));
    assert!(long_body.contains(&text));
}

#[test]
fn snippet_falls_back_to_body_start_on_title_match() {
    let body = "word ".repeat(100);
    let index = index_with(&[note("t.md", "Unique title", &body)]);
    let hits = index.search("unique ", 10).unwrap();
    let text = join_parts(&hits[0].snippet);
    assert!(text.starts_with("word word"));
    assert!(text.chars().count() <= 160);
    assert!(!text.ends_with(' '));
    assert!(highlighted(&hits[0]).is_empty());
}

#[test]
fn reopen_from_disk_keeps_documents() {
    let dir = tempfile::tempdir().unwrap();
    {
        let index = SearchIndex::open(dir.path()).unwrap();
        assert!(index.needs_rebuild());
        index
            .upsert(&note("a.md", "Alpha", "persisted text"))
            .unwrap();
        index.commit().unwrap();
        index
            .upsert(&note("b.md", "Beta", "never committed"))
            .unwrap();
    }
    let index = SearchIndex::open(dir.path()).unwrap();
    assert!(!index.needs_rebuild());
    assert_eq!(index.doc_count(), 1);
    assert_eq!(search(&index, "persisted "), ["a.md"]);
}

#[test]
fn a_second_open_of_the_same_dir_fails_without_wiping() {
    let dir = tempfile::tempdir().unwrap();
    let first = SearchIndex::open(dir.path()).unwrap();
    first.upsert(&note("a.md", "Alpha", "text")).unwrap();
    first.commit().unwrap();
    assert!(SearchIndex::open(dir.path()).is_err());
    assert_eq!(first.doc_count(), 1);
    drop(first);
    assert_eq!(SearchIndex::open(dir.path()).unwrap().doc_count(), 1);
}

#[test]
fn schema_version_mismatch_triggers_rebuild() {
    let dir = tempfile::tempdir().unwrap();
    {
        let index = SearchIndex::open(dir.path()).unwrap();
        index.upsert(&note("a.md", "Alpha", "text")).unwrap();
        index.commit().unwrap();
    }
    std::fs::write(dir.path().join("ostralith-index-version"), "0\n").unwrap();
    let index = SearchIndex::open(dir.path()).unwrap();
    assert!(index.needs_rebuild());
    assert_eq!(index.doc_count(), 0);
    drop(index);
    assert!(!SearchIndex::open(dir.path()).unwrap().needs_rebuild());
}

#[test]
fn corrupt_index_is_rebuilt() {
    let dir = tempfile::tempdir().unwrap();
    {
        let index = SearchIndex::open(dir.path()).unwrap();
        index.upsert(&note("a.md", "Alpha", "text")).unwrap();
        index.commit().unwrap();
    }
    std::fs::write(dir.path().join("meta.json"), "{ not json").unwrap();
    let index = SearchIndex::open(dir.path()).unwrap();
    assert!(index.needs_rebuild());
    assert_eq!(index.doc_count(), 0);
}

#[test]
fn refuses_to_wipe_a_foreign_directory() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("My note.md"), "precious").unwrap();
    let err = SearchIndex::open(dir.path()).unwrap_err();
    assert!(matches!(err, IndexError::NotAnIndex { .. }));
    assert!(dir.path().join("My note.md").exists());
}

#[test]
fn concurrent_search_while_writing() {
    let index = std::sync::Arc::new(sample());
    let writer = {
        let index = index.clone();
        std::thread::spawn(move || {
            for i in 0..50 {
                index
                    .upsert(&note(&format!("t/{i}.md"), "Thread", "threaded notes"))
                    .unwrap();
                if i % 10 == 0 {
                    index.commit().unwrap();
                }
            }
            index.commit().unwrap();
        })
    };
    for _ in 0..50 {
        index.search("notes", 10).unwrap();
    }
    writer.join().unwrap();
    assert_eq!(index.doc_count(), 54);
    assert_eq!(paths(&index.search("threaded ", 100).unwrap()).len(), 50);
}

#[test]
fn phrase_combinations_match_brute_force() {
    let notes: Vec<NoteDoc> = (0..300)
        .map(|i| {
            let mut body = if i % 2 == 0 {
                "alpha beta"
            } else {
                "beta alpha"
            }
            .to_string();
            if i % 3 == 0 {
                body.push_str(" gamma delta");
            }
            if i % 7 == 0 {
                body.push_str(" delta gamma");
            }
            note(&format!("{i:03}.md"), "Doc", &body)
        })
        .collect();
    let index = index_with(&notes);
    let expect = |f: &dyn Fn(usize) -> bool| -> Vec<String> {
        (0..300)
            .filter(|&i| f(i))
            .map(|i| format!("{i:03}.md"))
            .collect()
    };
    let all = |q: &str| {
        let mut p: Vec<String> = index
            .search(q, 1_000)
            .unwrap()
            .into_iter()
            .map(|h| h.path)
            .collect();
        p.sort();
        p
    };
    assert_eq!(
        all(r#""alpha beta" gamma "#),
        expect(&|i| i % 2 == 0 && (i % 3 == 0 || i % 7 == 0))
    );
    assert_eq!(
        all(r#"gamma -"alpha beta""#),
        expect(&|i| i % 2 == 1 && (i % 3 == 0 || i % 7 == 0))
    );
    assert_eq!(
        all(r#""alpha beta" OR "gamma delta""#),
        expect(&|i| i % 2 == 0 || i % 3 == 0)
    );
    assert_eq!(
        all(r#"-"beta alpha" -"delta gamma""#),
        expect(&|i| i % 2 == 0 && i % 7 != 0)
    );
    assert_eq!(
        all(r#""gamma delta" "delta gamma""#),
        expect(&|i| i % 3 == 0 && i % 7 == 0)
    );
    assert_eq!(
        all(r#"beta -"gamma delta" -"delta gamma""#),
        expect(&|i| i % 3 != 0 && i % 7 != 0)
    );
    assert_eq!(all(r#""alpha be"#), expect(&|i| i % 2 == 0));
}
