declare namespace chrome {
  namespace runtime {
    interface MessageSender {
      tab?: tabs.Tab;
      url?: string;
    }

    interface Port {
      name: string;
      sender?: MessageSender;
      postMessage(message: unknown): void;
      disconnect(): void;
      onMessage: {
        addListener(callback: (message: unknown, port: Port) => void): void;
      };
      onDisconnect: {
        addListener(callback: (port: Port) => void): void;
      };
    }

    function connect(connectInfo?: { name?: string }): Port;
    function sendMessage<T = unknown>(message: unknown): Promise<T>;
    function openOptionsPage(): Promise<void>;

    const onInstalled: {
      addListener(callback: () => void): void;
    };
    const onStartup: {
      addListener(callback: () => void): void;
    };
    const onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void
        ) => boolean | void
      ): void;
    };
    const onConnect: {
      addListener(callback: (port: Port) => void): void;
    };
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
    }
  }

  namespace action {
    function setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
    function setBadgeBackgroundColor(details: {
      color: string;
      tabId?: number;
    }): Promise<void>;

    const onClicked: {
      addListener(callback: (tab: tabs.Tab) => void): void;
    };
  }

  namespace scripting {
    interface InjectionResult<T = unknown> {
      result?: T;
    }

    function executeScript<Args extends unknown[], Result>(injection: {
      target: { tabId: number };
      files?: string[];
      func?: (...args: Args) => Result;
      args?: Args;
      world?: "ISOLATED" | "MAIN";
    }): Promise<Array<InjectionResult<Result>>>;
  }

  namespace storage {
    interface StorageChange {
      oldValue?: unknown;
      newValue?: unknown;
    }

    const local: {
      get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };

    const onChanged: {
      addListener(
        callback: (
          changes: Record<string, StorageChange>,
          areaName: string
        ) => void
      ): void;
    };
  }

  namespace contextMenus {
    interface OnClickData {
      menuItemId: string | number;
      checked?: boolean;
    }

    function removeAll(callback?: () => void): void;
    function create(
      createProperties: {
        id: string;
        title: string;
        type?: "normal" | "checkbox" | "radio" | "separator";
        checked?: boolean;
        contexts?: Array<"action" | "page" | "all">;
      },
      callback?: () => void
    ): void;
    function update(
      id: string,
      updateProperties: { checked?: boolean; title?: string },
      callback?: () => void
    ): void;

    const onClicked: {
      addListener(
        callback: (info: OnClickData, tab?: tabs.Tab) => void
      ): void;
    };
  }
}
