//! Search and quick-open over 50k synthetic notes.
//!
//! `cargo bench -p ostralith-index` — also prints p50/p95 latencies for a
//! mixed set of search queries before the Criterion runs.

use std::hint::black_box;
use std::time::{Duration, Instant};

use criterion::{criterion_group, criterion_main, Criterion};
use ostralith_index::quick_open::{self, QuickOpenCandidate};
use ostralith_index::{NoteDoc, SearchIndex};

const NOTES: usize = 50_000;
const WORDS_PER_NOTE: usize = 150;

/// Small deterministic PRNG so runs are comparable.
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

fn vocabulary() -> Vec<String> {
    const SYLLABLES: [&str; 16] = [
        "ka", "lo", "mi", "ne", "ra", "su", "to", "vi", "ze", "po", "qua", "lith", "os", "tra",
        "gen", "dor",
    ];
    let mut rng = Lcg(7);
    let mut words: Vec<String> = (0..5_000)
        .map(|_| {
            (0..2 + rng.below(3))
                .map(|_| SYLLABLES[rng.below(SYLLABLES.len())])
                .collect()
        })
        .collect();
    words.extend(
        [
            "project",
            "meeting",
            "ostralith",
            "rust",
            "search",
            "idea",
            "plan",
            "notes",
        ]
        .map(String::from),
    );
    words
}

fn synthetic_notes() -> Vec<NoteDoc> {
    let vocab = vocabulary();
    let mut rng = Lcg(42);
    (0..NOTES)
        .map(|i| {
            // Zipf-ish: bias towards the start of the vocabulary.
            let mut word = || {
                let r = rng.below(vocab.len());
                &vocab[r * rng.below(vocab.len()) / vocab.len()]
            };
            let title = format!("{} {} {i}", word(), word());
            let body: Vec<&str> = (0..WORDS_PER_NOTE).map(|_| word().as_str()).collect();
            NoteDoc {
                path: format!("Area {}/Project {}/{title}.md", i % 17, i % 101),
                headings: vec![format!("{} {}", word(), word())],
                body: body.join(" "),
                tags: vec![format!("t{}", i % 97), format!("area/{}", i % 17)],
                mtime: i as f64,
                title,
            }
        })
        .collect()
}

fn build_index(notes: &[NoteDoc]) -> SearchIndex {
    let start = Instant::now();
    let index = SearchIndex::in_memory().unwrap();
    for note in notes {
        index.upsert(note).unwrap();
    }
    index.commit().unwrap();
    eprintln!("indexed {} notes in {:?}", notes.len(), start.elapsed());
    index
}

const QUERIES: [&str; 12] = [
    "project",
    "project meeting ",
    "ostra",
    "ka",
    "lolo",
    "\"project meeting\"",
    "tag:t42",
    "#area/3 plan",
    "path:area 1/ idea",
    "rust -search",
    "idea OR plan",
    "lokami tra",
];

fn report_percentiles(index: &SearchIndex) {
    let mut samples: Vec<Duration> = Vec::new();
    for _ in 0..20 {
        for query in QUERIES {
            let start = Instant::now();
            black_box(index.search(query, 50).unwrap());
            samples.push(start.elapsed());
        }
    }
    samples.sort();
    let pct = |p: f64| samples[((samples.len() - 1) as f64 * p) as usize];
    eprintln!(
        "search over {NOTES} notes: p50 {:?}, p95 {:?}, max {:?}",
        pct(0.5),
        pct(0.95),
        samples[samples.len() - 1]
    );
}

fn benches(c: &mut Criterion) {
    let notes = synthetic_notes();
    let index = build_index(&notes);
    report_percentiles(&index);

    let mut group = c.benchmark_group("search");
    for query in QUERIES {
        group.bench_function(query, |b| {
            b.iter(|| black_box(index.search(black_box(query), 50).unwrap()))
        });
    }
    group.finish();

    let candidates: Vec<QuickOpenCandidate> = notes
        .iter()
        .map(|n| QuickOpenCandidate {
            path: n.path.clone(),
            title: n.title.clone(),
            mtime: n.mtime,
        })
        .collect();
    let mut group = c.benchmark_group("quick_open");
    for query in ["", "o", "prj 42", "ostra", "area 3/proj 7"] {
        group.bench_function(format!("{query:?}"), |b| {
            b.iter(|| black_box(quick_open::rank(black_box(query), &candidates, 50)))
        });
    }
    group.finish();
}

criterion_group! {
    name = search;
    config = Criterion::default().sample_size(20);
    targets = benches
}
criterion_main!(search);
