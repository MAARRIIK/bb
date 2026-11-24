import type { Environment, ResolvedThreadExecutionOptions } from "@bb/domain";
import {
  providerServiceTierOptions,
  resolvedThreadExecutionOptionsSchema,
} from "@bb/domain";
import type { ProviderSwitchPreviewRequest } from "@bb/server-contract";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { clampPermissionModeToHost } from "../hosts/permission-ceiling.js";
import { resolveSystemExecutionOptionsForValidation } from "../system/execution-options.js";
import { resolveCreateThreadExecutionDefaults } from "./thread-default-policy.js";

export async function resolveProviderTargetExecution(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: {
    environment: Pick<Environment, "id" | "hostId">;
    request: Pick<
      ProviderSwitchPreviewRequest,
      | "providerId"
      | "model"
      | "permissionMode"
      | "reasoningLevel"
      | "serviceTier"
    >;
  },
) {
  const { request } = args;
  await deps.providerRegistry.whenRegistrationsSettled();
  resolveCreateThreadExecutionDefaults(deps.providerRegistry, {
    requestedProviderId: request.providerId,
    storedDefaults: null,
  });
  const catalog = await resolveSystemExecutionOptionsForValidation(
    deps,
    { environmentId: args.environment.id, providerId: request.providerId },
    request.model,
  );
  if (catalog.modelLoadError !== null)
    throw new ApiError(
      503,
      "model_catalog_unavailable",
      "The target model catalog could not be checked. Reconnect the executor and try again.",
      true,
    );
  const model = [...catalog.models, ...catalog.selectedOnlyModels].find(
    (entry) => entry.model === request.model,
  );
  if (!model)
    throw new ApiError(
      400,
      "invalid_request",
      "The chosen model is not in the target provider catalog",
    );
  const registration = deps.providerRegistry.get(request.providerId);
  if (
    !registration ||
    !registration.info.available ||
    deps.providerRegistry.disabledProviderIds().has(request.providerId)
  )
    throw new ApiError(
      409,
      "provider_unavailable",
      "The target provider is unavailable",
    );
  if (
    !registration.info.capabilities.permissionModes.includes(
      request.permissionMode,
    )
  )
    throw new ApiError(
      400,
      "invalid_request",
      `The target provider requires one of these permission modes: ${registration.info.capabilities.permissionModes.join(", ")}`,
    );
  if (
    clampPermissionModeToHost(deps, {
      hostId: args.environment.hostId,
      providerId: request.providerId,
      permissionMode: request.permissionMode,
    }) !== request.permissionMode
  )
    throw new ApiError(
      409,
      "host_permission_ceiling_conflict",
      "The selected permission mode exceeds this machine's limit",
    );
  const reasoningLevel = request.reasoningLevel ?? model.defaultReasoningEffort;
  if (
    model.supportedReasoningEfforts.length > 0 &&
    !model.supportedReasoningEfforts.some(
      (effort) => effort.reasoningEffort === reasoningLevel,
    )
  )
    throw new ApiError(
      400,
      "invalid_request",
      "The target model does not support the selected reasoning level",
    );
  const tiers =
    model.supportedServiceTiers ??
    providerServiceTierOptions(registration.info);
  if (
    request.serviceTier !== "default" &&
    (!registration.info.capabilities.supportsServiceTier ||
      !tiers.some((tier) => tier.id === request.serviceTier))
  )
    throw new ApiError(
      400,
      "invalid_request",
      "The target model does not support the selected service tier",
    );
  const execution: ResolvedThreadExecutionOptions =
    resolvedThreadExecutionOptionsSchema.parse({
      model: request.model,
      reasoningLevel,
      permissionMode: request.permissionMode,
      serviceTier: request.serviceTier,
      source: "client/turn/requested",
    });
  return { execution, model };
}
