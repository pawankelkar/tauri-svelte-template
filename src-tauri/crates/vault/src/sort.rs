use std::cmp::Ordering;
use std::iter::Peekable;
use std::str::Chars;

/// Case-insensitive natural order: digit runs compare numerically, so
/// `Note 2` < `Note 10`. Ties fall back to a plain comparison so the order is
/// total and stable.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let mut x = a.chars().peekable();
    let mut y = b.chars().peekable();
    loop {
        match (x.peek().copied(), y.peek().copied()) {
            (None, None) => return a.cmp(b),
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(cx), Some(cy)) if cx.is_ascii_digit() && cy.is_ascii_digit() => {
                let dx = take_digits(&mut x);
                let dy = take_digits(&mut y);
                let tx = dx.trim_start_matches('0');
                let ty = dy.trim_start_matches('0');
                let ord = tx
                    .len()
                    .cmp(&ty.len())
                    .then_with(|| tx.cmp(ty))
                    .then_with(|| dx.len().cmp(&dy.len()));
                if ord != Ordering::Equal {
                    return ord;
                }
            }
            (Some(cx), Some(cy)) => {
                let ord = cx.to_lowercase().cmp(cy.to_lowercase());
                if ord != Ordering::Equal {
                    return ord;
                }
                x.next();
                y.next();
            }
        }
    }
}

fn take_digits(it: &mut Peekable<Chars<'_>>) -> String {
    let mut out = String::new();
    while let Some(c) = it.peek().copied() {
        if !c.is_ascii_digit() {
            break;
        }
        out.push(c);
        it.next();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn natural_order() {
        let mut v = vec!["Note 10", "note 2", "Note 1", "apple", "Banana", "Note 02b"];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(
            v,
            ["apple", "Banana", "Note 1", "note 2", "Note 02b", "Note 10"]
        );
        assert_eq!(natural_cmp("a", "A"), "a".cmp("A"));
    }
}
