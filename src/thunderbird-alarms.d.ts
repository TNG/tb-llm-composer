/**
 * Type declarations for the alarms API.
 * This API is available in Thunderbird MV3 extensions with the "alarms" permission
 * but is not included in @types/thunderbird-webext-browser.
 */
declare namespace browser {
  export namespace alarms {
    interface Alarm {
      name: string;
      scheduledTime: number;
      periodInMinutes?: number;
    }
    function create(name: string, alarmInfo: { periodInMinutes: number }): void;
    function clear(name: string): Promise<boolean>;
    const onAlarm: WebExtEvent<(alarm: Alarm) => void>;
  }
}

declare namespace messenger {
  export namespace alarms {
    interface Alarm {
      name: string;
      scheduledTime: number;
      periodInMinutes?: number;
    }
    function create(name: string, alarmInfo: { periodInMinutes: number }): void;
    function clear(name: string): Promise<boolean>;
    const onAlarm: WebExtEvent<(alarm: Alarm) => void>;
  }
}
