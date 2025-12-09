import {
  deleteBeforeCursor,
  insertPasteAtCursor,
  insertTextAtCursor,
  moveCursorLeft,
  moveCursorRight,
  removeCurrentLargePasteSegment,
} from "./inputReducer.js";
import { type ChatInputSegment, type ChatUserInputState } from "./types.js";

function createChatUserInputState(
  segments: ChatInputSegment[],
  cursorOnSegmentIndex: number,
  cursorInSegmentOffset: number,
): ChatUserInputState {
  return {
    segments,
    cursorOnSegmentIndex,
    cursorInSegmentOffset,
  };
}

describe("chatInputStateReducers", () => {
  describe("sanitize behavior via reducers", () => {
    it("ensures there is always at least one text segment", () => {
      const initialState: ChatUserInputState = createChatUserInputState([], 5, -1);

      const result = moveCursorLeft(initialState);

      expect(result.segments.length).toBe(1);
      expect(result.segments[0]).toEqual({ type: "text", content: "" });
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("merges consecutive text segments and keeps cursor position when cursor was on later segment", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "first" },
          { type: "text", content: "second" },
        ],
        0,
        5,
      );

      const result = moveCursorRight(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "firstsecond" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(5);
    });

    it("merges chains of text segments and repositions cursor when it was on the final segment", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "first" },
          { type: "text", content: "second" },
          { type: "text", content: "third" },
        ],
        2,
        1,
      );

      const result = moveCursorLeft(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "firstsecondthird" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(11);
    });
  });

  describe("removeCurrentLargePasteSegment", () => {
    it("removes current largePaste between text segments and moves cursor to previous segment", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "before" },
          { type: "largePaste", content: "pasted" },
          { type: "text", content: "-after" },
        ],
        1,
        0,
      );

      const result = removeCurrentLargePasteSegment(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "before-after" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("replaces sole largePaste segment with empty text segment", () => {
      const initialState = createChatUserInputState(
        [{ type: "largePaste", content: "pasted" }],
        0,
        0,
      );

      const result = removeCurrentLargePasteSegment(initialState);

      expect(result.segments.length).toBe(1);
      expect(result.segments[0]).toEqual({ type: "text", content: "" });
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("does nothing when current segment is not largePaste", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "before" },
          { type: "largePaste", content: "pasted" },
          { type: "text", content: "-after" },
        ],
        0,
        3,
      );

      const result = removeCurrentLargePasteSegment(initialState);

      expect(result.segments).toEqual(initialState.segments);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(3);
    });
  });

  describe("deleteBeforeCursor (legacy tests)", () => {
    it("deletes character within a text segment", () => {
      const initialState = createChatUserInputState([{ type: "text", content: "abcd" }], 0, 2);

      const result = deleteBeforeCursor(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "acd" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(1);
    });

    it("does nothing at start of first text segment", () => {
      const initialState = createChatUserInputState([{ type: "text", content: "abcd" }], 0, 0);

      const result = deleteBeforeCursor(initialState);

      expect(result.segments).toEqual(initialState.segments);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("merges with previous text segment when deleting at segment start", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "hello" },
          { type: "text", content: "world" },
        ],
        1,
        0,
      );

      const result = deleteBeforeCursor(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "hellworld" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(4);
    });

    it("removes previous largePaste segment when deleting at start of text segment", () => {
      const initialState = createChatUserInputState(
        [
          { type: "largePaste", content: "pasted" },
          { type: "text", content: "text" },
        ],
        1,
        0,
      );

      const result = deleteBeforeCursor(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "text" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });
  });

  describe("deleteBeforeCursor", () => {
    it("deletes previous largePaste when cursor is at start of largePaste (offset 0)", () => {
      const initialState = createChatUserInputState(
        [
          { type: "largePaste", content: "paste1" },
          { type: "largePaste", content: "paste2" },
          { type: "text", content: "text" },
        ],
        1,
        0,
      );

      const result = deleteBeforeCursor(initialState);

      expect(result.segments).toEqual([
        { type: "largePaste", content: "paste2" },
        { type: "text", content: "text" },
      ]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("deletes current largePaste when cursor is inside largePaste (offset > 0)", () => {
      const initialState = createChatUserInputState(
        [
          { type: "largePaste", content: "paste1" },
          { type: "largePaste", content: "paste2" },
          { type: "text", content: "text" },
        ],
        1,
        1,
      );

      const result = deleteBeforeCursor(initialState);

      expect(result.segments).toEqual([
        { type: "largePaste", content: "paste1" },
        { type: "text", content: "text" },
      ]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("deletes last character of previous text when cursor is at start of largePaste", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "before" },
          { type: "largePaste", content: "pasted" },
          { type: "text", content: "after" },
        ],
        1,
        0,
      );

      const result = deleteBeforeCursor(initialState);

      expect(result.segments).toEqual([
        { type: "text", content: "befor" },
        { type: "largePaste", content: "pasted" },
        { type: "text", content: "after" },
      ]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(5);
    });

    it("deletes empty previous text segment when cursor is at start of largePaste", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "" },
          { type: "largePaste", content: "pasted" },
          { type: "text", content: "after" },
        ],
        1,
        0,
      );

      const result = deleteBeforeCursor(initialState);

      expect(result.segments).toEqual([
        { type: "largePaste", content: "pasted" },
        { type: "text", content: "after" },
      ]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("deletes last character of single-character previous text at start of largePaste", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "a" },
          { type: "largePaste", content: "pasted" },
        ],
        1,
        0,
      );

      const result = deleteBeforeCursor(initialState);

      expect(result.segments).toEqual([{ type: "largePaste", content: "pasted" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("does nothing when cursor is at very start (segment 0, offset 0)", () => {
      const initialState = createChatUserInputState(
        [
          { type: "largePaste", content: "paste1" },
          { type: "text", content: "text" },
        ],
        0,
        0,
      );

      const result = deleteBeforeCursor(initialState);

      expect(result.segments).toEqual([
        { type: "largePaste", content: "paste1" },
        { type: "text", content: "text" },
      ]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });
  });

  describe("moveCursorLeft", () => {
    it("moves left within a text segment", () => {
      const initialState = createChatUserInputState([{ type: "text", content: "abcd" }], 0, 3);

      const result = moveCursorLeft(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(2);
    });

    it("moves from start of text segment to previous text segment end", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "first" },
          { type: "text", content: "second" },
        ],
        1,
        0,
      );

      const result = moveCursorLeft(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(4);
    });

    it("moves from start of text segment to previous largePaste segment", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "first" },
          { type: "largePaste", content: "pasted" },
          { type: "text", content: "third" },
        ],
        2,
        0,
      );

      const result = moveCursorLeft(initialState);

      expect(result.cursorOnSegmentIndex).toBe(1);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("moves to previous largePaste segment when current segment is largePaste with offset at start", () => {
      const initialState = createChatUserInputState(
        [
          { type: "largePaste", content: "first" },
          { type: "largePaste", content: "second" },
          { type: "text", content: "tail" },
        ],
        1,
        0,
      );

      const result = moveCursorLeft(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("moves from start of largePaste to end of previous text segment", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "hello" },
          { type: "largePaste", content: "pasted" },
          { type: "text", content: "tail" },
        ],
        1,
        0,
      );

      const result = moveCursorLeft(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(4);
    });

    it("moves to start of current largePaste segment when cursor offset is greater than zero", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "text" },
          { type: "largePaste", content: "pasted" },
        ],
        1,
        1,
      );

      const result = moveCursorLeft(initialState);

      expect(result.cursorOnSegmentIndex).toBe(1);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("does nothing when at first largePaste segment and moving left", () => {
      const initialState = createChatUserInputState(
        [
          { type: "largePaste", content: "pasted" },
          { type: "text", content: "tail" },
        ],
        0,
        0,
      );

      const result = moveCursorLeft(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });
  });

  describe("moveCursorRight", () => {
    it("moves right within a text segment", () => {
      const initialState = createChatUserInputState([{ type: "text", content: "abcd" }], 0, 1);

      const result = moveCursorRight(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(2);
    });

    it("moves from end of text segment to next text segment at start", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "first" },
          { type: "text", content: "second" },
        ],
        0,
        5,
      );

      const result = moveCursorRight(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(5);
    });

    it("skips over a single largePaste segment when moving right from text", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "A" },
          { type: "largePaste", content: "P1" },
          { type: "text", content: "B" },
        ],
        0,
        1,
      );

      const result = moveCursorRight(initialState);

      expect(result.cursorOnSegmentIndex).toBe(2);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("skips over first largePaste in TEXT PASTE PASTE pattern when moving right", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "A" },
          { type: "largePaste", content: "P1" },
          { type: "largePaste", content: "P2" },
        ],
        0,
        1,
      );

      const result = moveCursorRight(initialState);

      expect(result.cursorOnSegmentIndex).toBe(2);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("moves from largePaste to next text segment", () => {
      const initialState = createChatUserInputState(
        [
          { type: "largePaste", content: "P1" },
          { type: "text", content: "tail" },
        ],
        0,
        0,
      );

      const result = moveCursorRight(initialState);

      expect(result.cursorOnSegmentIndex).toBe(1);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("moves from one largePaste to the next largePaste in sequence", () => {
      const initialState = createChatUserInputState(
        [
          { type: "largePaste", content: "P1" },
          { type: "largePaste", content: "P2" },
          { type: "text", content: "tail" },
        ],
        0,
        0,
      );

      const result = moveCursorRight(initialState);

      expect(result.cursorOnSegmentIndex).toBe(1);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("preserves all segments when moving right between back-to-back largePaste segments", () => {
      const initialState = createChatUserInputState(
        [
          { type: "largePaste", content: "Paste1" },
          { type: "largePaste", content: "Paste2" },
          { type: "largePaste", content: "Paste3" },
          { type: "text", content: "trailing" },
        ],
        0,
        0,
      );

      const result = moveCursorRight(initialState);

      expect(result.segments.length).toBe(4);
      expect(result.segments[0]).toEqual({ type: "largePaste", content: "Paste1" });
      expect(result.segments[1]).toEqual({ type: "largePaste", content: "Paste2" });
      expect(result.segments[2]).toEqual({ type: "largePaste", content: "Paste3" });
      expect(result.segments[3]).toEqual({ type: "text", content: "trailing" });
      expect(result.cursorOnSegmentIndex).toBe(1);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("does nothing when moving right from last largePaste segment", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "head" },
          { type: "largePaste", content: "P1" },
        ],
        1,
        0,
      );

      const result = moveCursorRight(initialState);

      expect(result.cursorOnSegmentIndex).toBe(1);
      expect(result.cursorInSegmentOffset).toBe(0);
    });
  });

  describe("insertTextAtCursor", () => {
    it("inserts text into a text segment at cursor position", () => {
      const initialState = createChatUserInputState([{ type: "text", content: "abcd" }], 0, 2);

      const result = insertTextAtCursor({
        state: initialState,
        text: "XX",
      });

      expect(result.segments).toEqual([{ type: "text", content: "abXXcd" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(4);
    });

    it("creates a new text segment before a leading largePaste when there is no previous text", () => {
      const initialState = createChatUserInputState(
        [{ type: "largePaste", content: "pasted" }],
        0,
        0,
      );

      const result = insertTextAtCursor({
        state: initialState,
        text: "typed",
      });

      expect(result.segments).toEqual([
        { type: "text", content: "typed" },
        { type: "largePaste", content: "pasted" },
      ]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(5);
    });

    it("appends to previous text segment when inserting at start of largePaste with preceding text", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "before" },
          { type: "largePaste", content: "pasted" },
        ],
        1,
        0,
      );

      const result = insertTextAtCursor({
        state: initialState,
        text: "X",
      });

      expect(result.segments).toEqual([
        { type: "text", content: "beforeX" },
        { type: "largePaste", content: "pasted" },
      ]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(7);
    });

    it("creates a new text segment after a largePaste when inserting with non-zero offset inside largePaste", () => {
      const initialState = createChatUserInputState(
        [{ type: "largePaste", content: "pasted" }],
        0,
        3,
      );

      const result = insertTextAtCursor({
        state: initialState,
        text: "typed",
      });

      expect(result.segments).toEqual([
        { type: "largePaste", content: "pasted" },
        { type: "text", content: "typed" },
      ]);
      expect(result.cursorOnSegmentIndex).toBe(1);
      expect(result.cursorInSegmentOffset).toBe(5);
    });
  });

  describe("insertPasteAtCursor", () => {
    const largePasteThreshold = 5;

    it("does nothing when paste content is empty", () => {
      const initialState = createChatUserInputState([{ type: "text", content: "text" }], 0, 2);

      const result = insertPasteAtCursor({
        state: initialState,
        content: "",
        largePasteThreshold,
      });

      expect(result).toEqual(initialState);
    });

    it("pastes small content into a text segment at cursor", () => {
      const initialState = createChatUserInputState([{ type: "text", content: "hello" }], 0, 5);

      const result = insertPasteAtCursor({
        state: initialState,
        content: " xyz",
        largePasteThreshold,
      });

      expect(result.segments).toEqual([{ type: "text", content: "hello xyz" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(9);
    });

    it("splits text segment and inserts largePaste while preserving text after cursor", () => {
      const initialState = createChatUserInputState(
        [{ type: "text", content: "before-after" }],
        0,
        6,
      );

      const result = insertPasteAtCursor({
        state: initialState,
        content: "PASTE_CONTENT",
        largePasteThreshold,
      });

      expect(result.segments.length).toBe(3);
      expect(result.segments[0]).toEqual({ type: "text", content: "before" });
      expect(result.segments[1]).toEqual({ type: "largePaste", content: "PASTE_CONTENT" });
      expect(result.segments[2]).toEqual({ type: "text", content: "-after" });
      expect(result.cursorOnSegmentIndex).toBe(2);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("inserts small paste as text segment before current largePaste when cursor is at start", () => {
      const initialState = createChatUserInputState(
        [{ type: "largePaste", content: "existing" }],
        0,
        0,
      );

      const result = insertPasteAtCursor({
        state: initialState,
        content: "txt",
        largePasteThreshold,
      });

      expect(result.segments).toEqual([
        { type: "text", content: "txt" },
        { type: "largePaste", content: "existing" },
      ]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(3);
    });

    it("inserts large paste as largePaste segment after current largePaste when cursor offset is non-zero", () => {
      const initialState = createChatUserInputState(
        [{ type: "largePaste", content: "existing" }],
        0,
        2,
      );

      const result = insertPasteAtCursor({
        state: initialState,
        content: "BIG_PASTE",
        largePasteThreshold,
      });

      expect(result.segments).toEqual([
        { type: "largePaste", content: "existing" },
        { type: "largePaste", content: "BIG_PASTE" },
      ]);
      expect(result.cursorOnSegmentIndex).toBe(1);
      expect(result.cursorInSegmentOffset).toBe(9);
    });

    it("inserts large paste before trailing text without dropping it in TEXT PASTE PASTE TEXT pattern", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "T1" },
          { type: "largePaste", content: "P1" },
          { type: "largePaste", content: "P2" },
          { type: "text", content: "T2" },
        ],
        3,
        0,
      );

      const result = insertPasteAtCursor({
        state: initialState,
        content: "BIG_PASTE",
        largePasteThreshold: 5,
      });

      expect(result.segments).toEqual([
        { type: "text", content: "T1" },
        { type: "largePaste", content: "P1" },
        { type: "largePaste", content: "P2" },
        { type: "largePaste", content: "BIG_PASTE" },
        { type: "text", content: "T2" },
      ]);
      expect(result.cursorOnSegmentIndex).toBe(4);
      expect(result.cursorInSegmentOffset).toBe(0);
    });
  });
