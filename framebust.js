// Clickjacking guard, loaded render-blocking from <head> so it runs before the
// panel paints.
//
// GitHub Pages cannot send X-Frame-Options, and CSP's frame-ancestors is
// ignored when it arrives in a <meta> tag (see commit eb592a0, which dropped
// it for exactly that reason). So this script is the only control available on
// this host. Without it, a hostile page can stack an invisible copy of the
// panel under a decoy and harvest real clicks on the review and tagging
// buttons from an already-logged-in session.
//
// The paired `html{visibility:hidden}` rule in the page keeps the panel
// invisible until this file confirms it is running at the top level; if
// scripting is off, the page stays blank rather than becoming frameable bait.
//
// If the panel ever moves behind Cloudflare Access — or anything else that can
// set real response headers — replace this with:
//     Content-Security-Policy: frame-ancestors 'none'
// and drop both this file and the visibility rule.
(function () {
  if (window.top === window.self) {
    document.documentElement.style.visibility = "visible";
    return;
  }

  // Framed: never reveal the UI.
  window.stop();
  document.documentElement.style.visibility = "visible";
  document.documentElement.textContent =
    "This page cannot be displayed inside a frame.";

  try {
    // Best effort break-out; blocked silently when the framing page is
    // cross-origin and has not granted allow-top-navigation.
    window.top.location = window.self.location.href;
  } catch (e) {
    /* stay blanked */
  }
})();
