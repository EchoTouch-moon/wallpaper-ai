//! Asset pool for P2.2 region-level swap.
//!
//! Scans a directory for image files and keeps the per-slot assignment +
//! round-robin cursors. The pool is the source of truth for "which asset is
//! shown in which slot": the custom-protocol handler serializes it into
//! `/manifest.json` (read by the renderer at page load, so a rebuilt
//! generation always boots with the current assignment), and the control
//! server advances it on `POST /swap`.
//!
//! Slot ids mirror the renderer's `triptych_desktop_equal` template from
//! @wallpaper/core. The renderer owns template geometry; the host only keys
//! the assignment map by these ids.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Template slot order for initial assignment. Must match
/// `WALLPAPER_TEMPLATES` → `triptych_desktop_equal` in @wallpaper/core.
pub const TEMPLATE_SLOTS: &[&str] = &["left", "center", "right"];

/// Accepted image extensions. Everything else in the directory is ignored.
const IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp"];

/// Only these characters are allowed in asset file names. The pool's names
/// are embedded verbatim into JSON (manifest + evaluate_script payloads), so
/// a conservative allowlist removes any escaping/injection concern.
fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')
        })
        && !name.starts_with('.')
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetEntry {
    /// File name (also the asset id stem). Safe per `safe_name`.
    pub name: String,
    /// Human-free stable id = file stem.
    pub id: String,
}

pub struct AssetPool {
    assets_dir: PathBuf,
    /// Scanned assets, sorted by name for stable round-robin order.
    assets: Vec<AssetEntry>,
    /// slot id → index into `assets` currently displayed.
    assignment: HashMap<String, usize>,
    /// slot id → next index to consider when rotating.
    cursors: HashMap<String, usize>,
}

impl AssetPool {
    /// Scan `dir` for images and build the initial assignment: template slots
    /// take assets in scan order; slots beyond the asset count stay empty
    /// (renderer falls back to its gradient placeholder for those).
    pub fn scan(dir: &Path) -> anyhow::Result<Self> {
        let mut pool = Self {
            assets_dir: dir.to_path_buf(),
            assets: Vec::new(),
            assignment: HashMap::new(),
            cursors: HashMap::new(),
        };
        pool.rescan()?;
        Ok(pool)
    }

    /// Re-scan the directory. Cursors/assignments are preserved by asset id
    /// where possible; entries that disappeared are dropped and assignment
    /// indexes re-pointed.
    pub fn rescan(&mut self) -> anyhow::Result<()> {
        let mut scanned: Vec<AssetEntry> = Vec::new();
        for entry in fs::read_dir(&self.assets_dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let ext_ok = Path::new(&name)
                .extension()
                .map(|e| {
                    let e = e.to_string_lossy().to_ascii_lowercase();
                    IMAGE_EXTS.contains(&e.as_str())
                })
                .unwrap_or(false);
            if !ext_ok || !safe_name(&name) {
                if !safe_name(&name) && ext_ok {
                    eprintln!("[assets] skipped unsafe file name: {:?}", name);
                }
                continue;
            }
            let id = Path::new(&name)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| name.clone());
            scanned.push(AssetEntry { name, id });
        }
        scanned.sort_by(|a, b| a.name.cmp(&b.name));
        eprintln!("[assets] scanned {} image(s) from {:?}", scanned.len(), self.assets_dir);

        // Re-point assignment/cursors from asset ids to new indexes.
        let old_assignment: HashMap<String, String> = self
            .assignment
            .iter()
            .filter_map(|(slot, idx)| {
                self.assets
                    .get(*idx)
                    .map(|a| (slot.clone(), a.id.clone()))
            })
            .collect();
        self.assets = scanned;
        self.assignment.clear();
        self.cursors.clear();
        for (slot, asset_id) in old_assignment {
            if let Some(idx) = self.assets.iter().position(|a| a.id == asset_id) {
                self.assignment.insert(slot.clone(), idx);
                self.cursors.insert(slot, idx);
            }
        }
        // Initial assignment only for slots that have none yet.
        for (i, slot) in TEMPLATE_SLOTS.iter().enumerate() {
            if !self.assignment.contains_key(*slot) && !self.assets.is_empty() {
                let idx = i % self.assets.len();
                self.assignment.insert(slot.to_string(), idx);
                self.cursors.insert(slot.to_string(), idx);
            }
        }
        Ok(())
    }

    pub fn asset_count(&self) -> usize {
        self.assets.len()
    }

    /// Whether `name` is a currently-scanned asset (protocol handler gate:
    /// only pool-known names are ever served from disk).
    pub fn knows_file(&self, name: &str) -> bool {
        self.assets.iter().any(|a| a.name == name)
    }

    pub fn file_path(&self, name: &str) -> PathBuf {
        self.assets_dir.join(name)
    }

    /// `"/assets/<name>"` URL for asset index `i`.
    fn asset_url(&self, idx: usize) -> Option<String> {
        self.assets.get(idx).map(|a| format!("/assets/{}", a.name))
    }

    /// Serialize the manifest the renderer consumes at page load:
    /// `{assets:[{id,url}...], assignment:{slot:assetId...}}`.
    pub fn manifest_json(&self) -> String {
        let mut out = String::from("{\"assets\":[");
        for (i, a) in self.assets.iter().enumerate() {
            if i > 0 {
                out.push(',');
            }
            // safe_name guarantees only [A-Za-z0-9._-], no escaping needed.
            out.push_str(&format!(
                "{{\"id\":\"{}\",\"url\":\"/assets/{}\"}}",
                a.id, a.name
            ));
        }
        out.push_str("],\"assignment\":");
        out.push_str(&self.assignment_json());
        out.push('}');
        out
    }

    /// Just the assignment map: `{slot:assetId,...}`.
    pub fn assignment_json(&self) -> String {
        let mut out = String::from("{");
        let mut first = true;
        for slot in TEMPLATE_SLOTS {
            if let Some(idx) = self.assignment.get(*slot) {
                if let Some(a) = self.assets.get(*idx) {
                    if !first {
                        out.push(',');
                    }
                    out.push_str(&format!("\"{}\":\"{}\"", slot, a.id));
                    first = false;
                }
            }
        }
        out.push('}');
        out
    }

    /// Advance one slot (or every slot when `slot` is None) to its next asset,
    /// skipping the currently shown one. Returns the (slot, url) pairs that
    /// changed, in template order. Empty result = nothing to rotate to (0 or
    /// 1 asset). The assignment is updated here; the caller is responsible
    /// for pushing the change to the live renderer.
    pub fn rotate(&mut self, slot: Option<&str>) -> Vec<(String, String)> {
        let slots: Vec<&str> = match slot {
            Some(s) if TEMPLATE_SLOTS.contains(&s) => vec![s],
            Some(_) => return Vec::new(), // unknown slot id — ignore
            None => TEMPLATE_SLOTS.to_vec(),
        };
        let mut swaps = Vec::new();
        for s in slots {
            let next = self.next_index_for(s);
            if let Some(idx) = next {
                self.assignment.insert(s.to_string(), idx);
                self.cursors.insert(s.to_string(), idx);
                if let Some(url) = self.asset_url(idx) {
                    swaps.push((s.to_string(), url));
                }
            }
        }
        swaps
    }

    /// Round-robin: advance from the cursor until an asset different from the
    /// currently assigned one AND not held by any other slot is found (a
    /// wallpaper showing the same photo twice is never desirable). If every
    /// other asset is held by other slots (pool barely bigger than the slot
    /// count), fall back to skipping only the slot's own current. `None` when
    /// rotation is impossible (no assets, or a single asset can't move).
    fn next_index_for(&self, slot: &str) -> Option<usize> {
        if self.assets.len() < 2 {
            return None;
        }
        let current = self.assignment.get(slot).copied();
        let others: Vec<usize> = self
            .assignment
            .iter()
            .filter(|(s, _)| s.as_str() != slot)
            .map(|(_, idx)| *idx)
            .collect();
        let start = *self.cursors.get(slot).unwrap_or(&0);
        let scan = |skip: &[usize]| {
            let mut idx = start;
            for _ in 0..self.assets.len() {
                idx = (idx + 1) % self.assets.len();
                if !skip.contains(&idx) {
                    return Some(idx);
                }
            }
            None
        };
        // Preferred: avoid own current + every other slot's asset.
        let mut avoided = vec![current.unwrap_or(usize::MAX)];
        avoided.extend_from_slice(&others);
        if let Some(idx) = scan(&avoided) {
            return Some(idx);
        }
        // Fallback: only avoid own current.
        scan(&[current.unwrap_or(usize::MAX)])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pool_with(n: usize) -> AssetPool {
        let mut p = AssetPool {
            assets_dir: PathBuf::from("."),
            assets: (0..n)
                .map(|i| AssetEntry {
                    name: format!("img{}.jpg", i),
                    id: format!("img{}", i),
                })
                .collect(),
            assignment: HashMap::new(),
            cursors: HashMap::new(),
        };
        for (i, slot) in TEMPLATE_SLOTS.iter().enumerate() {
            if n > 0 {
                let idx = i % n;
                p.assignment.insert(slot.to_string(), idx);
                p.cursors.insert(slot.to_string(), idx);
            }
        }
        p
    }

    #[test]
    fn initial_assignment_maps_slots_in_order() {
        let p = pool_with(6);
        assert_eq!(p.assignment.get("left"), Some(&0));
        assert_eq!(p.assignment.get("center"), Some(&1));
        assert_eq!(p.assignment.get("right"), Some(&2));
    }

    #[test]
    fn rotate_single_slot_skips_current() {
        let mut p = pool_with(6);
        let swaps = p.rotate(Some("center"));
        assert_eq!(swaps, vec![("center".into(), "/assets/img3.jpg".into())]);
        let swaps = p.rotate(Some("center"));
        assert_eq!(swaps, vec![("center".into(), "/assets/img4.jpg".into())]);
        // left/right untouched
        assert_eq!(p.assignment.get("left"), Some(&0));
    }

    #[test]
    fn rotate_never_collides_with_other_slots() {
        let mut p = pool_with(6);
        // left=0, center=1, right=2. Center must skip BOTH 1 (own) and 0/2
        // (other slots) → lands on 3, not 2.
        let swaps = p.rotate(Some("center"));
        assert_eq!(swaps, vec![("center".into(), "/assets/img3.jpg".into())]);
        assert_eq!(p.assignment.get("left"), Some(&0));
        assert_eq!(p.assignment.get("right"), Some(&2));
        // Rotate all: each slot moves to an asset no other slot holds.
        let swaps = p.rotate(None);
        assert_eq!(swaps.len(), 3);
        let idxs: Vec<usize> = p
            .assignment
            .values()
            .copied()
            .collect();
        let mut sorted = idxs.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), 3, "all slots must hold distinct assets: {:?}", idxs);
    }

    #[test]
    fn tiny_pool_falls_back_to_own_current_only() {
        // 3 assets, 3 slots: every other asset is held → collision unavoidable
        // → fallback rotates anyway (skip own current only).
        let mut p = pool_with(3);
        let swaps = p.rotate(Some("center"));
        assert_eq!(swaps, vec![("center".into(), "/assets/img2.jpg".into())]);
    }

    #[test]
    fn rotate_all_covers_every_slot() {
        let mut p = pool_with(6);
        let swaps = p.rotate(None);
        assert_eq!(swaps.len(), 3);
        // Each slot skips its own current AND the other slots' assets.
        assert_eq!(swaps[0], ("left".into(), "/assets/img3.jpg".into()));
        assert_eq!(swaps[1], ("center".into(), "/assets/img4.jpg".into()));
        assert_eq!(swaps[2], ("right".into(), "/assets/img5.jpg".into()));
    }

    #[test]
    fn single_asset_never_rotates() {
        let mut p = pool_with(1);
        assert!(p.rotate(Some("center")).is_empty());
        assert!(p.rotate(None).is_empty());
    }

    #[test]
    fn unknown_slot_is_ignored() {
        let mut p = pool_with(3);
        assert!(p.rotate(Some("nope")).is_empty());
    }

    #[test]
    fn manifest_json_shape() {
        let p = pool_with(2);
        let m = p.manifest_json();
        assert!(m.starts_with("{\"assets\":["));
        assert!(m.contains("\"assignment\":{\"left\":\"img0\",\"center\":\"img1\",\"right\":\"img0\"}"));
    }
}
