// Runs first, in the page head. Marks that scripts work (the entry screen and the scroll reveals rely on it) and
// makes sure nobody is ever left on the entry screen or in front of hidden content: if the page script cannot
// load, stops on an error before it is ready (an old browser), or is not ready after 9 s, the page is shown as it
// is, with every section visible ("no-app"). main.js sets window.__gloriaReady when it is running.
(function () {
  var root = document.documentElement;
  root.classList.add('js');
  function showPlainPage() {
    if (window.__gloriaReady || root.classList.contains('no-app')) return;
    var gate = document.getElementById('gate');
    if (gate) gate.parentNode.removeChild(gate);
    root.classList.add('is-entered', 'no-app');
    root.classList.remove('is-intro');
  }
  // a page script that failed to download, or an error thrown by one of them before the page was ready
  addEventListener('error', function (e) {
    var file = (e.target && e.target.src) || e.filename || '';
    if (/assets\/(js|vendor)\//.test(file)) showPlainPage();
  }, true);
  setTimeout(showPlainPage, 9000);
})();
