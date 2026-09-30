use serde::{Deserialize, Deserializer, Serialize};
use specta::Type;

use crate::CoreError;

/// A feature that sits behind the Pro flag.
///
/// Entitlements are local feature flags only: there is no licence server and
/// no network check. Adding a variant here is the whole of gating a new
/// feature; call [`Entitlements::require`] at the top of its command.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "camelCase")]
pub enum ProFeature {
    /// Live translation of a transcript while it is being recorded.
    RealtimeTranslation,
    /// Asking questions of a PDF, answered with page citations.
    PdfAiQa,
    /// Cloud summaries and research on premium hosted models.
    PremiumCloudModels,
}

impl ProFeature {
    pub const ALL: [ProFeature; 3] = [
        ProFeature::RealtimeTranslation,
        ProFeature::PdfAiQa,
        ProFeature::PremiumCloudModels,
    ];
}

/// Which Pro features are switched on, persisted as `entitlements.json`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct Entitlements {
    /// Sorted and de-duplicated. Unknown ids in the file (a feature removed
    /// in a later version) are dropped on load rather than failing the
    /// whole file, which `json_store` would otherwise quarantine.
    #[serde(deserialize_with = "known_features")]
    enabled: Vec<ProFeature>,
}

/// One row of the Pro features list the settings UI renders.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FeatureEntitlement {
    pub feature: ProFeature,
    pub enabled: bool,
}

impl Entitlements {
    pub fn is_entitled(&self, feature: ProFeature) -> bool {
        self.enabled.binary_search(&feature).is_ok()
    }

    /// `Ok(())` when the feature is on, `NotEntitled` otherwise.
    pub fn require(&self, feature: ProFeature) -> Result<(), CoreError> {
        if self.is_entitled(feature) {
            Ok(())
        } else {
            Err(CoreError::NotEntitled { feature })
        }
    }

    pub fn set(&mut self, feature: ProFeature, enabled: bool) {
        match (self.enabled.binary_search(&feature), enabled) {
            (Err(at), true) => self.enabled.insert(at, feature),
            (Ok(at), false) => {
                self.enabled.remove(at);
            }
            _ => {}
        }
    }

    /// Every known feature with its current state, in declaration order.
    pub fn list(&self) -> Vec<FeatureEntitlement> {
        ProFeature::ALL
            .iter()
            .map(|&feature| FeatureEntitlement {
                feature,
                enabled: self.is_entitled(feature),
            })
            .collect()
    }
}

fn known_features<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<ProFeature>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum MaybeFeature {
        Known(ProFeature),
        #[allow(dead_code)]
        Unknown(serde::de::IgnoredAny),
    }

    let mut features: Vec<ProFeature> = Vec::<MaybeFeature>::deserialize(deserializer)?
        .into_iter()
        .filter_map(|f| match f {
            MaybeFeature::Known(feature) => Some(feature),
            MaybeFeature::Unknown(_) => None,
        })
        .collect();
    features.sort();
    features.dedup();
    Ok(features)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_entitled_by_default() {
        let e = Entitlements::default();
        for feature in ProFeature::ALL {
            assert!(!e.is_entitled(feature));
            assert_eq!(e.require(feature), Err(CoreError::NotEntitled { feature }));
        }
    }

    #[test]
    fn set_toggles_one_feature() {
        let mut e = Entitlements::default();
        e.set(ProFeature::PdfAiQa, true);
        e.set(ProFeature::PdfAiQa, true);
        assert!(e.is_entitled(ProFeature::PdfAiQa));
        assert!(!e.is_entitled(ProFeature::RealtimeTranslation));
        assert_eq!(e.require(ProFeature::PdfAiQa), Ok(()));

        e.set(ProFeature::PdfAiQa, false);
        assert!(!e.is_entitled(ProFeature::PdfAiQa));
    }

    #[test]
    fn list_covers_every_feature_in_order() {
        let mut e = Entitlements::default();
        e.set(ProFeature::PremiumCloudModels, true);
        let list = e.list();
        assert_eq!(
            list.iter().map(|f| f.feature).collect::<Vec<_>>(),
            ProFeature::ALL.to_vec()
        );
        assert!(list[2].enabled);
        assert!(!list[0].enabled);
    }

    #[test]
    fn unknown_and_duplicate_ids_are_dropped_on_load() {
        let e: Entitlements = serde_json::from_str(
            r#"{"enabled":["pdfAiQa","somethingRemoved","pdfAiQa","realtimeTranslation"]}"#,
        )
        .unwrap();
        assert!(e.is_entitled(ProFeature::PdfAiQa));
        assert!(e.is_entitled(ProFeature::RealtimeTranslation));
        assert_eq!(e.list().iter().filter(|f| f.enabled).count(), 2);
    }

    #[test]
    fn round_trips_through_json() {
        let mut e = Entitlements::default();
        e.set(ProFeature::RealtimeTranslation, true);
        let json = serde_json::to_string(&e).unwrap();
        assert_eq!(json, r#"{"enabled":["realtimeTranslation"]}"#);
        assert_eq!(serde_json::from_str::<Entitlements>(&json).unwrap(), e);
    }
}
