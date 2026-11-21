/* Stocktake and audit report screens. Mirrors the Python app's stocktake and report pages. */
import React, { useState, useEffect, useRef } from "react";
import { db, GROUP, ASSET, today, now, fd, daysLate, ref, byId, user, flash, tx, typeStock, activeTypes, issuedRows, left, barcode } from "./store.js";
import { OUTCOMES, PROBLEMS, stRef, categories, liveResults, summarise, startStocktake, scanForStocktake, saveCounts, finaliseStocktake, countFor } from "./audit.js";

const Barcode = ({ text, h }) => <span dangerouslySetInnerHTML={{ __html: barcode(text, h) }} />;
const signed = (n) => (n > 0 ? "+" + n : String(n));
const nowStr = () => { const d = new Date(); return d.toLocaleDateString("en-AU") + " " + d.toTimeString().slice(0, 5); };
const Finding = ({ o }) => <span className={OUTCOMES[o][1]}>{OUTCOMES[o][0]}</span>;
let audio;
function beep(ok) {
  try {
    audio = audio || new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 1200 : 220; o.type = ok ? "sine" : "square"; g.gain.value = 0.06;
    o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.08 : 0.3));
  } catch (e) { /* no sound */ }
}

/* ---------- printable page frame ---------- */
function PrintPage({ title, meta, refBox, back, controls, children, certify }) {
  const [msg, setMsg] = useState("");
  const print = () => {
    try { window.print(); } catch (e) { /* blocked */ }
    setTimeout(() => setMsg("If nothing opened, use your browser's Print command (Ctrl+P)."), 800);
  };
  return (
    <>
      <div className="noprint printbar">
        <button className="primary" onClick={print}>Print</button>
        <a onClick={back}>Back</a>
        {controls}
        {msg && <span className="muted">{msg}</span>}
      </div>
      <div className="sheet report">
        <div className="vhead">
          <div><small>{GROUP} · Q Store</small><h1>{title}</h1>
            <p className="rmeta">{meta}Printed {nowStr()} by {db.me.name}</p></div>
          <div className="vref">{refBox}</div>
        </div>
        {children}
        {certify || <div className="vsign two"><div>Quartermaster</div><div>Group Leader / auditor</div></div>}
        <p className="vfoot">{GROUP} Q Store · {title} · printed {nowStr()}</p>
      </div>
    </>
  );
}

/* ---------- stocktake list ---------- */
export function Stocktakes({ go, refresh }) {
  const all = db.S.stocktakes.slice().reverse();
  const open = all.find((s) => s.status === "open");
  const past = all.filter((s) => s.status !== "open");
  const start = (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget));
    const id = tx(() => startStocktake(d.category, (d.name || "").trim()));
    if (id) go("stocktake", id); else refresh();
  };
  const problems = (s) => db.S.st_results.filter((r) => r.stocktake_id === s.id && PROBLEMS.has(r.outcome)).length;
  return (
    <>
      <h1>Stocktake</h1>
      {open ? (
        <section className="panel alert-amber">
          <h2>In progress: {open.name} <span className="mono muted">{stRef(open.id)}</span></h2>
          <p>Started {fd(open.started_at)} by {user(open.started_by).name}. Issues and returns can carry on while you count; the comparison always uses the register as it stands now.</p>
          <div className="btns"><button className="primary" onClick={() => go("stocktake", open.id)}>Carry on counting</button>
            <button onClick={() => go("stockSheet", open.id)}>Print count sheet</button></div>
        </section>
      ) : (
        <section className="panel">
          <h2>Start a stocktake</h2>
          <p>Scan every tagged item on the shelves and count the bulk items. The Q Store compares the count with the register, then you review the differences and sign it off.</p>
          <form className="grid2" onSubmit={start}>
            <label>What to count
              <select name="category" defaultValue="">
                <option value="">The whole store</option>
                {categories().map((c) => <option key={c} value={c}>{c} only</option>)}
              </select>
            </label>
            <label>Name<input name="name" placeholder={`e.g. End of year stocktake ${today().slice(0, 4)}`} /></label>
            <div className="span2"><button className="primary">Start stocktake</button></div>
          </form>
        </section>
      )}
      <section className="panel">
        <h2>Past stocktakes</h2>
        {past.length ? (
          <table className="list stack">
            <thead><tr><th>Ref</th><th>Name</th><th>Scope</th><th>Started</th><th>Signed off</th><th className="num">Differences</th><th>Status</th></tr></thead>
            <tbody>{past.map((s) => (
              <tr key={s.id} className={s.status === "finalised" ? "link" : ""} onClick={() => s.status === "finalised" && go("stReport", s.id)}>
                <td className="mono">{stRef(s.id)}</td><td>{s.name}</td><td>{s.category || "Whole store"}</td><td>{fd(s.started_at)}</td>
                <td>{s.status === "finalised" && <>{fd(s.finalised_at)}<small className="block muted">{user(s.finalised_by).name}{s.witness ? `, witness ${s.witness}` : ""}</small></>}</td>
                <td className="num">{s.status === "finalised" && <b className={problems(s) ? "bad" : "ok"}>{problems(s)}</b>}</td>
                <td>{s.status === "finalised" ? <a>Report</a> : <span className="muted">Cancelled</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="empty">No stocktakes yet.</p>}
      </section>
    </>
  );
}

/* ---------- counting ---------- */
export function Stocktake({ go, refresh, arg }) {
  const st = byId("stocktakes", arg);
  const [msg, setMsg] = useState(null);
  const [hideDone, setHideDone] = useState(false);
  const [, bump] = useState(0);
  const [counts, setCounts] = useState(() => Object.fromEntries(activeTypes().filter((t) => t.kind === "bulk").map((t) => {
    const c = countFor(st, t.id); return [t.id, c === null ? "" : String(c)];
  })));
  const inp = useRef(null);
  useEffect(() => { inp.current && inp.current.focus({ preventScroll: true }); }, []);
  if (st.status !== "open") return <p>This stocktake is closed. <a onClick={() => go("stReport", st.id)}>Open the report</a>.</p>;
  const rows = liveResults(st), sm = summarise(rows);
  const tags = rows.filter((r) => r.kind === "asset" && r.expected && !r.counted).slice(0, 10).map((r) => r.tag);
  const extra = rows.find((r) => r.kind === "asset" && r.status === "out");
  if (extra) tags.push(extra.tag);
  tags.push("XYZ-999");

  const scan = (code, undo) => {
    if (!code.trim()) return;
    const res = tx(() => scanForStocktake(st, code, undo));
    if (!res) return refresh();
    const [ok, level, text] = res;
    if (!undo) beep(ok);
    setMsg([level, text]); bump((n) => n + 1);
  };
  const save = (e) => {
    e.preventDefault();
    const n = tx(() => saveCounts(st, counts));
    if (n !== false) flash(`Counts saved (${n} lines counted).`);
    refresh();
  };
  const cancel = () => {
    tx(() => { st.status = "cancelled"; st.finalised_at = now(); });
    flash(`${stRef(st.id)} cancelled. Nothing was changed.`); go("stocktakes");
  };

  return (
    <>
      <div className="head">
        <div><p className="crumb"><a onClick={() => go("stocktakes")}>Stocktake</a> / <span className="mono">{stRef(st.id)}</span></p>
          <h1>Counting: {st.name}</h1></div>
        <div className="btns"><button onClick={() => go("stockSheet", st.id)}>Print count sheet</button>
          <button className="primary" onClick={() => go("stFinalise", st.id)}>Review &amp; sign off</button></div>
      </div>
      <div className="tiles">
        <div className="tile"><b>{sm.tagged_found}</b><span>of {sm.tagged_expected} tagged items found</span></div>
        <div className="tile"><b>{sm.bulk_counted}</b><span>of {sm.bulk_lines} bulk lines counted</span></div>
        <div className="tile"><b>{sm.on_issue}</b><span>on issue (not expected on shelf)</span></div>
        <div className={`tile ${sm.problems ? "amber" : ""}`}><b>{sm.problems}</b><span>differences so far</span></div>
      </div>
      <section className="panel">
        <h2>1. Scan tagged items</h2>
        <input ref={inp} className="scanbox" placeholder="Scan each tagged item on the shelves…" autoComplete="off"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const v = e.target.value; e.target.value = ""; scan(v); } }} />
        <div className="sim"><b>No scanner? Tap a tag to scan it. The last ones show an item the register says is on issue, and one that isn't on the register.</b>
          {tags.map((t) => <button type="button" key={t} className="chip" onClick={() => scan(t)}>{t}</button>)}</div>
        <p className={`scanmsg ${msg ? msg[0] : ""}`} aria-live="polite">{msg ? msg[1] : ""}</p>
        <div className="head"><p className="hint">Rows turn green as they're scanned. Scanned something by mistake? Use Undo on its row.</p>
          <label className="check"><input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Hide items already found</label></div>
        <table className="list stack">
          <thead><tr><th>Tag</th><th>Item</th><th>Register says</th><th>Counted</th><th></th></tr></thead>
          <tbody>{rows.filter((r) => r.kind === "asset" && !(hideDone && r.counted)).map((r) => (
            <tr key={r.asset_id} className={`${r.counted ? "done" : ""} ${!r.expected && !r.counted ? "muted-row" : ""}`}>
              <td className="mono">{r.tag}</td><td>{r.item}<small className="block muted">{r.category}</small></td>
              <td>{ASSET[r.status]}{r.booking_id && <> <span className="mono">{ref(r.booking_id)}</span></>}</td>
              <td>{r.counted ? <span className="ok">✓ Found</span> : <span className="muted">{r.expected ? "Not yet" : "Not expected"}</span>}</td>
              <td>{r.counted ? <button type="button" className="link" onClick={() => scan(r.tag, true)}>Undo</button> : null}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>
      <section className="panel">
        <h2>2. Count bulk items</h2>
        <p className="hint">Count everything physically on the shelf, serviceable and unserviceable together. Leave a box blank if you haven't counted it yet. You can save and come back.</p>
        <form onSubmit={save}>
          <table className="list stack">
            <thead><tr><th>Item</th><th>Location</th><th className="num">On issue</th><th className="num">Counted on shelf</th></tr></thead>
            <tbody>{rows.filter((r) => r.kind === "bulk").map((r) => (
              <tr key={r.type_id}><td>{r.item}<small className="block muted">{r.category}</small></td><td>{r.location}</td><td className="num">{r.out || ""}</td>
                <td className="num"><input type="number" min="0" className="qty" name={`count_${r.type_id}`} value={counts[r.type_id] ?? ""}
                  onChange={(e) => setCounts({ ...counts, [r.type_id]: e.target.value })} /></td></tr>
            ))}</tbody>
          </table>
          <p className="hint">The expected figure is hidden on purpose so the count is blind. You'll see any differences at sign-off.</p>
          <div className="actions"><button className="primary">Save counts</button></div>
        </form>
      </section>
      <button className="danger" onClick={cancel} style={{ marginTop: "1.5rem" }}>Cancel stocktake</button>
    </>
  );
}

/* ---------- review and sign off ---------- */
export function StocktakeFinalise({ go, refresh, arg }) {
  const st = byId("stocktakes", arg);
  const [apply, setApply] = useState(true);
  const [witness, setWitness] = useState("");
  const [notes, setNotes] = useState("");
  const [pin, setPin] = useState("");
  if (st.status !== "open") return <p>Already signed off. <a onClick={() => go("stReport", st.id)}>Open the report</a>.</p>;
  const all = liveResults(st), sm = summarise(all), rows = all.filter((r) => PROBLEMS.has(r.outcome));
  const submit = (e) => {
    e.preventDefault();
    if (db.me.pin !== pin) { flash("Enter your own PIN to sign off the stocktake.", "error"); return refresh(); }
    if (tx(() => (finaliseStocktake(st, apply, witness.trim(), notes.trim()), true))) { flash(`${stRef(st.id)} signed off.`); go("stReport", st.id); }
    else refresh();
  };
  const effect = (r) => ({ not_found: "Marked missing, loss report raised", found_missing: "Back into stock, loss report closed",
    bulk_over: `Holding adjusted by ${signed(r.variance)}`, bulk_short: `Holding adjusted by ${signed(r.variance)}`,
    found_on_issue: "No change — book it back in on the booking", not_counted: "No change — not counted" })[r.outcome];
  return (
    <>
      <p className="crumb"><a onClick={() => go("stocktakes")}>Stocktake</a> / <a className="mono" onClick={() => go("stocktake", st.id)}>{stRef(st.id)}</a> / Sign off</p>
      <h1>Review and sign off: {st.name}</h1>
      <div className="tiles">
        <div className={`tile ${sm.tagged_found < sm.tagged_expected ? "red" : ""}`}><b>{sm.tagged_found}/{sm.tagged_expected}</b><span>tagged items found</span></div>
        <div className={`tile ${sm.bulk_counted < sm.bulk_lines ? "amber" : ""}`}><b>{sm.bulk_counted}/{sm.bulk_lines}</b><span>bulk lines counted</span></div>
        <div className={`tile ${rows.length ? "amber" : ""}`}><b>{rows.length}</b><span>differences</span></div>
      </div>
      <section className="panel">
        <h2>Differences</h2>
        {rows.length ? (
          <table className="list stack">
            <thead><tr><th>Item</th><th>Tag</th><th className="num">Expected</th><th className="num">Counted</th><th className="num">Diff.</th><th>Finding</th><th>If you apply changes</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.type_id + "-" + (r.asset_id || "b")}>
                <td>{r.item}</td><td className="mono">{r.tag}</td><td className="num">{r.expected}</td>
                <td className="num">{r.counted === null ? "—" : r.counted}</td>
                <td className="num">{r.variance !== null && <b className={r.variance < 0 ? "bad" : r.variance > 0 ? "warn" : ""}>{signed(r.variance)}</b>}</td>
                <td><Finding o={r.outcome} />{r.booking_id && <> <a className="mono" onClick={() => go("booking", r.booking_id)}>{ref(r.booking_id)}</a></>}</td>
                <td className="small">{effect(r)}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="ok"><b>No differences.</b> The count agrees with the register.</p>}
        {(sm.tagged_found < sm.tagged_expected || sm.bulk_counted < sm.bulk_lines) &&
          <p className="flash warn">Some items haven't been counted. <a onClick={() => go("stocktake", st.id)}>Go back and count them</a>, or sign off now and they'll be reported as above.</p>}
      </section>
      <form className="panel sign" onSubmit={submit}>
        <h2>Sign off</h2>
        <label className="check"><input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} />
          <span><b>Apply the changes to the register</b> as shown above. Untick to record the stocktake for the report only.</span></label>
        <div className="grid2">
          <label>Witness (second adult who checked the count)<input value={witness} onChange={(e) => setWitness(e.target.value)} placeholder="Name" /></label>
          <label>Notes for the report<input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Pegs recounted twice" /></label>
        </div>
        <div className="signrow">
          <label>{db.me.name}'s PIN <span className="muted">(demo: 1234)</span><input type="password" name="pin" inputMode="numeric" required autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} /></label>
          <button className="primary big">Sign off stocktake</button>
        </div>
      </form>
    </>
  );
}

/* ---------- printable stocktake documents ---------- */
export function StockSheet({ go, arg }) {
  const st = byId("stocktakes", arg), rows = liveResults(st);
  const tagged = rows.filter((r) => r.kind === "asset"), bulk = rows.filter((r) => r.kind === "bulk");
  return (
    <PrintPage title={`Stocktake count sheet ${stRef(st.id)}`} meta={`${st.name} · ${st.category || "Whole store"} · `}
      refBox={<b className="mono">{stRef(st.id)}</b>} back={() => go(st.status === "open" ? "stocktake" : "stocktakes", st.id)}
      certify={<div className="vsign two"><div>Counted by</div><div>Checked by (witness)</div></div>}>
      <p className="rnote">Tick each tagged item seen on the shelf. Write the number counted for bulk items, counting serviceable and unserviceable together. Items on issue are listed so you know not to look for them.</p>
      {tagged.length > 0 && <>
        <h2>Tagged items</h2>
        <table className="vt"><thead><tr><th>Tag</th><th>Item</th><th>Category</th><th>Register says</th><th className="c">Seen ✓</th><th>Notes</th></tr></thead>
          <tbody>{tagged.map((r) => <tr key={r.asset_id} className={r.expected ? "" : "greyed"}><td className="mono">{r.tag}</td><td>{r.item}</td><td>{r.category}</td>
            <td>{ASSET[r.status]}{r.booking_id ? " " + ref(r.booking_id) : ""}</td><td className="box" /><td className="wide-blank" /></tr>)}</tbody></table>
      </>}
      {bulk.length > 0 && <>
        <h2>Bulk items</h2>
        <table className="vt"><thead><tr><th>Item</th><th>Category</th><th>Location</th><th className="num">On issue</th><th className="num">Counted on shelf</th><th>Notes</th></tr></thead>
          <tbody>{bulk.map((r) => <tr key={r.type_id}><td>{r.item}</td><td>{r.category}</td><td>{r.location}</td><td className="num">{r.out || ""}</td><td className="countbox" /><td className="wide-blank" /></tr>)}</tbody></table>
      </>}
    </PrintPage>
  );
}

export function StocktakeReport({ go, arg }) {
  const st = byId("stocktakes", arg);
  const final = st.status === "finalised";
  const rows = final ? db.S.st_results.filter((r) => r.stocktake_id === st.id) : liveResults(st);
  const sm = summarise(rows), problems = rows.filter((r) => PROBLEMS.has(r.outcome));
  return (
    <PrintPage title={`Stocktake report ${stRef(st.id)}`} meta={`${st.name} · ${st.category || "Whole store"} · `}
      refBox={<><Barcode text={stRef(st.id)} h={36} /><b className="mono block">{stRef(st.id)}</b></>} back={() => go("stocktakes")}
      certify={<div className="vsign"><div>Quartermaster</div><div>Witness</div><div>Group Leader</div></div>}>
      {!final && <p className="flash warn">DRAFT — this stocktake hasn't been signed off. Figures are live and may change.</p>}
      <table className="vt"><tbody>
        <tr><th>Started</th><td>{fd(st.started_at)} by {user(st.started_by).name}</td><th>Signed off</th><td>{final ? `${fd(st.finalised_at)} by ${user(st.finalised_by).name}` : "—"}</td></tr>
        <tr><th>Witness</th><td>{st.witness || "—"}</td><th>Register adjusted</th><td>{final ? (st.adjusted ? "Yes" : "No, report only") : "—"}</td></tr>
        {st.notes && <tr><th>Notes</th><td colSpan="3">{st.notes}</td></tr>}
      </tbody></table>
      <div className="rsum">
        <div><b>{sm.tagged_found} / {sm.tagged_expected}</b><span>tagged items found</span></div>
        <div><b>{sm.bulk_counted} / {sm.bulk_lines}</b><span>bulk lines counted</span></div>
        <div><b>{sm.on_issue}</b><span>on issue, held on vouchers</span></div>
        <div className={sm.problems ? "bad" : ""}><b>{sm.problems}</b><span>differences</span></div>
      </div>
      <h2>Differences</h2>
      {problems.length ? (
        <table className="vt"><thead><tr><th>Item</th><th>Tag</th><th className="num">Expected</th><th className="num">Counted</th><th className="num">Diff.</th><th>Finding</th><th>Action taken</th></tr></thead>
          <tbody>{problems.map((r, i) => <tr key={i}><td>{r.item}</td><td className="mono">{r.tag}</td><td className="num">{r.expected}</td>
            <td className="num">{r.counted === null ? "—" : r.counted}</td><td className="num">{r.variance === null ? "" : signed(r.variance)}</td>
            <td>{OUTCOMES[r.outcome][0]}</td><td>{r.action || (final ? "" : "Not yet signed off")}</td></tr>)}</tbody></table>
      ) : <p><b>None.</b> The count agrees with the register.</p>}
      <h2>Full count</h2>
      <table className="vt small"><thead><tr><th>Category</th><th>Item</th><th>Tag</th><th className="num">Expected</th><th className="num">Counted</th><th>Finding</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className={PROBLEMS.has(r.outcome) ? "flag" : ""}><td>{r.category}</td><td>{r.item}</td><td className="mono">{r.tag}</td>
          <td className="num">{r.expected}</td><td className="num">{r.counted === null ? "—" : r.counted}</td><td>{OUTCOMES[r.outcome][0]}</td></tr>)}</tbody></table>
    </PrintPage>
  );
}

/* ---------- reports ---------- */
const monthStart = () => today().slice(0, 8) + "01";

export function Reports({ go }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const sts = db.S.stocktakes.filter((s) => s.status === "finalised").slice().reverse();
  const card = (title, text, view, a) => (
    <a className="card rcard" onClick={() => go(view, a)}><b>{title}</b><span>{text}</span></a>
  );
  return (
    <>
      <h1>Audit reports</h1>
      <p className="muted">Each report opens as a printable A4 page with signature lines. Use Print, then choose your printer or "Save as PDF".</p>
      <div className="reportgrid">
        {card("Equipment register", "Everything the store holds, with in store, on issue, unserviceable and missing counts.", "rRegister", "0")}
        {card("Register with every tag", "As above, listing each tag number, serial and status.", "rRegister", "1")}
        {card("Equipment on issue", "Who holds what right now, by leader and booking.", "rOnIssue", "0")}
        {card("Overdue equipment", "Late returns, with days overdue and the leader's phone number.", "rOnIssue", "1")}
      </div>
      <section className="panel">
        <h2>For a period</h2>
        <div className="filters">
          <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button className="primary" onClick={() => go("rLosses", { from, to })}>Damage, losses &amp; write-offs</button>
          <button onClick={() => go("rMovements", { from, to })}>Issue &amp; return audit trail</button>
        </div>
      </section>
      <section className="panel">
        <h2>Stocktake reports</h2>
        {sts.length ? (
          <table className="list stack"><thead><tr><th>Ref</th><th>Name</th><th>Signed off</th><th></th></tr></thead>
            <tbody>{sts.map((s) => <tr key={s.id} className="link" onClick={() => go("stReport", s.id)}><td className="mono">{stRef(s.id)}</td><td>{s.name}</td><td>{fd(s.finalised_at)}</td><td><a>Open report</a></td></tr>)}</tbody></table>
        ) : <p className="empty">No signed-off stocktakes yet. <a onClick={() => go("stocktakes")}>Start one</a>.</p>}
      </section>
    </>
  );
}

export function ReportRegister({ go, arg }) {
  const detail = arg === "1";
  const rows = activeTypes().map((t) => ({ t, s: typeStock(t.id),
    assets: t.kind === "asset" ? db.S.assets.filter((a) => a.type_id === t.id && a.status !== "written_off").sort((a, b) => a.tag.localeCompare(b.tag)) : [] }));
  const tot = (k) => rows.reduce((n, r) => n + r.s[k], 0);
  return (
    <PrintPage title="Equipment register" meta={`As at ${fd(today())} · `} back={() => go("reports")}
      controls={<a onClick={() => go("rRegister", detail ? "0" : "1")}>{detail ? "Hide" : "Show"} each tag</a>}>
      <table className="vt">
        <thead><tr><th>Category</th><th>Item</th><th>Type</th><th className="num">Held</th><th className="num">In store</th><th className="num">On issue</th><th className="num">U/S</th><th className="num">Missing</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <React.Fragment key={r.t.id}>
              <tr><td>{r.t.category}</td><td><b>{r.t.name}</b></td><td>{r.t.kind === "asset" ? "Tagged" : "Bulk"}</td>
                <td className="num">{r.s.held}</td><td className="num">{r.s.in}</td><td className="num">{r.s.out || ""}</td><td className="num">{r.s.us || ""}</td><td className="num">{r.s.lost || ""}</td></tr>
              {detail && r.assets.length > 0 && <tr className="sub"><td /><td colSpan="7">{r.assets.map((a) =>
                <span key={a.id} className="tagchip">{a.tag}{a.serial ? ` (${a.serial})` : ""} – {ASSET[a.status]}</span>)}</td></tr>}
            </React.Fragment>
          ))}
          <tr className="total"><td colSpan="3">Total</td><td className="num">{tot("held")}</td><td className="num">{tot("in")}</td><td className="num">{tot("out")}</td><td className="num">{tot("us")}</td><td className="num">{tot("lost")}</td></tr>
        </tbody>
      </table>
      <p className="rnote">Held = in store + on issue + unserviceable. Missing items are not counted as held until found or written off.</p>
    </PrintPage>
  );
}

export function ReportOnIssue({ go, arg }) {
  const onlyOverdue = arg === "1";
  let bookings = db.S.bookings.filter((b) => ["issued", "part_returned"].includes(b.status))
    .sort((a, b) => user(a.leader_id).name.localeCompare(user(b.leader_id).name) || a.end_date.localeCompare(b.end_date));
  if (onlyOverdue) bookings = bookings.filter((b) => b.end_date < today());
  return (
    <PrintPage title={onlyOverdue ? "Overdue equipment" : "Equipment on issue"} meta={`As at ${fd(today())} · `} back={() => go("reports")}
      controls={<a onClick={() => go("rOnIssue", onlyOverdue ? "0" : "1")}>{onlyOverdue ? "Show all on issue" : "Show overdue only"}</a>}>
      {bookings.length ? bookings.map((b) => {
        const l = user(b.leader_id), lines = issuedRows(b.id).filter((i) => left(i) > 0);
        return (
          <div key={b.id} className="rblock">
            <h2>{l.name}{l.section ? ` · ${l.section}` : ""}{l.phone ? ` · ${l.phone}` : ""}</h2>
            <p><b className="mono">{ref(b.id)}</b> {b.activity} · issued {fd(b.issued_at)} · due back <b>{fd(b.end_date)}</b>
              {b.end_date < today() && <> · <b className="bad">{daysLate(b.end_date)} days overdue</b></>}</p>
            <table className="vt small"><thead><tr><th>Item</th><th>Tag</th><th className="num">Still out</th></tr></thead>
              <tbody>{lines.map((i) => <tr key={i.id}><td>{i.t.name}</td><td className="mono">{i.a ? i.a.tag : ""}</td><td className="num">{left(i)}</td></tr>)}</tbody></table>
          </div>
        );
      }) : <p>Nothing {onlyOverdue ? "overdue" : "on issue"}.</p>}
    </PrintPage>
  );
}

const inRange = (s, from, to) => s && s.slice(0, 10) >= from && s.slice(0, 10) <= to;
function DateControls({ arg, go, view }) {
  return (
    <span className="inline">
      <input type="date" defaultValue={arg.from} id="rfrom" />
      <input type="date" defaultValue={arg.to} id="rto" />
      <button onClick={() => go(view, { from: document.getElementById("rfrom").value, to: document.getElementById("rto").value })}>Change dates</button>
    </span>
  );
}

export function ReportLosses({ go, arg }) {
  const { from, to } = arg || { from: monthStart(), to: today() };
  const rows = db.S.defects.filter((d) => inRange(d.reported_at, from, to) || inRange(d.closed_at, from, to));
  const tally = { damage: 0, loss: 0, written_off: 0, open: 0 };
  rows.forEach((d) => { tally[d.kind] += d.qty; if (d.status === "written_off") tally.written_off += d.qty; if (d.status === "open") tally.open += d.qty; });
  const outcome = { repaired: "Repaired", found: "Found", written_off: "Written off" };
  return (
    <PrintPage title="Damage, losses and write-offs" meta={`${fd(from)} to ${fd(to)} · `} back={() => go("reports")}
      controls={<DateControls arg={{ from, to }} go={go} view="rLosses" />}>
      <div className="rsum">
        <div><b>{tally.damage}</b><span>reported damaged</span></div><div><b>{tally.loss}</b><span>reported missing</span></div>
        <div><b>{tally.written_off}</b><span>written off</span></div><div className={tally.open ? "bad" : ""}><b>{tally.open}</b><span>still open</span></div>
      </div>
      {rows.length ? (
        <table className="vt small"><thead><tr><th>Reported</th><th>Item</th><th>Type</th><th>Details</th><th>Booking / leader</th><th>Outcome</th></tr></thead>
          <tbody>{rows.map((d) => {
            const t = byId("types", d.type_id), a = d.asset_id ? byId("assets", d.asset_id) : null, b = d.booking_id ? byId("bookings", d.booking_id) : null;
            return (
              <tr key={d.id}>
                <td>{fd(d.reported_at)}<br /><small>{d.reported_by ? user(d.reported_by).name : ""}</small></td>
                <td>{a ? <><span className="mono">{a.tag}</span> </> : d.qty + " × "}{t.name}{a && a.serial && <><br /><small>S/N {a.serial}</small></>}</td>
                <td>{d.kind === "loss" ? "Missing" : "Damaged"}</td><td>{d.description}</td>
                <td>{b && <><span className="mono">{ref(b.id)}</span> {b.activity}<br /><small>{user(b.leader_id).name}</small></>}</td>
                <td>{d.status === "open" ? <b>Open</b> : <>{outcome[d.status]} {fd(d.closed_at)}<br /><small>{d.closed_by ? user(d.closed_by).name : ""}{d.closed_notes ? ` – ${d.closed_notes}` : ""}</small></>}</td>
              </tr>
            );
          })}</tbody></table>
      ) : <p>No damage or losses in this period.</p>}
    </PrintPage>
  );
}

export function ReportMovements({ go, arg }) {
  const { from, to } = arg || { from: monthStart(), to: today() };
  const rows = db.S.log.filter((l) => inRange(l.at, from, to) && !["Signed in", "Changed PIN"].includes(l.action));
  return (
    <PrintPage title="Issue and return audit trail" meta={`${fd(from)} to ${fd(to)} · ${rows.length} entries · `} back={() => go("reports")}
      controls={<DateControls arg={{ from, to }} go={go} view="rMovements" />}>
      {rows.length ? (
        <table className="vt small"><thead><tr><th>When</th><th>By</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>{rows.map((l) => <tr key={l.id}><td className="nowrap">{fd(l.at)}</td><td>{l.user_id ? user(l.user_id).name : ""}</td><td>{l.action}</td><td>{l.detail}</td></tr>)}</tbody></table>
      ) : <p>No activity in this period.</p>}
    </PrintPage>
  );
}
