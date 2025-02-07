export async function timedNotification(title: string, message: string, ms: number = 3000) {
  const notificationId = await browser.notifications.create({
    title,
    message,
    type: "basic",
  });
  setTimeout(() => browser.notifications.clear(notificationId), ms);
}

export function notifyOnError(callback: () => Promise<any>) {
  return () => callback().catch((e) => timedNotification("Thunderbird LLM Extension Error", (e as Error).message));
}

export function showNotification(message: string, isSuccess: boolean) {
  const notification = document.getElementById("notification");
  if (!notification) {
    throw Error(`Element "notification" could not be found. Contact devs`);
  }
  notification.textContent = message;
  notification.style.backgroundColor = isSuccess ? "green" : "red";
  notification.className = "notification show";
  setTimeout(function () {
    notification.className = "notification";
  }, 3000); // The notification will disappear after 3 seconds
}
