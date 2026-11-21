/* Registering equipment by scanning its own barcode, and the scanner test page. Mirrors qstore/scanning.py. */
import React, { useState, useRef, useEffect } from "react";
import { db, byId, nid, log, flash, tx, fd, activeTypes, cleanCode, findCode, checkCodeFree, StoresError } from "./store.js";

let audio;
export function beep(ok) {
  try {
    audio = audio || new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = ok ? 1200 : 220; o.type = ok ? "sine" : "square"; g.gain.value = 0.06;
    o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + (ok ? 0.08 : 0.3));
  } catch (e) { /* no sound */ }
}

/* A box a USB/Bluetooth scanner types into; the scanner presses Enter at the end. */
export function ScanInput({ onScan, placeholder, autoFocus = true }) {
  const ref = useRef(null);
  useEffect(() => { if (autoFocus && ref.current) ref.current.focus({ preventScroll: true }); }, [autoFocus]);
  return (
    <input ref={ref} className="scanbox" placeholder={placeholder} autoComplete="off"
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const v = e.target.value; e.target.value = ""; if (v.trim()) onScan(v); } }} />
  );
}

function newType(d, kind) {
  const name = (d.new_name || "").trim();
  if (!name) throw new StoresError("Give the new item a name.");
  if (db.S.types.some((t) => t.active && t.name.toLowerCase() === name.toLowerCase()))
    throw new StoresError(`There's already an item called ${name}. Choose it from the list instead.`);
  const t = { id: nid("types"), name, category: (d.new_category || "").trim(), kind, unit: "each", location: (d.new_location || "").trim(),
    tag_prefix: (d.new_prefix || "").trim().toUpperCase(), qty_total: kind === "bulk" ? Math.max(parseInt(d.new_qty, 10) || 0, 0) : 0,
    qty_us: 0, notes: "", barcode: "", active: true };
  db.S.types.push(t);
  log("Item added", `${name} (${kind})`, { type_id: t.id });
  return t;
}

export function Register({ go, refresh, arg }) {
  const code = arg ? cleanCode(arg) : "";
  const [kind, row] = code ? findCode(code) : [null, null];
  const [mode, setMode] = useState("unique");
  const [choice, setChoice] = useState("");
  const types = activeTypes();
  const recent = db.S.log.filter((l) => l.action === "Registered barcode").slice(-10).reverse();
  const isNew = choice === "new";

  const submit = (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget));
    const ok = tx(() => {
      checkCodeFree(code);
      if (mode === "unique") {
        const t = isNew ? newType(d, "asset") : byId("types", choice);
        if (!t) throw new StoresError("Choose which item this is.");
        if (t.kind !== "asset") throw new StoresError(`${t.name} is counted in bulk, so its items don't have their own barcodes. Choose 'the same barcode is on every one' instead.`);
        const a = { id: nid("assets"), type_id: t.id, tag: code, serial: (d.serial || "").trim(), status: "in", condition: "Serviceable", acquired: d.acquired || "", notes: (d.notes || "").trim() };
        db.S.assets.push(a);
        log("Registered barcode", `${code} as a new ${t.name}`, { asset_id: a.id, type_id: t.id });
        flash(`Registered ${code} as a new ${t.name}. Scan the next one.`);
      } else {
        let t;
        if (isNew) t = newType(d, d.new_kind === "bulk" ? "bulk" : "asset");
        else {
          t = byId("types", choice);
          if (!t) throw new StoresError("Choose which item this barcode belongs to.");
          if (t.barcode) throw new StoresError(`${t.name} already has product barcode ${t.barcode}. Change it on the item's page if it's wrong.`);
        }
        t.barcode = code;
        log("Registered barcode", `${code} as the product barcode for ${t.name}`, { type_id: t.id });
        flash(`${code} is now the product barcode for ${t.name}.`);
      }
      return true;
    });
    if (ok) go("register"); else refresh();
  };

  const cats = [...new Set(types.map((t) => t.category || "Other"))];
  return (
    <>
      <div className="head"><h1>Register equipment by scanning</h1><button onClick={() => go("scanner")}>Test the scanner</button></div>
      <p className="muted">Scan the barcode already on a new piece of equipment, such as a serial-number sticker, an asset label or the shop barcode, and the Q Store uses it instead of printing its own tag.</p>
      <div className="card">
        <ScanInput placeholder="Scan a barcode…" onScan={(c) => go("register", cleanCode(c))} autoFocus={!code || !!kind} />
        <p className="hint">A USB or Bluetooth scanner types the code and presses Enter. You can also type a code and press Enter. To try it here, type <span className="mono">SN-12345</span> and press Enter.</p>
      </div>
      {code && kind === "asset" && <div className="flash warn"><b className="mono">{code}</b> is already registered as <a className="mono" onClick={() => go("asset", row.id)}>{row.tag}</a> {byId("types", row.type_id).name}.</div>}
      {code && kind === "type" && <div className="flash warn"><b className="mono">{code}</b> is the product barcode for <a onClick={() => go("item", row.id)}>{row.name}</a>.</div>}
      {code && kind === "booking" && <div className="flash warn"><b className="mono">{code}</b> is a booking number. <a onClick={() => go("booking", row)}>Open it</a>.</div>}
      {code && !kind && (
        <form className="panel sign" onSubmit={submit} id="regform">
          <h2>New barcode: <span className="mono">{code}</span></h2>
          <fieldset>
            <legend>What kind of barcode is it?</legend>
            <label className="check"><input type="radio" name="mode" checked={mode === "unique"} onChange={() => setMode("unique")} />
              <span><b>On this one item only</b>, such as a serial number or asset sticker. It becomes this item's tag, so scanning it issues, returns and counts exactly this item.</span></label>
            <label className="check"><input type="radio" name="mode" checked={mode === "product"} onChange={() => setMode("product")} />
              <span><b>The same on every one</b>, such as a shop barcode (EAN/UPC) on a box of pegs. It's linked to the item line. For bulk items, each scan counts 1.</span></label>
          </fieldset>
          <label>Which item is it?
            <select id="typeSel" required value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">Choose…</option>
              <option value="new">+ A new item not on the register yet</option>
              {cats.map((c) => (
                <optgroup key={c} label={c}>{types.filter((t) => (t.category || "Other") === c).map((t) => (
                  <option key={t.id} value={t.id} disabled={mode === "unique" && t.kind === "bulk"}>{t.name}{t.kind === "bulk" ? " (bulk)" : ""}{t.barcode ? " – has a barcode" : ""}</option>
                ))}</optgroup>
              ))}
            </select>
          </label>
          {isNew && (
            <div className="grid2 newtype">
              <label className="span2">New item name<input name="new_name" required placeholder="e.g. Coleman 6-person tent" /></label>
              <label>Category<input name="new_category" placeholder="Tents, Cooking, Safety…" /></label>
              <label>Store location<input name="new_location" placeholder="Bay A, Shelf C2…" /></label>
              {mode === "product" ? (
                <div className="span2">
                  <label className="check"><input type="radio" name="new_kind" value="asset" defaultChecked /> <span>Each one gets its own tag (tents, stoves)</span></label>
                  <label className="check"><input type="radio" name="new_kind" value="bulk" /> <span>Counted in bulk (pegs, rope)</span></label>
                  <label>How many do you hold? (bulk)<input type="number" name="new_qty" min="0" defaultValue="0" /></label>
                </div>
              ) : <label>Tag prefix for printed tags (optional)<input name="new_prefix" maxLength="6" placeholder="e.g. CLM" /></label>}
            </div>
          )}
          {mode === "unique" && (
            <div className="grid2">
              <label>Serial number (if different from the barcode)<input name="serial" /></label>
              <label>Acquired<input type="date" name="acquired" /></label>
              <label className="span2">Notes<input name="notes" /></label>
            </div>
          )}
          <div className="actions"><button className="primary big">Register</button><a onClick={() => go("register")}>Cancel</a></div>
        </form>
      )}
      <section className="panel">
        <h2>Recently registered</h2>
        {recent.length ? (
          <table className="list stack small"><thead><tr><th>When</th><th>By</th><th>What</th></tr></thead>
            <tbody>{recent.map((r) => (
              <tr key={r.id} className="link" onClick={() => (r.asset_id ? go("asset", r.asset_id) : go("item", r.type_id))}>
                <td className="nowrap">{fd(r.at)}</td><td>{r.user_id ? byId("users", r.user_id).name : ""}</td><td>{r.detail}</td></tr>
            ))}</tbody></table>
        ) : <p className="empty">Nothing registered by scanning yet.</p>}
      </section>
    </>
  );
}

/* Add several items of one line by scanning each one's own barcode. */
export function ScanAdd({ t, go, refresh }) {
  const [msg, setMsg] = useState(null);
  const [added, setAdded] = useState([]);
  const scan = (raw) => {
    const code = cleanCode(raw);
    try { checkCodeFree(code); } catch (e) { beep(false); return setMsg(["bad", e.message]); }
    const a = { id: nid("assets"), type_id: t.id, tag: code, serial: "", status: "in", condition: "Serviceable", acquired: "", notes: "" };
    tx(() => { db.S.assets.push(a); log("Registered barcode", `${code} as a new ${t.name}`, { asset_id: a.id, type_id: t.id }); });
    beep(true); setMsg(["ok", `✓ ${code} added as a new ${t.name}.`]); setAdded([a, ...added]); refresh();
  };
  return (
    <details className="addbox"><summary>Add items by scanning their own barcodes</summary>
      <p className="hint">Scan the serial-number or asset barcode on each new {t.name}. Each scan adds one item with that barcode as its tag. To try it here, type a code such as <span className="mono">SER-001</span> and press Enter.</p>
      <ScanInput placeholder="Scan the barcode on each new item…" onScan={scan} autoFocus={false} />
      <p className={`scanmsg ${msg ? msg[0] : ""}`} aria-live="polite">{msg ? msg[1] : ""}</p>
      <ul className="added">{added.map((a) => <li key={a.id}><a className="mono" onClick={() => go("asset", a.id)}>{a.tag}</a></li>)}</ul>
    </details>
  );
}

export function ScannerTest({ go }) {
  const [log_, setLog] = useState([]);
  const times = useRef([]), timer = useRef(null), box = useRef(null);
  useEffect(() => { box.current && box.current.focus(); return () => clearTimeout(timer.current); }, []);
  const record = (enter) => {
    clearTimeout(timer.current);
    const code = box.current.value.trim();
    box.current.value = "";
    const t = times.current; times.current = [];
    if (!code) return;
    const gaps = t.slice(1).map((x, i) => x - t[i]);
    const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
    const [k, r] = findCode(code);
    const label = k === "asset" ? `${r.tag} ${byId("types", r.type_id).name}` : k === "type" ? `Product barcode for ${r.name}` : k === "booking" ? `Booking QB-${String(r).padStart(4, "0")}` : "Not registered";
    beep(!!k);
    setLog((l) => [{ id: Date.now(), code, fast: gaps.length > 2 && avg < 35, enter, label, k, r }, ...l]);
  };
  const open = (e) => {
    if (e.k === "asset") go("asset", e.r.id); else if (e.k === "type") go("item", e.r.id);
    else if (e.k === "booking") go("booking", e.r); else go("register", e.code);
  };
  return (
    <>
      <h1>Scanner test</h1>
      <div className="cols">
        <section className="panel">
          <h2>Scan anything</h2>
          <input ref={box} className="scanbox" placeholder="Click here, then scan a barcode…" autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); record(true); return; }
              if (e.key.length === 1) times.current.push(performance.now());
              clearTimeout(timer.current); timer.current = setTimeout(() => record(false), 600);
            }} />
          {log_[0] ? <p className="bigcode mono">{log_[0].code}</p> : <p className="empty">Waiting for a scan…</p>}
          {log_.length > 0 && (
            <table className="list small"><thead><tr><th>Code</th><th className="num">Length</th><th>Speed</th><th>Ended with Enter</th><th>On the register</th></tr></thead>
              <tbody>{log_.map((e) => (
                <tr key={e.id}><td className="mono">{e.code}</td><td className="num">{e.code.length}</td>
                  <td>{e.fast ? <span className="ok">Scanner speed</span> : <span className="warn">Typed</span>}</td>
                  <td>{e.enter ? <span className="ok">Yes</span> : <span className="bad">No – turn on the Enter suffix</span>}</td>
                  <td><a onClick={() => open(e)}>{e.label}</a></td></tr>
              ))}</tbody></table>
          )}
        </section>
        <section className="panel">
          <h2>Setting up a scanner</h2>
          <ol className="steps">
            <li><b>Plug it in</b> (USB), or pair it in Windows Bluetooth settings. No driver is needed: it works like a keyboard.</li>
            <li><b>Set it to send Enter after each scan</b>, often called the "CR suffix" or "Enter suffix". Most scanners do this out of the box. If not, scan the "Add CR suffix" code in the scanner's manual.</li>
            <li><b>Keyboard language: US.</b> If codes come out with wrong symbols, scan the "USA keyboard" code in the manual.</li>
            <li><b>Turn on Code 128</b> for Q Store labels. It's on by default on nearly every scanner. EAN/UPC (shop barcodes) and Code 39 work too.</li>
            <li>Scan a Q Store label or a booking voucher here. You should see the code, "Yes" for Enter, and a fast speed.</li>
          </ol>
          <p className="hint">"Typed" means the characters arrived slowly, like a person typing. A scanner shows as "Scanner speed". If the code is right but Enter is "No", the scanner needs its Enter suffix turned on.</p>
          <p className="hint">Bluetooth scanners in "batch" or "inventory" mode store scans and send them later. Use "instant" or "HID keyboard" mode.</p>
        </section>
      </div>
    </>
  );
}
