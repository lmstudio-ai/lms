export interface ParsedLmStudioArtifactUrl {
  owner: string;
  name: string;
}

const invalidLmStudioArtifactUrlMessage =
  "Invalid LM Studio artifact URL. Expected https://lmstudio.ai/models/owner/name or https://lmstudio.ai/owner/name.";

export function tryParseLmStudioArtifactUrl(modelName: string): ParsedLmStudioArtifactUrl | null {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(modelName);
  } catch {
    return null;
  }

  if (parsedUrl.hostname !== "lmstudio.ai" && parsedUrl.hostname !== "www.lmstudio.ai") {
    return null;
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("Only https://lmstudio.ai URLs are supported.");
  }

  const pathSegments = parsedUrl.pathname.split("/").filter(segment => segment !== "");
  let owner: string | undefined;
  let name: string | undefined;

  if (pathSegments.length === 2 && pathSegments[0] !== "models") {
    [owner, name] = pathSegments;
  } else if (pathSegments.length === 3 && pathSegments[0] === "models") {
    owner = pathSegments[1];
    name = pathSegments[2];
  } else {
    throw new Error(invalidLmStudioArtifactUrlMessage);
  }

  if (owner === undefined || owner === "" || name === undefined || name === "") {
    throw new Error(invalidLmStudioArtifactUrlMessage);
  }

  return {
    owner: owner.toLowerCase(),
    name: name.toLowerCase(),
  };
}
