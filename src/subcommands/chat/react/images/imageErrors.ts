export class ImagePreparationError extends Error {
  code: "not_image" | "prepare_failed";

  constructor(code: "not_image" | "prepare_failed", message: string) {
    super(message);
    this.code = code;
    this.name = "ImagePreparationError";
  }
}
