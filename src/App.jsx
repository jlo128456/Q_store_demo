/* Q Store demo in React. Same screens and rules as the Python app (qstore/app.py). */
import React, { useState, useEffect, useRef } from "react";
import {
  db, GROUP, STATUS, ASSET, StoresError, today, addDays, now, fd, daysLate, ref, byId, nid, user, isQM, flash, log,
  save, tx, typeStock, outstanding, availability, shortfalls, activeTypes, blines, issuedRows, left, saveBooking,
  issueBooking, defect, returnItems, closeDefect, addAssets, overdue, onBooking, barcode,
} from "./store.js";
import { Stocktakes, Stocktake, StocktakeFinalise, StockSheet, StocktakeReport, Reports, ReportRegister, ReportOnIssue, ReportLosses, ReportMovements } from "./Audit.jsx";

const OPEN = ["requested", "reserved", "issued", "part_returned"];
const OUT = ["issued", "part_returned"];
const byStart = (a, b) => a.start_date.localeCompare(b.start_date);
const int = (v) => parseInt(v, 10) || 0;
const formData = (e) => {
  const d = Object.fromEntries(new FormData(e.currentTarget));
  if (e.nativeEvent.submitter && e.nativeEvent.submitter.name) d[e.nativeEvent.submitter.name] = e.nativeEvent.submitter.value;
  return d;
};

/* ---------- small pieces ---------- */
const Pill = ({ s }) => <span className={`pill s-${s}`}>{STATUS[s]}</span>;
const APill = ({ s }) => <span className={`pill a-${s}`}>{ASSET[s]}</span>;
const Tag = () => <span className="tagmark" title="Individually tagged">#</span>;
const Barcode = ({ text, h }) => <span dangerouslySetInnerHTML={{ __html: barcode(text, h) }} />;

function BTable({ rows, empty, late, go }) {
  if (!rows.length) return <p className="empty">{empty}</p>;
  return (
    <table className="list stack">
      <thead><tr><th>Booking</th><th>Activity</th><th>Leader</th><th>Out</th><th>Back</th><th>Status</th></tr></thead>
      <tbody>
        {rows.map((b) => (
          <tr key={b.id} className="link" onClick={() => go("booking", b.id)}>
            <td><a className="mono">{ref(b.id)}</a></td><td>{b.activity}</td><td>{user(b.leader_id).name}</td>
            <td>{fd(b.start_date)}</td>
            <td>{fd(b.end_date)}{late && <> <b className="late">{daysLate(b.end_date)}d late</b></>}</td>
            <td><Pill s={b.status} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function History({ rows }) {
  if (!rows.length) return <p className="empty">No history yet.</p>;
  return (
    <table className="list stack">
      <thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead>
      <tbody>{rows.map((h) => (
        <tr key={h.id}><td className="nowrap">{fd(h.at)}</td><td>{h.user_id ? user(h.user_id).name : ""}</td><td>{h.action}</td><td>{h.detail}</td></tr>
      ))}</tbody>
    </table>
  );
}

/* Tap-to-scan helper for people without a barcode scanner. */
function ScanBox({ placeholder, onScan, tags, label, msg }) {
  const inp = useRef(null);
  useEffect(() => { inp.current && inp.current.focus({ preventScroll: true }); });
  return (
    <>
      <input ref={inp} className="scanbox" placeholder={placeholder} autoComplete="off"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const v = e.target.value; e.target.value = ""; onScan(v); } }} />
      {tags.length > 0 && (
        <div className="sim"><b>{label}</b>
          {tags.map((t) => <button type="button" key={t} className="chip" onClick={() => onScan(t)}>{t}</button>)}
        </div>
      )}
      <p className={`scanmsg ${msg ? msg[0] : ""}`} aria-live="polite">{msg ? msg[1] : ""}</p>
    </>
  );
}

let audio;
function beep(ok) {
  try {
    audio = audio || new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 1200 : 220; o.type = ok ? "sine" : "square"; g.gain.value = 0.06;
    o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.08 : 0.3));
  } catch (e) { /* no sound */ }
}

/* ---------- screens ---------- */
function Login({ done }) {
  const users = db.S.users.filter((u) => u.active)
    .sort((a, b) => (b.role === "qm") - (a.role === "qm") || a.name.localeCompare(b.name));
  const submit = (e) => {
    e.preventDefault();
    const d = formData(e), u = byId("users", d.user_id);
    if (u && u.active && u.pin === d.pin) { db.me = u; log("Signed in", u.name); save(); done("dashboard"); }
    else { flash("Wrong name or PIN.", "error"); done(); }
  };
  return (
    <div className="login">
      <div className="brand"><span className="mark">Q</span><span><b>Q STORE</b><small>{GROUP}</small></span></div>
      <form className="card" onSubmit={submit}>
        <label>Your name
          <select name="user_id" required defaultValue="">
            <option value="">Choose…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.section ? " — " + u.section : ""}{u.role === "qm" ? " (QM)" : ""}</option>)}
          </select>
        </label>
        <label>PIN<input type="password" name="pin" inputMode="numeric" required autoComplete="off" /></label>
        <button className="primary wide">Sign in</button>
        <table className="pins"><tbody>
          <tr><td colSpan="2"><b>Demo PINs</b></td></tr>
          <tr><td>Quartermaster</td><td className="mono">1234</td></tr>
          <tr><td>Any leader</td><td className="mono">1111</td></tr>
        </tbody></table>
      </form>
      <p className="hint" style={{ textAlign: "center" }}>Sign in as the Quartermaster to issue and receive equipment, or as a leader to book it.</p>
    </div>
  );
}

function Dashboard({ go, mine }) {
  const S = db.S, t = today(), wk = addDays(7), B = S.bookings.filter(mine);
  const tot = (s) => S.assets.filter((a) => a.status === s).length;
  const ov = overdue().filter(mine);
  const defects = S.defects.filter((d) => d.status === "open").slice(-8).reverse();
  return (
    <>
      <div className="head">
        <h1>{isQM() ? "Q Store dashboard" : "My bookings"}</h1>
        <button className="primary" onClick={() => go("bookingForm")}>{isQM() ? "New booking" : "Book equipment"}</button>
      </div>
      {isQM() && (
        <div className="tiles">
          <div className="tile"><b>{tot("in")}</b><span>tagged items in store</span></div>
          <div className="tile"><b>{tot("out")}</b><span>on issue</span></div>
          <div className={`tile ${tot("repair") ? "amber" : ""}`}><b>{tot("repair")}</b><span>unserviceable</span></div>
          <div className={`tile ${tot("lost") ? "red" : ""}`}><b>{tot("lost")}</b><span>missing</span></div>
        </div>
      )}
      {ov.length > 0 && <section className="panel alert"><h2>Overdue — not returned</h2><BTable rows={ov} late go={go} /></section>}
      <div className="cols">
        <section className="panel"><h2>Due back today</h2>
          <BTable rows={B.filter((b) => OUT.includes(b.status) && b.end_date === t).sort(byStart)} empty="Nothing due back today." go={go} /></section>
        <section className="panel"><h2>To issue in the next 7 days</h2>
          <BTable rows={B.filter((b) => b.status === "reserved" && b.start_date <= wk).sort(byStart)} empty="Nothing to issue this week." go={go} /></section>
      </div>
      <section className="panel"><h2>Waiting for approval</h2>
        <BTable rows={B.filter((b) => b.status === "requested").sort(byStart)} empty={isQM() ? "No requests waiting." : "None of your bookings are waiting."} go={go} /></section>
      <section className="panel"><h2>Booked for later</h2>
        <BTable rows={B.filter((b) => b.status === "reserved" && b.start_date > wk).sort(byStart)} empty="Nothing else booked." go={go} /></section>
      <section className="panel"><h2>On issue</h2>
        <BTable rows={B.filter((b) => OUT.includes(b.status) && b.end_date > t).sort((a, b) => a.end_date.localeCompare(b.end_date))} empty="Nothing else is out." go={go} /></section>
      {isQM() && (
        <section className="panel">
          <h2>Open repair and loss reports <a style={{ marginLeft: "auto", fontSize: ".85rem", fontWeight: 400 }} onClick={() => go("defects")}>All reports →</a></h2>
          {defects.length ? (
            <table className="list stack"><thead><tr><th>Reported</th><th>Item</th><th>Type</th><th>Fault</th></tr></thead>
              <tbody>{defects.map((d) => (
                <tr key={d.id}><td>{fd(d.reported_at)}</td>
                  <td>{d.asset_id ? <><span className="mono">{byId("assets", d.asset_id).tag}</span> </> : d.qty + " × "}{byId("types", d.type_id).name}</td>
                  <td>{d.kind === "loss" ? "Missing" : "Damaged"}</td><td>{d.description}</td></tr>
              ))}</tbody></table>
          ) : <p className="empty">Everything is serviceable.</p>}
        </section>
      )}
    </>
  );
}

function Bookings({ go, mine, arg }) {
  const st = arg || "open";
  let rows = db.S.bookings.filter(mine);
  if (st === "open") rows = rows.filter((b) => OPEN.includes(b.status));
  else if (STATUS[st]) rows = rows.filter((b) => b.status === st);
  rows.sort(byStart);
  if (["returned", "cancelled", "all"].includes(st)) rows.reverse();
  const tabs = [["open", "Open"], ["requested", "Requested"], ["reserved", "Reserved"], ["issued", "On issue"], ["part_returned", "Part returned"], ["returned", "Returned"], ["cancelled", "Cancelled"], ["all", "All"]];
  return (
    <>
      <div className="head"><h1>Bookings</h1><button className="primary" onClick={() => go("bookingForm")}>New booking</button></div>
      <div className="tabs">{tabs.map(([k, l]) => <a key={k} className={st === k ? "on" : ""} onClick={() => go("bookings", k)}>{l}</a>)}</div>
      <section className="panel"><BTable rows={rows} empty="No bookings." go={go} /></section>
    </>
  );
}

function BookingForm({ go, refresh, arg }) {
  const b = arg ? byId("bookings", arg) : null;
  const [f, setF] = useState(() => b
    ? { activity: b.activity, leader_id: b.leader_id, start_date: b.start_date, end_date: b.end_date, notes: b.notes,
        lines: Object.fromEntries(db.S.lines.filter((l) => l.booking_id === b.id).map((l) => [l.type_id, l.qty])) }
    : { activity: "", leader_id: "", start_date: addDays(3), end_date: addDays(5), notes: "", lines: {} });
  const [filter, setFilter] = useState("");
  const [problems, setProblems] = useState([]);
  const [override, setOverride] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setQty = (id, v) => setF({ ...f, lines: { ...f.lines, [id]: v } });
  const datesOk = f.start_date && f.end_date && f.end_date >= f.start_date;
  const avail = {};
  if (datesOk) availability(f.start_date, f.end_date, b ? b.id : null).forEach((r) => (avail[r.t.id] = r.a));

  const submit = (e) => {
    e.preventDefault();
    const lines = {};
    for (const [k, v] of Object.entries(f.lines)) if (int(v) > 0) lines[k] = int(v);
    const data = { activity: f.activity.trim(), notes: f.notes.trim(), start_date: f.start_date, end_date: f.end_date,
      leader_id: isQM() ? int(f.leader_id) : db.me.id };
    if (!data.leader_id) { flash("Choose the leader responsible.", "error"); return refresh(); }
    const probs = shortfalls(lines, data.start_date, data.end_date, b ? b.id : null);
    if (probs.length && !(isQM() && override)) { probs.forEach((p) => flash(p, "error")); setProblems(probs); return refresh(); }
    const id = tx(() => {
      const id = saveBooking(data, lines, b ? b.id : null, isQM() ? "reserved" : "requested");
      log(`Booking ${b ? "updated" : isQM() ? "booked" : "requested"}`, `${ref(id)} ${data.activity}`, { booking_id: id });
      return id;
    });
    if (id) { flash(`${b ? "Updated" : isQM() ? "Booked" : "Requested"} ${ref(id)}.` + (isQM() ? "" : " The Quartermaster will confirm it.")); go("booking", id); }
    else refresh();
  };

  return (
    <>
      <h1>{b ? "Change booking " + ref(b.id) : isQM() ? "New booking" : "Book equipment"}</h1>
      <form onSubmit={submit}>
        <div className="card grid2">
          <label className="span2">Activity or camp<input name="activity" required value={f.activity} onChange={set("activity")} placeholder="e.g. Scout patrol camp – Bunya" /></label>
          {isQM() ? (
            <label>Leader responsible
              <select name="leader_id" required value={f.leader_id} onChange={set("leader_id")}>
                <option value="">Choose…</option>
                {db.S.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}{u.section ? " — " + u.section : ""}</option>)}
              </select>
            </label>
          ) : <label>Leader responsible<input value={db.me.name} disabled /></label>}
          <div className="grid2" style={{ gap: "0 .7rem" }}>
            <label>Collect from store<input type="date" id="start" name="start_date" required value={f.start_date}
              onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: f.end_date < e.target.value ? e.target.value : f.end_date })} /></label>
            <label>Return to store<input type="date" id="end" name="end_date" required value={f.end_date} onChange={set("end_date")} /></label>
          </div>
          <label className="span2">Notes for the Quartermaster<textarea rows="2" value={f.notes} onChange={set("notes")} /></label>
        </div>
        <div className="panel">
          <div className="head"><h2>Equipment</h2>
            <input type="search" placeholder="Filter equipment…" style={{ maxWidth: 240, margin: 0 }} value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
          <p className="hint">{datesOk ? "Free = serviceable stock not already booked or out over those dates." : "Pick the dates to see what's free."}</p>
          <table className="list"><thead><tr><th>Item</th><th>Category</th><th className="num">Free</th><th className="num">Quantity</th></tr></thead>
            <tbody>{activeTypes().map((t) => {
              const q = int(f.lines[t.id]), a = avail[t.id];
              const hidden = filter && !(t.name + " " + t.category).toLowerCase().includes(filter.toLowerCase()) && !q;
              if (hidden) return null;
              return (
                <tr key={t.id} className={`${q ? "chosen" : ""} ${a !== undefined && q > a ? "over" : ""}`}>
                  <td>{t.name}{t.kind === "asset" && <> <Tag /></>}</td><td>{t.category}</td>
                  <td className={`num avail ${a === 0 ? "bad" : ""}`}>{a ?? "–"}</td>
                  <td className="num"><input type="number" min="0" className="qty" name={`qty_${t.id}`} value={f.lines[t.id] || ""} onChange={(e) => setQty(t.id, e.target.value)} /></td>
                </tr>
              );
            })}</tbody></table>
        </div>
        {problems.length > 0 && isQM() && (
          <label className="check warnbox"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Book anyway, even though some items are short</label>
        )}
        <div className="actions">
          <button className="primary">{b ? "Save changes" : isQM() ? "Book and reserve" : "Send request"}</button>
          <a onClick={() => (b ? go("booking", b.id) : go("bookings"))}>Cancel</a>
        </div>
      </form>
    </>
  );
}

function Booking({ go, refresh, arg, mine }) {
  const b = byId("bookings", arg);
  const [override, setOverride] = useState(false);
  if (!b || !mine(b)) return <p>Not found.</p>;
  const L = blines(b.id), I = issuedRows(b.id), ld = user(b.leader_id), Q = isQM(), onIssue = OUT.includes(b.status);
  const probs = ["requested", "reserved"].includes(b.status)
    ? shortfalls(Object.fromEntries(L.map((l) => [l.type_id, l.qty])), b.start_date, b.end_date, b.id) : [];
  const outN = Object.values(outstanding(b.id)).reduce((a, c) => a + c, 0);

  const approve = () => {
    if (probs.length && !override) { probs.forEach((p) => flash(p, "error")); flash("Change the booking, or tick 'Approve anyway' to over-book.", "warn"); return refresh(); }
    tx(() => { b.status = "reserved"; log("Booking approved", ref(b.id), { booking_id: b.id }); });
    flash(`${ref(b.id)} approved and the equipment reserved.`); refresh();
  };
  const extend = (e) => {
    e.preventDefault(); const d = formData(e);
    if (d.end_date < b.start_date) { flash("The new return date is before the issue date.", "error"); return refresh(); }
    tx(() => { log("Return date changed", `${fd(b.end_date)} → ${fd(d.end_date)}`, { booking_id: b.id }); b.end_date = d.end_date; });
    flash("Return date changed."); refresh();
  };
  const cancel = (e) => {
    e.preventDefault(); const d = formData(e);
    tx(() => { b.status = "cancelled"; b.closed_at = now(); log("Booking cancelled", d.reason || "", { booking_id: b.id }); });
    flash(`${ref(b.id)} cancelled.`); refresh();
  };

  return (
    <>
      <div className="head">
        <div><p className="crumb"><a onClick={() => go("bookings")}>Bookings</a> / <span className="mono">{ref(b.id)}</span></p>
          <h1>{b.activity} <Pill s={b.status} /></h1></div>
        <div className="btns">
          {Q && b.status === "requested" && (
            <span className="inline">
              {probs.length > 0 && <label className="check"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Approve anyway</label>}
              <button className="primary" onClick={approve}>Approve &amp; reserve</button>
            </span>
          )}
          {Q && ["reserved", ...OUT].includes(b.status) &&
            <button className={b.status === "reserved" ? "primary" : ""} onClick={() => go("issue", b.id)}>{b.status === "reserved" ? "Issue equipment" : "Issue more"}</button>}
          {Q && onIssue && <button className="primary" onClick={() => go("ret", b.id)}>Book return</button>}
          {["requested", "reserved"].includes(b.status) && (Q || b.status === "requested") && <button onClick={() => go("bookingForm", b.id)}>Change</button>}
          <button onClick={() => go("voucher", b.id)}>{b.issued_at ? "Issue voucher" : "Booking sheet"}</button>
        </div>
      </div>
      {onIssue && b.end_date < today() &&
        <div className="flash error">Overdue: due back {fd(b.end_date)}, {daysLate(b.end_date)} days late. Contact {ld.name}{ld.phone ? " on " + ld.phone : ""}.</div>}
      {probs.map((p) => <div key={p} className="flash warn">Short: {p}</div>)}
      <div className="card facts">
        <div><span>Leader responsible</span><b>{ld.name}</b><small>{ld.section}</small><small>{ld.phone}</small></div>
        <div><span>Collect</span><b>{fd(b.start_date)}</b></div>
        <div><span>Return by</span><b>{fd(b.end_date)}</b>
          {Q && ["reserved", ...OUT].includes(b.status) && (
            <details><summary>Change date</summary>
              <form className="inline" onSubmit={extend}><input type="date" name="end_date" defaultValue={b.end_date} required /><button>Save</button></form>
            </details>
          )}
        </div>
        <div><span>Signed for</span><b>{b.signed_by ? user(b.signed_by).name : "—"}</b><small>{fd(b.issued_at)}</small></div>
        {b.notes && <div style={{ gridColumn: "1/-1" }}><span>Notes</span>{b.notes}</div>}
      </div>
      <div className="cols">
        <section className="panel"><h2>Booked</h2>
          <table className="list"><thead><tr><th>Item</th><th className="num">Qty</th></tr></thead>
            <tbody>{L.map((l) => <tr key={l.id}><td>{l.t.name}</td><td className="num">{l.qty}</td></tr>)}</tbody></table>
        </section>
        <section className="panel"><h2>Issued{outN > 0 && <small className="muted">— {outN} still out</small>}</h2>
          {I.length ? (
            <table className="list"><thead><tr><th>Item</th><th>Tag</th><th className="num">Out</th><th>Returned</th></tr></thead>
              <tbody>{I.map((i) => {
                const l = left(i);
                return (
                  <tr key={i.id} className={l === 0 ? "done" : ""}>
                    <td>{i.t.name}</td>
                    <td>{i.a && <a className="mono" onClick={() => go("asset", i.a.id)}>{i.a.tag}</a>}</td>
                    <td className="num">{i.qty}</td>
                    <td>
                      {l === 0 && !i.damaged_qty && !i.lost_qty ? <span className="ok">✓ {fd(i.returned_at)}</span> : <>
                        {i.returned_qty > 0 && !i.a && <>{i.returned_qty} back </>}
                        {i.damaged_qty > 0 && <span className="warn">{i.a ? "" : i.damaged_qty + " "}damaged </span>}
                        {i.lost_qty > 0 && <span className="bad">{i.a ? "" : i.lost_qty + " "}missing </span>}
                        {l > 0 && <span className="muted">{l} out</span>}
                      </>}
                      {i.return_notes && <small className="block muted">{i.return_notes}</small>}
                    </td>
                  </tr>
                );
              })}</tbody></table>
          ) : <p className="empty">Nothing issued yet.</p>}
        </section>
      </div>
      <section className="panel"><h2>History</h2><History rows={db.S.log.filter((l) => l.booking_id === b.id).reverse()} /></section>
      {["requested", "reserved"].includes(b.status) && (
        <form className="inline" style={{ marginTop: "1.5rem" }} onSubmit={cancel}>
          <input name="reason" placeholder="Reason (optional)" /><button className="danger">Cancel booking</button>
        </form>
      )}
    </>
  );
}

function Issue({ go, refresh, arg }) {
  const b = byId("bookings", arg), L = blines(b.id), ld = user(b.leader_id);
  const [scanned, setScanned] = useState([]);
  const [msg, setMsg] = useState(null);
  const [pin, setPin] = useState("");
  const already = {};
  issuedRows(b.id).forEach((i) => (already[i.type_id] = (already[i.type_id] || 0) + i.qty));
  const [bulk, setBulk] = useState(() => Object.fromEntries(L.filter((l) => l.t.kind === "bulk")
    .map((l) => [l.type_id, Math.min(Math.max(l.qty - (already[l.type_id] || 0), 0), typeStock(l.type_id).in)])));
  const cnt = {};
  scanned.forEach((id) => { const a = byId("assets", id); cnt[a.type_id] = (cnt[a.type_id] || 0) + 1; });
  const short = L.filter((l) => l.t.kind === "asset").map((l) => {
    const need = Math.max(l.qty - (already[l.type_id] || 0), 0), n = cnt[l.type_id] || 0;
    return n < need ? `${l.t.name}: ${need - n} short` : null;
  }).filter(Boolean);
  const tags = [];
  L.filter((l) => l.t.kind === "asset").forEach((l) =>
    tags.push(...db.S.assets.filter((a) => a.type_id === l.type_id && a.status === "in").slice(0, l.qty + 1).map((a) => a.tag)));
  const busy = db.S.assets.find((a) => a.status === "out" && L.some((l) => l.type_id === a.type_id));
  if (busy) tags.push(busy.tag);
  tags.push("XYZ-999");

  const scan = (code) => {
    code = code.trim().toUpperCase(); if (!code) return;
    const a = db.S.assets.find((x) => x.tag.toUpperCase() === code || (x.serial && x.serial.toUpperCase() === code));
    if (!a) { beep(false); return setMsg(["bad", `${code}: not on the register.`]); }
    const name = byId("types", a.type_id).name;
    if (scanned.includes(a.id)) { beep(false); return setMsg(["warn", `${a.tag} is already scanned.`]); }
    if (a.status !== "in") { beep(false); const ob = onBooking(a.id); return setMsg(["bad", `${a.tag} ${name} can't be issued: ${ASSET[a.status]}${ob ? " on " + ref(ob) : ""}.`]); }
    beep(true); setScanned([...scanned, a.id]);
    setMsg(L.some((l) => l.type_id === a.type_id) ? ["ok", `✓ ${a.tag} ${name}`] : ["warn", `${a.tag} ${name} added — note: not on the booking.`]);
  };
  const submit = (e) => {
    e.preventDefault();
    if (ld.pin !== pin) { flash(`${ld.name} must enter their own PIN to sign for the equipment.`, "error"); return refresh(); }
    const q = Object.fromEntries(Object.entries(bulk).map(([k, v]) => [k, int(v)]));
    if (tx(() => (issueBooking(b, scanned, q, ld), true))) { flash(`Equipment issued on ${ref(b.id)} and signed for by ${ld.name}.`); go("booking", b.id); }
    else refresh();
  };

  return (
    <>
      <p className="crumb"><a className="mono" onClick={() => go("booking", b.id)}>{ref(b.id)}</a> / Issue</p>
      <h1>Issue: {b.activity}</h1>
      <p>To <b>{ld.name}</b>, return by <b>{fd(b.end_date)}</b>.</p>
      <form onSubmit={submit}>
        <div className="cols">
          <section className="panel"><h2>1. Scan tagged items</h2>
            <ScanBox placeholder="Scan the barcode on each item…" onScan={scan} tags={tags} msg={msg}
              label="No scanner? Tap a tag to scan it. The last ones show what happens with an item already out or not on the register." />
            {scanned.length ? (
              <table className="list"><thead><tr><th>Tag</th><th>Item</th><th></th></tr></thead>
                <tbody>{[...scanned].reverse().map((id) => {
                  const a = byId("assets", id);
                  return <tr key={id}><td className="mono">{a.tag}</td><td>{byId("types", a.type_id).name}</td>
                    <td><button type="button" className="link" onClick={() => setScanned(scanned.filter((x) => x !== id))}>Remove</button></td></tr>;
                })}</tbody></table>
            ) : <p className="empty">Nothing scanned yet.</p>}
          </section>
          <section className="panel"><h2>Checklist</h2>
            <table className="list"><thead><tr><th>Item</th><th className="num">Booked</th><th className="num">Already out</th><th className="num">This issue</th></tr></thead>
              <tbody>{L.map((l) => {
                const al = already[l.type_id] || 0, need = Math.max(l.qty - al, 0), n = cnt[l.type_id] || 0, s = typeStock(l.type_id);
                const cls = l.t.kind === "asset" ? (n >= need && need > 0 ? "done" : n < need ? "short" : "") : "";
                return (
                  <tr key={l.id} className={cls}>
                    <td>{l.t.name}{l.t.kind === "asset" && <> <Tag /></>}</td><td className="num">{l.qty}</td><td className="num">{al}</td>
                    <td className="num">{l.t.kind === "bulk" ? <>
                      <input type="number" className="qty" min="0" max={s.in} name={`bulk_${l.type_id}`} value={bulk[l.type_id]} onChange={(e) => setBulk({ ...bulk, [l.type_id]: e.target.value })} />
                      <small className="block muted">{s.in} in store</small></> : <b>{n}</b>}</td>
                  </tr>
                );
              })}</tbody></table>
          </section>
        </div>
        <section className="panel sign"><h2>2. Leader signs for the equipment</h2>
          <p>{ld.name} checks the items above and enters their own PIN. They then hold the equipment until it's booked back in.
            <span className="muted"> (Demo PIN: {ld.role === "qm" ? "1234" : "1111"})</span></p>
          <div className="signrow">
            <label>{ld.name}'s PIN<input type="password" name="pin" inputMode="numeric" required autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} /></label>
            <button className="primary big">Issue and sign for</button>
          </div>
          <p className="hint">{short.length ? `Not everything booked has been scanned — ${short.join("; ")}. You can still issue what's here.` : ""}</p>
        </section>
      </form>
    </>
  );
}

function Return({ go, refresh, arg }) {
  const b = byId("bookings", arg);
  const rows = issuedRows(b.id).filter((i) => left(i) > 0);
  const A = rows.filter((i) => i.a), Bk = rows.filter((i) => !i.a);
  const [marks, setMarks] = useState({});
  const [counts, setCounts] = useState({});
  const [msg, setMsg] = useState(null);
  const mark = (id, patch) => setMarks((m) => ({ ...m, [id]: { ...(m[id] || {}), ...patch } }));
  const cnt = (id, k, v) => setCounts((c) => ({ ...c, [id]: { ...(c[id] || {}), [k]: v } }));

  const scan = (code) => {
    code = code.trim().toUpperCase(); if (!code) return;
    const i = A.find((i) => i.a.tag.toUpperCase() === code || (i.a.serial && i.a.serial.toUpperCase() === code));
    if (!i) { beep(false); return setMsg(["bad", `${code} is not out on this booking.`]); }
    if (marks[i.id] && marks[i.id].on) { beep(false); return setMsg(["warn", `${i.a.tag} already marked back.`]); }
    beep(true); mark(i.id, { on: true }); setMsg(["ok", `✓ ${i.a.tag} ${i.t.name} — check its condition.`]);
  };
  const submit = (e) => {
    e.preventDefault();
    const assets = {}, bulk = {};
    for (const [id, m] of Object.entries(marks)) if (m.on) assets[id] = [m.cond || "good", (m.note || "").trim()];
    Bk.forEach((i) => { const c = counts[i.id] || {}; bulk[i.id] = [int(c.good), int(c.dam), int(c.miss), (c.note || "").trim()]; });
    const st = tx(() => returnItems(b, assets, bulk));
    if (st) {
      flash(st === "returned" ? `All equipment back. ${ref(b.id)} is closed.` : "Return booked in. Some equipment is still out.", st === "returned" ? "ok" : "warn");
      go("booking", b.id);
    } else refresh();
  };

  return (
    <>
      <p className="crumb"><a className="mono" onClick={() => go("booking", b.id)}>{ref(b.id)}</a> / Return</p>
      <h1>Book in: {b.activity}</h1>
      <p>From <b>{user(b.leader_id).name}</b>, due back {fd(b.end_date)}
        {b.end_date < today() && <> <b className="late">{daysLate(b.end_date)} days late</b></>}.
        Scan each item as it comes back and check its condition. Anything not marked stays on the booking as still out.</p>
      <form onSubmit={submit}>
        <section className="panel">
          <ScanBox placeholder="Scan each item coming back…" onScan={scan} msg={msg}
            tags={A.length ? A.map((i) => i.a.tag).concat(["TNT-008"]) : []} label="No scanner? Tap a tag to scan it back in." />
          {A.length > 0 && (
            <table className="list stack"><thead><tr><th>Back</th><th>Item</th><th>Tag</th><th>Condition</th><th>Notes / fault</th></tr></thead>
              <tbody>{A.map((i) => {
                const m = marks[i.id] || {};
                return (
                  <tr key={i.id} className={m.cond && m.cond !== "good" ? "badrow" : m.on ? "done" : ""}>
                    <td className="c"><input type="checkbox" aria-label="Returned" checked={!!m.on} onChange={(e) => mark(i.id, { on: e.target.checked })} /></td>
                    <td>{i.t.name}</td><td className="mono">{i.a.tag}</td>
                    <td><select value={m.cond || "good"} onChange={(e) => mark(i.id, { cond: e.target.value, on: true })}>
                      <option value="good">Serviceable</option><option value="damaged">Damaged – U/S</option><option value="missing">Missing</option></select></td>
                    <td><input className="note" placeholder="What's wrong?" value={m.note || ""} onChange={(e) => mark(i.id, { note: e.target.value })} /></td>
                  </tr>
                );
              })}</tbody></table>
          )}
          {Bk.length > 0 && <>
            <h2 style={{ marginTop: "1rem" }}>Counted items</h2>
            <table className="list stack"><thead><tr><th>Item</th><th className="num">Still out</th><th className="num">Back OK</th><th className="num">Damaged</th><th className="num">Missing</th><th>Notes</th></tr></thead>
              <tbody>{Bk.map((i) => {
                const c = counts[i.id] || {};
                return (
                  <tr key={i.id}><td>{i.t.name}</td><td className="num">{left(i)}</td>
                    {["good", "dam", "miss"].map((k) => (
                      <td key={k} className="num"><input type="number" className="qty" min="0" max={left(i)} value={c[k] ?? 0} onChange={(e) => cnt(i.id, k, e.target.value)} /></td>
                    ))}
                    <td><input className="note" placeholder="Damage or loss details" value={c.note || ""} onChange={(e) => cnt(i.id, "note", e.target.value)} /></td></tr>
                );
              })}</tbody></table>
            <p><button type="button" className="link" onClick={() => setCounts(Object.fromEntries(Bk.map((i) => [i.id, { ...(counts[i.id] || {}), good: left(i), dam: 0, miss: 0 }])))}>All counted items back OK</button></p>
          </>}
        </section>
        <div className="actions"><button className="primary big">Book in</button>
          <span className="muted">{Object.values(marks).filter((m) => m.on).length} of {A.length} tagged items marked back.</span></div>
      </form>
    </>
  );
}

function Voucher({ go, arg }) {
  const b = byId("bookings", arg), ld = user(b.leader_id), I = issuedRows(b.id);
  return (
    <>
      <p className="crumb"><a className="mono" onClick={() => go("booking", b.id)}>{ref(b.id)}</a> / {b.issued_at ? "Issue voucher" : "Booking sheet"}</p>
      <p className="hint">In the real app this page has a Print button for an A4 copy.</p>
      <div className="sheet">
        <div className="vhead"><div><small>{GROUP} · Q Store</small><h1>{b.issued_at ? "Equipment issue voucher" : "Equipment booking sheet"}</h1></div>
          <div className="vref"><Barcode text={ref(b.id)} h={40} /><b className="mono">{ref(b.id)}</b></div></div>
        <table className="vt"><tbody>
          <tr><th>Activity</th><td colSpan="3">{b.activity}</td></tr>
          <tr><th>Leader responsible</th><td>{ld.name} ({ld.section})</td><th>Phone</th><td>{ld.phone}</td></tr>
          <tr><th>Collect</th><td>{fd(b.start_date)}</td><th>Return by</th><td><b>{fd(b.end_date)}</b></td></tr>
          {b.issued_at && <tr><th>Issued</th><td>{fd(b.issued_at)} by {user(b.issued_by).name}</td><th>Signed for</th><td>{user(b.signed_by).name} (PIN)</td></tr>}
        </tbody></table>
        <div style={{ overflowX: "auto" }}>
          {I.length ? (
            <table className="vt"><thead><tr><th>Item</th><th>Tag / serial</th><th>Qty</th><th>Out ✓</th><th>Back ✓</th><th>Condition on return</th></tr></thead>
              <tbody>{I.map((i) => <tr key={i.id}><td>{i.t.name}</td><td className="mono">{i.a ? i.a.tag + (i.a.serial ? " / " + i.a.serial : "") : ""}</td><td>{i.qty}</td><td className="box" /><td className="box" /><td /></tr>)}</tbody></table>
          ) : (
            <table className="vt"><thead><tr><th>Item</th><th>Qty booked</th><th>Tags issued</th><th>✓</th></tr></thead>
              <tbody>{blines(b.id).map((l) => <tr key={l.id}><td>{l.t.name}</td><td>{l.qty}</td><td /><td className="box" /></tr>)}</tbody></table>
          )}
        </div>
        <p style={{ fontSize: ".85rem" }}>The leader named above is responsible for this equipment from issue until it is booked back in by the Quartermaster. Report any damage or loss on return.</p>
        <div className="vsign"><div>Issued by (QM)</div><div>Received by (leader)</div><div>Returned and checked by (QM)</div></div>
      </div>
    </>
  );
}

function Availability({ go }) {
  const [st, setSt] = useState(today());
  const [en, setEn] = useState(addDays(2));
  const end = en < st ? st : en;
  const rows = availability(st, end);
  const clashes = db.S.bookings.filter((b) => OPEN.includes(b.status) && b.start_date <= end && (b.end_date >= st || OUT.includes(b.status))).sort(byStart);
  return (
    <>
      <h1>What's free?</h1>
      <div className="card filters">
        <label>From<input type="date" value={st} onChange={(e) => setSt(e.target.value)} /></label>
        <label>To<input type="date" value={en} onChange={(e) => setEn(e.target.value)} /></label>
        <button type="button" onClick={() => go("bookingForm")}>Book equipment</button>
      </div>
      <section className="panel"><h2>{fd(st)} – {fd(end)}</h2>
        <div style={{ overflowX: "auto" }}>
          <table className="list"><thead><tr><th>Item</th><th className="num">Serviceable</th><th className="num">Booked / out</th><th className="num">Free</th><th className="num">U/S</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.t.id} className="link" onClick={() => go("item", r.t.id)}>
                <td>{r.t.name} <small className="muted">{r.t.category}</small></td><td className="num">{r.s.serviceable}</td><td className="num">{r.c || ""}</td>
                <td className="num"><b className={r.a === 0 ? "bad" : r.a < r.s.serviceable ? "warn" : "ok"}>{r.a}</b></td><td className="num">{r.s.us || ""}</td>
              </tr>
            ))}</tbody></table>
        </div>
        <p className="hint">Requests still waiting for approval don't hold equipment until the Quartermaster approves them. Overdue equipment counts as unavailable until it comes back.</p>
      </section>
      <section className="panel"><h2>Bookings over these dates</h2><BTable rows={clashes} empty="No other bookings over these dates." go={go} /></section>
    </>
  );
}

function Items({ go }) {
  const [q, setQ] = useState("");
  const rows = activeTypes().filter((t) => !q || (t.name + t.category + t.location).toLowerCase().includes(q.toLowerCase()));
  const find = (e) => {
    e.preventDefault();
    const a = db.S.assets.find((x) => x.tag.toUpperCase() === q.trim().toUpperCase());
    if (a) return go("asset", a.id);
    if (/^QB-\d+$/i.test(q.trim()) && byId("bookings", +q.trim().slice(3))) go("booking", +q.trim().slice(3));
  };
  return (
    <>
      <div className="head"><h1>Equipment register</h1>
        {isQM() && <div className="btns"><button onClick={() => go("labels")}>Print all labels</button><button className="primary" onClick={() => go("itemForm")}>Add equipment</button></div>}</div>
      <form className="card filters" onSubmit={find}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, or scan a tag and press Enter" style={{ maxWidth: 360 }} />
      </form>
      <section className="panel">
        <table className="list stack"><thead><tr><th>Item</th><th>Category</th><th>Location</th><th className="num">Held</th><th className="num">In store</th><th className="num">On issue</th><th className="num">U/S</th><th className="num">Missing</th></tr></thead>
          <tbody>{rows.map((t) => {
            const s = typeStock(t.id);
            return (
              <tr key={t.id} className="link" onClick={() => go("item", t.id)}>
                <td><a>{t.name}</a>{t.kind === "asset" && <> <Tag /></>}</td><td>{t.category}</td><td>{t.location}</td>
                <td className="num">{s.held}</td><td className="num"><b>{s.in}</b></td><td className="num">{s.out || ""}</td>
                <td className="num warn">{s.us || ""}</td><td className="num bad">{s.lost || ""}</td>
              </tr>
            );
          })}</tbody></table>
        <p className="hint"><Tag /> = each item has its own tag and barcode. Others are counted in bulk.
          {isQM() && " The real app also imports a spreadsheet of equipment and exports the register."}</p>
      </section>
    </>
  );
}

function ItemForm({ go }) {
  const submit = (e) => {
    e.preventDefault(); const d = formData(e);
    const id = tx(() => {
      const kind = d.kind === "bulk" ? "bulk" : "asset", q = Math.max(int(d.qty), 0);
      const t = { id: nid("types"), name: d.name.trim(), category: (d.category || "").trim(), kind, unit: "each", location: (d.location || "").trim(),
        tag_prefix: (d.tag_prefix || "").trim().toUpperCase(), qty_total: kind === "bulk" ? q : 0, qty_us: 0, notes: "", active: true };
      db.S.types.push(t);
      if (kind === "asset" && q) { const tags = addAssets(t, Math.min(q, 100)); log("Assets added", `${t.name}: ${tags.join(", ")}`, { type_id: t.id }); }
      log("Item added", `${t.name} (${kind})`, { type_id: t.id });
      return t.id;
    });
    if (id) { flash("Saved."); go("item", id); }
  };
  return (
    <>
      <h1>Add equipment</h1>
      <form className="card grid2" onSubmit={submit}>
        <label className="span2">Name<input name="name" required placeholder="e.g. Canoe" /></label>
        <label>Category<input name="category" placeholder="Tents, Cooking, Safety…" /></label>
        <label>Store location<input name="location" placeholder="Bay A, Shelf C2…" /></label>
        <fieldset className="span2" style={{ border: "1px solid var(--line)", borderRadius: 6, margin: "0 0 .8rem" }}>
          <legend style={{ fontWeight: 600, fontSize: ".88rem" }}>How is it tracked?</legend>
          <label className="check"><input type="radio" name="kind" value="asset" defaultChecked /><span><b>Each one tagged</b> — tents, stoves, radios. Every item gets its own barcode, condition and history.</span></label>
          <label className="check"><input type="radio" name="kind" value="bulk" /><span><b>Counted in bulk</b> — pegs, rope, tarps, chairs.</span></label>
        </fieldset>
        <label>How many do you hold?<input type="number" name="qty" min="0" defaultValue="1" /></label>
        <label>Tag prefix (tagged items)<input name="tag_prefix" maxLength="6" placeholder="CNO → CNO-001…" /></label>
        <div className="actions span2"><button className="primary">Save</button><a onClick={() => go("items")}>Cancel</a></div>
      </form>
    </>
  );
}

function Item({ go, refresh, arg }) {
  const t = byId("types", arg), s = typeStock(t.id);
  const A = db.S.assets.filter((a) => a.type_id === t.id).sort((a, b) => (a.status === "written_off") - (b.status === "written_off") || a.tag.localeCompare(b.tag));
  const up = db.S.bookings.filter((b) => OPEN.includes(b.status) && db.S.lines.some((l) => l.booking_id === b.id && l.type_id === t.id)).sort(byStart);
  const addTags = (e) => {
    e.preventDefault(); const d = formData(e);
    const tags = tx(() => {
      let tags; const tag = (d.tag || "").trim().toUpperCase();
      if (tag) {
        if (db.S.assets.some((a) => a.tag === tag)) throw new StoresError(`Tag ${tag} is already used.`);
        db.S.assets.push({ id: nid("assets"), type_id: t.id, tag, serial: (d.serial || "").trim(), status: "in", condition: "Serviceable", acquired: d.acquired || "", notes: "" });
        tags = [tag];
      } else {
        tags = addAssets(t, Math.min(Math.max(int(d.count), 1), 100), { acquired: d.acquired });
        if (tags.length === 1 && d.serial) db.S.assets.find((a) => a.tag === tags[0]).serial = d.serial.trim();
      }
      log("Assets added", `${t.name}: ${tags.join(", ")}`, { type_id: t.id });
      return tags;
    });
    if (tags) { flash(`Added ${tags.join(", ")}.`); e.currentTarget.reset(); }
    refresh();
  };
  const adjust = (e) => {
    e.preventDefault(); const d = formData(e), c = int(d.counted);
    tx(() => { t.qty_total = c + s.out + t.qty_us; log("Stock adjusted", `${t.name}: in store ${s.in} → ${c} (${d.reason})`, { type_id: t.id }); });
    flash("Stock adjusted."); refresh();
  };
  const report = (e) => {
    e.preventDefault(); const d = formData(e), n = int(d.qty);
    if (n < 1 || n > s.in) { flash(`Enter a number between 1 and ${s.in}.`, "error"); return refresh(); }
    tx(() => { t.qty_us += n; defect({ kind: "damage", type_id: t.id, qty: n, description: d.description }); log("Reported unserviceable", `${n} x ${t.name}: ${d.description}`, { type_id: t.id }); });
    flash("Reported."); refresh();
  };
  return (
    <>
      <div className="head"><div><p className="crumb"><a onClick={() => go("items")}>Equipment</a> / {t.category}</p><h1>{t.name}</h1></div>
        {isQM() && t.kind === "asset" && <button onClick={() => go("labels", t.id)}>Print labels</button>}</div>
      <div className="tiles">
        <div className="tile"><b>{s.held}</b><span>held</span></div><div className="tile"><b>{s.in}</b><span>in store</span></div>
        <div className="tile"><b>{s.out}</b><span>on issue</span></div>
        <div className={`tile ${s.us ? "amber" : ""}`}><b>{s.us}</b><span>unserviceable</span></div>
        {t.kind === "asset" && <div className={`tile ${s.lost ? "red" : ""}`}><b>{s.lost}</b><span>missing</span></div>}
      </div>
      <p className="muted">{t.kind === "asset" ? "Each item tagged" : "Counted in bulk"}{t.location ? " · Location: " + t.location : ""}</p>
      {t.kind === "asset" ? (
        <section className="panel"><h2>Tagged items</h2>
          {A.length ? (
            <table className="list stack"><thead><tr><th>Tag</th><th>Serial</th><th>Status</th><th>Where</th></tr></thead>
              <tbody>{A.map((a) => {
                const ob = onBooking(a.id);
                return <tr key={a.id} className={`link ${a.status === "written_off" ? "done" : ""}`} onClick={() => go("asset", a.id)}>
                  <td><a className="mono">{a.tag}</a></td><td>{a.serial}</td><td><APill s={a.status} /></td><td>{ob && <span className="mono">{ref(ob)}</span>}</td></tr>;
              })}</tbody></table>
          ) : <p className="empty">No tagged items yet.</p>}
          {isQM() && (
            <details className="addbox"><summary>Add tagged items</summary>
              <form className="grid4" onSubmit={addTags}>
                <label>How many<input type="number" name="count" defaultValue="1" min="1" max="100" /></label>
                <label>Own tag (one item)<input name="tag" placeholder="blank = auto-number" /></label>
                <label>Serial no.<input name="serial" /></label>
                <label>Acquired<input type="date" name="acquired" /></label>
                <button className="primary">Add</button>
              </form>
            </details>
          )}
        </section>
      ) : isQM() && (
        <div className="cols">
          <section className="panel"><h2>Stocktake</h2>
            <form className="grid2" onSubmit={adjust} key={s.in}>
              <label>Counted on the shelf now<input type="number" name="counted" min="0" defaultValue={s.in} required /></label>
              <label>Reason<input name="reason" required placeholder="Stocktake, new purchase…" /></label>
              <div className="span2"><button className="primary">Adjust</button> <small className="muted">Items on issue and unserviceable aren't affected.</small></div>
            </form>
          </section>
          <section className="panel"><h2>Report unserviceable</h2>
            <form className="grid2" onSubmit={report}>
              <label>How many<input type="number" name="qty" min="1" max={s.in} defaultValue="1" /></label>
              <label>Fault<input name="description" required /></label>
              <div className="span2"><button>Report</button></div>
            </form>
          </section>
        </div>
      )}
      <section className="panel"><h2>Bookings for this item</h2><BTable rows={up} empty="No open bookings." go={go} /></section>
      {isQM() && <section className="panel"><h2>History</h2><History rows={db.S.log.filter((l) => l.type_id === t.id).reverse().slice(0, 40)} /></section>}
    </>
  );
}

function DefectActions({ d, refresh }) {
  const submit = (e) => {
    e.preventDefault(); const f = formData(e);
    if (tx(() => (closeDefect(d, f.action, (f.notes || "").trim()), true))) flash("Report closed.");
    refresh();
  };
  return (
    <form className="inline" style={{ marginTop: ".4rem" }} onSubmit={submit}>
      <input name="notes" placeholder="Notes" size="12" />
      {d.kind === "damage" ? <button name="action" value="repaired">Repaired</button> : <button name="action" value="found">Found</button>}
      <button name="action" value="written_off" className="danger">Write off</button>
    </form>
  );
}

function Asset({ go, refresh, arg }) {
  const a = byId("assets", arg), t = byId("types", a.type_id);
  const D = db.S.defects.filter((d) => d.asset_id === a.id && d.status === "open");
  const B = db.S.issued.filter((i) => i.asset_id === a.id).reverse();
  const saveDetails = (e) => {
    e.preventDefault(); const d = formData(e);
    tx(() => { Object.assign(a, { serial: d.serial.trim(), acquired: d.acquired, notes: d.notes.trim() }); log("Asset details changed", a.tag, { asset_id: a.id, type_id: a.type_id }); });
    flash("Saved."); refresh();
  };
  const report = (e) => {
    e.preventDefault(); const d = formData(e);
    tx(() => { a.status = "repair"; a.condition = "Unserviceable"; defect({ kind: "damage", type_id: t.id, asset_id: a.id, description: d.description });
      log("Reported unserviceable", `${a.tag} ${t.name}: ${d.description}`, { asset_id: a.id, type_id: t.id }); });
    flash(`${a.tag} marked unserviceable.`); refresh();
  };
  return (
    <>
      <div className="head"><div><p className="crumb"><a onClick={() => go("items")}>Equipment</a> / <a onClick={() => go("item", t.id)}>{t.name}</a></p>
        <h1><span className="mono">{a.tag}</span> <APill s={a.status} /></h1></div></div>
      <div className="cols">
        <section className="card">
          <div className="labelpreview"><Barcode text={a.tag} /><b className="mono block">{a.tag}</b></div>
          {isQM() ? (
            <form className="grid2" onSubmit={saveDetails}>
              <label>Serial no.<input name="serial" defaultValue={a.serial} /></label>
              <label>Acquired<input type="date" name="acquired" defaultValue={a.acquired} /></label>
              <label className="span2">Notes<textarea name="notes" rows="2" defaultValue={a.notes} /></label>
              <div className="span2"><button>Save</button></div>
            </form>
          ) : <p>Serial: {a.serial || "—"}</p>}
        </section>
        <section className="panel"><h2>Condition</h2>
          <p><b>{a.condition}</b>{t.location ? " · stored at " + t.location : ""}</p>
          {D.map((d) => (
            <div key={d.id} className="flash warn"><b>{d.kind === "loss" ? "Missing" : "Unserviceable"}</b> since {fd(d.reported_at)}: {d.description}
              {isQM() && <DefectActions d={d} refresh={refresh} />}</div>
          ))}
          {isQM() && a.status === "in" && (
            <details className="addbox"><summary>Report unserviceable</summary>
              <form className="inline" onSubmit={report}><input name="description" placeholder="Describe the fault" required /><button>Report</button></form>
            </details>
          )}
        </section>
      </div>
      <section className="panel"><h2>Issue history</h2>
        {B.length ? (
          <table className="list stack"><thead><tr><th>Booking</th><th>Activity</th><th>Leader</th><th>Out</th><th>Back</th><th>Result</th></tr></thead>
            <tbody>{B.map((i) => {
              const b = byId("bookings", i.booking_id);
              return <tr key={i.id} className="link" onClick={() => go("booking", b.id)}>
                <td className="mono">{ref(b.id)}</td><td>{b.activity}</td><td>{user(b.leader_id).name}</td><td>{fd(i.issued_at)}</td><td>{fd(i.returned_at)}</td>
                <td>{i.lost_qty ? <span className="bad">Missing</span> : i.damaged_qty ? <span className="warn">Damaged</span> : i.returned_at ? <span className="ok">Serviceable</span> : "Out"}</td></tr>;
            })}</tbody></table>
        ) : <p className="empty">Never issued.</p>}
      </section>
      <section className="panel"><h2>Log</h2><History rows={db.S.log.filter((l) => l.asset_id === a.id).reverse()} /></section>
    </>
  );
}

function Defects({ go, refresh, arg }) {
  const all = arg === "all";
  const rows = db.S.defects.filter((d) => all || d.status === "open").slice().reverse();
  const outcome = { repaired: "Repaired", found: "Found", written_off: "Written off" };
  return (
    <>
      <h1>Repairs &amp; losses</h1>
      <div className="tabs"><a className={all ? "" : "on"} onClick={() => go("defects")}>Open</a><a className={all ? "on" : ""} onClick={() => go("defects", "all")}>All</a></div>
      <section className="panel">
        {rows.length ? (
          <table className="list stack"><thead><tr><th>Reported</th><th>Item</th><th>Type</th><th>Fault / what happened</th><th>From booking</th><th>{all ? "Outcome" : "Action"}</th></tr></thead>
            <tbody>{rows.map((d) => {
              const t = byId("types", d.type_id), a = d.asset_id ? byId("assets", d.asset_id) : null;
              return (
                <tr key={d.id}>
                  <td>{fd(d.reported_at)}</td>
                  <td>{a ? <><a className="mono" onClick={() => go("asset", a.id)}>{a.tag}</a> </> : d.qty + " × "}{t.name}</td>
                  <td>{d.kind === "loss" ? <span className="bad">Missing</span> : <span className="warn">Damaged</span>}</td>
                  <td>{d.description}</td>
                  <td>{d.booking_id && <a className="mono" onClick={() => go("booking", d.booking_id)}>{ref(d.booking_id)}</a>}</td>
                  <td>{d.status === "open" ? <DefectActions d={d} refresh={refresh} />
                    : <>{outcome[d.status]} {fd(d.closed_at)}{d.closed_notes && <small className="block muted">{d.closed_notes}</small>}</>}</td>
                </tr>
              );
            })}</tbody></table>
        ) : <p className="empty">No {all ? "" : "open "}reports.</p>}
      </section>
      <p className="hint">Damaged items are held as unserviceable and can't be booked until repaired. Missing items come off the available stock straight away; write them off once you're sure they won't turn up.</p>
    </>
  );
}

function Users({ go }) {
  return (
    <>
      <div className="head"><h1>Leaders</h1><button className="primary" onClick={() => go("userForm")}>Add leader</button></div>
      <section className="panel">
        <table className="list stack"><thead><tr><th>Name</th><th>Section</th><th>Phone</th><th>Access</th><th className="num">Bookings out</th></tr></thead>
          <tbody>{db.S.users.map((u) => (
            <tr key={u.id} className={`link ${u.active ? "" : "done"}`} onClick={() => go("userForm", u.id)}>
              <td><a>{u.name}</a></td><td>{u.section}</td><td>{u.phone}</td>
              <td>{u.role === "qm" ? "Quartermaster" : "Leader"}{u.active ? "" : " (inactive)"}</td>
              <td className="num">{db.S.bookings.filter((b) => b.leader_id === u.id && OUT.includes(b.status)).length || ""}</td>
            </tr>
          ))}</tbody></table>
      </section>
      <p className="hint">Leaders sign in to book equipment and enter their PIN to sign for it when it's issued. Quartermasters also issue, return and manage the store.</p>
    </>
  );
}

function UserForm({ go, refresh, arg }) {
  const u = arg ? byId("users", arg) : null;
  const submit = (e) => {
    e.preventDefault(); const d = formData(e), pin = (d.pin || "").trim();
    if (pin && (pin.length < 4 || !/^\d+$/.test(pin))) { flash("Use a PIN of at least 4 digits.", "error"); return refresh(); }
    if (u && u.id === db.me.id && (d.role !== "qm" || d.active === "0")) { flash("You can't remove your own Quartermaster access.", "error"); return refresh(); }
    tx(() => {
      const o = { name: d.name.trim(), section: (d.section || "").trim(), phone: (d.phone || "").trim(), email: (d.email || "").trim(), role: d.role === "qm" ? "qm" : "leader" };
      if (u) { Object.assign(u, o, { active: d.active !== "0" }); if (pin) u.pin = pin; log("Leader changed", o.name); }
      else { db.S.users.push({ id: nid("users"), ...o, pin, active: true }); log("Leader added", o.name); }
    });
    flash("Saved."); go("users");
  };
  return (
    <>
      <h1>{u ? u.name : "Add leader"}</h1>
      <form className="card grid2" onSubmit={submit}>
        <label>Name<input name="name" required defaultValue={u ? u.name : ""} /></label>
        <label>Section<input name="section" defaultValue={u ? u.section : ""} placeholder="Joeys, Cubs, Scouts, Venturers, Rovers…" /></label>
        <label>Phone<input name="phone" defaultValue={u ? u.phone : ""} /></label>
        <label>Email<input type="email" name="email" defaultValue={u ? u.email : ""} /></label>
        <label>Access<select name="role" defaultValue={u ? u.role : "leader"}>
          <option value="leader">Leader — book and sign for equipment</option><option value="qm">Quartermaster — runs the store</option></select></label>
        <label>{u ? "Reset PIN (leave blank to keep)" : "Starting PIN"}<input name="pin" inputMode="numeric" required={!u} autoComplete="off" /></label>
        {u && <label>Status<select name="active" defaultValue={u.active ? "1" : "0"}><option value="1">Active</option><option value="0">Inactive — can't sign in or book</option></select></label>}
        <div className="actions span2"><button className="primary">Save</button><a onClick={() => go("users")}>Cancel</a></div>
      </form>
    </>
  );
}

const Log = () => (
  <>
    <h1>Store log</h1><p className="muted">Every issue, return, repair and change is recorded here.</p>
    <section className="panel"><History rows={db.S.log.slice().reverse()} /></section>
  </>
);

function Labels({ arg }) {
  const A = db.S.assets.filter((a) => !["written_off", "lost"].includes(a.status) && (!arg || a.type_id === +arg));
  return (
    <>
      <h1>Barcode labels</h1><p className="hint">{A.length} labels. The real app prints these 3 across on A4 label sheets.</p>
      <div className="labels">{A.map((a) => (
        <div key={a.id} className="label"><small>{GROUP} Q Store</small><Barcode text={a.tag} h={44} /><b className="mono">{a.tag}</b><small>{byId("types", a.type_id).name}</small></div>
      ))}</div>
    </>
  );
}

/* ---------- app shell ---------- */
const SCREENS = { dashboard: Dashboard, bookings: Bookings, bookingForm: BookingForm, booking: Booking, issue: Issue, ret: Return,
  voucher: Voucher, availability: Availability, items: Items, itemForm: ItemForm, item: Item, asset: Asset, defects: Defects,
  users: Users, userForm: UserForm, log: Log, labels: Labels,
  stocktakes: Stocktakes, stocktake: Stocktake, stFinalise: StocktakeFinalise, stockSheet: StockSheet, stReport: StocktakeReport,
  reports: Reports, rRegister: ReportRegister, rOnIssue: ReportOnIssue, rLosses: ReportLosses, rMovements: ReportMovements };
const AUDIT = ["stocktakes", "stocktake", "stFinalise", "stockSheet", "stReport", "reports", "rRegister", "rOnIssue", "rLosses", "rMovements"];
const QM_ONLY = ["issue", "ret", "defects", "users", "userForm", "log", "labels", "itemForm", ...AUDIT];
const NAV = [["dashboard", "Dashboard", ["dashboard"]], ["bookings", "Bookings", ["bookings", "booking", "bookingForm", "issue", "ret", "voucher"]],
  ["availability", "Availability", ["availability"]], ["items", "Equipment", ["items", "item", "asset", "itemForm", "labels"]]];
const QM_NAV = [["defects", "Repairs & losses", ["defects"]], ["stocktakes", "Stocktake", ["stocktakes", "stocktake", "stFinalise", "stockSheet", "stReport"]],
  ["reports", "Reports", ["reports", "rRegister", "rOnIssue", "rLosses", "rMovements"]], ["users", "Leaders", ["users", "userForm"]], ["log", "Log", ["log"]]];

export default function App() {
  const [route, setRoute] = useState({ view: db.me ? "dashboard" : "login", arg: null, n: 0 });
  const [flashes, setFlashes] = useState([]);
  const [, setTick] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);

  const refresh = () => { setFlashes(db.takeFlashes()); setTick((t) => t + 1); };
  const go = (view, arg = null) => {
    if (view === "login" || view === undefined) { refresh(); if (!view) return; }
    setFlashes(db.takeFlashes());
    setRoute((r) => ({ view, arg, n: r.n + 1 }));
    window.scrollTo(0, 0);
  };
  const mine = (b) => isQM() || b.leader_id === db.me.id;

  let { view, arg } = route;
  if (!db.me) view = "login";
  if (db.me && QM_ONLY.includes(view) && !isQM()) view = "dashboard";
  const Screen = SCREENS[view];
  const S = db.S;
  const requested = S.bookings.filter((b) => b.status === "requested").length;
  const late = overdue().length;
  const openDefects = S.defects.filter((d) => d.status === "open").length;

  return (
    <>
      <div className="demo">
        <span><b>Demo</b> · sample data for trying it out. Changes stay in this browser only.</span>
        <button type="button" onClick={() => setConfirmReset(true)}>Reset demo</button>
      </div>
      {db.me && (
        <header className="top">
          <a className="brand" onClick={() => go("dashboard")}><span className="mark">Q</span><span><b>Q STORE</b><small>{GROUP}</small></span></a>
          <nav>{NAV.concat(isQM() ? QM_NAV : []).map(([v, l, on]) => (
            <a key={v} className={on.includes(view) ? "on" : ""} onClick={() => go(v)}>{l}
              {v === "bookings" && isQM() && requested > 0 && <i className="badge">{requested}</i>}
              {v === "bookings" && isQM() && late > 0 && <i className="badge red">{late}</i>}
              {v === "defects" && openDefects > 0 && <i className="badge amber">{openDefects}</i>}
              {v === "stocktakes" && S.stocktakes.some((x) => x.status === "open") && <i className="badge amber">open</i>}
            </a>
          ))}</nav>
          <div className="who"><span>{db.me.name}{isQM() && <> <em>QM</em></>}</span><a onClick={() => { db.me = null; go("login"); }}>Sign out</a></div>
        </header>
      )}
      <main>
        {flashes.map(([k, m], i) => <div key={route.n + "-" + i + m} className={`flash ${k}`}>{m}</div>)}
        {view === "login" ? <Login done={(v) => (v ? go(v) : refresh())} />
          : <Screen key={`${view}-${arg}-${route.n}`} go={go} refresh={refresh} arg={arg} mine={mine} />}
      </main>
      {confirmReset && (
        <div className="modal" role="dialog" aria-modal="true">
          <div>
            <h2>Reset the demo?</h2>
            <p>All changes are cleared and the sample equipment, leaders and bookings come back.</p>
            <div className="actions">
              <button className="primary" onClick={() => { db.reset(); setConfirmReset(false); flash("Demo reset."); go("login"); }}>Reset</button>
              <button onClick={() => setConfirmReset(false)}>Keep my changes</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
