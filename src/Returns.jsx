/* Leader returns and the Quartermaster's check of them. Mirrors qstore/returns.py in the Python app. */
import React, { useState } from "react";
import { db, byId, now, log, defect, flash, tx, fd, ref, user, StoresError } from "./store.js";
import { ScanInput, beep } from "./Scanning.jsx";

export const retRef = (id) => "QR-" + String(id).padStart(4, "0");
const ASSET_GOOD = { ok: "Confirmed in store, serviceable", damaged: "Found damaged at check", missing: "Not in the store at check" };
const ASSET_DAMAGED = { ok: "Damage confirmed", serviceable: "No fault found, back in stock" };
const ASSET_MISSING = { ok: "Missing confirmed", found: "Found in the store" };
const optionsFor = (l) => (l.good ? ASSET_GOOD : l.damaged ? ASSET_DAMAGED : ASSET_MISSING);
const int = (v) => parseInt(v, 10) || 0;
export const pendingReturns = () => db.S.returns.filter((r) => r.status === "pending");

function closeDefects(assetId, bookingId, kind, status, note) {
  db.S.defects.filter((d) => d.asset_id === assetId && d.booking_id === bookingId && d.kind === kind && d.status === "open")
    .forEach((d) => Object.assign(d, { status, closed_at: now(), closed_by: db.me.id, closed_notes: note }));
}

function checkReturn(ret, decisions, fixes, notes) {
  const bId = ret.booking_id, r = ref(bId), rr = retRef(ret.id);
  for (const l of ret.lines) {
    const t = byId("types", l.type_id), issued = byId("issued", l.issued_id);
    let result;
    if (l.asset_id) {
      const a = byId("assets", l.asset_id);
      let choice = decisions[l.id] || "ok";
      const expected = l.good ? "in" : l.damaged ? "repair" : "lost";
      if (choice !== "ok" && a.status !== expected)
        throw new StoresError(`${a.tag} has changed since it was returned, so it can't be corrected here. Use its own page instead.`);
      if (l.good && choice === "damaged") {
        Object.assign(a, { status: "repair", condition: "Unserviceable" }); Object.assign(issued, { returned_qty: 0, damaged_qty: 1 });
        defect({ kind: "damage", type_id: t.id, asset_id: a.id, booking_id: bId, description: `Found damaged when ${rr} was checked` + (notes ? `: ${notes}` : "") });
        log("Found damaged at check", `${a.tag} ${t.name} returned on ${r}`, { booking_id: bId, asset_id: a.id, type_id: t.id });
      } else if (l.good && choice === "missing") {
        Object.assign(a, { status: "lost", condition: "Missing" }); Object.assign(issued, { returned_qty: 0, lost_qty: 1 });
        defect({ kind: "loss", type_id: t.id, asset_id: a.id, booking_id: bId, description: `Marked returned by the leader but not in the store when ${rr} was checked` });
        log("Not in store at check", `${a.tag} ${t.name} marked returned on ${r}`, { booking_id: bId, asset_id: a.id, type_id: t.id });
      } else if (l.damaged && choice === "serviceable") {
        Object.assign(a, { status: "in", condition: "Serviceable" }); Object.assign(issued, { returned_qty: 1, damaged_qty: 0 });
        closeDefects(a.id, bId, "damage", "repaired", "No fault found at return check");
        log("No fault found", `${a.tag} ${t.name} returned on ${r}`, { booking_id: bId, asset_id: a.id, type_id: t.id });
      } else if (l.missing && choice === "found") {
        Object.assign(a, { status: "in", condition: "Serviceable" }); Object.assign(issued, { returned_qty: 1, lost_qty: 0 });
        closeDefects(a.id, bId, "loss", "found", "Found in the store at return check");
        log("Found", `${a.tag} ${t.name} at return check on ${r}`, { booking_id: bId, asset_id: a.id, type_id: t.id });
      } else choice = "ok";
      result = optionsFor(l)[choice];
    } else {
      const [dmg, miss] = fixes[l.id] || [0, 0];
      if (dmg < 0 || miss < 0 || dmg + miss > l.good) throw new StoresError(`${t.name}: only ${l.good} were reported back OK, so you can't correct more than that.`);
      if (dmg) { t.qty_us += dmg; issued.returned_qty -= dmg; issued.damaged_qty += dmg; defect({ kind: "damage", type_id: t.id, qty: dmg, booking_id: bId, description: `Found damaged when ${rr} was checked` + (notes ? `: ${notes}` : "") }); }
      if (miss) { t.qty_total -= miss; issued.returned_qty -= miss; issued.lost_qty += miss; defect({ kind: "loss", type_id: t.id, qty: miss, booking_id: bId, description: `Short when ${rr} was checked` }); }
      if (dmg || miss) {
        log("Return corrected", `${t.name} on ${r}: ${l.good} reported OK, ${dmg} found damaged, ${miss} short`, { booking_id: bId, type_id: t.id });
        result = `${l.good - dmg - miss} confirmed OK` + (dmg ? `, ${dmg} found damaged` : "") + (miss ? `, ${miss} short` : "");
      } else result = l.good ? "Count confirmed" : "Nothing to check";
    }
    l.check_result = result;
  }
  Object.assign(ret, { status: "checked", checked_at: now(), checked_by: db.me.id, check_notes: notes });
  log("Return checked", `${rr} on ${r} checked` + (notes ? `: ${notes}` : ""), { booking_id: bId });
}

const lineName = (l) => byId("types", l.type_id).name;
const lineTag = (l) => (l.asset_id ? byId("assets", l.asset_id).tag : "");
const LeaderSaid = ({ l }) => (
  <>{l.asset_id ? (l.good ? <span className="ok">Back, serviceable</span> : l.damaged ? <span className="warn">Damaged</span> : <span className="bad">Missing</span>)
    : <>{l.good} OK{l.damaged ? <>, <span className="warn">{l.damaged} damaged</span></> : null}{l.missing ? <>, <span className="bad">{l.missing} missing</span></> : null}</>}
    {l.notes && <small className="block muted">"{l.notes}"</small>}</>
);

export function ReturnsTable({ rows, go, showBooking = true, showChecker = true }) {
  return (
    <table className="list stack">
      <thead><tr><th>Return</th>{showBooking && <th>Booking</th>}<th>Returned by</th><th>When</th>{showChecker && <th>Checked</th>}</tr></thead>
      <tbody>{rows.map((r) => {
        const b = byId("bookings", r.booking_id);
        return (
          <tr key={r.id} className={db.me.role === "qm" ? "link" : ""} onClick={() => db.me.role === "qm" && go("retCheck", r.id)}>
            <td className="mono">{retRef(r.id)}</td>
            {showBooking && <td><span className="mono">{ref(b.id)}</span> {b.activity}</td>}
            <td>{user(r.returned_by).name}{r.by_leader ? <small className="muted"> (leader, no QM present)</small> : <small className="muted"> (QM)</small>}</td>
            <td>{fd(r.returned_at)}</td>
            {showChecker && <td>{r.status === "pending" ? <span className="pill s-part_returned">Awaiting QM check</span>
              : <><span className="ok">✓ {user(r.checked_by).name}</span> <small className="muted">{fd(r.checked_at)}</small></>}</td>}
          </tr>
        );
      })}</tbody>
    </table>
  );
}

export function Returns({ go }) {
  const pending = pendingReturns();
  const recent = db.S.returns.filter((r) => r.status === "checked").slice(-25).reverse();
  return (
    <>
      <h1>Returns</h1>
      <p className="muted">When a leader returns equipment without a Quartermaster there, it's recorded straight away and the leader is cleared of it. Check each one here: make sure everything they ticked is in the store, in the condition they reported.</p>
      <section className={`panel ${pending.length ? "alert-amber" : ""}`}>
        <h2>To check ({pending.length})</h2>
        {pending.length ? <ReturnsTable rows={pending} go={go} showChecker={false} /> : <p className="empty">Nothing waiting. All returns have been checked.</p>}
      </section>
      <section className="panel">
        <h2>Recently checked</h2>
        {recent.length ? <ReturnsTable rows={recent} go={go} /> : <p className="empty">None yet.</p>}
      </section>
    </>
  );
}

export function ReturnCheck({ go, refresh, arg }) {
  const ret = byId("returns", arg);
  const [dec, setDec] = useState({});
  const [fix, setFix] = useState({});
  const [found, setFound] = useState({});
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState(null);
  if (!ret) return <p>Not found.</p>;
  const b = byId("bookings", ret.booking_id);
  const pending = ret.status === "pending";

  const scan = (code) => {
    const l = ret.lines.find((x) => x.asset_id && lineTag(x).toUpperCase() === code.trim().toUpperCase());
    if (!l) { beep(false); return setMsg(["bad", `${code} isn't on this return.`]); }
    beep(true); setFound({ ...found, [l.id]: true }); setMsg(["ok", `✓ ${lineTag(l)} found`]);
  };
  const submit = (e) => {
    e.preventDefault();
    const fixes = Object.fromEntries(Object.entries(fix).map(([k, v]) => [k, [int(v.dmg), int(v.mis)]]));
    if (tx(() => (checkReturn(ret, dec, fixes, notes.trim()), true))) {
      flash(`${retRef(ret.id)} checked.`);
      const next = pendingReturns()[0];
      return next ? go("retCheck", next.id) : go("returns");
    }
    refresh();
  };

  return (
    <>
      <p className="crumb"><a onClick={() => go("returns")}>Returns</a> / <span className="mono">{retRef(ret.id)}</span></p>
      <h1>{pending ? "Check return" : "Return"} {retRef(ret.id)}: {b.activity}</h1>
      <div className="card facts">
        <div><span>Booking</span><b><a className="mono" onClick={() => go("booking", b.id)}>{ref(b.id)}</a></b></div>
        <div><span>Returned by</span><b>{user(ret.returned_by).name}</b><small>{ret.by_leader ? "Leader, no QM present" : "Booked in by QM"}</small></div>
        <div><span>When</span><b>{fd(ret.returned_at)}</b></div>
        <div><span>Checked</span><b>{pending ? "Not yet" : user(ret.checked_by).name}</b><small>{fd(ret.checked_at)}</small></div>
        {ret.check_notes && <div style={{ gridColumn: "1/-1" }}><span>Check notes</span>{ret.check_notes}</div>}
      </div>
      {pending ? (
        <form onSubmit={submit}>
          <section className="panel">
            <h2>What the leader returned</h2>
            <p className="hint">Find each item in the store and confirm it, or correct it. Scanning a tag marks it found.</p>
            <ScanInput placeholder="Scan an item to find it in the list…" onScan={scan} />
            <p className={`scanmsg ${msg ? msg[0] : ""}`} aria-live="polite">{msg ? msg[1] : ""}</p>
            <table className="list stack">
              <thead><tr><th>Item</th><th>Tag</th><th>Leader said</th><th>Your check</th></tr></thead>
              <tbody>{ret.lines.map((l) => (
                <tr key={l.id} className={`${found[l.id] ? "done" : ""} ${dec[l.id] && dec[l.id] !== "ok" ? "badrow" : ""}`}>
                  <td>{lineName(l)}</td><td className="mono">{lineTag(l)}</td><td><LeaderSaid l={l} /></td>
                  <td>{l.asset_id ? (
                    <select value={dec[l.id] || "ok"} onChange={(e) => setDec({ ...dec, [l.id]: e.target.value })}>
                      {Object.entries(optionsFor(l)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  ) : l.good ? (
                    <>
                      <span className="inline">
                        <label>Found damaged <input type="number" className="qty" min="0" max={l.good} value={(fix[l.id] || {}).dmg ?? 0}
                          onChange={(e) => setFix({ ...fix, [l.id]: { ...(fix[l.id] || {}), dmg: e.target.value } })} /></label>
                        <label>Short <input type="number" className="qty" min="0" max={l.good} value={(fix[l.id] || {}).mis ?? 0}
                          onChange={(e) => setFix({ ...fix, [l.id]: { ...(fix[l.id] || {}), mis: e.target.value } })} /></label>
                      </span>
                      <small className="block muted">Leave at 0 if all {l.good} are here and serviceable.</small>
                    </>
                  ) : <span className="muted">Nothing to check</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </section>
          <section className="panel sign">
            <label>Notes (optional)<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Tent 3 put away wet, aired out" /></label>
            <button className="primary big">Finish check</button>
          </section>
        </form>
      ) : (
        <section className="panel">
          <h2>Lines</h2>
          <table className="list stack"><thead><tr><th>Item</th><th>Tag</th><th>Leader said</th><th>Check result</th></tr></thead>
            <tbody>{ret.lines.map((l) => <tr key={l.id}><td>{lineName(l)}</td><td className="mono">{lineTag(l)}</td><td><LeaderSaid l={l} /></td><td>{l.check_result || "—"}</td></tr>)}</tbody></table>
        </section>
      )}
    </>
  );
}
