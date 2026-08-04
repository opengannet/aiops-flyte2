import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeysPage } from "./Page";

vi.mock("@/components/Header", () => ({ Header: () => <div /> }));
vi.mock("@/components/NavPanel/NavPanelLayout", () => ({
  NavPanelLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

describe("ApiKeysPage", () => {
  beforeEach(() => {
    window.history.pushState(
      {},
      "",
      "/v2/domain/development/project/aione/api-keys",
    );
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("submits only the model to the console API and shows the created key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: 200,
          data: "sk-created-key",
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ApiKeysPage />);

    await userEvent.type(
      screen.getByLabelText("模型标识"),
      "sakamakismile/Qwen3.6-27B-NVFP4",
    );
    expect(screen.queryByLabelText("第三方 API Key")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New API 凭证")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "创建密钥" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/v2/api/aione/apikey/sakamakismile/Qwen3.6-27B-NVFP4",
      {
        method: "POST",
      },
    );
    expect(await screen.findByText("sk-c*********key")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "显示密钥" }));
    expect(screen.getByText("sk-created-key")).toBeVisible();
  });

  it("shows a copy error when the clipboard write fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: 200,
          data: "sk-created-key",
        }),
    }));
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      },
    });

    render(<ApiKeysPage />);

    await userEvent.type(screen.getByLabelText("模型标识"), "model-a");
    await userEvent.click(screen.getByRole("button", { name: "创建密钥" }));
    await userEvent.click(await screen.findByRole("button", { name: "复制密钥" }));

    expect(await screen.findByText("复制密钥失败")).toBeVisible();
  });
});
