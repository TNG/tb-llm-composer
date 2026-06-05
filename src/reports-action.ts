// Action-button popup: routes to the organise-folder toggle or opens the report window.

document.querySelector("#organise-btn")?.addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "organise-folder-toggle" });
  window.close();
});

document.querySelector("#report-btn")?.addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "open-report-window" });
  window.close();
});
