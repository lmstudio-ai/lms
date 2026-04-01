import { tryParseLmStudioArtifactUrl } from "./parseLmStudioArtifactUrl.js";

describe("tryParseLmStudioArtifactUrl", () => {
  it("parses the current lmstudio.ai models URL format", () => {
    expect(
      tryParseLmStudioArtifactUrl("https://lmstudio.ai/models/nvidia/nemotron-3-super"),
    ).toEqual({
      owner: "nvidia",
      name: "nemotron-3-super",
    });
  });

  it("parses the lmstudio.ai artifact URL format without /models", () => {
    expect(tryParseLmStudioArtifactUrl("https://lmstudio.ai/nvidia/nemotron-3-super")).toEqual({
      owner: "nvidia",
      name: "nemotron-3-super",
    });
  });

  it("parses www.lmstudio.ai model URLs", () => {
    expect(
      tryParseLmStudioArtifactUrl("https://www.lmstudio.ai/models/NVIDIA/Nemotron-3-Super"),
    ).toEqual({
      owner: "nvidia",
      name: "nemotron-3-super",
    });
  });

  it("returns null for non-lmstudio.ai URLs", () => {
    expect(
      tryParseLmStudioArtifactUrl("https://huggingface.co/nvidia/nemotron-3-super"),
    ).toBeNull();
  });

  it("rejects non-https lmstudio.ai URLs", () => {
    expect(() =>
      tryParseLmStudioArtifactUrl("http://lmstudio.ai/models/nvidia/nemotron-3-super"),
    ).toThrow("Only https://lmstudio.ai URLs are supported.");
  });

  it("rejects unexpected lmstudio.ai paths", () => {
    expect(() => tryParseLmStudioArtifactUrl("https://lmstudio.ai/models/nvidia")).toThrow(
      "Invalid LM Studio artifact URL. Expected https://lmstudio.ai/models/owner/name or https://lmstudio.ai/owner/name.",
    );
  });
});
