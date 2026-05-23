/**
 * Generic short-form video metadata validator.
 *
 * Pure function. No I/O. Returns `{ ok, errors }`. Use before pushing
 * metadata to a provider (Sora, Veo, Seedance, YouTube Shorts, etc.) to
 * catch the dumb violations early instead of on the upload endpoint.
 *
 * Limits are chosen to be the most restrictive common denominator across
 * the major short-form destinations:
 *   - title:       <= 100 chars
 *   - description: <= 5000 chars
 *   - tags:        <= 500 individual tags
 *   - tag length:  <= 100 chars each
 *
 * @typedef {{ title?: unknown, description?: unknown, tags?: unknown }} Metadata
 * @typedef {{ ok: boolean, errors: string[] }} ValidationResult
 *
 * @param {Metadata} metadata
 * @param {{ maxTitle?: number, maxDescription?: number, maxTags?: number, maxTagLength?: number }} [options]
 * @returns {ValidationResult}
 */
export function validateVideoMetadata(metadata, options = {}) {
  const errors = [];

  if (metadata === null || typeof metadata !== "object") {
    return { ok: false, errors: ["metadata must be an object"] };
  }

  const maxTitle = numberOr(options.maxTitle, 100);
  const maxDescription = numberOr(options.maxDescription, 5000);
  const maxTags = numberOr(options.maxTags, 500);
  const maxTagLength = numberOr(options.maxTagLength, 100);

  const { title, description, tags } = metadata;

  if (title == null || (typeof title === "string" && title.trim() === "")) {
    errors.push("title is required");
  } else if (typeof title !== "string") {
    errors.push("title must be a string");
  } else if (title.length > maxTitle) {
    errors.push(`title exceeds ${maxTitle} characters (got ${title.length})`);
  }

  if (description != null) {
    if (typeof description !== "string") {
      errors.push("description must be a string");
    } else if (description.length > maxDescription) {
      errors.push(
        `description exceeds ${maxDescription} characters (got ${description.length})`,
      );
    }
  }

  if (tags != null) {
    if (!Array.isArray(tags)) {
      errors.push("tags must be an array of strings");
    } else {
      if (tags.length > maxTags) {
        errors.push(`tags exceeds ${maxTags} entries (got ${tags.length})`);
      }
      tags.forEach((tag, i) => {
        if (typeof tag !== "string") {
          errors.push(`tags[${i}] must be a string`);
        } else if (tag.length > maxTagLength) {
          errors.push(
            `tags[${i}] exceeds ${maxTagLength} characters (got ${tag.length})`,
          );
        }
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
