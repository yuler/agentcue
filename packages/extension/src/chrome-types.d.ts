declare namespace chrome {
  namespace runtime {
    const id: string | undefined;

    interface MessageSender {
      id?: string;
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
    function getManifest(): {
      name?: string;
      short_name?: string;
      version?: string;
      version_name?: string;
    };

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

    interface TabChangeInfo {
      status?: string;
      url?: string;
    }

    function query(queryInfo: {
      active?: boolean;
      currentWindow?: boolean;
    }): Promise<Tab[]>;
    function sendMessage<T = unknown>(tabId: number, message: unknown): Promise<T>;

    const onUpdated: {
      addListener(
        callback: (tabId: number, changeInfo: TabChangeInfo, tab: Tab) => void
      ): void;
    };
    const onRemoved: {
      addListener(callback: (tabId: number) => void): void;
    };
  }

  namespace commands {
    const onCommand: {
      addListener(callback: (command: string, tab?: tabs.Tab) => void): void;
    };
  }

  namespace action {
    function setIcon(details: {
      path: Record<string, string>;
      tabId?: number;
    }): Promise<void>;
    function setTitle(details: { title: string; tabId?: number }): Promise<void>;
    function setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
    function setBadgeBackgroundColor(details: {
      color: string;
      tabId?: number;
    }): Promise<void>;
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
      get(
        keys?: string | string[] | Record<string, unknown> | null
      ): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };

    const onChanged: {
      addListener(
        callback: (
          changes: Record<string, StorageChange>,
          areaName: string
        ) => void
      ): void;
      removeListener(
        callback: (
          changes: Record<string, StorageChange>,
          areaName: string
        ) => void
      ): void;
    };
  }
}
