// Podbiegi: najbliższe wzniesienia o zadanej długości i nachyleniu (do treningu interwałowego).
// Korzysta z danych i funkcji z petla.js (G, ADJ, KARA, KIER, droga, podsumuj, pokazWynik…).
"use strict";

// ---------- zakładki Pętla / Podbiegi / A→B ----------
let rodzaj = "petla";
const RODZAJE = { petla: ["rodzajPetla", "panelPetla"], podbiegi: ["rodzajPodbiegi", "panelPodbiegi"], ab: ["rodzajAB", "panelAB"] };
function ustawRodzaj(r) {
  rodzaj = r;
  for (const [k, [przycisk, panel]] of Object.entries(RODZAJE)) {
    $(przycisk).classList.toggle("wybrany", r === k);
    $(przycisk).setAttribute("aria-selected", r === k);
    $(panel).hidden = r !== k;
  }
  warstwaTrasy.clearLayers(); $("wynik").hidden = true; $("stan").textContent = "";
  if (location.hash) history.replaceState(null, "", location.pathname); // link dotyczy bieżącej trasy
}
for (const k of Object.keys(RODZAJE)) $(RODZAJE[k][0]).onclick = () => rodzaj !== k && ustawRodzaj(k);

function odswiezPodbiegi() {
  $("pbDlTxt").textContent = `${$("pbDl").value} m`;
  $("pbNachTxt").textContent = `${(+$("pbNach").value).toLocaleString("pl-PL")}%`;
  $("pbZasTxt").textContent = `${(+$("pbZas").value).toLocaleString("pl-PL")} km`;
}
$("pbDl").oninput = $("pbNach").oninput = $("pbZas").oninput = odswiezPodbiegi;
odswiezPodbiegi();

// ---------- próbki wysokości wzdłuż krawędzi ----------
const pamiecProbek = new Map();
// [[lat, lon, wysokość, odległość od początku], ...] w kierunku jazdy
function probki(e, fwd) {
  const klucz = e * 2 + (fwd ? 1 : 0);
  if (pamiecProbek.has(klucz)) return pamiecProbek.get(klucz);
  let g = geometria(e); if (!fwd) g = g.reverse();
  let w = wysokosci(e); if (!fwd) w = w.reverse();
  const cz = [0];
  for (let j = 1; j < g.length; j++) cz.push(cz[j - 1] + odl(g[j - 1][0], g[j - 1][1], g[j][0], g[j][1]));
  const Lk = G.DL[e], skala = Lk / Math.max(1, cz[cz.length - 1]);
  const out = [];
  let s = 1;
  for (let i = 0; i < w.length; i++) {
    const d = (i * Lk) / Math.max(1, w.length - 1);
    while (s < g.length - 1 && cz[s] * skala < d) s++;
    const a0 = cz[s - 1] * skala, b0 = cz[s] * skala, t = b0 > a0 ? Math.min(1, (d - a0) / (b0 - a0)) : 0;
    out.push([g[s - 1][0] + (g[s][0] - g[s - 1][0]) * t, g[s - 1][1] + (g[s][1] - g[s - 1][1]) * t, w[i], d]);
  }
  pamiecProbek.set(klucz, out);
  return out;
}

// Idź „prosto przed siebie” od krawędzi (e, fwd), aż uzbiera się `ile` metrów
function ciag(e, fwd, ile) {
  const kraw = [[e, fwd]], pts = probki(e, fwd).map((p) => p.slice());
  let dl = G.DL[e]; const byly = new Set([e]);
  while (dl < ile) {
    const [pe, pf] = kraw[kraw.length - 1];
    const u = pf ? G.V[pe] : G.U[pe], o = pf ? 2 : 0;
    const px = -KIER[4 * pe + o], py = -KIER[4 * pe + o + 1];
    let best = -1, bf = true, bc = 0.6; // najwyżej ~53° skrętu
    const s = ADJ[u];
    for (let j = 0; j < s.length; j += 2) {
      const e2 = s[j]; if (!KARA[e2] || byly.has(e2)) continue;
      const f2 = G.U[e2] === u, o2 = f2 ? 0 : 2, c = px * KIER[4 * e2 + o2] + py * KIER[4 * e2 + o2 + 1];
      if (c > bc) { bc = c; best = e2; bf = f2; }
    }
    if (best < 0) break;
    byly.add(best); kraw.push([best, bf]);
    for (const p of probki(best, bf).slice(1)) pts.push([p[0], p[1], p[2], p[3] + dl]);
    dl += G.DL[best];
  }
  return { kraw, pts, dl };
}

// ---------- szukanie ----------
function szukajPodbiegow() {
  const Lh = +$("pbDl").value, gmin = +$("pbNach").value / 100, zasieg = +$("pbZas").value * 1000;
  const sla = G.lat[start], slo = G.lon[start], m = G.U.length;
  const kand = [];
  for (let e = 0; e < m; e++) {
    if (!KARA[e]) continue;
    const u = G.U[e], v = G.V[e];
    if (odl(G.lat[u], G.lon[u], sla, slo) > zasieg && odl(G.lat[v], G.lon[v], sla, slo) > zasieg) continue;
    for (const fwd of [true, false]) {
      const Le = G.DL[e];
      const c = ciag(e, fwd, Le + Lh);
      if (c.dl < Lh) continue;
      const P = c.pts;
      let best = null, j = 0;
      for (let i = 0; i < P.length && P[i][3] <= Le; i++) {
        if (odl(P[i][0], P[i][1], sla, slo) > zasieg) continue;
        while (j < P.length && P[j][3] - P[i][3] < Lh) j++;
        if (j >= P.length) break;
        const dl = P[j][3] - P[i][3], zysk = P[j][2] - P[i][2], g = zysk / dl;
        if (g < gmin || (best && g <= best.g)) continue;
        // równy podbieg, nie „góra-dół”: zejścia w środku najwyżej 25% zysku
        let zej = 0; for (let q = i + 1; q <= j; q++) if (P[q][2] < P[q - 1][2]) zej += P[q - 1][2] - P[q][2];
        if (zej > 0.25 * zysk) continue;
        best = { g, zysk, dl, i, j };
      }
      if (best) kand.push({ ...best, e, fwd, pts: P, kraw: c.kraw });
    }
  }
  // bez dubli: ten sam stok znaleziony z przesunięciem o kilka metrów
  kand.sort((a, b) => b.g - a.g);
  const wybrane = [];
  for (const k of kand) {
    const a = k.pts[k.i], b = k.pts[k.j];
    const blisko = (p, w) => w.pts.slice(w.i, w.j + 1).some((q) => odl(p[0], p[1], q[0], q[1]) < 60);
    if (wybrane.some((w) => blisko(a, w) || blisko(b, w))) continue;
    k.odStartu = odl(a[0], a[1], sla, slo);
    wybrane.push(k);
    if (wybrane.length >= 40) break;
  }
  return wybrane.sort((a, b) => a.odStartu - b.odStartu).slice(0, 8);
}

let podbiegi = [];
$("szukajPodbiegow").onclick = () => {
  if (!G || start === null) return;
  $("stan").textContent = "Szukam podbiegów…";
  $("szukajPodbiegow").disabled = true;
  setTimeout(() => {
    try {
      const t0 = performance.now();
      podbiegi = szukajPodbiegow();
      const lista = $("listaPodbiegow");
      lista.innerHTML = "";
      if (!podbiegi.length) {
        $("stan").textContent = "Nie ma tu takiego podbiegu. Zmniejsz nachylenie albo długość, albo zwiększ zasięg.";
        warstwaTrasy.clearLayers(); $("wynik").hidden = true;
        return;
      }
      podbiegi.forEach((pb, n) => {
        const b = document.createElement("button");
        b.innerHTML = `<b>${Math.round(pb.dl)} m · średnio ${proc1(pb.g)} · +${Math.round(pb.zysk)} m</b>` +
          `<span>${km(pb.odStartu)} km od startu w linii prostej</span>`;
        b.onclick = () => {
          pokazPodbieg(n);
          // na telefonie mapa jest nad listą – przewiń do niej, żeby było widać wybrany podbieg
          if (matchMedia("(max-width: 767px)").matches) $("mapa").scrollIntoView({ block: "start" });
        };
        lista.appendChild(b);
      });
      $("stan").textContent = `Znaleziono ${podbiegi.length} (${((performance.now() - t0) / 1000).toFixed(1).replace(".", ",")} s). Wybierz z listy.`;
      pokazPodbieg(0);
    } catch (e) {
      console.error(e);
      $("stan").textContent = "Coś poszło nie tak przy szukaniu. Spróbuj jeszcze raz.";
    } finally {
      $("szukajPodbiegow").disabled = false;
    }
  }, 20);
};

// Dobieg ze startu do podnóża + podbieg; na mapie dobieg przerywaną linią, podbieg czerwoną
function pokazPodbieg(n) {
  const pb = podbiegi[n];
  [...$("listaPodbiegow").children].forEach((b, i) => b.classList.toggle("wybrany", i === n));
  const [e, fwd] = [pb.e, pb.fwd], Le = G.DL[e], di = pb.pts[pb.i][3];
  // Dobieg do podnóża od bliższego końca ulicy, na której zaczyna się podbieg
  const wariant = (wezel, odwrotnie) => {
    const r = wezel === start ? [] : droga(start, wezel, 0, new Set());
    if (!r) return null;
    let d = 0; for (const [s] of r) d += G.DL[s];
    return { r, odwrotnie, razem: d + (odwrotnie ? Le - di : di) };
  };
  const A = wariant(fwd ? G.U[e] : G.V[e], false), B = wariant(fwd ? G.V[e] : G.U[e], true);
  const W = !B || (A && A.razem <= B.razem) ? A : B;
  const dojazd = W ? W.r : [];
  // dobieg (krawędzie) + kawałek pierwszej krawędzi do podnóża
  const linia = [], pkt = [];
  let dl = 0;
  if (dojazd.length) {
    const d = podsumuj(dojazd);
    d.linia.forEach((x) => linia.push(x)); d.pkt.forEach((x) => pkt.push(x)); dl = d.dl;
  }
  const dodaj = (p, d) => { linia.push([p[0], p[1], d]); pkt.push([p[2], d]); };
  const P = pb.pts;
  if (W && W.odwrotnie) {
    // od drugiego końca krawędzi wstecz do podnóża
    const k0 = P.findIndex((p) => p[3] >= Le - 0.01);
    for (let q = k0; q >= pb.i; q--) dodaj(P[q], dl + (Le - P[q][3]));
    dl += Le - di;
  } else {
    for (let q = 0; q <= pb.i; q++) dodaj(P[q], dl + P[q][3]);
    dl += di;
  }
  const dojazdDo = dl;
  // podbieg
  for (let q = pb.i + 1; q <= pb.j; q++) dodaj(P[q], dl + (P[q][3] - di));
  const calosc = dl + (P[pb.j][3] - di);
  let max = -Infinity, min = Infinity, up = 0, ref = pkt[0][0];
  for (const [h] of pkt) {
    if (h > max) max = h; if (h < min) min = h;
    if (h - ref >= 1.5) { up += h - ref; ref = h; } else if (ref - h >= 1.5) ref = h;
  }
  const p = { linia, pkt, dl: calosc, up, max, min, tryb, rodzaj: "podbieg" };

  warstwaTrasy.clearLayers();
  const ll = (x) => [x[0], x[1]];
  const dobiegLinia = linia.filter((x) => x[2] <= dojazdDo + 0.1).map(ll);
  const podbiegLinia = pb.pts.slice(pb.i, pb.j + 1).map(ll);
  const kolor = getComputedStyle(document.documentElement).getPropertyValue("--trasa").trim();
  const stromy = getComputedStyle(document.documentElement).getPropertyValue("--nach3").trim();
  if (dobiegLinia.length > 1) L.polyline(dobiegLinia, { color: kolor, weight: 3, dashArray: "6 6" }).addTo(warstwaTrasy);
  L.polyline(podbiegLinia, { color: "#fff", weight: 10, opacity: 0.9 }).addTo(warstwaTrasy);
  L.polyline(podbiegLinia, { color: stromy, weight: 6 }).addTo(warstwaTrasy);
  L.circleMarker(podbiegLinia[0], { radius: 6, color: "#fff", weight: 2, fillColor: stromy, fillOpacity: 1 })
    .bindTooltip("Podnóże", { direction: "top" }).addTo(warstwaTrasy);
  dopasuj(L.latLngBounds(dobiegLinia.concat(podbiegLinia)), 30);
  znacznikStartu.addTo(mapa);

  pokazWynik(p,
    `Podbieg: ${Math.round(pb.dl)} m, średnio ${proc1(pb.g)}, +${Math.round(pb.zysk)} m. ` +
    `Dobieg do podnóża: ${dojazdDo < 1000 ? Math.round(dojazdDo) + " m" : km(dojazdDo) + " km"} (linia przerywana).`,
    "Dobieg + podbieg");
  $("zakres").textContent = "Interwały: podbieg w górę, powrót truchtem w dół – powtórz kilka razy.";
}

// Zmiana startu albo trybu czyści listę podbiegów
const _ustawStart = ustawStart;
ustawStart = function (i) { _ustawStart(i); podbiegi = []; $("listaPodbiegow").innerHTML = ""; };
