/* Q Store demo: data, store rules and sample data. Mirrors qstore/db.py in the Python app. */
const GROUP="Jimboomba Scout Group";
const STATUS={requested:"Requested",reserved:"Reserved",issued:"On issue",part_returned:"Part returned",returned:"Returned",cancelled:"Cancelled"};
const ASSET={in:"In store",out:"On issue",repair:"U/S – repair",lost:"Missing",written_off:"Written off"};
const KEY="qstore-demo-v1";
let S, me=null, flashes=[];

/* ---------- helpers ---------- */
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const iso=d=>{const z=new Date(d.getTime()-d.getTimezoneOffset()*6e4);return z.toISOString().slice(0,10)};
const today=()=>iso(new Date());
const addDays=n=>{const d=new Date();d.setDate(d.getDate()+n);return iso(d)};
const now=()=>{const d=new Date();return today()+" "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")};
const fd=s=>{if(!s)return"";const [d,t]=s.split(" ");const [y,m,dd]=d.split("-");return `${dd}/${m}/${y}`+(t?" "+t:"")};
const daysLate=e=>Math.round((new Date(today())-new Date(e))/864e5);
const ref=id=>"QB-"+String(id).padStart(4,"0");
const byId=(arr,id)=>S[arr].find(x=>x.id===+id);
const nid=t=>(S.seq[t]=(S.seq[t]||0)+1);
const pill=s=>`<span class="pill s-${s}">${STATUS[s]}</span>`;
const apill=s=>`<span class="pill a-${s}">${ASSET[s]}</span>`;
const user=id=>byId("users",id)||{name:"?"};
const isQM=()=>me&&me.role==="qm";
class StoresError extends Error{}
function flash(m,k="ok"){flashes.push([k,m])}
function log(action,detail="",o={}){S.log.push({id:nid("log"),at:now(),user_id:me?me.id:null,action,detail,...o})}
function save(){try{localStorage.setItem(KEY,JSON.stringify({S,me:me&&me.id}))}catch(e){}}
function tx(fn){const snap=JSON.stringify(S);try{const r=fn();save();return r}catch(e){S=JSON.parse(snap);if(e instanceof StoresError){flash(e.message,"error");return false}throw e}}

/* ---------- store rules ---------- */
function typeStock(tid){
  const t=byId("types",tid);
  if(t.kind==="asset"){const c={};S.assets.filter(a=>a.type_id===t.id).forEach(a=>c[a.status]=(c[a.status]||0)+1);
    const g=k=>c[k]||0;return{held:g("in")+g("out")+g("repair"),in:g("in"),out:g("out"),us:g("repair"),lost:g("lost"),serviceable:g("in")+g("out")}}
  const out=S.issued.filter(i=>i.type_id===t.id).reduce((n,i)=>n+i.qty-i.returned_qty-i.damaged_qty-i.lost_qty,0);
  const sv=t.qty_total-t.qty_us;return{held:t.qty_total,in:sv-out,out,us:t.qty_us,lost:0,serviceable:sv}
}
function outstanding(bid){const o={};S.issued.filter(i=>i.booking_id===bid).forEach(i=>{const n=i.qty-i.returned_qty-i.damaged_qty-i.lost_qty;if(n>0)o[i.type_id]=(o[i.type_id]||0)+n});return o}
function committed(tid,start,end,excl){
  let tot=0;const t=today();
  S.bookings.filter(b=>["reserved","issued","part_returned"].includes(b.status)&&b.id!==excl).forEach(b=>{
    if(b.status==="reserved"){if(b.start_date<=end&&b.end_date>=start)tot+=S.lines.filter(l=>l.booking_id===b.id&&l.type_id===tid).reduce((n,l)=>n+l.qty,0)}
    else{const e=b.end_date>t?b.end_date:t;if(b.start_date<=end&&e>=start)tot+=outstanding(b.id)[tid]||0}});
  return tot
}
function availability(start,end,excl){return activeTypes().map(t=>{const s=typeStock(t.id),c=committed(t.id,start,end,excl);return{t,s,c,a:Math.max(s.serviceable-c,0)}})}
function shortfalls(lines,start,end,excl){const p=[];for(const [tid,q] of Object.entries(lines)){const a=typeStock(+tid).serviceable-committed(+tid,start,end,excl);if(q>a)p.push(`${byId("types",tid).name}: ${q} wanted, only ${Math.max(a,0)} available for those dates`)}return p}
const activeTypes=()=>S.types.filter(t=>t.active).sort((a,b)=>(a.category+a.name).localeCompare(b.category+b.name));
const blines=bid=>S.lines.filter(l=>l.booking_id===bid).map(l=>({...l,t:byId("types",l.type_id)})).sort((a,b)=>(a.t.category+a.t.name).localeCompare(b.t.category+b.t.name));
const issuedRows=bid=>S.issued.filter(i=>i.booking_id===bid).map(i=>({...i,t:byId("types",i.type_id),a:i.asset_id?byId("assets",i.asset_id):null}));
const left=i=>i.qty-i.returned_qty-i.damaged_qty-i.lost_qty;
function saveBooking(d,lines,bid,status){
  if(d.end_date<d.start_date)throw new StoresError("The return date is before the issue date.");
  if(!Object.keys(lines).length)throw new StoresError("Add at least one item to the booking.");
  let b;
  if(bid){b=byId("bookings",bid);Object.assign(b,d);if(status)b.status=status;S.lines=S.lines.filter(l=>l.booking_id!==bid)}
  else{b={id:nid("bookings"),...d,status:status||"requested",created_by:me.id,created_at:now(),issued_at:null,issued_by:null,signed_by:null,closed_at:null};S.bookings.push(b)}
  for(const [tid,q] of Object.entries(lines))S.lines.push({id:nid("lines"),booking_id:b.id,type_id:+tid,qty:q});
  return b.id
}
function issueBooking(b,assetIds,bulk,signer){
  if(!["reserved","issued","part_returned"].includes(b.status))throw new StoresError("Only an approved (reserved) booking can be issued.");
  if(!assetIds.length&&!Object.values(bulk).some(v=>v>0))throw new StoresError("Nothing has been scanned or counted to issue.");
  const st=now();
  for(const id of assetIds){const a=byId("assets",id),t=byId("types",a.type_id);
    if(a.status!=="in")throw new StoresError(`${a.tag} (${t.name}) is not in the store (status: ${ASSET[a.status]}).`);
    a.status="out";S.issued.push({id:nid("issued"),booking_id:b.id,type_id:a.type_id,asset_id:a.id,qty:1,issued_at:st,returned_qty:0,damaged_qty:0,lost_qty:0,returned_at:null,return_notes:""});
    log("Issued",`${a.tag} ${t.name} to ${ref(b.id)}`,{booking_id:b.id,asset_id:a.id,type_id:t.id})}
  for(const [tid,q] of Object.entries(bulk)){if(q<=0)continue;const t=byId("types",tid),s=typeStock(+tid);
    if(q>s.in)throw new StoresError(`${t.name}: only ${s.in} in the store, cannot issue ${q}.`);
    S.issued.push({id:nid("issued"),booking_id:b.id,type_id:+tid,asset_id:null,qty:q,issued_at:st,returned_qty:0,damaged_qty:0,lost_qty:0,returned_at:null,return_notes:""});
    log("Issued",`${q} x ${t.name} to ${ref(b.id)}`,{booking_id:b.id,type_id:+tid})}
  if(b.status==="reserved")Object.assign(b,{status:"issued",issued_at:st,issued_by:me.id,signed_by:signer.id});
  log("Signed for",`${signer.name} signed for issue on ${ref(b.id)}`,{booking_id:b.id})
}
function defect(o){S.defects.push({id:nid("defects"),reported_at:now(),reported_by:me.id,status:"open",closed_at:null,closed_notes:"",asset_id:null,booking_id:null,qty:1,...o})}
function returnItems(b,assets,bulk,byLeader=false){
  const st=now(),r=ref(b.id);let did=0;
  const ret={id:nid("returns"),booking_id:b.id,returned_by:me.id,returned_at:st,by_leader:byLeader,status:byLeader?"pending":"checked",
    checked_at:byLeader?null:st,checked_by:byLeader?null:me.id,check_notes:"",lines:[]};
  const by=byLeader?" (leader return, awaiting QM check)":"";
  const line=(i,g,dm,ms,notes)=>ret.lines.push({id:nid("return_lines"),issued_id:i.id,type_id:i.type_id,asset_id:i.asset_id,good:g,damaged:dm,missing:ms,notes,check_result:""});
  for(const [iid,[cond,notes]] of Object.entries(assets)){const i=byId("issued",iid);if(!i||i.returned_at)continue;const a=byId("assets",i.asset_id),t=byId("types",i.type_id);did++;
    if(cond==="good"){Object.assign(i,{returned_qty:1,returned_at:st,return_notes:notes});Object.assign(a,{status:"in",condition:"Serviceable"});line(i,1,0,0,notes);log("Returned",`${a.tag} ${t.name} serviceable from ${r}${by}`,{booking_id:b.id,asset_id:a.id,type_id:t.id})}
    else if(cond==="damaged"){Object.assign(i,{damaged_qty:1,returned_at:st,return_notes:notes});Object.assign(a,{status:"repair",condition:"Unserviceable"});defect({kind:"damage",type_id:t.id,asset_id:a.id,booking_id:b.id,description:notes});line(i,0,1,0,notes);log("Returned damaged",`${a.tag} ${t.name} from ${r}: ${notes}${by}`,{booking_id:b.id,asset_id:a.id,type_id:t.id})}
    else{if(!notes)throw new StoresError(`Say what happened to missing item ${a.tag}.`);Object.assign(i,{lost_qty:1,returned_at:st,return_notes:notes});Object.assign(a,{status:"lost",condition:"Missing"});defect({kind:"loss",type_id:t.id,asset_id:a.id,booking_id:b.id,description:notes});line(i,0,0,1,notes);log("Reported missing",`${a.tag} ${t.name} on ${r}: ${notes}${by}`,{booking_id:b.id,asset_id:a.id,type_id:t.id})}}
  for(const [iid,[g,dm,ms,notes]] of Object.entries(bulk)){if(g+dm+ms===0)continue;const i=byId("issued",iid),t=byId("types",i.type_id),l=left(i);
    if(Math.min(g,dm,ms)<0||g+dm+ms>l)throw new StoresError(`${t.name}: only ${l} still out, check the numbers.`);
    if(ms&&!notes)throw new StoresError(`Say what happened to the missing ${t.name}.`);did++;
    i.returned_qty+=g;i.damaged_qty+=dm;i.lost_qty+=ms;i.return_notes=(i.return_notes+" "+notes).trim();if(left(i)===0)i.returned_at=st;
    if(dm){t.qty_us+=dm;defect({kind:"damage",type_id:t.id,qty:dm,booking_id:b.id,description:notes})}
    if(ms){t.qty_total-=ms;defect({kind:"loss",type_id:t.id,qty:ms,booking_id:b.id,description:notes})}
    line(i,g,dm,ms,notes);log("Returned",`${t.name}: ${g} serviceable, ${dm} damaged, ${ms} missing from ${r}`+(notes?` (${notes})`:"")+by,{booking_id:b.id,type_id:t.id})}
  if(!did)throw new StoresError("Nothing was marked as returned.");
  S.returns.push(ret);
  if(byLeader)log("Leader return",`${me.name} returned equipment on ${r} and confirmed with their PIN`,{booking_id:b.id});
  const still=Object.values(outstanding(b.id)).reduce((a,c)=>a+c,0);
  b.status=still?"part_returned":"returned";b.closed_at=still?null:st;return b.status
}
function closeDefect(d,action,notes){
  if(d.status!=="open")throw new StoresError("This report is already closed.");
  const t=byId("types",d.type_id);
  if(d.asset_id){const a=byId("assets",d.asset_id);a.status=action==="written_off"?"written_off":"in";a.condition=action==="written_off"?"Written off":"Serviceable"}
  else if(d.kind==="damage"&&action==="repaired")t.qty_us=Math.max(t.qty_us-d.qty,0);
  else if(d.kind==="damage")(t.qty_us=Math.max(t.qty_us-d.qty,0),t.qty_total=Math.max(t.qty_total-d.qty,0));
  else if(action==="found")t.qty_total+=d.qty;
  Object.assign(d,{status:action,closed_at:now(),closed_by:me.id,closed_notes:notes});
  const lab=d.asset_id?byId("assets",d.asset_id).tag:d.qty+" x";
  log({repaired:"Repaired",written_off:"Written off",found:"Found"}[action],`${lab} ${t.name}`+(notes?`: ${notes}`:""),{asset_id:d.asset_id,type_id:t.id,booking_id:d.booking_id})
}
function nextTag(t){const p=(t.tag_prefix||"QS").toUpperCase();const n=S.assets.filter(a=>a.tag.startsWith(p+"-")).map(a=>+a.tag.split("-").pop()||0);return p+"-"+String((n.length?Math.max(...n):0)+1).padStart(3,"0")}
function addAssets(t,n,o={}){const tags=[];for(let k=0;k<n;k++){const tag=nextTag(t);S.assets.push({id:nid("assets"),type_id:t.id,tag,serial:"",status:"in",condition:"Serviceable",acquired:o.acquired||"",notes:""});tags.push(tag)}return tags}
const overdue=()=>S.bookings.filter(b=>["issued","part_returned"].includes(b.status)&&b.end_date<today()).sort((a,b)=>a.end_date.localeCompare(b.end_date));
const onBooking=aid=>{const i=[...S.issued].reverse().find(x=>x.asset_id===aid&&!x.returned_at);return i?i.booking_id:null};

/* ---------- barcode (Code 128 B) ---------- */
const P="212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112".split(" ");
function barcode(text,h=50){const c=[104,...[...text].map(ch=>ch.charCodeAt(0)-32)];c.push((104+[...text].reduce((s,ch,i)=>s+(i+1)*(ch.charCodeAt(0)-32),0))%103,106);
  let x=20,r="";for(const k of c)[...P[k]].forEach((w,i)=>{w=+w*2;if(i%2===0)r+=`<rect x="${x}" width="${w}" height="${h}"/>`;x+=w});
  return `<svg viewBox="0 0 ${x+20} ${h}" width="${x+20}" height="${h}" role="img" aria-label="${esc(text)}"><rect width="${x+20}" height="${h}" fill="#fff"/><g fill="#000">${r}</g></svg>`}

/* ---------- sample data ---------- */
function seed(){
  S={users:[],types:[],assets:[],bookings:[],lines:[],issued:[],defects:[],log:[],seq:{}};
  S.users.push({id:nid("users"),name:"Quartermaster",section:"Q Store",phone:"",email:"",role:"qm",pin:"1234",active:true});
  const L=[["Sam Turner","Scouts","0400 111 222"],["Priya Shah","Venturers","0400 333 444"],["Mick O'Brien","Cubs","0400 555 666"],["Jo Nguyen","Joeys","0400 777 888"]];
  const ids={};L.forEach(([n,s,p])=>{const id=nid("users");S.users.push({id,name:n,section:s,phone:p,email:"",role:"leader",pin:"1111",active:true});ids[n]=id});
  const I=[["Dome tent 4-person","Tents","asset",8,"Bay A","TNT"],["Hike tent 2-person","Tents","asset",6,"Bay A","HTN"],["Patrol tent 6m","Tents","asset",3,"Bay B","PTL"],
   ["Gas cooker 2-burner","Cooking","asset",4,"Shelf C1","CKR"],["Trangia hike stove","Cooking","asset",10,"Shelf C2","STV"],["Gas bottle 9kg","Cooking","asset",4,"Gas cage","GAS"],
   ["Patrol cook box","Cooking","asset",4,"Shelf C3","PCB"],["Hiking pack 65L","Hiking","asset",12,"Rack D","PCK"],["First aid kit (camp)","Safety","asset",3,"Office","FAK"],
   ["UHF handheld radio","Safety","asset",6,"Office","RAD"],["Tent pegs","Tents","bulk",300,"Bin 4",""],["Tarp 3x4m","Shelter","bulk",15,"Shelf E1",""],
   ["Rope 10m (pioneering)","Pioneering","bulk",40,"Shelf F1",""],["Lashing spars 2.4m","Pioneering","bulk",60,"Rack G",""],["Camp chairs","Furniture","bulk",24,"Bay H",""],["Water jerry can 20L","Cooking","bulk",8,"Shelf C4",""]];
  const T={};I.forEach(([n,c,k,q,loc,p])=>{const t={id:nid("types"),name:n,category:c,kind:k,unit:"each",location:loc,tag_prefix:p,qty_total:k==="bulk"?q:0,qty_us:0,notes:"",active:true};S.types.push(t);T[n]=t.id;if(k==="asset")addAssets(t,q,{acquired:"2024-03-01"})});
  for(const [n,c] of [["Tent pegs","9312345000012"],["Tarp 3x4m","9312345000029"],["Camp chairs","9312345000036"]])S.types.find(t=>t.name===n).barcode=c;
  S.assets.find(a=>a.tag==="TNT-001").serial="OZ-55821";S.assets.find(a=>a.tag==="RAD-001").serial="GME-TX667-0193";
  me=S.users[0];
  const book=(act,l,s,e,lines,st)=>{const o={};for(const k in lines)o[T[k]]=lines[k];const id=saveBooking({activity:act,leader_id:ids[l],start_date:s,end_date:e,notes:""},o,null,st);log("Booking added",`${ref(id)} ${act}`,{booking_id:id});return id};
  const b1=book("Venturer hike – Lamington","Priya Shah",addDays(-6),addDays(-2),{"Hike tent 2-person":3,"Trangia hike stove":3,"Hiking pack 65L":6,"UHF handheld radio":2},"reserved");
  const b2=book("Scout patrol camp – Bunya","Sam Turner",addDays(-1),addDays(2),{"Dome tent 4-person":4,"Gas cooker 2-burner":2,"Gas bottle 9kg":2,"Patrol cook box":2,"First aid kit (camp)":1,"Tent pegs":60,"Tarp 3x4m":4,"Camp chairs":12},"reserved");
  [[b1,"Priya Shah"],[b2,"Sam Turner"]].forEach(([bid,l])=>{const as=[],bk={};blines(bid).forEach(x=>{if(x.t.kind==="asset")as.push(...S.assets.filter(a=>a.type_id===x.type_id&&a.status==="in").slice(0,x.qty).map(a=>a.id));else bk[x.type_id]=x.qty});issueBooking(byId("bookings",bid),as,bk,user(ids[l]))});
  book("Cub Scout pack holiday","Mick O'Brien",addDays(5),addDays(7),{"Patrol tent 6m":2,"Gas cooker 2-burner":2,"Gas bottle 9kg":2,"Camp chairs":20,"Tarp 3x4m":6},"reserved");
  book("Joey family sleepover","Jo Nguyen",addDays(12),addDays(13),{"Dome tent 4-person":6,"First aid kit (camp)":1,"Water jerry can 20L":2},"requested");
  book("Pioneering night – signal tower","Sam Turner",addDays(9),addDays(9),{"Rope 10m (pioneering)":30,"Lashing spars 2.4m":40},"requested");
  const stv=S.assets.find(a=>a.tag==="STV-010");stv.status="repair";stv.condition="Unserviceable";
  defect({kind:"damage",type_id:stv.type_id,asset_id:stv.id,description:"Burner ring cracked, leaks meths"});
  log("Reported unserviceable","STV-010 Trangia hike stove: Burner ring cracked",{asset_id:stv.id,type_id:stv.type_id});
  me=null;
}
try{const d=JSON.parse(localStorage.getItem(KEY));if(d&&d.S){S=d.S;me=d.me?byId("users",d.me):null}}catch(e){}
if(!S)seed();
function ensure(){for(const k of ["stocktakes","st_scans","st_counts","st_results","returns"])S[k]=S[k]||[];S.types.forEach(t=>{if(t.barcode===undefined)t.barcode=""})}
ensure();


/* ---------- barcodes (mirrors find_code in the Python app) ---------- */
const cleanCode=c=>[...String(c||"")].filter(ch=>ch.charCodeAt(0)>=32&&ch.charCodeAt(0)<=126).join("").trim().slice(0,64);
function findCode(code){
  const c=cleanCode(code).toUpperCase();if(!c)return [null,null];
  const a=S.assets.find(x=>x.tag.toUpperCase()===c)||S.assets.find(x=>x.serial&&x.serial.toUpperCase()===c);
  if(a)return ["asset",a];
  const t=S.types.find(x=>x.active&&x.barcode&&x.barcode.toUpperCase()===c);
  if(t)return ["type",t];
  if(/^QB-\d+$/.test(c)&&byId("bookings",+c.slice(3)))return ["booking",+c.slice(3)];
  return [null,null];
}
function checkCodeFree(code,ignoreType){
  const [k,r]=findCode(code);
  if(k==="asset")throw new StoresError(`${code} is already registered to ${r.tag} (${byId("types",r.type_id).name}).`);
  if(k==="type"&&r.id!==ignoreType)throw new StoresError(`${code} is already the product barcode for ${r.name}.`);
  if(k==="booking")throw new StoresError(`${code} looks like a booking number. Use a different barcode.`);
}
export const db={get S(){return S},get me(){return me},set me(u){me=u;save()},
  takeFlashes(){const f=flashes;flashes=[];return f},reset(){try{localStorage.removeItem(KEY)}catch(e){}seed();ensure();me=null;save()}};
export {GROUP,STATUS,ASSET,StoresError,esc,iso,today,addDays,now,fd,daysLate,ref,byId,nid,user,isQM,flash,log,save,tx,
  typeStock,outstanding,committed,availability,shortfalls,activeTypes,blines,issuedRows,left,saveBooking,issueBooking,
  defect,returnItems,closeDefect,addAssets,overdue,onBooking,barcode,cleanCode,findCode,checkCodeFree};
