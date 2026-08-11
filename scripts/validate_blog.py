#!/usr/bin/env python3
"""Validate Beadlight Markdown posts without third-party dependencies."""

from __future__ import annotations

import re
import sys
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
POSTS_DIR = ROOT / "_posts"
ALLOWED_CATEGORIES = {
    "Prayer guide",
    "Reflection",
    "Beadlight news",
    "Faith and life",
}
REQUIRED_FIELDS = {
    "layout",
    "title",
    "slug",
    "description",
    "date",
    "author",
    "category",
    "published",
}
ALLOWED_FIELDS = REQUIRED_FIELDS | {
    "featured",
    "image",
    "image_alt",
    "tags",
}
FILENAME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$")
BLOG_IMAGE_RE = re.compile(
    r"^/assets/blog/(?:[a-z0-9]+(?:-[a-z0-9]+)*/)*"
    r"[a-z0-9]+(?:[-_][a-z0-9]+)*\.(?:avif|jpe?g|png|webp)$"
)
MARKDOWN_IMAGE_RE = re.compile(
    r"!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+['\"][^'\"]*['\"])?\s*\)"
)
MARKDOWN_LINK_RE = re.compile(
    r"(?<!!)\[[^\]]+\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+['\"][^'\"]*['\"])?\s*\)"
)
UNSAFE_PATTERNS = {
    "script tag": re.compile(r"<\s*script\b", re.IGNORECASE),
    "inline event handler": re.compile(r"\son[a-z]+\s*=", re.IGNORECASE),
    "javascript URL": re.compile(r"javascript\s*:", re.IGNORECASE),
    "embedded frame or object": re.compile(r"<\s*(?:iframe|object|embed)\b", re.IGNORECASE),
    "raw HTML": re.compile(r"</?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*|/?)>"),
    "Liquid template code": re.compile(r"(?:\{\{|\{%|%\}|\}\})"),
    "Kramdown extension": re.compile(r"\{::?"),
}


def unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def parse_date(value: str) -> datetime:
    """Accept the ISO forms emitted by Jekyll authors and the browser studio."""
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        for date_format in ("%Y-%m-%d %H:%M:%S %z", "%Y-%m-%d %H:%M:%S"):
            try:
                return datetime.strptime(value, date_format)
            except ValueError:
                continue
    raise ValueError("invalid ISO date")


def parse_front_matter(text: str, path: Path) -> tuple[dict[str, object], str]:
    if not text.startswith("---\n"):
        raise ValueError("front matter must begin with --- on the first line")

    closing = text.find("\n---\n", 4)
    if closing == -1:
        raise ValueError("front matter must end with a second --- line")

    fields: dict[str, object] = {}
    active_list: str | None = None

    for line_number, raw_line in enumerate(text[4:closing].splitlines(), start=2):
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            continue

        list_match = re.match(r"^\s+-\s+(.+)$", raw_line)
        if list_match and active_list:
            current = fields.setdefault(active_list, [])
            if not isinstance(current, list):
                raise ValueError(f"line {line_number}: {active_list} is not a list")
            current.append(unquote(list_match.group(1)))
            continue

        field_match = re.match(r"^([a-z_][a-z0-9_]*):(?:\s*(.*))?$", raw_line)
        if not field_match:
            raise ValueError(f"line {line_number}: unsupported front matter syntax")

        key, raw_value = field_match.groups()
        if key in fields:
            raise ValueError(f"line {line_number}: duplicate field: {key}")
        value = (raw_value or "").strip()
        active_list = key if value in {"", "[]"} else None
        fields[key] = [] if value in {"", "[]"} else unquote(value)

    return fields, text[closing + 5 :]


def validate_post(path: Path) -> list[str]:
    errors: list[str] = []
    filename_match = FILENAME_RE.match(path.name)
    if not filename_match:
        errors.append("filename must be YYYY-MM-DD-lowercase-hyphenated-slug.md")

    try:
        text = path.read_text(encoding="utf-8")
        fields, body = parse_front_matter(text, path)
    except (OSError, UnicodeError, ValueError) as error:
        return [str(error)]

    missing = sorted(REQUIRED_FIELDS.difference(fields))
    if missing:
        errors.append("missing required fields: " + ", ".join(missing))

    unknown = sorted(set(fields).difference(ALLOWED_FIELDS))
    if unknown:
        errors.append("unsupported fields: " + ", ".join(unknown))

    for key in REQUIRED_FIELDS:
        if key in fields and isinstance(fields[key], list) and key != "tags":
            errors.append(f"{key} must be a single value")

    if fields.get("layout") != "blog-post":
        errors.append("layout must be blog-post")

    title = str(fields.get("title", "")).strip()
    if not 10 <= len(title) <= 160:
        errors.append("title must be between 10 and 160 characters")

    slug = str(fields.get("slug", "")).strip()
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
        errors.append("slug must use lowercase words separated by hyphens")
    if filename_match and slug != filename_match.group(2):
        errors.append("slug must match the filename after its date prefix")

    description = str(fields.get("description", "")).strip()
    if not 80 <= len(description) <= 200:
        errors.append("description must be between 80 and 200 characters")

    author = str(fields.get("author", "")).strip()
    if not 1 <= len(author) <= 80:
        errors.append("author must be between 1 and 80 characters")

    category = str(fields.get("category", "")).strip()
    if category not in ALLOWED_CATEGORIES:
        errors.append("category must be one of: " + ", ".join(sorted(ALLOWED_CATEGORIES)))

    date_value = str(fields.get("date", "")).strip()
    try:
        parsed_date = parse_date(date_value)
    except ValueError:
        errors.append("date must be a valid ISO 8601 date or date-time")
    else:
        if filename_match and parsed_date.date().isoformat() != filename_match.group(1):
            errors.append("filename date must match the date field")

    published = str(fields.get("published", "")).lower()
    if published not in {"true", "false"}:
        errors.append("published must be true or false")

    if "featured" in fields and str(fields["featured"]).lower() not in {"true", "false"}:
        errors.append("featured must be true or false")

    tags = fields.get("tags", [])
    if not isinstance(tags, list):
        errors.append("tags must be a YAML list")
        tags = []
    elif len(tags) > 6:
        errors.append("tags must contain no more than 6 items")
    for tag in tags:
        if not 1 <= len(str(tag).strip()) <= 60:
            errors.append("each tag must be between 1 and 60 characters")

    image = str(fields.get("image", "")).strip()
    image_alt = str(fields.get("image_alt", "")).strip()
    if image:
        if not BLOG_IMAGE_RE.fullmatch(image):
            errors.append("cover image must be a safe AVIF, JPEG, PNG or WebP path under /assets/blog/")
        else:
            image_file = ROOT / image.lstrip("/")
            if not image_file.is_file():
                errors.append(f"cover image does not exist: {image}")
            elif image_file.stat().st_size > 5 * 1024 * 1024:
                errors.append(f"cover image exceeds 5 MB: {image}")
        if not image_alt:
            errors.append("image_alt is required when a cover image is used")
        elif len(image_alt) > 180:
            errors.append("image_alt must be no more than 180 characters")
    elif image_alt:
        errors.append("image_alt should be omitted when there is no cover image")

    metadata_values = [title, slug, description, author, category, image_alt]
    metadata_values.extend(str(tag) for tag in tags)
    metadata_text = "\n".join(metadata_values)
    for label, pattern in UNSAFE_PATTERNS.items():
        if pattern.search(metadata_text):
            errors.append(f"unsafe metadata detected: {label}")

    if re.search(r"^#\s+", body, re.MULTILINE):
        errors.append("do not add a level-one heading; the layout supplies the title")

    if not body.strip():
        errors.append("article body cannot be empty")

    for label, pattern in UNSAFE_PATTERNS.items():
        if pattern.search(body):
            errors.append(f"unsafe content detected: {label}")

    for alt_text, angle_path, plain_path in MARKDOWN_IMAGE_RE.findall(body):
        image_path = angle_path or plain_path
        if not alt_text.strip():
            errors.append(f"inline image needs descriptive alternative text: {image_path}")
        if not BLOG_IMAGE_RE.fullmatch(image_path):
            errors.append(f"inline image must use a safe local path under /assets/blog/: {image_path}")
            continue
        image_file = ROOT / image_path.lstrip("/")
        if not image_file.is_file():
            errors.append(f"inline image does not exist: {image_path}")
        elif image_file.stat().st_size > 5 * 1024 * 1024:
            errors.append(f"inline image exceeds 5 MB: {image_path}")

    for angle_path, plain_path in MARKDOWN_LINK_RE.findall(body):
        link_path = angle_path or plain_path
        if link_path.startswith(("/", "#", "https://")):
            continue
        errors.append(f"links must use HTTPS or a root-relative/hash path: {link_path}")

    return errors


def main() -> int:
    posts = sorted(POSTS_DIR.glob("*.md")) if POSTS_DIR.exists() else []
    failures = 0

    for post in posts:
        errors = validate_post(post)
        if errors:
            failures += 1
            print(f"{post.relative_to(ROOT)}:")
            for error in errors:
                print(f"  - {error}")

    if failures:
        print(f"Blog validation failed for {failures} post(s).")
        return 1

    print(f"Blog validation passed for {len(posts)} post(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
