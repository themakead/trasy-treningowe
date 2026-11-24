// Pętle treningowe: trasa o zadanej długości, od płaskiej do pagórkowatej, dla biegu albo roweru.
// Routing w przeglądarce (Dijkstra z wagą zależną od nachylenia), dane z dane/siec.json (format 2).
"use strict";

const $ = (id) => document.getElementById(id);

// ---------- dane grafu ----------
let G = null;            // { srodek, promien, lat, lon (węzły), U, V, DL, UP, DOWN, TYP, FLAGI, GEOM, WYS }
let ADJ = null;          // dla węzła: [krawędź, sąsiad, krawędź, sąsiad, ...]
let ZMIENNOSC = null;    // (podejście+zejście)/długość krawędzi
let KIER = null;         // kierunki na końcach krawędzi
const KARY = { odcinek: 4, skret: 15, ostry: 60 }; // w metrach „udawanej” drogi
const PREMIE = { szlak: 0.85, zielen: 0.85, przemysl: 1.3 }; // mnożniki długości (mniej = chętniej)
let tryb = "bieg";       // "bieg" | "rower"
let KARA = null;         // mnożnik kosztu krawędzi w bieżącym trybie (0 = niedozwolona)
let STOPIEN = null;      // liczba dozwolonych krawędzi węzła w bieżącym trybie
let GLOWNA = null;       // 1 = węzeł w największej spójnej części sieci w bieżącym trybie
let start = null;        // indeks węzła startu
let kandydaci = [], pokazany = -1, ostatnieUstawienia = "";

const NAWIERZCHNIA = ["utwardzona", "szuter", "grunt / piach"];

// ---------- mapa ----------
const mapa = L.map("mapa", { zoomControl: true });
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> | wysokości: GUGiK',
}).addTo(mapa);
const warstwaTrasy = L.layerGroup().addTo(mapa);
// Mapa zmienia rozmiar nie tylko z oknem (np. po wczytaniu pisma pasek u góry zmienia wysokość)
// Gdy strona otwiera się w karcie w tle, mapa ma rozmiar 0 – wtedy dopasuj widok do trasy później.
let zalegleDopasowanie = null;
function dopasuj(granice, padding) {
  if (mapa.getSize().x < 50 || mapa.getSize().y < 50) zalegleDopasowanie = [granice, padding];
  else { zalegleDopasowanie = null; mapa.fitBounds(granice, { padding: [padding, padding] }); }
}
if (window.ResizeObserver) new ResizeObserver(() => {
  mapa.invalidateSize();
  if (zalegleDopasowanie) dopasuj(...zalegleDopasowanie);
}).observe($("mapa"));
const znacznikStartu = L.marker([0, 0], { icon: L.divIcon({ className: "start-ikona", iconSize: [18, 18] }) });
const kursor = L.marker([0, 0], { icon: L.divIcon({ className: "kursor-ikona", iconSize: [12, 12] }), interactive: false });

fetch("dane/siec.json", { cache: "no-cache" }) // zawsze sprawdź, czy dane się nie zmieniły
  .then((r) => r.json())
  .then((d) => {
    wczytaj(d);
    ustawTryb("bieg", false);
    mapa.setView(G.srodek, 13);
    L.circle(G.srodek, { radius: G.promien, color: "#8A8170", weight: 1, fill: false, dashArray: "4 6", interactive: false }).addTo(mapa);
    const hashNaStart = location.hash;
    ustawStart(najblizszy(G.srodek[0], G.srodek[1]));
    $("stan").textContent = "";
    otworzLink(hashNaStart);
  })
  .catch((e) => {
    console.error(e);
    $("stan").textContent = location.protocol === "file:"
      ? "Strona otwarta jako plik – dane się nie wczytają. Uruchom ją przez serwer (komenda w CLAUDE.md) i wejdź na http://localhost:8765."
      : "Nie udało się wczytać danych.";
  });

// ---------- link do trasy ----------
// #t=bieg&km=10&h=0.5&c=80&b=-3&p=lat,lon;lat,lon;...  (start, punkty zwrotne)
function zapiszLink(p) {
  if (!p.pkty) return;
  if (p.rodzaj === "ab") return zapiszLinkAB(p);
  const pk = p.pkty.slice(0, -1).map((i) => `${G.lat[i].toFixed(5)},${G.lon[i].toFixed(5)}`).join(";");
  const par = new URLSearchParams({ t: p.tryb, km: $("dlugosc").value, h: $("teren").value, b: p.beta, p: pk });
  if (celM() !== null) par.set("c", celM());
  if ($("spokojnie").checked) par.set("s", 1);
  if ($("prosto").checked) par.set("pr", 1);
  history.replaceState(null, "", "#" + par.toString());
}

function otworzLink(hash = location.hash) {
  if (hash.length < 3) return;
  const par = new URLSearchParams(hash.slice(1));
  if (par.get("r") === "ab") return otworzLinkAB(par);
  const pk =(par.get("p") || "").split(";").map((s) => s.split(",").map(Number)).filter((x) => x.length === 2 && x.every(isFinite));
  if (pk.length < 3) return;
  if (rodzaj !== "petla") ustawRodzaj("petla");
  $("spokojnie").checked = par.get("s") === "1";
  $("prosto").checked = par.get("pr") === "1";
  ustawTryb(par.get("t") === "rower" ? "rower" : "bieg");
  if (par.get("km")) $("dlugosc").value = par.get("km");
  if (par.get("h")) $("teren").value = par.get("h");
  $("cel").value = par.get("c") || "";
  odswiezOpisy(); odswiezCel();
  const pkty = pk.map(([la, lo], i) => najblizszy(la, lo, i > 0));
  ustawStart(pkty[0]);
  pkty.push(pkty[0]);
  const p = trasaPrzez(pkty, +par.get("b") || 0, +$("dlugosc").value * 1000);
  if (!p) { $("stan").textContent = "Nie udało się odtworzyć trasy z linku."; return; }
  kandydaci = [p]; pokazany = 0; ostatnieUstawienia = ustawienia();
  rysuj(p);
  $("zakres").textContent = "Trasa z udostępnionego linku.";
}

window.addEventListener("hashchange", () => { if (G) otworzLink(); });

$("link").onclick = async () => {
  if (!biezaca) return;
  // link bez parametrów z aplikacji (osadzenie, trening dnia) – sama trasa
  const url = location.origin + location.pathname + location.hash;
  const tekst = nazwaTrasy(biezaca);
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) { await navigator.share({ title: tekst, url }); return; }
    await navigator.clipboard.writeText(url);
    $("stan").textContent = "Skopiowano link do trasy – wklej go, komu chcesz.";
  } catch (e) {
    if (e && e.name === "AbortError") return;
    prompt("Skopiuj link do trasy:", url);
  }
};

function wczytaj(d) {
  const n = d.wezly.length / 2, lat = new Float64Array(n), lon = new Float64Array(n);
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) { a += d.wezly[2 * i]; b += d.wezly[2 * i + 1]; lat[i] = a / 1e5; lon[i] = b / 1e5; }
  const m = d.u.length;
  G = {
    srodek: d.srodek, promien: d.promien, typy: d.typy, lat, lon,
    U: Int32Array.from(d.u), V: Int32Array.from(d.v),
    DL: Float32Array.from(d.dl, (x) => x / 10), UP: Float32Array.from(d.up, (x) => x / 10), DOWN: Float32Array.from(d.down, (x) => x / 10),
    TYP: Uint8Array.from(d.typ), FLAGI: Uint8Array.from(d.flagi), GEOM: d.geom, WYS: d.wys,
  };
  const lista = Array.from({ length: n }, () => []);
  ZMIENNOSC = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    lista[G.U[i]].push(i, G.V[i]);
    lista[G.V[i]].push(i, G.U[i]);
    ZMIENNOSC[i] = G.DL[i] > 0 ? (G.UP[i] + G.DOWN[i]) / G.DL[i] : 0;
  }
  ADJ = lista;
  // Kierunek wyjścia z każdego końca krawędzi (wektor jednostkowy, w metrach): [U→, V→]
  KIER = new Float32Array(4 * m);
  for (let i = 0; i < m; i++) {
    const g = geometria(i), k = Math.cos((g[0][0] * Math.PI) / 180);
    const wek = (a, b) => { const x = (b[1] - a[1]) * k, y = b[0] - a[0], d = Math.hypot(x, y) || 1; return [x / d, y / d]; };
    const [ux, uy] = wek(g[0], g[1]), [vx, vy] = wek(g[g.length - 1], g[g.length - 2]);
    KIER[4 * i] = ux; KIER[4 * i + 1] = uy; KIER[4 * i + 2] = vx; KIER[4 * i + 3] = vy;
  }
}

// Geometria krawędzi jako [[lat, lon], ...] od U do V
function geometria(e) {
  const g = G.GEOM[e], u = G.U[e], v = G.V[e], out = [[G.lat[u], G.lon[u]]];
  let a = Math.round(G.lat[u] * 1e5), b = Math.round(G.lon[u] * 1e5);
  for (let i = 0; i < g.length; i += 2) { a += g[i]; b += g[i + 1]; out.push([a / 1e5, b / 1e5]); }
  out.push([G.lat[v], G.lon[v]]);
  return out;
}
// Wysokości krawędzi (m) od U do V, równo rozłożone na długości
function wysokosci(e) {
  const w = G.WYS[e], out = new Array(w.length);
  let s = 0;
  for (let i = 0; i < w.length; i++) { s += w[i]; out[i] = s / 10; }
  return out;
}

// ---------- tryb bieg / rower ----------
function ustawTryb(t, przelicz = true) {
  tryb = t;
  $("trybBieg").classList.toggle("wybrany", t === "bieg");
  $("trybRower").classList.toggle("wybrany", t === "rower");
  $("trybBieg").setAttribute("aria-checked", t === "bieg");
  $("trybRower").setAttribute("aria-checked", t === "rower");
  const bit = t === "bieg" ? 1 : 2, m = G.U.length, n = G.lat.length;
  KARA = new Float32Array(m);
  STOPIEN = new Uint8Array(n);
  for (let e = 0; e < m; e++) {
    if (!(G.FLAGI[e] & bit)) continue;
    const typ = G.typy[G.TYP[e]], naw = (G.FLAGI[e] >> 2) & 3;
    let k = 1;
    if (t === "bieg") k = typ === "primary" ? 2.5 : typ === "secondary" ? 1.5 : 1;
    else k = (typ === "primary" ? 2 : typ === "secondary" ? 1.3 : 1) * [1, 1.4, 2.2][naw];
    if ($("spokojnie").checked) {
      // „Omijaj ruchliwe ulice”: główne drogi dużo drożej, ścieżki i drogi leśne taniej
      k *= { primary: 4, secondary: 3, tertiary: 1.8, unclassified: 1.2, service: 1.2 }[typ] || 1;
      if (["path", "track", "cycleway", "footway", "bridleway", "pedestrian"].includes(typ)) k *= 0.8;
    }
    // „Popularność” z darmowych danych (zamiast mapy cieplnej Stravy): szlaki, lasy, parki – taniej;
    // tereny przemysłowe – drożej
    const f = G.FLAGI[e];
    const szlak = t === "rower" ? f & 16 : f & 48;
    if (szlak) k *= PREMIE.szlak;
    if (f & 64) k *= PREMIE.zielen;
    if (f & 128) k *= PREMIE.przemysl;
    KARA[e] = k;
    STOPIEN[G.U[e]]++; STOPIEN[G.V[e]]++;
  }
  // największa spójna część sieci w tym trybie
  GLOWNA = new Uint8Array(n);
  const komp = new Int32Array(n).fill(-1); let najw = -1, najwRozm = 0, nr = 0;
  for (let s = 0; s < n; s++) {
    if (komp[s] >= 0 || !STOPIEN[s]) continue;
    const stos = [s]; komp[s] = nr; let rozm = 0;
    while (stos.length) {
      const x = stos.pop(); rozm++;
      const a = ADJ[x];
      for (let j = 0; j < a.length; j += 2) if (KARA[a[j]] && komp[a[j + 1]] < 0) { komp[a[j + 1]] = nr; stos.push(a[j + 1]); }
    }
    if (rozm > najwRozm) { najwRozm = rozm; najw = nr; }
    nr++;
  }
  for (let i = 0; i < n; i++) GLOWNA[i] = komp[i] === najw ? 1 : 0;

  if (przelicz) {
    $("dlugosc").value = t === "bieg" ? 10 : 25;
    odswiezOpisy();
    kandydaci = []; ostatnieUstawienia = ""; $("inna").disabled = true;
    warstwaTrasy.clearLayers(); $("wynik").hidden = true;
    if (start !== null) ustawStart(najblizszy(G.lat[start], G.lon[start]));
  }
}
$("trybBieg").onclick = () => G && tryb !== "bieg" && ustawTryb("bieg");
$("trybRower").onclick = () => G && tryb !== "rower" && ustawTryb("rower");

function najblizszy(lat, lon, skrzyzowanie = false) {
  const k = Math.cos((lat * Math.PI) / 180), min = skrzyzowanie ? 3 : 1;
  let best = 0, bd = Infinity;
  for (let i = 0; i < G.lat.length; i++) {
    if (!GLOWNA[i] || STOPIEN[i] < min) continue;
    const dy = G.lat[i] - lat, dx = (G.lon[i] - lon) * k, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function ustawStart(i) {
  start = i;
  znacznikStartu.setLatLng([G.lat[i], G.lon[i]]).addTo(mapa);
  $("podpowiedz").textContent = "Start ustawiony. Kliknij na mapie, żeby go zmienić.";
  kandydaci = []; ostatnieUstawienia = "";
  $("inna").disabled = true;
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

mapa.on("click", (ev) => {
  if (!G) return;
  if (typeof rodzaj !== "undefined" && rodzaj === "ab") klikAB(ev.latlng);   // A→B: osobna obsługa (ab.js)
  else ustawStart(najblizszy(ev.latlng.lat, ev.latlng.lng));
});

$("gps").onclick = () => {
  if (!navigator.geolocation || !G) return;
  $("stan").textContent = "Szukam Twojej lokalizacji…";
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const i = najblizszy(p.coords.latitude, p.coords.longitude);
      if (odl(G.lat[i], G.lon[i], p.coords.latitude, p.coords.longitude) > 1500) {
        $("stan").textContent = "Jesteś poza obszarem mapy (okolice Baranowa).";
        return;
      }
      ustawStart(i); mapa.setView([G.lat[i], G.lon[i]], 14); $("stan").textContent = "";
    },
    () => ($("stan").textContent = "Brak dostępu do lokalizacji.")
  );
};

// ---------- suwaki ----------
const opisTerenu = (h) => (h < 0.2 ? "jak najpłaściej" : h < 0.4 ? "raczej płasko" : h < 0.6 ? "mieszany" : h < 0.8 ? "raczej pagórkowato" : "jak najwięcej podjazdów");
function odswiezOpisy() {
  $("dlugoscTxt").textContent = `${(+$("dlugosc").value).toLocaleString("pl-PL")} km`;
  $("terenTxt").textContent = opisTerenu(+$("teren").value);
}
$("dlugosc").oninput = $("teren").oninput = odswiezOpisy;
odswiezOpisy();
const ustawienia = () => `${tryb}|${start}|${$("dlugosc").value}|${$("spokojnie").checked}`;
$("spokojnie").onchange = () => {
  if (!G) return;
  ustawTryb(tryb, false);                 // przelicz koszty dróg
  kandydaci = []; ostatnieUstawienia = ""; $("inna").disabled = true;
  $("stan").textContent = "Zmieniono preferencje – wyznacz trasę jeszcze raz.";
};

// ---------- routing ----------
function odl(la1, lo1, la2, lo2) {
  const k = Math.cos(((la1 + la2) / 2) * Math.PI / 180);
  return Math.hypot((la1 - la2) * 111320, (lo1 - lo2) * 111320 * k);
}

class Kopiec {
  constructor() { this.k = []; this.v = []; }
  push(klucz, w) {
    const k = this.k, v = this.v; let i = k.length; k.push(klucz); v.push(w);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= klucz) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = klucz; v[i] = w;
  }
  pop() {
    const k = this.k, v = this.v, top = v[0], last = k.length - 1, lk = k[last], lv = v[last];
    k.pop(); v.pop();
    if (last > 0) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= last) break; if (c + 1 < last && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
  get size() { return this.k.length; }
}

// Najtańsza droga z a do b. beta > 0 omija górki, beta < 0 ich szuka. uzyte: kara za powtórki.
function droga(a, b, beta, uzyte, wejscie = -1) {
  const n = ADJ.length;
  const dist = new Float64Array(n).fill(Infinity), skad = new Int32Array(n).fill(-1);
  const cla = G.lat[b], clo = G.lon[b];
  // dolne oszacowanie kosztu do celu: przy beta ≥ 0 każdy metr kosztuje ≥ 1, przy beta < 0 ≥ 0,25
  const hk = (beta >= 0 ? 1 : 0.25) * PREMIE.szlak * PREMIE.zielen * 0.8; // 0,8 = premia „omijaj ruchliwe”
  const h = (i) => odl(G.lat[i], G.lon[i], cla, clo) * hk;
  dist[a] = 0; skad[a] = wejscie; // kierunek dojścia do punktu zwrotnego – bez zawracania na nim
  const q = new Kopiec(); q.push(h(a), a);
  while (q.size) {
    const u = q.pop();
    if (u === b) break;
    const du = dist[u], s = ADJ[u];
    // kierunek, w którym przyszliśmy do u (do kary za ostre zakręty)
    const ei = skad[u];
    let px = 0, py = 0;
    if (ei >= 0) { const o = G.V[ei] === u ? 2 : 0; px = -KIER[4 * ei + o]; py = -KIER[4 * ei + o + 1]; }
    for (let j = 0; j < s.length; j += 2) {
      const e = s[j], kara = KARA[e];
      if (!kara) continue;
      const v = s[j + 1];
      let m = Math.exp(beta * ZMIENNOSC[e] * 10);
      if (m < 0.25) m = 0.25;
      m *= kara;
      if (uzyte.has(e)) m *= 6;
      let nd = du + G.DL[e] * m + KARY.odcinek;  // +4 m za każdy odcinek: mniej drobnych przeskoków
      if (ei >= 0) {
        const o = G.U[e] === u ? 0 : 2, c = px * KIER[4 * e + o] + py * KIER[4 * e + o + 1];
        if (c < -0.3) nd += KARY.ostry;       // zawracanie / bardzo ostry zakręt
        else if (c < 0.7) nd += KARY.skret;   // zwykły skręt
      }
      if (nd < dist[v]) { dist[v] = nd; skad[v] = e; q.push(nd + h(v), v); }
    }
  }
  if (!isFinite(dist[b])) return null;
  const kraw = []; let v = b;
  while (v !== a) { const e = skad[v]; const fwd = G.V[e] === v; kraw.push([e, fwd]); v = fwd ? G.U[e] : G.V[e]; }
  return kraw.reverse();
}

// Najkrótsze połączenie a→b, ale tylko jeśli ma najwyżej `maks` metrów (mała, szybka wersja Dijkstry)
function krotkaDroga(a, b, maks) {
  const dist = new Map([[a, 0]]), skad = new Map(), q = new Kopiec();
  q.push(0, a);
  while (q.size) {
    const u = q.pop(), du = dist.get(u);
    if (u === b) break;
    const s = ADJ[u];
    for (let j = 0; j < s.length; j += 2) {
      const e = s[j]; if (!KARA[e]) continue;
      const v = s[j + 1], nd = du + G.DL[e];
      if (nd > maks) continue;
      if (nd < (dist.has(v) ? dist.get(v) : Infinity)) { dist.set(v, nd); skad.set(v, e); q.push(nd, v); }
    }
  }
  if (!dist.has(b)) return null;
  const kraw = []; let v = b;
  while (v !== a) { const e = skad.get(v); const fwd = G.V[e] === v; kraw.push([e, fwd]); v = fwd ? G.U[e] : G.V[e]; }
  return kraw.reverse();
}

function punktWKierunku(lat, lon, d, kat) {
  const k = Math.cos(lat * Math.PI / 180);
  return [lat + (d * Math.cos(kat)) / 111320, lon + (d * Math.sin(kat)) / (111320 * k)];
}

function zbudujPetle(L, beta, kat, skala) {
  // Punkty zwrotne na okręgu przechodzącym przez start (obwód ≈ L·skala)
  const sla = G.lat[start], slo = G.lon[start];
  const r = (L * skala) / (2 * Math.PI);
  const [sLat, sLon] = punktWKierunku(sla, slo, r, kat);   // środek okręgu
  const ile = L > 20000 ? 4 : 3, pkty = [start];
  for (let i = 1; i <= ile; i++) {
    const fi = kat + Math.PI + (i * 2 * Math.PI) / (ile + 1);
    let p = punktWKierunku(sLat, sLon, r, fi);
    // poza obszarem mapy → przyciągnij do brzegu
    const dc = odl(p[0], p[1], G.srodek[0], G.srodek[1]), maks = G.promien * 0.92;
    if (dc > maks) { const t = maks / dc; p = [G.srodek[0] + (p[0] - G.srodek[0]) * t, G.srodek[1] + (p[1] - G.srodek[1]) * t]; }
    const w = najblizszy(p[0], p[1], true);
    if (pkty.includes(w)) return null;
    pkty.push(w);
  }
  pkty.push(start);
  return trasaPrzez(pkty, beta, L);
}

// Trasa przez kolejne węzły (start, punkty zwrotne, start) – używana też przy otwieraniu linku
function trasaPrzez(pkty, beta, L) {
  const uzyte = new Set(), trasa = [];
  for (let i = 0; i < pkty.length - 1; i++) {
    const a = pkty[i], b = pkty[i + 1];
    const r = droga(a, b, beta, uzyte, trasa.length ? trasa[trasa.length - 1][0] : -1);
    if (!r) return null;
    r.forEach(([e]) => uzyte.add(e));
    trasa.push(...r);
  }
  // Usuń „ogonki”: wejście w ślepą uliczkę i powrót tą samą drogą
  const stos = [];
  for (const k of trasa) {
    const top = stos[stos.length - 1];
    if (top && top[0] === k[0] && top[1] !== k[1]) stos.pop(); else stos.push(k);
  }
  // Usuń „pętelki” i „wąskie odnogi”: fragment, po którym wracamy do tego samego skrzyżowania,
  // jeśli jest krótki albo wąski (np. tam i z powrotem dwiema równoległymi ścieżkami)
  const limit = Math.min(600, 0.08 * L);
  const k0 = Math.cos((G.lat[pkty[0]] * Math.PI) / 180) * 111320;
  const waski = (od, doI) => {
    // średnia szerokość wielokąta = 2 · pole / obwód (w metrach)
    // współrzędne względem pierwszego węzła (dokładność), wielokąt domknięty odcinkiem koniec→początek
    const [e0, f0] = t[od], w0 = f0 ? G.U[e0] : G.V[e0];
    const X = (w) => (G.lon[w] - G.lon[w0]) * k0, Y = (w) => (G.lat[w] - G.lat[w0]) * 111320;
    let pole = 0, dl = 0, ost = w0;
    for (let i = od; i < doI; i++) {
      const [e, f] = t[i], a = f ? G.U[e] : G.V[e], b = f ? G.V[e] : G.U[e];
      pole += X(a) * Y(b) - X(b) * Y(a);
      dl += G.DL[e]; ost = b;
    }
    pole += X(ost) * Y(w0) - X(w0) * Y(ost);
    return { szer: Math.abs(pole) / dl, dl };
  };
  let t = stos, zmiana = true, proby = 0;
  while (zmiana && proby++ < 20) {
    zmiana = false;
    const byl = new Map(), lista = []; let d = 0;
    for (let i = 0; i < t.length && !zmiana; i++) {
      const [e, fwd] = t[i], wezel = fwd ? G.U[e] : G.V[e];
      const k = byl.get(wezel);
      if (k) {
        const w = d - k.d < limit ? null : waski(k.i, i);
        if (!w || (w.szer < 80 && w.dl < 0.35 * L)) { t = t.slice(0, k.i).concat(t.slice(i)); zmiana = true; break; }
      }
      // powrót w pobliże (≤ 80 m) miejsca sprzed ≥ 600 m wąskim „języczkiem” → skrót
      const la = G.lat[wezel], lo = G.lon[wezel];
      for (const q of lista) {
        if (d - q.d < 600 || d - q.d > 0.35 * L) continue;
        if (Math.abs(G.lat[q.w] - la) > 0.0008 || Math.abs(G.lon[q.w] - lo) > 0.0012) continue; // szybkie odsianie
        if (odl(G.lat[q.w], G.lon[q.w], la, lo) > 80) continue;
        const w = waski(q.i, i);
        if (w.szer >= 80) continue;
        const skrot = krotkaDroga(q.w, wezel, 200);
        if (!skrot) continue;
        t = t.slice(0, q.i).concat(skrot, t.slice(i));
        zmiana = true; break;
      }
      if (zmiana) break;
      byl.set(wezel, { i, d });
      lista.push({ w: wezel, i, d });
      d += G.DL[e];
    }
    if (zmiana) {
      // po skrócie mogą się pojawić nowe „ogonki” tam i z powrotem
      const s2 = [];
      for (const k of t) { const top = s2[s2.length - 1]; if (top && top[0] === k[0] && top[1] !== k[1]) s2.pop(); else s2.push(k); }
      t = s2;
    }
  }
  // po sprzątaniu mogło nic nie zostać (np. krótka trasa tam i z powrotem) – taka się nie nadaje
  let dlug = 0; for (const [e] of t) dlug += G.DL[e];
  if (t.length < 3 || dlug < 0.5 * L) return null;
  const p = podsumuj(t);
  p.pkty = pkty; p.beta = beta; p.rodzaj = "petla";
  return p;
}

function podsumuj(trasa) {
  let dl = 0, up = 0, powt = 0; const byly = new Set();
  const pkt = [];   // profil: [wysokość, odległość od startu]
  const linia = []; // mapa:   [lat, lon, odległość od startu]
  const naw = [0, 0, 0];
  let zielono = 0, szlakiem = 0;
  let zawrotki = 0, skrety = 0, poprz = null;
  for (const [e, fwd] of trasa) {
    const L = G.DL[e];
    if (poprz) {
      const [pe, pf] = poprz, o = pf ? 2 : 0, o2 = fwd ? 0 : 2;
      const c = -(KIER[4 * pe + o] * KIER[4 * e + o2] + KIER[4 * pe + o + 1] * KIER[4 * e + o2 + 1]);
      if (c < -0.3) zawrotki++;
      if (c < 0.7) skrety++;   // zakręt ostrzejszy niż ~45° (do „płasko i prosto”)
    }
    poprz = [e, fwd];
    if (byly.has(e)) powt += L; byly.add(e);
    naw[(G.FLAGI[e] >> 2) & 3] += L;
    if (G.FLAGI[e] & 64) zielono += L;
    if (G.FLAGI[e] & (tryb === "rower" ? 16 : 48)) szlakiem += L;
    let w = wysokosci(e); if (!fwd) w = w.reverse();
    const kd = L / Math.max(1, w.length - 1);
    w.forEach((h, j) => { if (j > 0 || pkt.length === 0) pkt.push([h, dl + j * kd]); });
    let g = geometria(e); if (!fwd) g = g.reverse();
    const cz = [0]; for (let j = 1; j < g.length; j++) cz.push(cz[j - 1] + odl(g[j - 1][0], g[j - 1][1], g[j][0], g[j][1]));
    const skala = L / Math.max(1, cz[cz.length - 1]);
    g.forEach((p, j) => { if (j > 0 || linia.length === 0) linia.push([p[0], p[1], dl + cz[j] * skala]); });
    dl += L;
  }
  // Podejście z histerezą 1,5 m (pomija drobne wahania – podobnie liczą zegarki)
  let ref = pkt[0][0];
  for (const [h] of pkt) {
    if (h - ref >= 1.5) { up += h - ref; ref = h; }
    else if (ref - h >= 1.5) ref = h;
  }
  let max = -Infinity, min = Infinity;
  for (const [h] of pkt) { if (h > max) max = h; if (h < min) min = h; }
  return { trasa, dl, up, powt, pkt, linia, naw, max, min, tryb, zawrotki, skrety, zielono, szlakiem };
}

function policzKandydatow() {
  const L = +$("dlugosc").value * 1000, wynik = [];
  const N = 28;
  for (let i = 0; i < N; i++) {
    const kat = (i / N) * 2 * Math.PI * 3 + Math.random() * 0.4;
    const beta = [3, 1, 0, -1.5, -3][i % 5];
    let skala = 0.78, p = null;
    for (let proba = 0; proba < 3; proba++) {
      p = zbudujPetle(L, beta, kat, skala);
      if (!p) break;
      const blad = p.dl / L;
      if (Math.abs(blad - 1) <= 0.08) break;
      skala /= blad;
    }
    if (!p || Math.abs(p.dl / L - 1) > 0.12 || p.powt / p.dl >= 0.1) continue;
    // bez duplikatów: odrzuć trasę, która w ≥ 70% pokrywa się z już znalezioną
    const kr = new Set(p.trasa.map(([e]) => e));
    const duplikat = wynik.some((q) => {
      let wsp = 0; for (const e of q.kr) if (kr.has(e)) wsp += G.DL[e];
      return wsp / Math.min(p.dl, q.dl) >= 0.7;
    });
    if (duplikat) continue;
    p.kr = kr;
    wynik.push(p);
  }
  return wynik;
}

const celM = () => { const v = $("cel").value.trim(); return v === "" || isNaN(+v) ? null : Math.max(0, +v); };

let pokazane = new Set();   // trasy już pokazane w tej serii – „Inna propozycja” ich nie powtarza

function wybierz(nastepny = false) {
  if (!kandydaci.length) return;
  const cel = celM();
  // kolejność od najlepiej pasującej: do zadanych metrów albo do pozycji suwaka terenu
  let pos;
  if ($("prosto").checked) {
    // „Płasko i prosto”: mało podejścia (m/km) i mało zakrętów (na km) – oba liczą się tak samo
    const ocena = (p) => (p.up / p.dl) * 1000 + (p.skrety / p.dl) * 1000;
    pos = kandydaci.slice().sort((a, b) => ocena(a) - ocena(b));
  } else if (cel !== null) {
    pos = kandydaci.slice().sort((a, b) => Math.abs(a.up - cel) - Math.abs(b.up - cel));
  } else {
    const h = +$("teren").value;
    const wg = kandydaci.slice().sort((a, b) => a.up / a.dl - b.up / b.dl);
    const cel_i = h * (wg.length - 1);
    pos = wg.map((p, i) => [p, Math.abs(i - cel_i)]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  }
  if (!nastepny) pokazane = new Set();
  let wybrana = pos.find((p) => !pokazane.has(p));
  if (!wybrana) { pokazane = new Set(); wybrana = pos[0]; $("stan").textContent = "To już wszystkie propozycje – zaczynam od początku."; }
  else if (nastepny) $("stan").textContent = `Propozycja ${pokazane.size + 1} z ${kandydaci.length}.`;
  pokazane.add(wybrana);
  pokazany = kandydaci.indexOf(wybrana);
  rysuj(wybrana);
  opiszZakres(wybrana);
}

// Ile podejścia da się zrobić stąd na tej długości – żeby było jasne, czego oczekiwać
function opiszZakres(p) {
  if (!kandydaci.length) { $("zakres").textContent = ""; return; }
  const ups = kandydaci.map((k) => Math.round(k.up)), lo = Math.min(...ups), hi = Math.max(...ups);
  let t = `Stąd na ${$("dlugosc").value.replace(".", ",")} km: od ${lo} do ${hi} m podejścia.`;
  const cel = celM();
  if (cel !== null) {
    if (cel > hi * 1.1) t += ` Więcej niż ${hi} m stąd się nie da – pokazuję najbliższą.`;
    else if (cel < lo * 0.9) t += ` Mniej niż ${lo} m stąd się nie da – pokazuję najbliższą.`;
  }
  $("zakres").textContent = t;
}

function odswiezCel() {
  const jest = celM() !== null;
  $("terenPole").classList.toggle("wyciszone", jest);
  $("celWyczysc").hidden = !jest;
}
$("cel").oninput = odswiezCel;
$("cel").onchange = () => { if (kandydaci.length && ostatnieUstawienia === ustawienia()) wybierz(); };
$("cel").onkeydown = (e) => { if (e.key === "Enter") $("wyznacz").click(); };
$("celWyczysc").onclick = () => { $("cel").value = ""; odswiezCel(); $("cel").onchange(); };
$("teren").addEventListener("input", () => { if (celM() !== null) { $("cel").value = ""; odswiezCel(); } });

$("wyznacz").onclick = () => {
  if (!G || start === null) return;
  $("stan").textContent = "Szukam tras…";
  $("wyznacz").disabled = true;
  setTimeout(() => {
    try {
      const t0 = performance.now();
      kandydaci = policzKandydatow();
      ostatnieUstawienia = ustawienia();
      if (!kandydaci.length) {
        $("stan").textContent = "Nie znalazłem pętli tej długości stąd. Zmień start albo długość.";
        return;
      }
      $("stan").textContent = `${kandydaci.length} różnych pętli (${((performance.now() - t0) / 1000).toFixed(1).replace(".", ",")} s).`;
      $("inna").disabled = kandydaci.length < 2;
      wybierz();
    } catch (e) {
      console.error(e);
      $("stan").textContent = "Coś poszło nie tak przy liczeniu. Spróbuj jeszcze raz albo zmień start.";
    } finally {
      $("wyznacz").disabled = false;   // przycisk zawsze wraca do działania
    }
  }, 20);
};
$("inna").onclick = () => wybierz(true);
$("teren").onchange = () => { if (kandydaci.length && ostatnieUstawienia === ustawienia()) wybierz(); };

// ---------- rysowanie ----------
let biezaca = null;
const km = (m) => (m / 1000).toLocaleString("pl-PL", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

function rysuj(p) {
  biezaca = p;
  warstwaTrasy.clearLayers();
  const linia = p.linia.map((x) => [x[0], x[1]]);
  const kolor = getComputedStyle(document.documentElement).getPropertyValue("--trasa").trim();
  L.polyline(linia, { color: "#F2B300", weight: 9, opacity: 0.9 }).addTo(warstwaTrasy);
  L.polyline(linia, { color: kolor, weight: 3.5 }).addTo(warstwaTrasy);
  dopasuj(L.latLngBounds(linia), 24);
  znacznikStartu.addTo(mapa);
  zapiszLink(p);

  const proc = p.naw.map((x) => Math.round((100 * x) / p.dl));
  const zp = Math.round((100 * p.zielono) / p.dl), sp = Math.round((100 * p.szlakiem) / p.dl);
  pokazWynik(p, `Nawierzchnia: ${proc.map((x, i) => (x ? `${NAWIERZCHNIA[i]} ${x}%` : "")).filter(Boolean).join(", ")}.` +
    ` Las / park: ${zp}%` + (sp ? `, oznakowanym szlakiem: ${sp}%` : "") + ".");
}

// Liczby, profil i najbardziej strome miejsce – wspólne dla pętli i podbiegów
function pokazWynik(p, opis, dystansOpis = "Dystans") {
  biezaca = p;
  $("wynik").hidden = false;
  $("wDystOpis").textContent = dystansOpis;
  $("wDyst").textContent = p.dl < 1000 ? `${Math.round(p.dl)} m` : `${km(p.dl)} km`;
  $("wUp").textContent = `${Math.round(p.up)} m`;
  $("wMax").textContent = `${Math.round(p.max)} m`;
  $("wNaw").textContent = opis;
  $("link").hidden = !p.pkty;
  rysujProfil(p);
  const s = najstromiej(p);
  if (s && s.g >= 0.02) {
    $("wStromo").textContent = `Najbardziej stromo: ${proc1(s.g)} na ${Math.round(s.dl)} m (${km(s.d)} km od startu) – zaznaczone na mapie.`;
    L.marker(punktNaTrasie(p, s.d + s.dl / 2), {
      icon: L.divIcon({ className: "stromo-ikona", html: `${proc1(s.g)} ↑`, iconSize: null }), interactive: false,
    }).addTo(warstwaTrasy);
  } else $("wStromo").textContent = "Bez stromych podjazdów (nigdzie powyżej 2% na 100 m).";
}
const proc1 = (g) => `${(g * 100).toFixed(1).replace(".", ",").replace(",0", "")}%`;

// Najbardziej strome 100 m pod górę (dla krótkich tras – krótszy odcinek)
function najstromiej(p) {
  const okno = Math.min(100, p.dl / 3), k = p.pkt;
  let best = null;
  for (let i = 0; i < k.length; i++) {
    const d = k[i][1];
    if (d + okno > p.dl) break;
    const g = (wysokoscNa(p, d + okno) - k[i][0]) / okno;
    if (!best || g > best.g) best = { g, d, dl: okno };
  }
  return best;
}

function szukajIndeksu(tab, d, kol) { // pierwszy indeks z tab[i][kol] >= d (wyszukiwanie binarne)
  let lo = 1, hi = tab.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (tab[m][kol] < d) lo = m + 1; else hi = m; }
  return lo;
}
function punktNaTrasie(p, d) {
  const l = p.linia, j = szukajIndeksu(l, d, 2);
  const a = l[j - 1], b = l[j], t = b[2] > a[2] ? Math.min(1, Math.max(0, (d - a[2]) / (b[2] - a[2]))) : 0;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
function wysokoscNa(p, d) {
  const k = p.pkt, j = szukajIndeksu(k, d, 1);
  const a = k[j - 1], b = k[j], t = b[1] > a[1] ? (d - a[1]) / (b[1] - a[1]) : 0;
  return a[0] + (b[0] - a[0]) * Math.min(1, Math.max(0, t));
}
// Nachylenie w punkcie d (uśrednione na ±25 m)
function nachylenieNa(p, d) {
  const a = Math.max(0, d - 25), b = Math.min(p.dl, d + 25);
  return b > a ? (wysokoscNa(p, b) - wysokoscNa(p, a)) / (b - a) : 0;
}

function rysujProfil(p) {
  const svg = $("profil"), Wd = 600, Hd = 160;
  const lo = Math.floor(p.min - 3), hi = Math.ceil(Math.max(p.max + 3, lo + 25));
  const X = (d) => (d / p.dl) * Wd, Y = (h) => Hd - ((h - lo) / (hi - lo)) * Hd;
  const pts = p.pkt.map((x) => `${X(x[1]).toFixed(1)},${Y(x[0]).toFixed(1)}`).join(" ");
  // Pola pod wykresem w kolorze nachylenia (tylko pod górę): 3–6%, 6–9%, 9%+
  const klasa = (g) => (g >= 0.09 ? 3 : g >= 0.06 ? 2 : g >= 0.03 ? 1 : 0);
  const k = p.pkt;
  let kolory = "", i = 0;
  while (i < k.length - 1) {
    const c = klasa(nachylenieNa(p, (k[i][1] + k[i + 1][1]) / 2));
    let j = i + 1;
    while (j < k.length - 1 && klasa(nachylenieNa(p, (k[j][1] + k[j + 1][1]) / 2)) === c) j++;
    if (c) {
      const seg = k.slice(i, j + 1).map((x) => `${X(x[1]).toFixed(1)},${Y(x[0]).toFixed(1)}`).join(" ");
      kolory += `<polygon points="${X(k[i][1]).toFixed(1)},${Hd} ${seg} ${X(k[j][1]).toFixed(1)},${Hd}" fill="var(--nach${c})"/>`;
    }
    i = j;
  }
  svg.innerHTML =
    `<polygon points="0,${Hd} ${pts} ${Wd},${Hd}" fill="var(--profil-wyp)"/>` + kolory +
    `<polyline points="${pts}" fill="none" stroke="var(--profil)" stroke-width="2" vector-effect="non-scaling-stroke"/>` +
    `<line id="pLinia" x1="0" x2="0" y1="0" y2="${Hd}" stroke="var(--tekst)" stroke-width="1" vector-effect="non-scaling-stroke" visibility="hidden"/>`;
  $("pMin").textContent = `${lo} m`;
  $("pMax").textContent = `${hi} m`;
  $("pInfo").textContent = "przesuń palcem po wykresie";

  const pokaz = (clientX) => {
    const r = svg.getBoundingClientRect();
    const d = Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * p.dl;
    const l = $("pLinia"); l.setAttribute("x1", X(d)); l.setAttribute("x2", X(d)); l.setAttribute("visibility", "visible");
    kursor.setLatLng(punktNaTrasie(p, d)).addTo(mapa);
    $("pInfo").textContent = `${p.dl < 1000 ? Math.round(d) + " m" : km(d) + " km"} · ${Math.round(wysokoscNa(p, d))} m n.p.m. · ${proc1(nachylenieNa(p, d))}`;
  };
  svg.onpointermove = svg.onpointerdown = (e) => pokaz(e.clientX);
  svg.onpointerleave = () => { $("pLinia")?.setAttribute("visibility", "hidden"); kursor.remove(); };
}

// ---------- GPX ----------
function nazwaTrasy(p) {
  const co = p.rodzaj === "ab" ? "z A do B" : p.rodzaj === "podbieg" ? "dobieg + podbieg" : "pętla";
  return `${p.tryb === "rower" ? "Rower" : "Bieg"}: ${co} ${km(p.dl)} km, ${Math.round(p.up)} m podejścia`;
}
function gpx(p) {
  const nazwa = nazwaTrasy(p);
  const pkt = p.linia.map((x) => `<trkpt lat="${x[0].toFixed(6)}" lon="${x[1].toFixed(6)}"><ele>${wysokoscNa(p, x[2]).toFixed(1)}</ele></trkpt>`).join("\n      ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Trasy treningowe Baranowo" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${nazwa}</name><copyright author="OpenStreetMap contributors"><license>https://opendatacommons.org/licenses/odbl/</license></copyright></metadata>
  <trk>
    <name>${nazwa}</name>
    <type>${p.tryb === "rower" ? "cycling" : "running"}</type>
    <trkseg>
      ${pkt}
    </trkseg>
  </trk>
</gpx>
`;
}
$("gpx").onclick = () => {
  if (!biezaca) return;
  const blob = new Blob([gpx(biezaca)], { type: "application/gpx+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${{ ab: "a-b", podbieg: "podbieg" }[biezaca.rodzaj] || "petla"}-${biezaca.tryb}-${km(biezaca.dl).replace(",", "-")}km-${Math.round(biezaca.up)}m.gpx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
