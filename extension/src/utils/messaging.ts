let requestCounter = 0;

export interface MessageEnvelope<T = unknown> {
  type: string;
  payload?: T;
  requestId: string;
}

export interface MessageResult<T = unknown> {
  requestId: string;
  success: boolean;
  data?: T;
  error?: string;
}

function createRequestId(): string {
  requestCounter += 1;
  return `${Date.now()}-${requestCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function sendMessage<TReq, TRes>(
  type: string,
  payload?: TReq,
  target: 'background' | 'tab' | { tabId: number } = 'background'
): Promise<TRes> {
  const envelope: MessageEnvelope<TReq> = {
    type,
    payload,
    requestId: createRequestId(),
  };

  const sendFn = () => {
    if (target === 'background') {
      return chrome.runtime.sendMessage(envelope);
    }
    const tabId = typeof target === 'object' ? target.tabId : undefined;
    if (tabId === undefined) throw new Error('sendMessage to tab requires tabId');
    return chrome.tabs.sendMessage(tabId, envelope);
  };

  return new Promise<TRes>((resolve, reject) => {
    sendFn()
      .then((response: MessageResult<TRes> | undefined) => {
        if (!response) {
          reject(new Error(`No response for message type: ${type}`));
          return;
        }
        if (response.success) {
          resolve(response.data as TRes);
        } else {
          reject(new Error(response.error || 'Unknown error'));
        }
      })
      .catch((err: unknown) => reject(err instanceof Error ? err : new Error(String(err))));
  });
}

type MessageHandler = (
  payload: never,
  sender: chrome.runtime.MessageSender
) => Promise<unknown> | unknown;

export function registerHandlers(handlers: Record<string, MessageHandler>): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const envelope = message as MessageEnvelope;
    if (!envelope || typeof envelope.type !== 'string') return false;

    const rawHandler = handlers[envelope.type];
    if (!rawHandler) return false;

    const handler = rawHandler as unknown as (
      payload: unknown,
      sender: chrome.runtime.MessageSender
    ) => Promise<unknown> | unknown;

    Promise.resolve()
      .then(() => handler(envelope.payload, sender))
      .then((data) => sendResponse({ requestId: envelope.requestId, success: true, data }))
      .catch((err: unknown) =>
        sendResponse({
          requestId: envelope.requestId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        })
      );

    return true;
  });
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}