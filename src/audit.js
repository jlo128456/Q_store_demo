/* Stocktake rules for the demo. Mirrors qstore/audit.py in the Python app. */
import { db, byId, nid, now, log, defect, typeStock, activeTypes, ref, StoresError } from "./store.js";

export const OUTCOMES = {
  ok: ["Present", "ok"],
  ok_us: ["Present – unserviceable", "warn"],
  not_found: ["Not found", "bad"],
  found_missing: ["Missing item found", "ok"],
  found_on_issue: ["In store but on issue", "warn"],
  on_issue: ["On issue – held on voucher", "muted"],
  still_missing: ["Still missing", "bad"],
  bulk_ok: ["Count agrees", "ok"],
  bulk_over: ["Surplus", "warn"],
  bulk_short: ["Deficiency", "bad"],
  not_counted: ["Not counted", "warn"],
};
export const PROBLEMS = new Set(["not_found", "found_missing", "found_on_issue", "bulk_over", "bulk_short", "not_counted"]);
export const stRef = (id) => "ST-" + String(id).padStart(4, "0");

export const scopeTypes = (st) => activeTypes().filter((t) => !st.category || t.category === st.category);
export const categories = () => [...new Set(activeTypes().map((t) => t.category).filter(Boolean))].sort();
export const isScanned = (st, assetId) => db.S.st_scans.some((x) => x.stocktake_id === st.id && x.asset_id === assetId);
export const countFor = (st, typeId) => {
  const c = db.S.st_counts.find((x) => x.stocktake_id === st.id && x.type_id === typeId);
  return c ? c.counted : null;
};
const bookingOf = (assetId) => {
  const i = [...db.S.issued].reverse().find((x) => x.asset_id === assetId && !x.returned_at);
  return i ? i.booking_id : null;
};

/* Compare what the register expects on the shelf right now with what was scanned and counted. */
export function liveResults(st) {
  const rows = [];
  for (const t of scopeTypes(st)) {
    const base = { category: t.category, item: t.name, kind: t.kind, type_id: t.id, location: t.location };
    if (t.kind === "asset") {
      db.S.assets.filter((a) => a.type_id === t.id && a.status !== "written_off")
        .sort((a, b) => a.tag.localeCompare(b.tag)).forEach((a) => {
          const expected = ["in", "repair"].includes(a.status) ? 1 : 0;
          const found = isScanned(st, a.id) ? 1 : 0;
          const booking_id = a.status === "out" ? bookingOf(a.id) : null;
          let outcome;
          if (expected && found) outcome = a.status === "repair" ? "ok_us" : "ok";
          else if (expected) outcome = "not_found";
          else if (found) outcome = a.status === "lost" ? "found_missing" : "found_on_issue";
          else outcome = a.status === "lost" ? "still_missing" : "on_issue";
          rows.push({ ...base, asset_id: a.id, tag: a.tag, expected, counted: found, variance: found - expected, outcome, status: a.status, booking_id });
        });
    } else {
      const s = typeStock(t.id), expected = s.in + s.us, counted = countFor(st, t.id);
      const variance = counted === null ? null : counted - expected;
      const outcome = counted === null ? "not_counted" : variance === 0 ? "bulk_ok" : variance > 0 ? "bulk_over" : "bulk_short";
      rows.push({ ...base, asset_id: null, tag: "", expected, counted, variance, outcome, out: s.out, us: s.us });
    }
  }
  return rows;
}

export function summarise(rows) {
  const tagged = rows.filter((r) => r.kind === "asset" && r.expected), bulk = rows.filter((r) => r.kind === "bulk");
  return {
    tagged_expected: tagged.length,
    tagged_found: tagged.filter((r) => r.counted).length,
    bulk_lines: bulk.length,
    bulk_counted: bulk.filter((r) => r.counted !== null).length,
    problems: rows.filter((r) => PROBLEMS.has(r.outcome)).length,
    on_issue: rows.filter((r) => r.outcome === "on_issue").length,
  };
}

export function startStocktake(category, name) {
  if (db.S.stocktakes.some((s) => s.status === "open")) throw new StoresError("Finish or cancel the open stocktake first.");
  const st = { id: nid("stocktakes"), name: name || (category ? `${category} stocktake` : "Full stocktake"), category,
    status: "open", started_at: now(), started_by: db.me.id, finalised_at: null, finalised_by: null, witness: "", notes: "", adjusted: false };
  db.S.stocktakes.push(st);
  log("Stocktake started", `${stRef(st.id)} ${st.name}`);
  return st.id;
}

/* Returns [ok, level, message, assetId]. */
export function scanForStocktake(st, code, undo) {
  const c = code.trim().toUpperCase();
  const a = db.S.assets.find((x) => x.tag.toUpperCase() === c || (x.serial && x.serial.toUpperCase() === c));
  if (!a) return [false, "bad", `${code}: not on the register.`];
  const t = byId("types", a.type_id);
  if (undo) {
    db.S.st_scans = db.S.st_scans.filter((x) => !(x.stocktake_id === st.id && x.asset_id === a.id));
    return [true, "warn", `${a.tag} un-scanned.`, a.id];
  }
  if (st.category && t.category !== st.category) return [false, "warn", `${a.tag} ${t.name} is ${t.category || "uncategorised"}, outside this ${st.category} stocktake.`];
  if (a.status === "written_off") return [false, "bad", `${a.tag} ${t.name} was written off. Check it with the Quartermaster.`];
  if (isScanned(st, a.id)) return [false, "warn", `${a.tag} already counted.`];
  db.S.st_scans.push({ stocktake_id: st.id, asset_id: a.id, at: now(), user_id: db.me.id });
  const extra = a.status === "out" ? " — the register shows it ON ISSUE" : a.status === "lost" ? " — this was reported MISSING" : a.status === "repair" ? " (unserviceable)" : "";
  return [true, a.status === "out" ? "warn" : "ok", `✓ ${a.tag} ${t.name}${extra}`, a.id];
}

export function saveCounts(st, counts) {
  let n = 0;
  for (const [typeId, v] of Object.entries(counts)) {
    db.S.st_counts = db.S.st_counts.filter((x) => !(x.stocktake_id === st.id && x.type_id === +typeId));
    if (v === "" || v === null || v === undefined) continue;
    const c = parseInt(v, 10);
    if (isNaN(c) || c < 0) throw new StoresError("Counts can't be negative.");
    db.S.st_counts.push({ stocktake_id: st.id, type_id: +typeId, counted: c, at: now(), user_id: db.me.id });
    n++;
  }
  return n;
}

export function finaliseStocktake(st, apply, witness, notes) {
  const rows = liveResults(st), r0 = stRef(st.id), stamp = now();
  for (const r of rows) {
    let action = "";
    if (apply) {
      if (r.outcome === "not_found") {
        const a = byId("assets", r.asset_id);
        a.status = "lost"; a.condition = "Missing";
        defect({ kind: "loss", type_id: r.type_id, asset_id: a.id, description: `Not found at stocktake ${r0}` });
        log("Reported missing", `${r.tag} ${r.item}: not found at stocktake ${r0}`, { asset_id: a.id, type_id: r.type_id });
        action = "Marked missing; loss report raised";
      } else if (r.outcome === "found_missing") {
        const a = byId("assets", r.asset_id);
        a.status = "in"; a.condition = "Serviceable";
        db.S.defects.filter((d) => d.asset_id === a.id && d.status === "open" && d.kind === "loss")
          .forEach((d) => Object.assign(d, { status: "found", closed_at: stamp, closed_by: db.me.id, closed_notes: `Found at stocktake ${r0}` }));
        log("Found", `${r.tag} ${r.item} at stocktake ${r0}`, { asset_id: a.id, type_id: r.type_id });
        action = "Returned to stock; loss report closed";
      } else if (r.outcome === "bulk_over" || r.outcome === "bulk_short") {
        byId("types", r.type_id).qty_total += r.variance;
        log("Stock adjusted", `${r.item}: ${r.expected} → ${r.counted} on shelf (stocktake ${r0})`, { type_id: r.type_id });
        action = `Holding adjusted by ${r.variance > 0 ? "+" : ""}${r.variance}`;
      } else if (r.outcome === "found_on_issue") {
        action = r.booking_id ? `Check booking ${ref(r.booking_id)} and book it back in` : "Check and book in";
      }
    } else if (PROBLEMS.has(r.outcome)) action = "No change made";
    const { status, out, us, location, ...keep } = r;
    db.S.st_results.push({ id: nid("st_results"), stocktake_id: st.id, ...keep, action });
  }
  Object.assign(st, { status: "finalised", finalised_at: stamp, finalised_by: db.me.id, witness, notes, adjusted: !!apply });
  log("Stocktake signed off", `${r0} ${st.name}` + (apply ? " with adjustments" : " (no adjustments)") + (witness ? `, witnessed by ${witness}` : ""));
}
