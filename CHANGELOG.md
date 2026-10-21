# Changelog

## 0.1.0

- `video` and `audio` code fences in the transcript become players; one file
  path per line.
- Server half reads allowed files in 1 MiB pieces; the browser joins them into
  a Blob, cached per path and modification time.
- Allowed directories configurable through `plugins.media.settings.roots`;
  paths are resolved with `realpath` before the check.
- Players drawn at most 480 px wide; video at most 40% of the window height.
- No network, no commands, no runtime dependencies.
