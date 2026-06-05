/**
 * Type declarations for the alarms API.
 * This API is available in Thunderbird MV3 extensions with the "alarms" permission
 * but is not included in @types/thunderbird-webext-browser.
 */
declare namespace browser {
  export import _manifest = messenger._manifest;
  export import accounts = messenger.accounts;
  export import action = messenger.action;
  export import commands = messenger.commands;
  export import compose = messenger.compose;
  export import composeAction = messenger.composeAction;
  export import folders = messenger.folders;
  export import identities = messenger.identities;
  export import mailTabs = messenger.mailTabs;
  export import menus = messenger.menus;
  export import messages = messenger.messages;
  export import notifications = messenger.notifications;
  export import runtime = messenger.runtime;
  export import storage = messenger.storage;
  export import tabs = messenger.tabs;

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
    function create(
      name: string,
      alarmInfo: { when?: number; delayInMinutes?: number; periodInMinutes?: number },
    ): void;
    function clear(name: string): Promise<boolean>;
    const onAlarm: WebExtEvent<(alarm: Alarm) => void>;
  }
}
