/**
 * Wraps a served page's HTML with a strict Content-Security-Policy and a console bridge before
 * it is handed to the Browser app's sandboxed iframe. The CSP blocks any real outbound request
 * (fetch/XHR/images/fonts/frames) from page-authored JavaScript, so a site's <script> can safely
 * run and manipulate its own DOM but can never reach the real internet, the real file system or
 * the parent window (the iframe itself is also rendered with sandbox="allow-scripts" and no
 * allow-same-origin, so it gets an opaque origin with no access to Computer Simulator at all).
 */

const CSP =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; connect-src \'none\'; frame-src \'none\'; object-src \'none\';">';

const CONSOLE_BRIDGE = `<script>(function(){
  function relay(level){
    return function(){
      try {
        var args = Array.prototype.slice.call(arguments).map(function(a){
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a); } catch (e) { return String(a); }
        });
        parent.postMessage({ source: 'virtual-internet-console', level: level, args: args }, '*');
      } catch (e) {}
    };
  }
  ['log','warn','error','info'].forEach(function(level){
    var original = console[level] ? console[level].bind(console) : function(){};
    console[level] = function(){ relay(level).apply(null, arguments); original.apply(console, arguments); };
  });
})();</script>`;

export function sandboxHtml(html: string): string {
  const injected = CSP + CONSOLE_BRIDGE;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${injected}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1><head>${injected}</head>`);
  return `${injected}${html}`;
}
