# Changelog

## 0.2.0

- `image` code fences show image files (`.png .jpg .jpeg .webp .gif .avif
  .bmp`) from the allowed directories, at most 720 px wide and 70% of the window
  height; click to open full size in a new tab, with a download link below.
- `media.info` now reports `kind: "image"` for those extensions.

## 0.1.0

- `video` and `audio` code fences in the transcript become players; one file
  path per line.
- Server half reads allowed files in 1 MiB pieces; the browser joins them into
  a Blob, cached per path and modification time.
- Allowed directories configurable through `plugins.media.settings.roots`;
  paths are resolved with `realpath` before the check.
- Players drawn at the smaller of the available width and 480 px, so they fit a
  phone screen; video at most 40% of the window height.
- No network, no commands, no runtime dependencies.
