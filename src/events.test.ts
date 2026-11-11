import { describe, expect, it, vi } from "vitest";
import { registerListeners } from "./events";

describe("asynchronous event registration", () => {
  it("unsubscribes listeners that registered before cleanup exactly once", async () => {
    const unlisten = vi.fn();
    const dispose = registerListeners([Promise.resolve(unlisten)], vi.fn());
    await Promise.resolve();
    dispose();
    dispose();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("unsubscribes a listener that finishes registering after cleanup", async () => {
    let resolve!: (unlisten: () => void) => void;
    const registration = new Promise<() => void>((done) => { resolve = done; });
    const dispose = registerListeners([registration], vi.fn());
    dispose();
    const unlisten = vi.fn();
    resolve(unlisten);
    await registration;
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("reports registration errors while keeping successful listeners disposable", async () => {
    const onError = vi.fn();
    const unlisten = vi.fn();
    const error = new Error("Cannot listen");
    const dispose = registerListeners([Promise.reject(error), Promise.resolve(unlisten)], onError);
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(error);
    dispose();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("ignores late registration errors after cleanup", async () => {
    const onError = vi.fn();
    registerListeners([Promise.reject(new Error("Cannot listen"))], onError)();
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
  });
});
