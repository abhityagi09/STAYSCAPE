// Applies the saved theme before first paint to avoid a flash of the wrong theme.
(function () {
  try {
    var t = localStorage.getItem('stayscape.theme');
    var dark =
      t === 'dark' ||
      ((t === null || t === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch {
    /* storage unavailable: fall back to light theme */
  }
})();
