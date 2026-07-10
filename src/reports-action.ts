// Action-button popup: routes to the organise-folder toggle or opens the report window.

document.querySelector("#organise-btn")?.addEventListener("click", async () => {
  try {
    await browser.runtime.sendMessage({ type: "organise-folder-toggle" });
  } catch (e) {
    console.error("MENU: failed to send organise-folder-toggle", e);
  } finally {
    window.close();
  }
});

document.querySelector("#report-btn")?.addEventListener("click", async () => {
  try {
    await browser.runtime.sendMessage({ type: "open-report-window" });
  } catch (e) {
    console.error("MENU: failed to send open-report-window", e);
  } finally {
    window.close();
  }
});
