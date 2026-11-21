// Set the colour theme before first paint (no flash). Kept external so the CSP needs no inline scripts.
(function () {
  try {
    var t = localStorage.getItem('arka-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
