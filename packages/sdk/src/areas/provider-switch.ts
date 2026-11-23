import type {
  ProviderSwitchCommitRequest,
  ProviderSwitchOperationRequest,
  ProviderSwitchPreviewRequest,
  ProviderSwitchPreview,
  ProviderSwitchReceipt,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";
export type {
  ProviderSwitchPreview,
  ProviderSwitchPreviewRequest,
  ProviderSwitchReceipt,
} from "@bb/server-contract";

type Target = { threadId: string; signal?: AbortSignal };
export type ExperimentalProviderSwitchPreviewArgs = Target &
  ProviderSwitchPreviewRequest;
export type ExperimentalProviderSwitchCommitArgs = Target &
  ProviderSwitchCommitRequest;
export type ExperimentalProviderSwitchOperationArgs = Target &
  ProviderSwitchOperationRequest;

export interface ExperimentalProviderSwitchArea {
  preview(
    args: ExperimentalProviderSwitchPreviewArgs,
  ): Promise<ProviderSwitchPreview>;
  commit(
    args: ExperimentalProviderSwitchCommitArgs,
  ): Promise<ProviderSwitchReceipt>;
  get(
    args: ExperimentalProviderSwitchOperationArgs,
  ): Promise<ProviderSwitchReceipt>;
  recover(
    args: ExperimentalProviderSwitchOperationArgs,
  ): Promise<ProviderSwitchReceipt>;
}

export function createProviderSwitchArea({
  transport,
}: CreateSdkAreaArgs): ExperimentalProviderSwitchArea {
  return {
    preview({ threadId, signal, ...json }) {
      return transport.readJson(
        transport.api.v1.threads[":id"]["provider-switch"].preview.$post(
          { param: { id: threadId }, json },
          ...signalRequestArgs(signal),
        ),
      );
    },
    commit({ threadId, signal, ...json }) {
      return transport.readJson(
        transport.api.v1.threads[":id"]["provider-switch"].$post(
          { param: { id: threadId }, json },
          ...signalRequestArgs(signal),
        ),
      );
    },
    get({ threadId, signal, operationId }) {
      return transport.readJson(
        transport.api.v1.threads[":id"]["provider-switch"].$get(
          { param: { id: threadId }, query: { operationId } },
          ...signalRequestArgs(signal),
        ),
      );
    },
    recover({ threadId, signal, operationId }) {
      return transport.readJson(
        transport.api.v1.threads[":id"]["provider-switch"].recover.$post(
          { param: { id: threadId }, json: { operationId } },
          ...signalRequestArgs(signal),
        ),
      );
    },
  };
}
