const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const PAL_COUNT = 15;

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? genCode() : code;
}

function getRoomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    seats: room.seats.map(s => (s ? { id: s.id, name: s.name } : null)),
    cols: room.cols,
    mv: room.mv,
    drawOfferBy: room.drawOfferBy,
    isDraw: room.isDraw
  };
}

io.on("connection", socket => {
  let currentRoom = null;

  socket.on("joinRoom", ({ roomCode, name, preferredSeat, preferredColor }, cb) => {
    const cleanName = (name || "Gracz").trim().slice(0, 18) || "Gracz";
    socket.data.name = cleanName;
    let code = (roomCode || "").trim().toUpperCase();
    let room;

    if (!code) {
      code = genCode();
      room = {
        code,
        hostId: socket.id,
        seats: [null, null, null],
        cols: [0, 1, 2],
        mv: [],
        drawOfferBy: null,
        isDraw: false
      };
      rooms.set(code, room);
    } else {
      room = rooms.get(code);
      if (!room) return cb({ error: "Nie znaleziono pokoju o takim kodzie." });
    }

    currentRoom = room;
    socket.join(code);

    let seat = -1;
    if (preferredSeat >= 0 && preferredSeat <= 2 && !room.seats[preferredSeat]) {
      seat = preferredSeat;
    } else {
      seat = room.seats.findIndex(s => s === null);
    }

    if (seat !== -1) {
      room.seats[seat] = { id: socket.id, name: cleanName };
      if (
        typeof preferredColor === "number" &&
        preferredColor >= 0 &&
        preferredColor < PAL_COUNT &&
        !room.cols.includes(preferredColor)
      ) {
        room.cols[seat] = preferredColor;
      }
    }

    cb({ ok: true, seat, state: getRoomState(room) });
    io.to(code).emit("roomUpdate", getRoomState(room));
  });

  socket.on("takeSeat", seatIdx => {
    if (!currentRoom || seatIdx < 0 || seatIdx > 2) return;
    if (currentRoom.seats[seatIdx]) return;
    const old = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    const oldName = old !== -1 ? currentRoom.seats[old]?.name : null;
    if (old !== -1) currentRoom.seats[old] = null;
    currentRoom.seats[seatIdx] = { id: socket.id, name: socket.data.name || oldName || "Gracz" };
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom));
  });

  socket.on("setName", name => {
    socket.data.name = (name || "Gracz").trim().slice(0, 18) || "Gracz";
    if (!currentRoom) return;
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat !== -1) {
      currentRoom.seats[seat].name = socket.data.name;
      io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom));
    }
  });

  socket.on("changeColor", colIdx => {
    if (!currentRoom || typeof colIdx !== "number" || colIdx < 0 || colIdx >= PAL_COUNT) return;
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat === -1) return;
    if (currentRoom.cols.includes(colIdx)) return;
    currentRoom.cols[seat] = colIdx;
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom));
  });

  socket.on("makeMove", moveData => {
    if (!currentRoom || currentRoom.isDraw) return;
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat === -1) return;
    if (!Array.isArray(moveData) || moveData.length < 2) return;
    currentRoom.drawOfferBy = null;
    currentRoom.mv.push([moveData[0], moveData[1], moveData[2] || null]);
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom));
  });

  socket.on("offerDraw", () => {
    if (!currentRoom || currentRoom.isDraw) return;
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat === -1) return;
    if (currentRoom.drawOfferBy === null) {
      currentRoom.drawOfferBy = seat;
    } else if (currentRoom.drawOfferBy === seat) {
      currentRoom.drawOfferBy = null;
    } else {
      currentRoom.isDraw = true;
      currentRoom.drawOfferBy = null;
    }
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom));
  });

  socket.on("resetGame", () => {
    if (!currentRoom || currentRoom.hostId !== socket.id) return;
    currentRoom.mv = [];
    currentRoom.drawOfferBy = null;
    currentRoom.isDraw = false;
    io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom));
  });

  socket.on("disconnect", () => {
    if (!currentRoom) return;
    const seat = currentRoom.seats.findIndex(s => s && s.id === socket.id);
    if (seat !== -1) currentRoom.seats[seat] = null;
    if (currentRoom.drawOfferBy === seat) currentRoom.drawOfferBy = null;

    if (currentRoom.hostId === socket.id) {
      const next = currentRoom.seats.find(s => s !== null);
      if (next) currentRoom.hostId = next.id;
    }

    if (currentRoom.seats.every(s => s === null)) {
      const code = currentRoom.code;
      setTimeout(() => {
        const r = rooms.get(code);
        if (r && r.seats.every(s => s === null)) rooms.delete(code);
      }, 5 * 60 * 1000);
    } else {
      io.to(currentRoom.code).emit("roomUpdate", getRoomState(currentRoom));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serwer działa na porcie ${PORT}`));
```[cite: 6]

### `public/index.html`
```html
<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Szachy dla trzech graczy</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%232b2621'/%3E%3Cpath fill='%23f59e0b' stroke='%23161616' stroke-width='2.5' stroke-linejoin='round' d='M20 52h24v5H20zm3-5c0-6 4-9 8-12l-5-2c-3-1-5-4-4-8 1-4 5-7 7-11l-1-6 6 3 4-4 2 5c7 2 11 8 11 16 0 7-4 12-7 16v2H23zm9-25a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'/%3E%3C/svg%3E">
<style>
:root{--bg:#1d1a17;--fg:#efe7da;--pn:#2b2621;--ac:#d9a45b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px system-ui,sans-serif}
#bar{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;align-items:center;padding:8px;background:var(--pn)}
#turn{font-size:17px;font-weight:700;margin-right:8px}
button,select,input[type=text]{background:#43392f;color:var(--fg);border:0;border-radius:8px;padding:0 12px;min-height:40px;font:inherit}
button,select{cursor:pointer}
button.on{background:var(--ac);color:#201a13;font-weight:600}
button:disabled{opacity:.4;cursor:not-allowed}
label{display:inline-flex;gap:5px;align-items:center;min-height:40px}
#main{display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-start;gap:10px;padding:6px}
svg{width:min(98vw,calc(88vh*1.15));height:auto;user-select:none;touch-action:manipulation}
#side{width:min(98vw,270px);background:var(--pn);border-radius:10px;padding:10px}
#side h3{margin:4px 0 8px;font-size:14px;border-bottom:1px solid #fff2;padding-bottom:4px}
#seats{display:flex;flex-direction:column;gap:5px;margin-bottom:12px}
.seat{display:flex;align-items:center;justify-content:space-between;background:#362f29;padding:6px 8px;border-radius:6px;font-size:13px}
.seat.me{outline:2px solid var(--ac)}
#list{max-height:48vh;overflow:auto;margin:0;padding:0;list-style:none}
#list li{padding:6px 8px;border-radius:6px;cursor:pointer;display:flex;gap:8px;align-items:center}
#list li.cur{background:var(--ac);color:#201a13;font-weight:600}
.dot{width:12px;height:12px;border-radius:50%;border:1px solid #fff8;flex:none}
@media(max-width:700px){#list{max-height:24vh}}
.p{font:84px "Segoe UI Symbol","Noto Sans Symbols 2",serif;text-anchor:middle;dominant-baseline:central;pointer-events:none;stroke-width:3px;paint-order:stroke}
.lb{font:22px system-ui,sans-serif;text-anchor:middle;dominant-baseline:central;pointer-events:none}
.ov{position:fixed;inset:0;background:#000c;display:none;align-items:center;justify-content:center;z-index:9;padding:12px}
.box{background:var(--pn);border-radius:14px;padding:20px;max-width:440px;width:100%;box-shadow:0 10px 30px #0009}
.box h2{margin:0 0 12px;font-size:19px}
.row{display:flex;align-items:center;gap:8px;margin:10px 0;flex-wrap:wrap}
.row b{width:130px}
.sw{width:38px;height:38px;border-radius:50%;border:3px solid #0006;padding:0;min-height:0}
.sw.sel{border-color:#fff;box-shadow:0 0 0 3px var(--ac)}
.sw:disabled{opacity:.2;cursor:not-allowed}
.promo-btn{font-size:44px;width:64px;height:64px;display:inline-flex;align-items:center;justify-content:center}
#roomTag{background:#362f29;padding:6px 10px;border-radius:8px;font-weight:700;cursor:pointer;border:1px dashed var(--ac)}
.win-sub{font-size:20px;font-weight:800;color:#fbbf24;margin:8px 0 14px;letter-spacing:.3px}
</style></head><body>

<div id="bar">
  <span id="roomTag" title="Kliknij, aby skopiować link zaproszenia">Pokój: —</span>
  <span id="turn">Łączenie...</span>
  <button id="undo" title="Podgląd poprzedniego ruchu">◀</button>
  <button id="redo" title="Podgląd następnego ruchu">▶</button>
  <button id="live" class="on" style="display:none">Wróć do gry</button>
  <button id="clr">Usuń rysunki</button>
  <button id="arr">Strzałki: wył.</button>
  <select id="theme"><option value="w1">Drewno jasne</option><option value="w2">Drewno ciemne</option><option value="m">Marmur</option><option value="pl">Plastik</option></select>
  <label><input type="checkbox" id="lab" checked>Numery pól</label>
  <button id="colors">Twój kolor</button>
  <button id="drawBtn" style="display:none">Remis</button>
  <button id="mute">Dźwięk: wł.</button>
  <button id="reset" style="display:none">Zacznij od nowa</button>
</div>

<div id="main">
  <svg id="s" viewBox="230 0 1510 1310"></svg>
  <div id="side">
    <h3>Gracze w pokoju</h3>
    <div id="seats"></div>
    <h3>Historia ruchów</h3>
    <ul id="list"></ul>
  </div>
</div>

<!-- Okno startowe (Lobby) -->
<div id="lobby" class="ov" style="display:flex">
  <div class="box">
    <h2>Szachy dla trzech graczy</h2>
    <div class="row"><input type="text" id="nick" placeholder="Twój nick" style="width:100%"></div>
    <div class="row" style="margin:8px 0">
      <b style="width:auto">Kolor startowy:</b>
      <div id="lobbyPick" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px"></div>
    </div>
    <button id="createBtn" class="on" style="width:100%;margin-top:6px">Utwórz nowy pokój</button>
    <div style="text-align:center;margin:12px 0;opacity:.6">— LUB DOŁĄCZ KODEM —</div>
    <div class="row" style="margin:0">
      <input type="text" id="codeIn" placeholder="Kod pokoju (np. A7K9P)" style="flex:1;text-transform:uppercase">
      <button id="joinBtn" class="on">Dołącz</button>
    </div>
    <p id="lobbyErr" style="color:#ff6b6b;margin:8px 0 0;font-size:13px"></p>
  </div>
</div>

<!-- Okno wyboru koloru -->
<div id="ov" class="ov">
  <div class="box">
    <h2>Wybierz swój kolor</h2>
    <div id="pick"></div>
    <button id="go" class="on" style="width:100%;margin-top:12px">Gotowe</button>
  </div>
</div>

<!-- Okno promocji piona -->
<div id="promoOv" class="ov">
  <div class="box" style="text-align:center">
    <h2>Promocja piona</h2>
    <div style="display:flex;gap:10px;justify-content:center;margin-top:12px">
      <button class="promo-btn" data-p="q">♛</button>
      <button class="promo-btn" data-p="r">♜</button>
      <button class="promo-btn" data-p="b">♝</button>
      <button class="promo-btn" data-p="n">♞</button>
    </div>
  </div>
</div>

<!-- Okno końca gry -->
<div id="endOv" class="ov">
  <div class="box" style="text-align:center">
    <h2 id="endTitle">Koniec gry</h2>
    <div id="endSub" class="win-sub"></div>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <button id="endClose" class="on">Zobacz planszę</button>
      <button id="endReset" style="display:none">Nowa partia</button>
    </div>
  </div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
const socket = io();
let MY_SEAT = -1, IS_HOST = false, ROOM_CODE = "", SEATS = [null, null, null];
let pendingPromo = null, drawOfferBy = null, isDraw = false, endShownForKey = "";
let lobbyColor = 0;

// 15 wyraźnie rozróżnialnych kolorów (styl Among Us)
const PAL = [
  ["Czerwony", "#e52521"],
  ["Niebieski", "#132ed1"],
  ["Zielony", "#11802d"],
  ["Różowy", "#ed54ba"],
  ["Pomarańczowy", "#ef7d0d"],
  ["Żółty", "#f5f557"],
  ["Czarny", "#3f474e"],
  ["Biały", "#d6e0f0"],
  ["Fioletowy", "#6b2fbb"],
  ["Brązowy", "#71491e"],
  ["Cyjan", "#38fedc"],
  ["Limonkowy", "#50ef39"],
  ["Bordowy", "#6b2b3c"],
  ["Brzoskwiniowy", "#ecc0d3"],
  ["Lawendowy", "#9484cf"]
];

const G={p:"♟",r:"♜",n:"♞",b:"♝",q:"♛",k:"♚"};
const TH={w1:["#ecc995","#a86a3a",1],w2:["#c99a63","#5b3920",1],m:["#e9eaed","#6a7280",2],pl:["#f1e7d0","#2f7d5b",0]};
const H={B0:[610,1300],B1:[1360,1300],R:[1730,655],T1:[1360,8],T0:[610,8],L:[240,655]},C=[985,655];
const M={b:[985,1300],ll:[425,977],ul:[425,331],t:[985,8],ur:[1545,331],lr:[1545,977]};
const Q=[[H.B0,M.b,C,M.ll],[M.ll,H.L,M.ul,C],[M.ul,H.T0,M.t,C],[M.t,H.T1,M.ur,C],[M.ur,H.R,M.lr,C],[M.lr,H.B1,M.b,C]];
const NM=[(i,j)=>"ABCD"[i]+(j+1),(i,j)=>"ABCD"[j]+(5+i),(i,j)=>"IJKL"[i]+(8-j),(i,j)=>"LKJI"[j]+(9+i),(i,j)=>"EFGH"[i]+(12-j),(i,j)=>"HGFE"[j]+(4-i)];
const bil=(q,u,v)=>[0,1].map(k=>(1-u)*(1-v)*q[0][k]+u*(1-v)*q[1][k]+u*v*q[2][k]+(1-u)*v*q[3][k]);
const key=p=>p.map(x=>Math.round(x+.37)).join(",");
const cells=[],vm=new Map(),em=new Map();

Q.forEach((q,qi)=>{for(let i=0;i<4;i++)for(let j=0;j<4;j++){
 const pts=[[i,j],[i+1,j],[i+1,j+1],[i,j+1]].map(([a,b])=>bil(q,a/4,b/4));
 const c={id:cells.length,name:NM[qi](i,j),pts,keys:pts.map(key),n:[null,null,null,null],ctr:[0,1].map(k=>pts.reduce((s,p)=>s+p[k],0)/4)};
 cells.push(c);
 c.keys.forEach((k,e)=>{(vm.get(k)||vm.set(k,[]).get(k)).push(c.id);
  const ek=[k,c.keys[(e+1)%4]].sort().join("|");(em.get(ek)||em.set(ek,[]).get(ek)).push([c.id,e]);});
}});
em.forEach(l=>{if(l.length==2){const[[a,ea],[b,eb]]=l;cells[a].n[ea]=[b,eb];cells[b].n[eb]=[a,ea];}});
const col=Array(96).fill(-1);col[0]=0;for(const q=[0];q.length;){const c=q.shift();cells[c].n.forEach(n=>{if(n&&col[n[0]]<0){col[n[0]]=1-col[c];q.push(n[0]);}});}
const go=(c,e)=>cells[c].n[e],nrm=v=>{const l=Math.hypot(...v)||1;return[v[0]/l,v[1]/l]};
const SIDES=[{a:H.B0,b:H.B1,in:[0,-1],set:"rnbqkbnr"},{a:H.L,b:H.T0,in:[.866,.5],set:"rnbkqbnr"},{a:H.T1,b:H.R,in:[-.866,.5],set:"rnbkqbnr"}];

let B,turn,alive,sel=null,hl=[],arrows=[],marks=new Set(),rs=null,last=null,homeRow=[],status="",mv=[],notes=[],pos=0,cols=[0,1,2],theme="w1",arrMode=false;

function playerName(o){return SEATS[o]?.name || `Gracz ${o+1}`;}

function setup(){
 B=Array(96).fill(null);status="";turn=0;alive=[1,1,1];sel=null;hl=[];last=null;
 SIDES.forEach((S,o)=>{const d=[S.b[0]-S.a[0],S.b[1]-S.a[1]],L=Math.hypot(...d),row=[];
  cells.forEach(c=>{for(let e=0;e<4;e++){const on=[c.pts[e],c.pts[(e+1)%4]].every(p=>Math.abs((p[0]-S.a[0])*d[1]-(p[1]-S.a[1])*d[0])/L<2);if(on)row.push({c:c.id,e,t:((c.ctr[0]-S.a[0])*d[0]+(c.ctr[1]-S.a[1])*d[1])/L});}});
  row.sort((x,y)=>x.t-y.t);homeRow[o]=row.map(r=>r.c);
  row.forEach((r,i)=>{B[r.c]={t:S.set[i],o,moved:0};const f=go(r.c,(r.e+2)%4);if(f)B[f[0]]={t:"p",o,h:(f[1]+2)%4,moved:0};});});
}

const arrowPath=(a,z)=>{
 for(let e=0;e<8;e++){const r=e<4?rays(a,e):drays(a,e-4),i=r.indexOf(z);if(i>=0)return[a,...r.slice(0,i+1)];}
 if(knight(a).includes(z)){
  for(let e=0;e<4;e++){const p=go(a,e);if(!p)continue;const q=go(p[0],(p[1]+2)%4);if(!q)continue;for(const t of[1,3]){const d=go(q[0],(q[1]+t)%4);if(d&&d[0]==z)return[a,p[0],q[0],z];}}
  for(let e=0;e<4;e++){const p=go(a,e);if(!p)continue;for(const t of[1,3]){const q=go(p[0],(p[1]+t)%4);if(!q)continue;const d=go(q[0],(q[1]+2)%4);if(d&&d[0]==z)return[a,p[0],q[0],z];}}}
 return null;};
const slide=(list,me)=>{const r=[];for(const d of list){if(B[d]==null){r.push(d);continue}if(B[d].o!=me)r.push(d);break}return r;};
const rays=(c,e)=>{const r=[];let x=go(c,e);while(x){r.push(x[0]);x=go(x[0],(x[1]+2)%4);}return r;};
const dnext=(c,k)=>{const l=vm.get(cells[c].keys[k]);if(l.length!=4)return null;const d=l.find(o=>o!=c&&!cells[c].n.some(n=>n&&n[0]==o));return d==null?null:[d,cells[d].keys.indexOf(cells[c].keys[k])];};
const drays=(c,k)=>{const r=[];let x=dnext(c,k);while(x){r.push(x[0]);x=dnext(x[0],(x[1]+2)%4);}return r;};
function knight(c){const s=new Set();for(let e=0;e<4;e++){const a=go(c,e);if(!a)continue;
 const b=go(a[0],(a[1]+2)%4);if(b)[1,3].forEach(t=>{const d=go(b[0],(b[1]+t)%4);d&&s.add(d[0]);});
 [1,3].forEach(t=>{const b2=go(a[0],(a[1]+t)%4);if(!b2)return;const d=go(b2[0],(b2[1]+2)%4);d&&s.add(d[0]);});}
 s.delete(c);return[...s];}
function pseudo(c){const p=B[c],me=p.o;let out=[];
 const R=()=>[0,1,2,3].forEach(e=>out.push(...slide(rays(c,e),me)));
 const Bi=()=>[0,1,2,3].forEach(k=>out.push(...slide(drays(c,k),me)));
 if(p.t=="r")R();else if(p.t=="b")Bi();else if(p.t=="q"){R();Bi();}
 else if(p.t=="n")out=knight(c).filter(d=>!B[d]||B[d].o!=me);
 else if(p.t=="k"){const s=new Set();cells[c].n.forEach(n=>n&&s.add(n[0]));cells[c].keys.forEach(k=>vm.get(k).forEach(d=>s.add(d)));s.delete(c);out=[...s].filter(d=>!B[d]||B[d].o!=me);}
 else{const a=go(c,p.h);
  if(a&&!B[a[0]]){out.push(a[0]);const b=go(a[0],(a[1]+2)%4);if(!p.moved&&b&&!B[b[0]])out.push(b[0]);}
  if(a)[1,3].forEach(t=>{const d=go(a[0],(a[1]+t)%4);if(d&&B[d[0]]&&B[d[0]].o!=me)out.push(d[0]);});}
 return[...new Set(out)];}

const fwdAfterTurn=(fc,fe,s,dd)=>{const vi=s==(fe+1)%4?(fe+1)%4:fe,k=cells[dd[0]].keys.indexOf(cells[fc].keys[vi]);return k<0?(dd[1]+2)%4:[(k+3)%4,k].find(e=>e!=dd[1]);};
const att=c=>{const p=B[c];if(p.t!="p")return pseudo(c);const a=go(c,p.h),r=[];if(a)[1,3].forEach(t=>{const d=go(a[0],(a[1]+t)%4);d&&r.push(d[0]);});return r;};
const attacked=(x,o)=>{for(let c=0;c<96;c++){const p=B[c];if(p&&p.o!=o&&alive[p.o]&&att(c).includes(x))return true;}return false;};
const inCheck=o=>{const k=B.findIndex(p=>p&&p.o==o&&p.t=="k");return k>=0&&attacked(k,o);};
function legal(c){const p=B[c],o=p.o,out=[];
 for(const b of pseudo(c)){const t=B[b];B[b]=p;B[c]=null;const ok=!inCheck(o);B[c]=p;B[b]=t;if(ok)out.push(b);}
 if(p.t=="k"&&!p.moved){const hr=homeRow[o],ki=hr.indexOf(c);
  if(ki>=0&&!inCheck(o))for(const dir of[-1,1]){const ri=dir<0?0:7,rk=B[hr[ri]];
   if(!rk||rk.t!="r"||rk.o!=o||rk.moved)continue;
   let free=true;for(let i=Math.min(ki,ri)+1;i<Math.max(ki,ri);i++)if(B[hr[i]])free=false;
   if(!free)continue;
   const s1=hr[ki+dir],s2=hr[ki+2*dir];if(attacked(s1,o)||attacked(s2,o))continue;out.push(s2);}}
 return out;}
const hasLegal=o=>B.some((p,c)=>p&&p.o==o&&legal(c).length);
function advance(){status="";for(let g=0;g<4;g++){turn=(turn+1)%3;if(!alive[turn])continue;if(alive.reduce((x,y)=>x+y,0)<2)return;
 if(hasLegal(turn))return;
 if(inCheck(turn)){B=B.map(x=>x&&x.o==turn?null:x);alive[turn]=0;continue;}
 status="Pat: remis";return;}}

let ac,mute=false;
function snd(f,d=.12,t="sine"){if(mute)return;try{ac=ac||new AudioContext();if(ac.state==="suspended")ac.resume();const o=ac.createOscillator(),g=ac.createGain(),n=ac.currentTime;o.type=t;o.frequency.value=f;g.gain.setValueAtTime(.15,n);g.gain.exponentialRampToValueAtTime(.001,n+d);o.connect(g);g.connect(ac.destination);o.start();o.stop(n+d);}catch(e){}}

function apply(a,b,promo,quiet){
 const p=B[a],t=B[b],cap=!!t,pt=p.t,who=p.o;let note=null;
 if(p.t=="p"){const f=go(a,p.h),f2=f&&go(f[0],(f[1]+2)%4);
  if(f&&f[0]==b)p.h=(f[1]+2)%4;
  else if(f2&&f2[0]==b)p.h=(f2[1]+2)%4;
  else if(f)for(const tt of[1,3]){const sd=(f[1]+tt)%4,d=go(f[0],sd);if(d&&d[0]==b){p.h=fwdAfterTurn(f[0],(f[1]+2)%4,sd,d);break;}}}
 if(p.t=="k"&&!p.moved){const hr=homeRow[p.o],ki=hr.indexOf(a),bi=hr.indexOf(b);
  if(ki>=0&&bi>=0&&Math.abs(bi-ki)==2){const dir=Math.sign(bi-ki),ri=dir<0?0:7,rk=B[hr[ri]];B[hr[ki+dir]]=rk;B[hr[ri]]=null;rk.moved=1;note=Math.abs(ri-ki)==3?"O-O":"O-O-O";}}
 p.moved=1;B[b]=p;B[a]=null;last=[a,b];
 let promoTag="";
 if(p.t=="p"&&!go(b,p.h)){p.t=promo||"q";promoTag="="+G[p.t];}
 if(!quiet)snd(cap?430:520,.1);
 advance();
 return {text: note||(G[pt]+cells[a].name+(cap?"×":"→")+cells[b].name+promoTag), o: who};
}

function rebuild(n,quiet=true){
 setup();notes=[];
 for(let k=0;k<n;k++){notes.push(apply(mv[k][0],mv[k][1],mv[k][2],quiet && k<n-1));}
 if(n<mv.length){
  const snapB=B.map(x=>x?{...x}:null),snapTurn=turn,snapAlive=[...alive],snapLast=last,snapStatus=status;
  for(let k=n;k<mv.length;k++)notes.push(apply(mv[k][0],mv[k][1],mv[k][2],true));
  B=snapB;turn=snapTurn;alive=snapAlive;last=snapLast;status=snapStatus;
 }
 pos=n;sel=null;hl=[];
}

function pick(i){
 if(pos!==mv.length||isDraw) return;
 if(sel!=null&&hl.includes(i)){
  const p=B[sel];
  let isPromo=false;
  if(p.t=="p"){
   let nh=p.h;const f=go(sel,p.h),f2=f&&go(f[0],(f[1]+2)%4);
   if(f&&f[0]==i)nh=(f[1]+2)%4;
   else if(f2&&f2[0]==i)nh=(f2[1]+2)%4;
   else if(f)for(const tt of[1,3]){const sd=(f[1]+tt)%4,d=go(f[0],sd);if(d&&d[0]==i){nh=fwdAfterTurn(f[0],(f[1]+2)%4,sd,d);break;}}
   if(!go(i,nh)) isPromo=true;
  }
  if(isPromo){
   pendingPromo=[sel,i];
   $("promoOv").style.display="flex";
   return;
  }
  socket.emit("makeMove",[sel,i,null]);
  sel=null;hl=[];arrows=[];marks.clear();
 }
 else if(turn===MY_SEAT && B[i] && B[i].o===MY_SEAT){sel=i;hl=legal(i);snd(700,.05);}
 else{sel=null;hl=[];}
 draw();
}

const shade=(h,p)=>{const n=parseInt(h.slice(1),16),f=c=>Math.max(0,Math.min(255,Math.round(p<0?c*(1+p):c+(255-c)*p)));return"#"+[n>>16,n>>8&255,n&255].map(f).map(v=>v.toString(16).padStart(2,"0")).join("")};
const lum=h=>{const n=parseInt(h.slice(1),16);return((n>>16)*.3+(n>>8&255)*.59+(n&255)*.11)};

function draw(){
 const rot = MY_SEAT > 0 ? MY_SEAT * -120 : 0;
 const T=TH[theme],cl=cols.map(i=>PAL[i][1]),hex=Object.values(H).map(p=>p.join(",")).join(" ");
 let h=`<defs><clipPath id="hx"><polygon points="${hex}"/></clipPath>
<filter id="wd" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.006 0.09" numOctaves="4" seed="7"/><feColorMatrix values="0 0 0 0 .22 0 0 0 0 .11 0 0 0 0 .03 1.7 0 0 0 -.55"/></filter>
<filter id="mb" x="0" y="0" width="100%" height="100%"><feTurbulence type="turbulence" baseFrequency="0.004 0.006" numOctaves="5" seed="4"/><feColorMatrix values="0 0 0 0 .1 0 0 0 0 .12 0 0 0 0 .16 -2.2 0 0 0 .75"/></filter>
${cl.map((c,o)=>`<linearGradient id="pg${o}" x1="0" y1="0" x2=".7" y2="1"><stop offset="0" stop-color="${shade(c,.45)}"/><stop offset=".5" stop-color="${c}"/><stop offset="1" stop-color="${shade(c,-.35)}"/></linearGradient>`).join("")}
<marker id="ah" markerWidth="4" markerHeight="4" refX="2.2" refY="2" orient="auto"><path d="M0,0L4,2L0,4z" fill="#f59e0b"/></marker></defs>
<g transform="rotate(${rot} 985 655)">
<polygon points="${hex}" fill="#4a2f1a" stroke="#4a2f1a" stroke-width="26" stroke-linejoin="round"/>`;
 const poly=i=>cells[i].pts.map(p=>p.join(",")).join(" ");
 cells.forEach(c=>{h+=`<polygon data-i="${c.id}" points="${poly(c.id)}" fill="${T[col[c.id]]}" stroke="#0003" stroke-width="1"/>`;});
 if(T[2]==1){const lp=(p,q,t)=>[p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t],rd=(i,k)=>{const x=Math.sin(i*12.9898+k*78.233)*43758.5453;return x-Math.floor(x)};
  cells.forEach(c=>{const dk=col[c.id],cp=c.pts;
   h+=`<polygon points="${poly(c.id)}" fill="${rd(c.id,1)>.5?"#fff":"#000"}" opacity="${(rd(c.id,2)*.1).toFixed(3)}" pointer-events="none"/>`;
   for(let k=0;k<16;k++){const v=(k+rd(c.id,k+3))/16,a=lp(cp[0],cp[3],v),b=lp(cp[1],cp[2],v),mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2,w=(rd(c.id,k+60)-.5)*9,dx=b[1]-a[1],dy=a[0]-b[0],L=Math.hypot(dx,dy)||1,q=rd(c.id,k+9);
    h+=`<path d="M${a[0]},${a[1]}Q${mx+dx/L*w},${my+dy/L*w} ${b[0]},${b[1]}" fill="none" stroke="${q>.82?(dk?"#d9b27c":"#fff2d6"):(dk?"#1f0e03":"#5b3a1a")}" stroke-opacity="${(.06+rd(c.id,k+30)*(q>.82?.15:.2)).toFixed(2)}" stroke-width="${(.6+rd(c.id,k+40)*(q>.82?1.4:2.4)).toFixed(1)}" pointer-events="none"/>`;}
  });}
 if(T[2]==2)h+=`<g clip-path="url(#hx)" style="mix-blend-mode:multiply;pointer-events:none"><rect x="230" y="0" width="1520" height="1310" filter="url(#mb)" opacity=".6"/></g>`;
 if(lab.checked)cells.forEach(c=>{if(!B[c.id])h+=`<text class="lb" x="${c.ctr[0]}" y="${c.ctr[1]}" transform="rotate(${-rot} ${c.ctr[0]} ${c.ctr[1]})" fill="${col[c.id]?"#ffffffb0":"#000000a0"}">${c.name}</text>`;});
 if(last)last.forEach(i=>h+=`<polygon points="${poly(i)}" fill="#ffe14d77" pointer-events="none"/>`);
 // Lekkie podświetlenie pola króla w szachu
 [0,1,2].forEach(o=>{
  if(alive[o] && inCheck(o)){
   const ki=B.findIndex(p=>p&&p.o==o&&p.t=="k");
   if(ki>=0) h+=`<polygon points="${poly(ki)}" fill="#ff2a2a66" stroke="#ff3b30" stroke-width="4" pointer-events="none"/>`;
  }
 });
 marks.forEach(i=>h+=`<polygon points="${poly(i)}" fill="#e5484d99" pointer-events="none"/>`);
 if(sel!=null)h+=`<polygon points="${poly(sel)}" fill="#4cc9f088" pointer-events="none"/>`;
 cells.forEach(c=>{const p=B[c.id];if(p){const f=cl[p.o];h+=`<text class="p" x="${c.ctr[0]}" y="${c.ctr[1]+4}" transform="rotate(${-rot} ${c.ctr[0]} ${c.ctr[1]})" fill="url(#pg${p.o})" stroke="${lum(f)<90?"#e8e0d0":"#000"}">${G[p.t]}\uFE0E</text>`;}});
 hl.forEach(i=>{const c=cells[i];h+=B[i]?`<circle cx="${c.ctr[0]}" cy="${c.ctr[1]}" r="40" fill="none" stroke="#e5484d" stroke-width="8" pointer-events="none"/>`:`<circle cx="${c.ctr[0]}" cy="${c.ctr[1]}" r="15" fill="#000a" pointer-events="none"/>`;});
 arrows.forEach(([a,z])=>{const pt=arrowPath(a,z).map(i=>cells[i].ctr.slice()),L=pt.length,u=nrm([pt[L-1][0]-pt[L-2][0],pt[L-1][1]-pt[L-2][1]]);pt[L-1][0]-=u[0]*14;pt[L-1][1]-=u[1]*14;
  h+=`<polyline points="${pt.map(p=>p.join(",")).join(" ")}" fill="none" stroke="#f59e0b" stroke-opacity=".85" stroke-width="14" stroke-linejoin="round" marker-end="url(#ah)" pointer-events="none"/>`;});
 h+=`</g>`;
 s.innerHTML=h;

 const finalStatus = isDraw ? "Remis" : status;
 const w=alive.reduce((x,y)=>x+y,0)==1?alive.indexOf(1):-1;
 turn_.textContent=finalStatus?finalStatus:w>=0?`Wygrywa: ${playerName(w)} — wygrales fartem`:`Ruch: ${playerName(turn)}${turn===MY_SEAT?" (TWÓJ)":""}${inCheck(turn)?" – SZACH!":""}`;
 turn_.style.color=cl[w>=0?w:turn];

 // Przycisk remisu
 const drawBtn=$("drawBtn");
 if(MY_SEAT>=0 && !finalStatus && w<0){
  drawBtn.style.display="inline-block";
  if(drawOfferBy===null){
   drawBtn.classList.remove("on");
   drawBtn.textContent="Remis";
  } else if(drawOfferBy===MY_SEAT){
   drawBtn.classList.add("on");
   drawBtn.textContent="Anuluj remis";
  } else {
   drawBtn.classList.add("on");
   drawBtn.textContent=`Akceptuj remis (${playerName(drawOfferBy)})`;
  }
 } else {
  drawBtn.style.display="none";
 }

 // Ekran końca gry przy wygranej lub remisie
 const gameKey = `${mv.length}|${w}|${finalStatus}`;
 if((w>=0 || finalStatus) && pos===mv.length && endShownForKey!==gameKey){
  endShownForKey=gameKey;
  if(w>=0){
   const winName=playerName(w);
   $("endTitle").textContent=`Wygrywa ${winName}!`;
   $("endSub").textContent=`${winName} — wygrales fartem`;
   $("endSub").style.color=cl[w];
  } else {
   $("endTitle").textContent="Partia zakończona remisem";
   $("endSub").textContent=finalStatus;
   $("endSub").style.color="var(--fg)";
  }
  $("endReset").style.display=IS_HOST?"inline-block":"none";
  $("endOv").style.display="flex";
 } else if(w<0 && !finalStatus){
  endShownForKey="";
  $("endOv").style.display="none";
 }

 undo.disabled=pos==0;redo.disabled=pos>=mv.length;
 $("live").style.display=pos<mv.length?"inline-block":"none";
 $("colors").style.display=MY_SEAT>=0?"inline-block":"none";
 $("reset").style.display=IS_HOST?"inline-block":"none";

 $("seats").innerHTML=[0,1,2].map(o=>{
  const occ=SEATS[o];
  return `<div class="seat ${o===MY_SEAT?"me":""}">
   <span><span class="dot" style="display:inline-block;background:${cl[o]};margin-right:6px"></span>${occ?occ.name:"<i>Wolne miejsce</i>"}</span>
   ${!occ?`<button style="min-height:26px;padding:0 8px;font-size:12px" onclick="socket.emit('takeSeat',${o})">Usiądź</button>`:""}
  </div>`;
 }).join("");

 $("list").innerHTML=notes.map((n,idx)=>`<li class="${idx===pos-1?"cur":""}" onclick="jump(${idx+1})"><span class="dot" style="background:${cl[n.o]}"></span><span>${idx+1}. ${n.text}</span></li>`).join("");
 const lst=$("list");if(pos===mv.length)lst.scrollTop=lst.scrollHeight;
}

window.jump=n=>{rebuild(n,true);draw();};

const $=id=>document.getElementById(id),s=$("s"),turn_=$("turn"),lab=$("lab"),undo=$("undo"),redo=$("redo");
const cellAt=(x,y)=>{const t=document.elementFromPoint(x,y);const c=t&&t.closest&&t.closest("[data-i]");return c?+c.dataset.i:null;};
const over=()=>alive.reduce((x,y)=>x+y,0)<2||!!status||isDraw;

s.addEventListener("contextmenu",e=>e.preventDefault());
s.addEventListener("pointerdown",e=>{if(e.button==2||arrMode)rs=cellAt(e.clientX,e.clientY);});
s.addEventListener("pointerup",e=>{if(rs!=null){const z=cellAt(e.clientX,e.clientY);if(z!=null){
 if(z==rs)marks.has(z)?marks.delete(z):marks.add(z);
 else if(arrowPath(rs,z)){const k=arrows.findIndex(a=>a[0]==rs&&a[1]==z);k>=0?arrows.splice(k,1):arrows.push([rs,z]);}draw();}rs=null;e.preventDefault();}});
s.addEventListener("click",e=>{if(arrMode)return;const i=cellAt(e.clientX,e.clientY);if(i!=null&&!over())pick(i);});

undo.onclick=()=>{if(pos>0){rebuild(pos-1,true);snd(400,.06);draw();}};
redo.onclick=()=>{if(pos<mv.length){rebuild(pos+1,true);snd(520,.1);draw();}};
$("live").onclick=()=>{rebuild(mv.length,true);draw();};
const clearDraw=()=>{arrows=[];marks.clear();draw();};
$("clr").onclick=clearDraw;s.addEventListener("dblclick",clearDraw);
$("arr").onclick=e=>{arrMode=!arrMode;e.target.classList.toggle("on",arrMode);e.target.textContent="Strzałki: "+(arrMode?"wł.":"wył.");};
$("theme").onchange=e=>{theme=e.target.value;draw();};lab.onchange=draw;
$("mute").onclick=e=>{mute=!mute;e.target.textContent="Dźwięk: "+(mute?"wył.":"wł.");};
$("drawBtn").onclick=()=>socket.emit("offerDraw");
$("endClose").onclick=()=>{$("endOv").style.display="none";};
$("endReset").onclick=()=>{$("endOv").style.display="none";socket.emit("resetGame");};

$("promoOv").addEventListener("click",e=>{
 const b=e.target.closest(".promo-btn");if(!b||!pendingPromo)return;
 socket.emit("makeMove",[pendingPromo[0],pendingPromo[1],b.dataset.p]);
 pendingPromo=null;sel=null;hl=[];arrows=[];marks.clear();
 $("promoOv").style.display="none";draw();
});

let rt=null;
$("reset").onclick=e=>{
 if(!rt){e.target.textContent="Na pewno? Kliknij ponownie";rt=setTimeout(()=>{rt=null;e.target.textContent="Zacznij od nowa";},3000);return;}
 clearTimeout(rt);rt=null;e.target.textContent="Zacznij od nowa";
 socket.emit("resetGame");
};

// Wybór koloru w lobby (tworzenie stołu / dołączanie)
function renderLobbyPick(){
 $("lobbyPick").innerHTML=PAL.map((c,i)=>`<button type="button" class="sw ${lobbyColor===i?"sel":""}" data-i="${i}" title="${c[0]}" style="background:${c[1]}"></button>`).join("");
}
$("lobbyPick").addEventListener("click",e=>{
 const b=e.target.closest(".sw");
 if(!b)return;
 lobbyColor=+b.dataset.i;
 renderLobbyPick();
});
renderLobbyPick();

// Wybór koloru po wejściu do pokoju
$("colors").onclick=openPick;
function openPick(){
 if(MY_SEAT<0)return;
 const p=$("pick");
 p.innerHTML=`<div class="row"><b>Twój kolor</b>${PAL.map((c,i)=>{
  const taken=cols.includes(i)&&cols[MY_SEAT]!==i;
  return `<button class="sw ${cols[MY_SEAT]==i?"sel":""}" data-i="${i}" ${taken?"disabled":""} title="${c[0]}" style="background:${c[1]}"></button>`;
 }).join("")}</div>`;
 $("ov").style.display="flex";
}
$("pick").addEventListener("click",e=>{
 const b=e.target.closest(".sw");
 if(b&&!b.disabled) socket.emit("changeColor",+b.dataset.i);
});
$("go").onclick=()=>{$("ov").style.display="none";draw();};

$("roomTag").onclick=()=>{
 const url=`${location.origin}${location.pathname}?room=${ROOM_CODE}`;
 navigator.clipboard?.writeText(url);
 const old=$("roomTag").textContent;
 $("roomTag").textContent="Skopiowano link!";
 setTimeout(()=>$("roomTag").textContent=old,1500);
};

const urlRoom=new URLSearchParams(location.search).get("room");
if(urlRoom) $("codeIn").value=urlRoom.toUpperCase();
$("nick").value=localStorage.getItem("sz3_nick")||"";

function enterRoom(code){
 const nick=$("nick").value.trim()||"Gracz";
 localStorage.setItem("sz3_nick",nick);
 socket.emit("setName",nick);
 socket.emit("joinRoom",{roomCode:code,name:nick,preferredColor:lobbyColor},res=>{
  if(res.error){$("lobbyErr").textContent=res.error;return;}
  ROOM_CODE=res.state.code;
  $("lobby").style.display="none";
  history.replaceState(null,"",`?room=${ROOM_CODE}`);
  $("roomTag").textContent=`Pokój: ${ROOM_CODE} 📋`;
  syncState(res.state,true);
  if(MY_SEAT>=0 && res.state.mv.length===0) openPick();
 });
}

$("createBtn").onclick=()=>enterRoom("");
$("joinBtn").onclick=()=>enterRoom($("codeIn").value);

function syncState(st,initial=false){
 SEATS=st.seats;
 IS_HOST=(st.hostId===socket.id);
 MY_SEAT=SEATS.findIndex(s=>s&&s.id===socket.id);
 cols=st.cols;
 drawOfferBy=st.drawOfferBy ?? null;
 isDraw=!!st.isDraw;
 const prevLen=mv.length;
 mv=st.mv;
 if(initial || pos===prevLen || mv.length<pos){
  rebuild(mv.length, initial);
 } else {
  rebuild(pos, true);
 }
 if($("ov").style.display==="flex") openPick();
 draw();
}

socket.on("roomUpdate",st=>syncState(st,false));

rebuild(0,true);draw();
</script></body></html>
```[cite: 8]

Podmień oba pliki na GitHubie — Render automatycznie przebuduje aplikację[cite: 6, 8]. Jeśli coś będzie wymagało drobnego dopieszczenia po testach, daj znać.
