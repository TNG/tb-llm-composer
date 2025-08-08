export async function timedNotification(title: string, message: string, ms = 30000) {
  const notificationId = await browser.notifications.create({
    title,
    message,
    type: "basic",
  });
  setTimeout(() => browser.notifications.clear(notificationId), ms);
}

export function notifyOnError<T>(callback: () => Promise<T>) {
  return callback().catch((e) => {
    console.debug("Error occurred", e);
    if (e.name === "AbortError") {
      console.debug("User cancelled request, do not notify", e);
      return;
    }
    const message = e?.message || e.toString();
    timedNotification("Thunderbird LLM Extension Error", message);
  });
}
