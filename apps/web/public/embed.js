/*!
 * Setryn embed loader. Place a container and this script on any page:
 *
 *   <div data-setryn-widget="market" data-market="BTC-YC-24DEC26" data-theme="dark" data-partner="your-code"></div>
 *   <script async src="https://<setryn-host>/embed.js"></script>
 *
 * data-setryn-widget: ticker | market | trade
 * data-market:        market id (market and trade widgets)
 * data-markets:       comma-separated market ids (ticker)
 * data-theme:         dark | light
 * data-partner:       partner attribution code
 * data-side, data-lots: initial direction (long | short) and size for the trade widget
 *
 * The widget runs in a sandboxed iframe on the Setryn origin and never signs; it resizes itself via postMessage.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  var origin = script && script.src ? new URL(script.src).origin : window.location.origin;
  var frames = {};
  var counter = 0;
  var WIDGETS = { ticker: true, market: true, trade: true };
  var CODE = /^[a-z0-9][a-z0-9-]{2,31}$/;
  var MARKET = /^[A-Za-z0-9._-]{1,64}$/;

  function mount(element) {
    if (!element || element.getAttribute("data-setryn-mounted") === "true") return null;
    var widget = element.getAttribute("data-setryn-widget");
    if (!WIDGETS[widget]) return null;
    var market = element.getAttribute("data-market") || "";
    if (widget !== "ticker" && !MARKET.test(market)) return null;
    var frameId = "setryn-" + Date.now().toString(36) + "-" + (counter += 1);
    var params = new URLSearchParams();
    params.set("theme", element.getAttribute("data-theme") === "light" ? "light" : "dark");
    params.set("fid", frameId);
    var partner = element.getAttribute("data-partner");
    if (partner && CODE.test(partner)) params.set("partner", partner);
    var markets = element.getAttribute("data-markets");
    if (widget === "ticker" && markets) params.set("markets", markets);
    var side = element.getAttribute("data-side");
    if (widget === "trade" && side) params.set("side", side);
    var lots = element.getAttribute("data-lots");
    if (widget === "trade" && lots) params.set("lots", lots);

    var path = widget === "ticker" ? "/embed/ticker" : "/embed/" + widget + "/" + encodeURIComponent(market);
    var iframe = document.createElement("iframe");
    iframe.src = origin + path + "?" + params.toString();
    iframe.title = element.getAttribute("data-title") ||
      (widget === "ticker" ? "Setryn market ticker" : widget === "trade" ? "Setryn quote for " + market : "Setryn market " + market);
    iframe.loading = "lazy";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
    iframe.style.cssText = "display:block;width:100%;border:0;overflow:hidden;background:transparent;color-scheme:normal;";
    iframe.style.height = (element.getAttribute("data-height") || (widget === "ticker" ? "84" : widget === "trade" ? "330" : "250")) + "px";
    element.setAttribute("data-setryn-mounted", "true");
    element.appendChild(iframe);
    frames[frameId] = iframe;
    return iframe;
  }

  function scan(root) {
    var nodes = (root || document).querySelectorAll("[data-setryn-widget]");
    for (var index = 0; index < nodes.length; index += 1) mount(nodes[index]);
  }

  window.addEventListener("message", function (event) {
    if (event.origin !== origin || !event.data || event.data.type !== "setryn:embed:resize") return;
    var iframe = frames[event.data.frameId];
    var height = Number(event.data.height);
    if (!iframe || event.source !== iframe.contentWindow || !isFinite(height)) return;
    iframe.style.height = Math.max(40, Math.min(2000, Math.ceil(height))) + "px";
  });

  window.SetrynEmbed = { mount: mount, scan: scan, origin: origin };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { scan(); });
  else scan();
})();
