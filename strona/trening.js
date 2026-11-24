// Pętla dopasowana do treningu: długość z czasu i tempa, „płasko i prosto” pod interwały,
// trening dnia z aplikacji sportpluss w adresie: ?min=60 | ?km=8 | ?int=10x2/2 [&tempo=5:30] [&opis=…]
"use strict";

const TEMPO_DOMYSLNE = 6 * 60; // s/km

// „5:30”, „5.30”, „5” → sekundy na km (rozsądny zakres 2:30–12:00), inaczej null
function tempoS(t) {
  const m = String(t || "").trim().match(/^(\d{1,2})(?:[:.,](\d{1,2}))?$/);
  if (!m) return null;
  const s = +m[1] * 60 + (m[2] ? +m[2].padEnd(2, "0") : 0);
  return s >= 150 && s <= 720 ? s : null;
}
const tempoTxt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const tempoTeraz = () => tempoS($("tempo").value) || tempoS(localStorage.getItem("trasy.tempo")) || TEMPO_DOMYSLNE;

// czas + tempo → suwak długości (co 0,5 km, w zakresie suwaka)
function czasNaKm() {
  const min = +$("czas").value;
  if (!min) return;
  const km = Math.min(40, Math.max(2, Math.round(((min * 60) / tempoTeraz()) * 2) / 2));
  $("dlugosc").value = km;
  odswiezOpisy();
}
$("tempo").value = localStorage.getItem("trasy.tempo") || "";
$("czas").oninput = czasNaKm;
$("tempo").oninput = () => {
  const s = tempoS($("tempo").value);
  if (s) localStorage.setItem("trasy.tempo", tempoTxt(s));
  czasNaKm();
};
$("czas").onkeydown = $("tempo").onkeydown = (e) => { if (e.key === "Enter") $("wyznacz").click(); };
// ręczna zmiana suwaka = długość w km, czas przestaje obowiązywać
$("dlugosc").addEventListener("input", () => { $("czas").value = ""; });

// „Płasko i prosto”: suwak terenu i pole podejścia nie mają wtedy znaczenia
function odswiezProsto() {
  const p = $("prosto").checked;
  $("terenPole").classList.toggle("wyciszone", p || celM() !== null);
  $("cel").closest(".pole").classList.toggle("wyciszone", p);
}
$("prosto").onchange = () => {
  odswiezProsto();
  if (kandydaci.length && ostatnieUstawienia === ustawienia()) wybierz();
};

// Rower: czas i tempo biegowe nie pasują – pole tylko przy biegu
const _ustawTrybTr = ustawTryb;
ustawTryb = function (t, przelicz = true) {
  _ustawTrybTr(t, przelicz);
  // (.cel ma display:flex !important, więc atrybut hidden nie zadziała)
  document.querySelector(".czas").style.setProperty("display", t === "rower" ? "none" : "flex", "important");
  if (t === "rower") $("czas").value = "";
  else czasNaKm();   // zmiana trybu ustawia domyślną długość – wróć do tej z czasu
};

// ---------- trening dnia z aplikacji ----------
(function treningZAdresu() {
  const q = new URLSearchParams(location.search);
  const min = +q.get("min") || 0, km = +q.get("km") || 0;
  const int = (q.get("int") || "").match(/^(\d+)x(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (!min && !km && !int) return;
  const tempo = tempoS(q.get("tempo"));
  if (tempo) $("tempo").value = tempoTxt(tempo);
  const czasInt = int ? Math.round(+int[1] * (+int[2] + +int[3])) : 0;
  const opis = q.get("opis") || (int ? `${int[1]} × ${int[2]}′/${int[3]}′` : min ? `${min}′` : `${km} km`);

  let tekst;
  if (km) {
    $("dlugosc").value = Math.min(40, Math.max(2, Math.round(km * 2) / 2));
    tekst = `Pętla ok. ${km.toLocaleString("pl-PL")} km.`;
  } else {
    $("czas").value = int ? czasInt : min;
    czasNaKm();
    tekst = `${int ? `Interwały to ${czasInt} min biegu – pętla` : "Pętla"} ok. ${(+$("dlugosc").value).toLocaleString("pl-PL")} km przy tempie ${tempoTxt(tempoTeraz())}/km` +
      `${tempo ? "" : " (wpisz swoje tempo poniżej, jeśli jest inne)"}.`;
  }
  if (int) {
    $("prosto").checked = true;
    tekst += " Płasko i z małą liczbą zakrętów – dobra do interwałów.";
  }
  odswiezOpisy(); odswiezProsto();
  $("dzis").innerHTML = "";
  const b = document.createElement("b"); b.textContent = `Trening na dziś: ${opis}`;
  $("dzis").append(b, document.createTextNode(tekst + " Zmień start kliknięciem na mapie i wyznacz pętlę jeszcze raz."));
  $("dzis").hidden = false;

  // od razu pierwsza propozycja ze startu domyślnego (gdy nie otwieramy konkretnej trasy z linku)
  if (location.hash.length > 2) return;
  const czekaj = setInterval(() => {
    if (!G || start === null) return;
    clearInterval(czekaj);
    $("wyznacz").click();
  }, 200);
})();
