/* Shared by both legal pages.

   The postal address on those pages is deliberately plain text: it has to stay
   readable for screen readers, and it is the part the law asks to be plainly
   available. The e-mail is the part harvesters actually want, so it is
   assembled here and appears nowhere in the markup. That stops the
   regex-over-raw-HTML scrapers that make up the bulk of address harvesting; it
   does not stop a headless browser, and nothing served publicly can. */
(function(){
  var u = atob("cXVpbnRlLjQ3LWtvc2ludXM=");   /* local part */
  var d = atob("aWNsb3VkLmNvbQ==");           /* domain */
  var a = document.createElement("a");
  a.href = "mailto:" + u + "@" + d;
  a.textContent = u + "@" + d;
  var slot = document.getElementById("mail");
  slot.textContent = "";
  slot.appendChild(a);
})();
