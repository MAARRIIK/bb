import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { CONTROL_HOVER_TRANSITION } from "@/components/ui/motion";
import { CompactLongPressMenu } from "@/components/ui/compact-long-press-menu";
import type { InternalComposerInputSlots } from "./core-input-slots";
import {
  experimental_useComposerContributions as useComposerContributions,
  type ExperimentalComposerAction,
} from "@get-bb/plugin-sdk/app";

const MODIFIER_LABELS: Record<ExperimentalComposerAction["kind"], string> = {
  send: "Send",
  queue: "Queue",
  steer: "Steer",
};

export function ComposerSendMenu({
  children,
  isPointerCoarse,
  modifierKind,
  hasInput,
  canSubmit,
  onSubmit,
  queueWithModelAction,
  showContributions = true,
}: {
  children: ReactNode;
  isPointerCoarse: boolean;
  modifierKind: ExperimentalComposerAction["kind"] | null;
  hasInput: boolean;
  canSubmit: boolean;
  onSubmit: (() => void) | undefined;
  queueWithModelAction?: InternalComposerInputSlots["internal_DO_NOT_USE_queueWithModelAction"];
  showContributions?: boolean;
}) {
  const isCompactViewport = useIsCompactViewport();
  const { sendMenuItems: contributions, MenuEntry } =
    useComposerContributions();
  const [open, setOpen] = useState(false);
  const queue = modifierKind === "queue";
  const canOpen = canSubmit || queueWithModelAction !== undefined;
  const showArrow = hasInput || queueWithModelAction !== undefined;

  useEffect(() => {
    if (!canOpen) setOpen(false);
  }, [canOpen]);
  const handleOpenChange = (nextOpen: boolean) => setOpen(nextOpen && canOpen);

  if (
    !onSubmit &&
    (!showContributions || contributions.length === 0) &&
    !queueWithModelAction
  )
    return children;

  const items = (
    <>
      {onSubmit ? (
        <DropdownMenuItem disabled={!canSubmit} onSelect={onSubmit}>
          <Icon
            name={queue ? "ListEnd" : "CornerDownRight"}
            className={cn("size-4", queue && "-scale-x-100")}
          />
          {MODIFIER_LABELS[modifierKind ?? "steer"]}
        </DropdownMenuItem>
      ) : null}
      {queueWithModelAction ? (
        <DropdownMenuItem
          disabled={queueWithModelAction.disabled}
          onSelect={queueWithModelAction.run}
        >
          <Icon name="ListEnd" className="size-4 shrink-0 -scale-x-100" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span>{queueWithModelAction.label}</span>
            <span className="text-xs text-muted-foreground">
              {queueWithModelAction.description}
            </span>
          </span>
        </DropdownMenuItem>
      ) : null}
      {canSubmit && showContributions
        ? contributions.map((contribution) => (
            <MenuEntry
              key={contribution.key}
              kind="send"
              contribution={contribution}
            />
          ))
        : null}
    </>
  );

  if (isPointerCoarse && isCompactViewport && !queueWithModelAction) {
    if (!canSubmit) return children;
    return (
      <CompactLongPressMenu
        label="Send options"
        onOpenChange={handleOpenChange}
        items={items}
      >
        <span
          className="inline-flex"
          onPointerUpCapture={(event) => {
            if (!open) return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {children}
        </span>
      </CompactLongPressMenu>
    );
  }

  return (
    <div
      data-promptbox-send-menu=""
      className={cn(
        "group/send ml-1 inline-flex items-center rounded-md [&_[data-promptbox-submit-action]]:ml-0",
        CONTROL_HOVER_TRANSITION,
        "bg-foreground text-background [&_button]:!bg-transparent [&_button]:!text-inherit [&_button]:!opacity-100",
        showArrow && "[&_[data-promptbox-submit-action]]:rounded-r-none",
        canOpen
          ? "[&_button:hover]:!bg-background/15 [&_button[data-state=open]]:!bg-background/15"
          : "opacity-50",
        queueWithModelAction && !canSubmit && "[&_button:disabled]:!opacity-50",
      )}
    >
      {children}
      <DropdownMenu open={open && canOpen} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label="Send options"
            disabled={!canOpen}
            aria-hidden={showArrow ? undefined : true}
            className={cn(
              "min-w-0 overflow-hidden rounded-l-none px-0 transition-[width] duration-150 ease-out motion-reduce:transition-none",
              showArrow ? "w-6" : "w-0",
            )}
          >
            <Icon
              name="ChevronDown"
              className="opacity-50 transition-opacity duration-150 group-hover/send:opacity-100 group-focus-within/send:opacity-100 motion-reduce:transition-none"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" mobileTitle="Send options">
          {items}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
