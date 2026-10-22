// Applies the stored theme before first paint (kept external for the Content-Security-Policy).
try {
  const t = localStorage.getItem("contractly-theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch (e) {
  /* storage unavailable */
}
