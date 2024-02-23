// This is directly copied from the example composer plugin from thunderbird:
// https://github.com/thunderbird/sample-extensions/blob/master/manifest_v3/composeBody/background.js

// Thunderbird can terminate idle backgrounds in manifest v3.
// Any listener directly added during add-on startup will be registered as a
// persistent listener and the background will wake up (restart) each time the
// event is fired.

const STANDARD_TEST_TO_PREPEND = "Hi, I'm a fake LLM, here is my fake reply:\n\n";

browser.composeAction.onClicked.addListener(async (tab) => {
  const openTabId = tab.id || 12312093;
  let tabDetails = await browser.compose.getComposeDetails(openTabId);
  console.log(tabDetails);

  if (tabDetails.isPlainText) {
    let plainTextBody = tabDetails.plainTextBody;
    console.log(plainTextBody);

    plainTextBody = STANDARD_TEST_TO_PREPEND + plainTextBody;
    console.log(plainTextBody);
    browser.compose.setComposeDetails(openTabId, {
      plainTextBody: plainTextBody,
    });
  } else {
    let htmlTabWithBody = new DOMParser().parseFromString(tabDetails.body || "", "text/html");
    console.log(htmlTabWithBody);

    let newParagraph = htmlTabWithBody.createElement("p");
    newParagraph.textContent = STANDARD_TEST_TO_PREPEND;
    htmlTabWithBody.body.prepend(STANDARD_TEST_TO_PREPEND);

    let html = new XMLSerializer().serializeToString(htmlTabWithBody);
    console.log(html);
    browser.compose.setComposeDetails(openTabId, { body: html });
  }
});
