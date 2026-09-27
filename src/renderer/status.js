// Hover-link status bubble (bottom-left of the page). Driven by the browser.
window.setStatus = (text, dark) => {
  document.body.classList.toggle('dark', Boolean(dark));
  document.getElementById('text').textContent = text;
};
