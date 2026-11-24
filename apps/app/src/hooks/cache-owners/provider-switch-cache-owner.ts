import type { QueryClient } from "@tanstack/react-query";
import type { ProviderSwitchReceipt } from "@bb/server-contract";
import {
  providerSwitchOperationIdQueryKey,
  providerSwitchReceiptQueryKey,
  threadDefaultExecutionOptionsQueryKey,
  threadQueryKey,
} from "../queries/query-keys";

export function cacheProviderSwitchOperationId(
  queryClient: QueryClient,
  threadId: string,
  operationId: string | null,
): void {
  queryClient.setQueryData(
    providerSwitchOperationIdQueryKey(threadId),
    operationId,
  );
}

export function ingestProviderSwitchReceipt(
  queryClient: QueryClient,
  threadId: string,
  operationId: string,
  receipt: ProviderSwitchReceipt,
): void {
  queryClient.setQueryData(
    providerSwitchReceiptQueryKey(threadId, operationId),
    receipt,
  );
  void queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) });
  void queryClient.invalidateQueries({
    queryKey: threadDefaultExecutionOptionsQueryKey(threadId),
  });
}

export function invalidateProviderSwitchReceipt(
  queryClient: QueryClient,
  threadId: string,
  operationId: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: providerSwitchReceiptQueryKey(threadId, operationId),
  });
}
