// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { showMutationErrorToast } from "@/lib/mutation-errors";
import { InterfaceLanguageProvider } from "@/lib/interface-language";
import { OwnerSessionSettingsSection } from "./OwnerSessionSettingsSection";

vi.mock("@/lib/sdk", () => ({
  sdk: { experimental_ownerAuth: { status: vi.fn(), logout: vi.fn() } },
}));
vi.mock("@/lib/mutation-errors", () => ({ showMutationErrorToast: vi.fn() }));

afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

describe("owner session settings", () => {
  it.each([
    { enabled: false, authenticated: false },
    { enabled: true, authenticated: false },
  ])(
    "hides the section without an authenticated owner session",
    async (status) => {
      vi.mocked(sdk.experimental_ownerAuth.status).mockResolvedValue(status);
      const { container } = render(<OwnerSessionSettingsSection />);
      await waitFor(() =>
        expect(sdk.experimental_ownerAuth.status).toHaveBeenCalled(),
      );
      expect(container.textContent).toBe("");
    },
  );

  it("hides the section when an older server has no status endpoint", async () => {
    vi.mocked(sdk.experimental_ownerAuth.status).mockRejectedValue(
      new Error("404"),
    );
    const { container } = render(<OwnerSessionSettingsSection />);
    await waitFor(() =>
      expect(sdk.experimental_ownerAuth.status).toHaveBeenCalled(),
    );
    expect(container.textContent).toBe("");
  });

  it("allows retrying after logout fails and translates the control", async () => {
    const error = new Error("offline");
    vi.mocked(sdk.experimental_ownerAuth.status).mockResolvedValue({
      enabled: true,
      authenticated: true,
    });
    vi.mocked(sdk.experimental_ownerAuth.logout).mockRejectedValue(error);
    render(
      <InterfaceLanguageProvider preference="ru">
        <OwnerSessionSettingsSection />
      </InterfaceLanguageProvider>,
    );
    const button = await screen.findByRole("button", { name: "Выйти" });
    fireEvent.click(button);
    await waitFor(() =>
      expect(showMutationErrorToast).toHaveBeenCalledWith({
        error,
        fallbackMessage: "Не удалось выйти",
      }),
    );
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    await waitFor(() =>
      expect(sdk.experimental_ownerAuth.logout).toHaveBeenCalledTimes(2),
    );
  });
});
