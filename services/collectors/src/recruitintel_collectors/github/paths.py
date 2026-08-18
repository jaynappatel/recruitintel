from pathlib import PurePosixPath


def normalize_watched_path(value: str) -> str:
    candidate = value.strip().replace("\\", "/")
    if not candidate or candidate.startswith("/") or "\x00" in candidate:
        raise ValueError("watched paths must be non-empty relative repository paths")
    parts = PurePosixPath(candidate).parts
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError("watched paths must not contain dot traversal segments")
    if len(candidate) > 500:
        raise ValueError("watched paths cannot exceed 500 characters")
    return "/".join(parts)
