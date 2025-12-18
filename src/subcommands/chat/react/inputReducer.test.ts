import {
  deleteAfterCursor,
  deleteBeforeCursor,
  deleteWordBackward,
  deleteWordForward,
  insertPasteAtCursor,
  insertSuggestionAtCursor,
  insertTextAtCursor,
  moveCursorLeft,
  moveCursorRight,
  moveCursorToLineEnd,
  moveCursorToLineStart,
  moveCursorWordLeft,
  moveCursorWordRight,
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

  describe("deleteBeforeCursor", () => {
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

    it("deletes text characters then largePaste when pressing backspace thrice in abc[Paste]bb{cursor}[Paste] pattern", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "abc" },
          { type: "largePaste", content: "pasted1" },
          { type: "text", content: "bb" },
          { type: "largePaste", content: "pasted2" },
        ],
        2,
        2,
      );

      // First backspace: deletes 'b' from "bb"
      const afterFirstBackspace = deleteBeforeCursor(initialState);
      expect(afterFirstBackspace.segments).toEqual([
        { type: "text", content: "abc" },
        { type: "largePaste", content: "pasted1" },
        { type: "text", content: "b" },
        { type: "largePaste", content: "pasted2" },
      ]);
      expect(afterFirstBackspace.cursorOnSegmentIndex).toBe(2);
      expect(afterFirstBackspace.cursorInSegmentOffset).toBe(1);

      // Second backspace: deletes 'b' from "b"
      const afterSecondBackspace = deleteBeforeCursor(afterFirstBackspace);
      expect(afterSecondBackspace.segments).toEqual([
        { type: "text", content: "abc" },
        { type: "largePaste", content: "pasted1" },
        { type: "largePaste", content: "pasted2" },
      ]);
      expect(afterSecondBackspace.cursorOnSegmentIndex).toBe(2);
      expect(afterSecondBackspace.cursorInSegmentOffset).toBe(0);

      // Third backspace: deletes largePaste "pasted1"
      const afterThirdBackspace = deleteBeforeCursor(afterSecondBackspace);
      expect(afterThirdBackspace.segments).toEqual([
        { type: "text", content: "abc" },
        { type: "largePaste", content: "pasted2" },
      ]);
      expect(afterThirdBackspace.cursorOnSegmentIndex).toBe(0);
      expect(afterThirdBackspace.cursorInSegmentOffset).toBe(3);
    });
  });
  describe("deleteAfterCursor", () => {
    it("deletes character at cursor position within text segment", () => {
      const initialState = createChatUserInputState([{ type: "text", content: "hello" }], 0, 2);

      const result = deleteAfterCursor(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "helo" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(2);
    });

    it("does nothing at end of input when cursor is at end of last text segment", () => {
      const initialState = createChatUserInputState([{ type: "text", content: "hello" }], 0, 5);

      const result = deleteAfterCursor(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "hello" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(5);
    });

    it("merges next text segment when deleting at end of current text segment", () => {
      const initialState: ChatUserInputState = {
        segments: [
          { type: "text", content: "hello" },
          { type: "text", content: "world" },
        ],
        cursorOnSegmentIndex: 0,
        cursorInSegmentOffset: 5,
      };

      const result = deleteAfterCursor(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "helloorld" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(5);
    });

    it("deletes next largePaste segment when cursor is at end of text segment", () => {
      const initialState: ChatUserInputState = {
        segments: [
          { type: "text", content: "hello" },
          { type: "largePaste", content: "x".repeat(300) },
          { type: "text", content: "" },
        ],
        cursorOnSegmentIndex: 0,
        cursorInSegmentOffset: 5,
      };

      const result = deleteAfterCursor(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "hello" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(5);
    });

    it("deletes largePaste segment when cursor is on it at offset 0", () => {
      const initialState: ChatUserInputState = {
        segments: [
          { type: "text", content: "hello" },
          { type: "largePaste", content: "x".repeat(300) },
          { type: "text", content: "" },
        ],
        cursorOnSegmentIndex: 1,
        cursorInSegmentOffset: 0,
      };

      const result = deleteAfterCursor(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "hello" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(5);
    });

    it("does nothing when cursor is on largePaste with invalid offset greater than 0", () => {
      const initialState: ChatUserInputState = {
        segments: [
          { type: "text", content: "hello" },
          { type: "largePaste", content: "x".repeat(300) },
          { type: "text", content: "" },
        ],
        cursorOnSegmentIndex: 1,
        cursorInSegmentOffset: 5,
      };

      const result = deleteAfterCursor(initialState);

      expect(result.segments).toEqual([
        { type: "text", content: "hello" },
        { type: "largePaste", content: "x".repeat(300) },
        { type: "text", content: "" },
      ]);
      expect(result.cursorOnSegmentIndex).toBe(1);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("deletes first character of text segment when cursor is at start", () => {
      const initialState = createChatUserInputState([{ type: "text", content: "hello" }], 0, 0);

      const result = deleteAfterCursor(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "ello" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("deletes last character of text segment when cursor is before it", () => {
      const initialState = createChatUserInputState([{ type: "text", content: "hello" }], 0, 4);

      const result = deleteAfterCursor(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "hell" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(4);
    });

    it("deletes multiple characters in succession when called multiple times", () => {
      const initialState = createChatUserInputState([{ type: "text", content: "hello" }], 0, 1);

      const afterFirst = deleteAfterCursor(initialState);
      expect(afterFirst.segments).toEqual([{ type: "text", content: "hllo" }]);
      expect(afterFirst.cursorInSegmentOffset).toBe(1);

      const afterSecond = deleteAfterCursor(afterFirst);
      expect(afterSecond.segments).toEqual([{ type: "text", content: "hlo" }]);
      expect(afterSecond.cursorInSegmentOffset).toBe(1);

      const afterThird = deleteAfterCursor(afterSecond);
      expect(afterThird.segments).toEqual([{ type: "text", content: "ho" }]);
      expect(afterThird.cursorInSegmentOffset).toBe(1);
    });

    it("deletes first character of next segment at segment boundary", () => {
      const initialState: ChatUserInputState = {
        segments: [
          { type: "text", content: "abc" },
          { type: "text", content: "def" },
        ],
        cursorOnSegmentIndex: 0,
        cursorInSegmentOffset: 3,
      };

      const result = deleteAfterCursor(initialState);

      // Consecutive text segments are merged by sanitization
      expect(result.segments).toEqual([{ type: "text", content: "abcef" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(3);
    });

    it("deletes largePaste between two text segments", () => {
      const initialState: ChatUserInputState = {
        segments: [
          { type: "text", content: "before" },
          { type: "largePaste", content: "x".repeat(300) },
          { type: "text", content: "after" },
        ],
        cursorOnSegmentIndex: 0,
        cursorInSegmentOffset: 6,
      };

      const result = deleteAfterCursor(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "beforeafter" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(6);
    });

    it("deletes multiple largePaste segments in succession", () => {
      const initialState: ChatUserInputState = {
        segments: [
          { type: "text", content: "start" },
          { type: "largePaste", content: "x".repeat(300) },
          { type: "largePaste", content: "y".repeat(300) },
          { type: "text", content: "" },
        ],
        cursorOnSegmentIndex: 0,
        cursorInSegmentOffset: 5,
      };

      const afterFirst = deleteAfterCursor(initialState);
      expect(afterFirst.segments).toEqual([
        { type: "text", content: "start" },
        { type: "largePaste", content: "y".repeat(300) },
        { type: "text", content: "" },
      ]);

      const afterSecond = deleteAfterCursor(afterFirst);
      expect(afterSecond.segments).toEqual([{ type: "text", content: "start" }]);
    });

    it("handles empty text segment by deleting first char of next segment", () => {
      const initialState: ChatUserInputState = {
        segments: [
          { type: "text", content: "" },
          { type: "text", content: "hello" },
        ],
        cursorOnSegmentIndex: 0,
        cursorInSegmentOffset: 0,
      };

      const result = deleteAfterCursor(initialState);

      // Empty segment is removed by sanitization
      expect(result.segments).toEqual([{ type: "text", content: "ello" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("deletes trailing placeholder after deleting largePaste when cursor is on largePaste", () => {
      const initialState: ChatUserInputState = {
        segments: [
          { type: "text", content: "hello" },
          { type: "largePaste", content: "x".repeat(300) },
          { type: "text", content: "" },
        ],
        cursorOnSegmentIndex: 1,
        cursorInSegmentOffset: 0,
      };

      const result = deleteAfterCursor(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "hello" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(5);
    });

    it("handles single character text segment deletion at cursor position", () => {
      const initialState = createChatUserInputState([{ type: "text", content: "x" }], 0, 0);

      const result = deleteAfterCursor(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("does nothing when segments array is empty (edge case)", () => {
      const initialState: ChatUserInputState = {
        segments: [],
        cursorOnSegmentIndex: 0,
        cursorInSegmentOffset: 0,
      };

      const result = deleteAfterCursor(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("deletes newline character in text segment", () => {
      const initialState: ChatUserInputState = {
        segments: [{ type: "text", content: "hello\nworld" }],
        cursorOnSegmentIndex: 0,
        cursorInSegmentOffset: 5,
      };

      const result = deleteAfterCursor(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "helloworld" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(5);
    });

    it("deletes tab character in text segment", () => {
      const initialState: ChatUserInputState = {
        segments: [{ type: "text", content: "hello\tworld" }],
        cursorOnSegmentIndex: 0,
        cursorInSegmentOffset: 5,
      };

      const result = deleteAfterCursor(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "helloworld" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(5);
    });

    it("deletes unicode emoji character in text segment", () => {
      const initialState: ChatUserInputState = {
        segments: [{ type: "text", content: "hello🎉world" }],
        cursorOnSegmentIndex: 0,
        cursorInSegmentOffset: 5,
      };

      const result = deleteAfterCursor(initialState);

      // Note: emoji is multi-byte UTF-16, slice removes first code unit
      expect(result.segments[0].type).toBe("text");
      expect(result.segments[0].content.length).toBeLessThan("hello🎉world".length);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(5);
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

  describe("insertSuggestionAtCursor", () => {
    it("replaces last text segment content with suggestion text", () => {
      const initialState = createChatUserInputState([{ type: "text", content: "/mod" }], 0, 4);

      const result = insertSuggestionAtCursor({
        state: initialState,
        suggestionText: "/model mymodel",
      });

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0]).toEqual({ type: "text", content: "/model mymodel" });
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(14);
    });

    it("creates new text segment when last segment is largePaste", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "hello" },
          { type: "largePaste", content: "x".repeat(1000) },
        ],
        1,
        0,
      );

      const result = insertSuggestionAtCursor({
        state: initialState,
        suggestionText: "/help ",
      });

      expect(result.segments).toHaveLength(3);
      expect(result.segments[0]).toEqual({ type: "text", content: "hello" });
      expect(result.segments[1]).toEqual({ type: "largePaste", content: "x".repeat(1000) });
      expect(result.segments[2]).toEqual({ type: "text", content: "/help " });
      expect(result.cursorOnSegmentIndex).toBe(2);
      expect(result.cursorInSegmentOffset).toBe(6);
    });

    it("replaces last text segment even when there are multiple segments", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "hello" },
          { type: "largePaste", content: "x".repeat(1000) },
          { type: "text", content: "/co" },
        ],
        2,
        3,
      );

      const result = insertSuggestionAtCursor({
        state: initialState,
        suggestionText: "/context ",
      });

      expect(result.segments).toHaveLength(3);
      expect(result.segments[0]).toEqual({ type: "text", content: "hello" });
      expect(result.segments[1]).toEqual({ type: "largePaste", content: "x".repeat(1000) });
      expect(result.segments[2]).toEqual({ type: "text", content: "/context " });
      expect(result.cursorOnSegmentIndex).toBe(2);
      expect(result.cursorInSegmentOffset).toBe(9);
    });
  });

  describe("sanitizeChatUserInputState edge cases", () => {
    describe("trailing placeholder preservation", () => {
      it("preserves empty text segment after largePaste (trailing placeholder)", () => {
        const initialState = createChatUserInputState(
          [
            { type: "text", content: "hello" },
            { type: "largePaste", content: "x".repeat(1000) },
            { type: "text", content: "" },
          ],
          2,
          0,
        );

        const result = moveCursorLeft(initialState);

        expect(result.segments.length).toBe(3);
        expect(result.segments[2]).toEqual({ type: "text", content: "" });
      });

      it("removes empty text segment that is NOT a trailing placeholder", () => {
        const initialState = createChatUserInputState(
          [
            { type: "text", content: "hello" },
            { type: "text", content: "" },
            { type: "text", content: "world" },
          ],
          2,
          0,
        );

        const result = moveCursorLeft(initialState);

        expect(result.segments.length).toBe(1);
        expect(result.segments[0]).toEqual({ type: "text", content: "helloworld" });
      });
    });

    describe("cursor adjustment when removing empty segments", () => {
      it("adjusts cursor to previous segment when cursor is on removed empty segment", () => {
        const initialState = createChatUserInputState(
          [
            { type: "text", content: "hello" },
            { type: "text", content: "" },
            { type: "text", content: "world" },
          ],
          1,
          0,
        );

        const result = moveCursorRight(initialState);

        expect(result.segments.length).toBe(1);
        expect(result.cursorOnSegmentIndex).toBe(0);
      });

      it("adjusts cursor when removing segment before cursor position", () => {
        const initialState = createChatUserInputState(
          [
            { type: "text", content: "" },
            { type: "text", content: "hello" },
          ],
          1,
          2,
        );

        const result = moveCursorLeft(initialState);

        expect(result.segments.length).toBe(1);
        expect(result.cursorOnSegmentIndex).toBe(0);
        expect(result.cursorInSegmentOffset).toBe(1);
      });
    });

    describe("cursor bounds clamping", () => {
      it("clamps cursor segment index when it exceeds segments length", () => {
        const initialState = createChatUserInputState([{ type: "text", content: "hello" }], 5, 10);

        const result = moveCursorLeft(initialState);

        expect(result.cursorOnSegmentIndex).toBe(0);
        expect(result.cursorInSegmentOffset).toBe(0);
      });

      it("clamps negative cursor segment index to zero", () => {
        const initialState = createChatUserInputState([{ type: "text", content: "hello" }], -1, 0);

        const result = moveCursorRight(initialState);

        expect(result.cursorOnSegmentIndex).toBe(0);
        expect(result.cursorInSegmentOffset).toBe(0);
      });

      it("clamps cursor offset within text segment bounds", () => {
        const initialState = createChatUserInputState([{ type: "text", content: "hello" }], 0, 100);

        const result = moveCursorLeft(initialState);

        expect(result.cursorInSegmentOffset).toBe(5);
      });

      it("clamps negative cursor offset to zero for text segment", () => {
        const initialState = createChatUserInputState([{ type: "text", content: "hello" }], 0, -10);

        const result = moveCursorRight(initialState);

        expect(result.cursorInSegmentOffset).toBe(0);
      });

      it("clamps negative cursor offset to zero for largePaste segment", () => {
        const initialState = createChatUserInputState(
          [{ type: "largePaste", content: "x".repeat(1000) }],
          0,
          -5,
        );

        const result = moveCursorLeft(initialState);

        expect(result.cursorInSegmentOffset).toBe(0);
      });
    });
  });

  describe("deleteBeforeCursor edge cases", () => {
    it("merges with previous text when deleting at start of current text segment and previous is empty", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "" },
          { type: "text", content: "world" },
        ],
        1,
        0,
      );

      const result = deleteBeforeCursor(initialState);

      expect(result.segments.length).toBe(1);
      expect(result.segments[0]).toEqual({ type: "text", content: "world" });
    });

    it("removes single character before largePaste and keeps cursor at largePaste offset 0", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "a" },
          { type: "largePaste", content: "large content" },
          { type: "text", content: "" },
        ],
        0,
        1,
      );

      const result = deleteBeforeCursor(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
      expect(result.segments.length).toBe(2);
      expect(result.segments[0]).toEqual({ type: "largePaste", content: "large content" });
    });
    it("removes single character before largePaste if cursor is in text and keeps cursor at largePaste offset 0", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "a" },
          { type: "largePaste", content: "large content" },
          { type: "text", content: "" },
        ],
        0,
        1,
      );

      const result = deleteBeforeCursor(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
      expect(result.segments.length).toBe(2);
      expect(result.segments[0]).toEqual({ type: "largePaste", content: "large content" });
    });
  });

  describe("moveCursorLeft edge cases", () => {
    it("moves to start of previous text segment when previous segment is empty", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "" },
          { type: "text", content: "hello" },
        ],
        1,
        0,
      );

      const result = moveCursorLeft(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });
  });

  describe("moveCursorRight edge cases", () => {
    it("does nothing when trying to skip largePaste but no segment exists after it", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "hello" },
          { type: "largePaste", content: "x".repeat(1000) },
        ],
        0,
        5,
      );

      const result = moveCursorRight(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(5);
    });

    it("stays at last segment when trying to move right from end of last text segment", () => {
      const initialState = createChatUserInputState([{ type: "text", content: "hello" }], 0, 5);

      const result = moveCursorRight(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(5);
    });
  });

  describe("moveCursorWordLeft", () => {
    it("moves to start of previous word within a text segment", () => {
      const initialState = createChatUserInputState(
        [{ type: "text", content: "hello world" }],
        0,
        "hello world".length,
      );

      const result = moveCursorWordLeft(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe("hello ".length);
    });

    it("skips whitespace then moves to start of previous word", () => {
      const initialState = createChatUserInputState(
        [{ type: "text", content: "hello   world" }],
        0,
        "hello   world".length,
      );

      const result = moveCursorWordLeft(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe("hello   ".length);
    });

    it("does nothing when at start of segment", () => {
      const initialState = createChatUserInputState(
        [{ type: "text", content: "hello world" }],
        0,
        0,
      );

      const result = moveCursorWordLeft(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("treats largePaste before trailing placeholder as a word when moving left", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "before" },
          { type: "largePaste", content: "x".repeat(1000) },
          { type: "text", content: "" },
        ],
        2,
        0,
      );

      const result = moveCursorWordLeft(initialState);

      expect(result.cursorOnSegmentIndex).toBe(1);
      expect(result.cursorInSegmentOffset).toBe(0);
    });
  });

  describe("moveCursorWordRight", () => {
    it("moves to end of current word within a text segment", () => {
      const initialState = createChatUserInputState(
        [{ type: "text", content: "hello world" }],
        0,
        0,
      );

      const result = moveCursorWordRight(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe("hello".length);
    });

    it("skips whitespace then moves to end of next word", () => {
      const initialState = createChatUserInputState(
        [{ type: "text", content: "hello   world" }],
        0,
        "hello".length,
      );

      const result = moveCursorWordRight(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe("hello   world".length);
    });

    it("does nothing when at end of segment", () => {
      const initialState = createChatUserInputState(
        [{ type: "text", content: "hello" }],
        0,
        "hello".length,
      );

      const result = moveCursorWordRight(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe("hello".length);
    });

    it("treats largePaste as a word when moving right from preceding text", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "before" },
          { type: "largePaste", content: "x".repeat(1000) },
          { type: "text", content: "" },
        ],
        0,
        "before".length,
      );

      const result = moveCursorWordRight(initialState);

      expect(result.cursorOnSegmentIndex).toBe(1);
      expect(result.cursorInSegmentOffset).toBe(0);
    });
  });

  describe("moveCursorToLineStart", () => {
    it("moves to start of buffer when there is no newline", () => {
      const initialState = createChatUserInputState(
        [{ type: "text", content: "hello world" }],
        0,
        5,
      );

      const result = moveCursorToLineStart(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("moves to character after last newline in current segment", () => {
      const initialState = createChatUserInputState(
        [{ type: "text", content: "first line\nsecond line" }],
        0,
        "first line\nsecond line".length,
      );

      const result = moveCursorToLineStart(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe("first line\n".length);
    });

    it("moves to character after newline in previous text segment when current has none", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "line one\n" },
          { type: "text", content: "line two" },
        ],
        1,
        4,
      );

      const result = moveCursorToLineStart(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe("line one\n".length);
    });

    it("ignores newlines inside largePaste segments when searching for line start", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "prefix" },
          { type: "largePaste", content: "with\ninternal\nnewlines" },
          { type: "text", content: "suffix" },
        ],
        2,
        3,
      );

      const result = moveCursorToLineStart(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });
  });

  describe("moveCursorToLineEnd", () => {
    it("moves to end of buffer when there is no newline", () => {
      const initialState = createChatUserInputState(
        [{ type: "text", content: "hello world" }],
        0,
        0,
      );

      const result = moveCursorToLineEnd(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe("hello world".length);
    });

    it("moves to position before next newline in current segment", () => {
      const initialState = createChatUserInputState(
        [{ type: "text", content: "first line\nsecond line" }],
        0,
        0,
      );

      const result = moveCursorToLineEnd(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe("first line".length);
    });

    it("moves to position before newline in subsequent text segment when current has none", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "prefix" },
          { type: "text", content: "line one\nline two" },
        ],
        0,
        3,
      );

      const result = moveCursorToLineEnd(initialState);

      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe("prefixline one".length);
    });

    it("skips largePaste segments when searching for next newline and moves to end of buffer when none found", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "start" },
          { type: "largePaste", content: "with\ninternal\nnewlines" },
          { type: "text", content: "tail" },
        ],
        0,
        2,
      );

      const result = moveCursorToLineEnd(initialState);

      expect(result.cursorOnSegmentIndex).toBe(2);
      expect(result.cursorInSegmentOffset).toBe("tail".length);
    });
  });

  describe("insertTextAtCursor edge cases", () => {
    it("creates new text segment before largePaste when it is the first segment", () => {
      const initialState = createChatUserInputState(
        [{ type: "largePaste", content: "x".repeat(1000) }],
        0,
        0,
      );

      const result = insertTextAtCursor({
        state: initialState,
        text: "prefix",
      });

      expect(result.segments.length).toBe(2);
      expect(result.segments[0]).toEqual({ type: "text", content: "prefix" });
      expect(result.segments[1]).toEqual({ type: "largePaste", content: "x".repeat(1000) });
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(6);
    });
  });

  describe("deleteWordBackward", () => {
    it("deletes previous word within a text segment", () => {
      const initialState = createChatUserInputState(
        [{ type: "text", content: "hello world" }],
        0,
        "hello world".length,
      );

      const result = deleteWordBackward(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "hello " }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe("hello ".length);
    });

    it("deletes previous word when there is no trailing whitespace", () => {
      const initialState = createChatUserInputState(
        [{ type: "text", content: "hello   world" }],
        0,
        "hello   world".length,
      );

      const result = deleteWordBackward(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "hello   " }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe("hello   ".length);
    });

    it("does nothing when at start of segment", () => {
      const initialState = createChatUserInputState(
        [{ type: "text", content: "hello world" }],
        0,
        0,
      );

      const result = deleteWordBackward(initialState);

      expect(result.segments).toEqual(initialState.segments);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("deletes previous largePaste when cursor is at start of trailing placeholder", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "before" },
          { type: "largePaste", content: "large content" },
          { type: "text", content: "" },
        ],
        2,
        0,
      );

      const result = deleteWordBackward(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "before" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe("before".length);
    });

    it("deletes current largePaste when cursor is on it", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "before" },
          { type: "largePaste", content: "large content" },
          { type: "text", content: "" },
        ],
        1,
        0,
      );

      const result = deleteWordBackward(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "before" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe("before".length);
    });
  });

  describe("deleteWordForward", () => {
    it("deletes next word within a text segment", () => {
      const initialState = createChatUserInputState(
        [{ type: "text", content: "hello world" }],
        0,
        0,
      );

      const result = deleteWordForward(initialState);

      expect(result.segments).toEqual([{ type: "text", content: " world" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe(0);
    });

    it("deletes whitespace then next word", () => {
      const initialState = createChatUserInputState(
        [{ type: "text", content: "hello   world" }],
        0,
        "hello".length,
      );

      const result = deleteWordForward(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "hello" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe("hello".length);
    });

    it("does nothing when at end of segment", () => {
      const initialState = createChatUserInputState(
        [{ type: "text", content: "hello" }],
        0,
        "hello".length,
      );

      const result = deleteWordForward(initialState);

      expect(result.segments).toEqual(initialState.segments);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe("hello".length);
    });

    it("deletes next largePaste when cursor is at end of preceding text", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "before" },
          { type: "largePaste", content: "large content" },
          { type: "text", content: "" },
        ],
        0,
        "before".length,
      );

      const result = deleteWordForward(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "before" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe("before".length);
    });

    it("deletes current largePaste when cursor is on it", () => {
      const initialState = createChatUserInputState(
        [
          { type: "text", content: "before" },
          { type: "largePaste", content: "large content" },
          { type: "text", content: "" },
        ],
        1,
        0,
      );

      const result = deleteWordForward(initialState);

      expect(result.segments).toEqual([{ type: "text", content: "before" }]);
      expect(result.cursorOnSegmentIndex).toBe(0);
      expect(result.cursorInSegmentOffset).toBe("before".length);
    });
  });

  describe("insertPasteAtCursor edge cases", () => {
    it("inserts large paste before current largePaste when cursor is at start", () => {
      const initialState = createChatUserInputState(
        [{ type: "largePaste", content: "x".repeat(1000) }],
        0,
        0,
      );

      const result = insertPasteAtCursor({
        state: initialState,
        content: "y".repeat(1000),
        largePasteThreshold: 500,
      });

      expect(result.segments.length).toBe(2);
      expect(result.segments[0]).toEqual({ type: "largePaste", content: "y".repeat(1000) });
      expect(result.segments[1]).toEqual({ type: "largePaste", content: "x".repeat(1000) });
      expect(result.cursorOnSegmentIndex).toBe(0);
    });

    it("inserts small paste as text before current largePaste when cursor is at start", () => {
      const initialState = createChatUserInputState(
        [{ type: "largePaste", content: "x".repeat(1000) }],
        0,
        0,
      );

      const result = insertPasteAtCursor({
        state: initialState,
        content: "small",
        largePasteThreshold: 500,
      });

      expect(result.segments.length).toBe(2);
      expect(result.segments[0]).toEqual({ type: "text", content: "small" });
      expect(result.segments[1]).toEqual({ type: "largePaste", content: "x".repeat(1000) });
    });
  });
});
