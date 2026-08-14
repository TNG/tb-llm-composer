/**
 * Type declarations for the alarms API.
 * This API is available in Thunderbird MV3 extensions with the "alarms" permission
 * but is not included in @types/thunderbird-webext-browser. Everything else on the
 * `browser` namespace is provided by that package; this file only adds `alarms`.
 */
declare namespace browser {
  export namespace alarms {
    interface Alarm {
      name: string;
      scheduledTime: number;
      periodInMinutes?: number;
    }
    function create(
      name: string,
      alarmInfo: { when?: number; delayInMinutes?: number; periodInMinutes?: number },
    ): void;
    function clear(name: string): Promise<boolean>;
    const onAlarm: {
      addListener(callback: (alarm: Alarm) => void): void;
      removeListener(callback: (alarm: Alarm) => void): void;
      hasListener(callback: (alarm: Alarm) => void): boolean;
    };
  }
}
