import { describe, it, expect, beforeEach } from "vitest";
import { useStatusStore } from "../status.store";
import type { StatusLevel } from "../../types/status-types";

describe("StatusStore", () => {
  beforeEach(() => {
    // Reset store between tests
    useStatusStore.setState({ messages: [] });
  });

  describe("addMessage", () => {
    it("should add a message with default level (info) and no source", () => {
      useStatusStore.getState().addMessage("Test message");
      const { messages } = useStatusStore.getState();
      expect(messages).toHaveLength(1);
      expect(messages[0].text).toBe("Test message");
      expect(messages[0].level).toBe("info");
      expect(messages[0].source).toBeUndefined();
      expect(messages[0].id).toBeTruthy();
      expect(messages[0].timestamp).toBeGreaterThan(0);
    });

    it("should add a message with custom level", () => {
      useStatusStore.getState().addMessage("Warning!", "warn", "Test");
      const { messages } = useStatusStore.getState();
      expect(messages[0].level).toBe("warn");
      expect(messages[0].source).toBe("Test");
    });

    it("should add a message with source", () => {
      useStatusStore.getState().addMessage("Scan done", "success", "Local Scan");
      const { messages } = useStatusStore.getState();
      expect(messages[0].source).toBe("Local Scan");
    });

    it("should generate unique IDs for each message", () => {
      useStatusStore.getState().addMessage("First");
      useStatusStore.getState().addMessage("Second");
      const { messages } = useStatusStore.getState();
      expect(messages[0].id).not.toBe(messages[1].id);
    });
  });

  describe("message ordering", () => {
    it("should keep messages in chronological order", () => {
      useStatusStore.getState().addMessage("First");
      useStatusStore.getState().addMessage("Second");
      useStatusStore.getState().addMessage("Third");
      const { messages } = useStatusStore.getState();
      expect(messages).toHaveLength(3);
      expect(messages[0].text).toBe("First");
      expect(messages[1].text).toBe("Second");
      expect(messages[2].text).toBe("Third");
    });
  });

  describe("max messages limit", () => {
    it("should cap at MAX_MESSAGES (200)", () => {
      const store = useStatusStore.getState();
      for (let i = 0; i < 250; i++) {
        store.addMessage(`Message ${i}`);
      }
      const { messages } = useStatusStore.getState();
      expect(messages.length).toBeLessThanOrEqual(200);
      // Should keep the most recent messages
      expect(messages[messages.length - 1].text).toBe("Message 249");
    });
  });

  describe("clearMessages", () => {
    it("should remove all messages", () => {
      useStatusStore.getState().addMessage("One");
      useStatusStore.getState().addMessage("Two");
      expect(useStatusStore.getState().messages).toHaveLength(2);

      useStatusStore.getState().clearMessages();
      expect(useStatusStore.getState().messages).toHaveLength(0);
    });
  });

  describe("removeMessage", () => {
    it("should remove a specific message by id", () => {
      useStatusStore.getState().addMessage("Keep me");
      useStatusStore.getState().addMessage("Remove me");
      const messages = useStatusStore.getState().messages;
      const removeId = messages[1].id;

      useStatusStore.getState().removeMessage(removeId);
      const remaining = useStatusStore.getState().messages;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].text).toBe("Keep me");
    });
  });

  describe("all levels", () => {
    const levels: StatusLevel[] = ["info", "success", "warn", "danger"];

    levels.forEach((level) => {
      it(`should accept ${level} level`, () => {
        useStatusStore.getState().addMessage(`Level ${level}`, level);
        const { messages } = useStatusStore.getState();
        expect(messages[0].level).toBe(level);
      });
    });
  });

  describe("addMessage from non-React context (getState pattern)", () => {
    it("should work via getState (as used in local-indexer.ts)", () => {
      // This is exactly how the indexer calls it
      useStatusStore.getState().addMessage(
        "Indexing Test Artist – Test Album image…",
        "info",
        "Local Scan",
      );
      useStatusStore.getState().addMessage(
        "Local library indexed: 42 songs",
        "success",
      );

      const { messages } = useStatusStore.getState();
      expect(messages).toHaveLength(2);
      expect(messages[0].text).toMatch(/Indexing.*image/);
      expect(messages[0].source).toBe("Local Scan");
      expect(messages[1].text).toMatch(/indexed: 42 songs/);
      expect(messages[1].level).toBe("success");
    });
  });
});
