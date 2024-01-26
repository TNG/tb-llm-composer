// This is directly copied from the example composer plugin from thunderbird:
// https://github.com/thunderbird/sample-extensions/blob/master/manifest_v3/composeBody/background.js

// Thunderbird can terminate idle backgrounds in manifest v3.
// Any listener directly added during add-on startup will be registered as a
// persistent listener and the background will wake up (restart) each time the
// event is fired.

browser.composeAction.onClicked.addListener(async (tab) => {
    // Get the existing message.
    const tabId = tab.id || 12312093;
    let details = await browser.compose.getComposeDetails(tabId);
    console.log(details);

    if (details.isPlainText) {
        // The message is being composed in plain text mode.
        let body = details.plainTextBody;
        console.log(body);

        // Make direct modifications to the message text, and send it back to the editor.
        body += "\n\nSent from my Thunderbird";
        console.log(body);
        browser.compose.setComposeDetails(tabId, { plainTextBody: body });
    } else {
        // The message is being composed in HTML mode. Parse the message into an HTML document.
        let document = new DOMParser().parseFromString(details.body || "", "text/html");
        console.log(document);

        // Use normal DOM manipulation to modify the message.
        let para = document.createElement("p");
        para.textContent = "Sent from my Thunderbird";
        document.body.appendChild(para);

        // Serialize the document back to HTML, and send it back to the editor.
        let html = new XMLSerializer().serializeToString(document);
        console.log(html);
        browser.compose.setComposeDetails(tabId, { body: html });
    }
});