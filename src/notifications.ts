export async function timedNotification(title: string, message: string, ms: number = 3000) {
  const notificationId = await browser.notifications.create({
    title,
    message,
    type: "basic"
  });
  setTimeout(() => browser.notifications.clear(notificationId), ms);
}

export function notifyOnError(callback: () => Promise<any>) {
  return () => callback().catch((e) => timedNotification("Thunderbird LLM Extension Error", (e as Error).message));
}