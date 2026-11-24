// A→B: trasa z punktu A do punktu B, suwakiem od „najkrócej” do „najpłaściej” (jak flattensf).
// Korzysta z danych i funkcji z petla.js i podbiegi.js (G, droga, podsumuj, rysuj, ustawStart, rodzaj…).
"use strict";

let meta = null;          // indeks węzła mety (B)
let trasyAB = [];         // od najkrótszej do najpłaściejszej (każda kolejna płaściej i dłużej)
let betaZLinku = null;    // przy otwieraniu linku: którą wersję pokazać
let zegarAB = 0;

// Im większa beta, tym mocniej trasa omija górki (por. droga() w petla.js)
const BETY_AB = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];
const MAKS_NADLOZENIE = 1.8;  // płaściejsza wersja najwyżej 1,8 × dłuższa od najkrótszej
const DOMYSLNIE_NADLOZENIE = 1.25; // na start: najpłaściejsza, która nadkłada najwyżej 25%

const ikonaA = L.divIcon({ className: "start-ikona litera", html: "A", iconSize: [26, 26] });
const ikonaStartu = L.divIcon({ className: "start-ikona", iconSize: [18, 18] });
const znacznikMety = L.marker([0, 0], {
  icon: L.divIcon({ className: "meta-ikona litera", html: "B", iconSize: [26, 26] }), draggable: true,
  keyboard: false, title: "Meta – przeciągnij, żeby zmienić",
});

// ---------- wejście i wyjście z zakładki ----------
const _ustawRodzajAB = ustawRodzaj;
ustawRodzaj = function (r) {
  _ustawRodzajAB(r);
  if (r === "ab") {
    znacznikStartu.setIcon(ikonaA);
    if (znacznikStartu.dragging) znacznikStartu.dragging.enable();
    if (meta !== null) znacznikMety.addTo(mapa);
    podpowiedzAB();
    zaplanujAB();
  } else {
    znacznikStartu.setIcon(ikonaStartu);
    if (znacznikStartu.dragging) znacznikStartu.dragging.disable();
    znacznikMety.remove();
    $("podpowiedz").textContent = "Start ustawiony. Kliknij na mapie, żeby go zmienić.";
  }
};

function podpowiedzAB() {
  $("podpowiedz").textContent = meta === null
    ? "Kliknij na mapie metę (B). Start (A) już jest – możesz go przeciągnąć."
    : "Kliknij na mapie, żeby przesunąć bliższy punkt, albo przeciągnij A lub B.";
}

// ---------- ustawianie A i B ----------
function ustawMete(i) {
  meta = i;
  znacznikMety.setLatLng([G.lat[i], G.lon[i]]).addTo(mapa);
}

function klikAB(ll) {
  const i = najblizszy(ll.lat, ll.lng);
  if (meta === null) ustawMete(i);
  else {
    const dA = odl(ll.lat, ll.lng, G.lat[start], G.lon[start]);
    const dB = odl(ll.lat, ll.lng, G.lat[meta], G.lon[meta]);
    if (dA < dB) ustawStart(i); else ustawMete(i);
  }
  podpowiedzAB();
  zaplanujAB();
}

// Każda zmiana startu (klik, przeciągnięcie, „Moja lokalizacja”, zmiana trybu) w A→B przelicza trasę
const _ustawStartAB = ustawStart;
ustawStart = function (i) {
  _ustawStartAB(i);
  if (rodzaj === "ab") { podpowiedzAB(); zaplanujAB(); }
};

znacznikStartu.on("dragend", () => {
  if (rodzaj !== "ab") return;
  const ll = znacznikStartu.getLatLng();
  ustawStart(najblizszy(ll.lat, ll.lng));
});
znacznikMety.on("dragend", () => {
  const ll = znacznikMety.getLatLng();
  ustawMete(najblizszy(ll.lat, ll.lng));
  podpowiedzAB(); zaplanujAB();
});

$("abZamien").onclick = () => {
  if (meta === null) return;
  const a = start, b = meta;
  ustawMete(a); ustawStart(b);
};

// Bieg / rower i „omijaj ruchliwe” zmieniają sieć dróg – meta musi trafić na drogę dozwoloną w nowym trybie
const _ustawTrybAB = ustawTryb;
ustawTryb = function (t, przelicz = true) {
  _ustawTrybAB(t, przelicz);
  if (meta !== null) ustawMete(najblizszy(G.lat[meta], G.lon[meta]));
  if (rodzaj === "ab") zaplanujAB();
};
$("spokojnie").addEventListener("change", () => { if (rodzaj === "ab") zaplanujAB(); });

// ---------- liczenie ----------
function zaplanujAB() {
  clearTimeout(zegarAB);
  if (!G || meta === null || start === null || rodzaj !== "ab") return;
  $("stan").textContent = "Liczę trasę…";
  zegarAB = setTimeout(liczAB, 30);
}

function liczAB() {
  if (meta === start) {
    trasyAB = []; warstwaTrasy.clearLayers(); $("wynik").hidden = true; odswiezSuwakAB();
    $("stan").textContent = "A i B to to samo miejsce – przesuń jeden z punktów.";
    return;
  }
  try {
    const t0 = performance.now(), wszystkie = [];
    for (const beta of BETY_AB) {
      const r = droga(start, meta, beta, new Set());
      if (!r) continue;
      const p = podsumuj(r);
      p.beta = beta; p.rodzaj = "ab"; p.pkty = [start, meta];
      wszystkie.push(p);
    }
    if (!wszystkie.length) {
      trasyAB = []; warstwaTrasy.clearLayers(); $("wynik").hidden = true; odswiezSuwakAB();
      $("stan").textContent = "Nie znalazłem drogi z A do B. Przesuń jeden z punktów.";
      return;
    }
    // Zostaw tylko wersje, z których każda kolejna jest wyraźnie płaściejsza (i dłuższa) od poprzedniej
    wszystkie.sort((a, b) => a.dl - b.dl || a.up - b.up);
    const najkr = wszystkie[0];
    trasyAB = [];
    for (const p of wszystkie) {
      if (p.dl > najkr.dl * MAKS_NADLOZENIE) continue;
      const ost = trasyAB[trasyAB.length - 1];
      // bez sensu nadkładać, jeśli wychodzi płaściej o mniej niż 2 m albo mniej niż 3 m na każdy dodatkowy km
      if (ost && (ost.up - p.up < 2 || ost.up - p.up < 0.003 * (p.dl - ost.dl))) continue;
      trasyAB.push(p);
    }
    // Którą pokazać: z linku tę o najbliższej becie, inaczej najpłaściejszą „rozsądną”
    let idx = 0;
    if (betaZLinku !== null) {
      let bd = Infinity;
      trasyAB.forEach((p, i) => { const d = Math.abs(p.beta - betaZLinku); if (d < bd) { bd = d; idx = i; } });
      betaZLinku = null;
    } else {
      trasyAB.forEach((p, i) => { if (p.dl <= najkr.dl * DOMYSLNIE_NADLOZENIE) idx = i; });
    }
    odswiezSuwakAB(idx);
    pokazAB(idx);
    const s = ((performance.now() - t0) / 1000).toFixed(1).replace(".", ",");
    $("stan").textContent = trasyAB.length > 1
      ? `${trasyAB.length} ${trasyAB.length < 5 ? "wersje" : "wersji"} trasy (${s} s) – suwakiem wybierz, ile chcesz nadłożyć dla płaskiej drogi.`
      : `Gotowe (${s} s).`;
  } catch (e) {
    console.error(e);
    $("stan").textContent = "Coś poszło nie tak przy liczeniu. Przesuń jeden z punktów i spróbuj jeszcze raz.";
  }
}

function odswiezSuwakAB(idx = 0) {
  const s = $("abSuwak"), n = trasyAB.length;
  s.max = Math.max(0, n - 1); s.value = idx;
  s.disabled = n < 2;
  $("abPole").classList.toggle("wyciszone", n < 2);
  $("abZamien").disabled = meta === null;
  $("abTxt").textContent = n ? opisSuwakaAB(idx) : "–";
}

function opisSuwakaAB(i) {
  const n = trasyAB.length;
  if (n < 2) return "najkrótsza = najpłaściejsza";
  if (i === 0) return "najkrócej";
  if (i === n - 1) return "najpłaściej";
  return "kompromis";
}

$("abSuwak").oninput = () => {
  const i = +$("abSuwak").value;
  if (!trasyAB[i]) return;
  $("abTxt").textContent = opisSuwakaAB(i);
  pokazAB(i);
};

function pokazAB(i) {
  const p = trasyAB[i], k = trasyAB[0];
  rysuj(p);                       // linia na mapie, liczby, profil, nawierzchnia, link
  znacznikMety.addTo(mapa);
  let t;
  if (trasyAB.length < 2) t = "Tu najkrótsza droga jest też najpłaściejsza.";
  else if (i === 0) {
    const pl = trasyAB[trasyAB.length - 1];
    t = `Najkrótsza. Najpłaściej: ${km(pl.dl)} km i ${Math.round(pl.up)} m podejścia – przesuń suwak w prawo.`;
  } else {
    const dd = p.dl - k.dl, du = Math.round(k.up) - Math.round(p.up); // jak na kafelkach, bez rozjazdu zaokrągleń
    t = `Względem najkrótszej (${km(k.dl)} km, ${Math.round(k.up)} m): ` +
      `${dd < 1000 ? "+" + Math.round(dd) + " m" : "+" + km(dd) + " km"} drogi, ${du} m mniej podejścia.`;
  }
  $("zakres").textContent = t;
}

// ---------- link ----------
// #r=ab&t=rower&s=1&a=lat,lon&b=lat,lon&k=beta
function zapiszLinkAB(p) {
  const wsp = (i) => `${G.lat[i].toFixed(5)},${G.lon[i].toFixed(5)}`;
  const par = new URLSearchParams({ r: "ab", t: p.tryb, a: wsp(p.pkty[0]), b: wsp(p.pkty[1]), k: p.beta });
  if ($("spokojnie").checked) par.set("s", 1);
  history.replaceState(null, "", "#" + par.toString());
}

function otworzLinkAB(par) {
  const pkt = (s) => { const x = (s || "").split(",").map(Number); return x.length === 2 && x.every(isFinite) ? x : null; };
  const a = pkt(par.get("a")), b = pkt(par.get("b"));
  if (!a || !b) return;
  betaZLinku = isFinite(+par.get("k")) ? +par.get("k") : null;
  $("spokojnie").checked = par.get("s") === "1";
  clearTimeout(zegarAB);
  meta = null;
  ustawRodzaj("ab");
  ustawTryb(par.get("t") === "rower" ? "rower" : "bieg");
  ustawMete(najblizszy(b[0], b[1]));
  ustawStart(najblizszy(a[0], a[1]));   // uruchamia liczenie
  dopasuj(L.latLngBounds([a, b]), 40);
}
