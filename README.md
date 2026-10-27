# pi-web-media

A PI WEB plugin that plays video and audio files, and shows image files, inline
in the chat transcript.

PI WEB's transcript draws text and images that come with a message, but not
video or audio, and it cannot show an image that only exists as a file on the
machine. With this plugin, a fenced code block whose language is `video`,
`audio` or `image` and whose body is a file path on the machine becomes a
player or an image:

````markdown
```video
/opt/h3-hrx/out/fox_5s.mp4
```

```audio
/opt/h3-hrx/out/fox_5s.wav
```

```image
/opt/comfyui/output/ComfyUI_00001_.png
```
````

One path per line; several paths draw several players or images. Lines starting with `#`
are ignored. If a file cannot be loaded, the block says why in place of the
player and offers a 重试 (Retry) button that resumes where the read stopped. If the plugin is off or missing, the block stays plain code, so nothing
is lost.

This makes it easy for an agent to show what it generated: it writes the fence
in its reply instead of asking you to open the Files page.

## Requirements

- PI WEB `2.202610.14` or newer (plugin browser API v2 with `codeFenceRenderers`,
  server API v1).
- Node.js 22.19.0 or newer on the machine running PI WEB.
- No runtime dependencies and no build step: the files in `browser/` and
  `server/` are served and imported as-is.

## Install

As a Pi package:

```bash
pi install git:github.com/kingoliang/pi-web-media
systemctl --user restart pi-web-sessiond   # the server half runs in the daemon
```

Or link a checkout, which is what you want while editing it:

```bash
git clone https://github.com/kingoliang/pi-web-media ~/src/pi-web-media
mkdir -p ~/.pi-web/plugins
ln -s ~/src/pi-web-media ~/.pi-web/plugins/media
systemctl --user restart pi-web-sessiond
```

Then reload the PI WEB tab. The plugin is on by default; turn it off in
**Settings → PI WEB Plugins**.

> **Editing a plugin with a server half needs the restart.** PI WEB hashes the
> whole package into one revision and withholds a browser half whose revision
> no longer matches the running server half. After any edit: restart the session
> daemon, then reload the tab. A tab left open keeps the browser module it already
> loaded, so reload it even when nothing else seems to change.

## How it works

1. The browser half registers code-fence renderers for `video`, `audio` and
   `image`.
   When a fence settles in the transcript, it reads the paths from the fence body.
2. For each path it calls the server half's `media.info` operation, then reads
   the file in 1 MiB pieces with `media.read` (base64 in JSON, the only way a
   plugin operation can return bytes), joins them into a `Blob` and plays it from
   an object URL. Loaded files are cached in the page by path and modification
   time, so scrolling past a block again does not read the file again.
3. Players are drawn at the smaller of the available width and 480 px, so they
   fit a phone screen (video also at most 40% of the window
   height). Use the player's own full-screen button for a larger view.
   Images are drawn at most 720 px wide and 70% of the window height, keeping
   their proportions; click one to open it at full size in a new tab.

### What the server half reads

Only regular files with a known audio, video or image extension, under a set of allowed
directories. Each path is resolved with `realpath` before the check, so `..` and
symbolic links cannot leave the allowed directories.

| Setting | Default |
|---|---|
| Allowed directories | `/opt/h3-hrx/out`, `/opt/comfyui/output`, `/home/kingo/projects`, `/tmp` (directories that do not exist are skipped) |
| Extensions | video `.mp4 .m4v .webm .mov .mkv`; audio `.mp3 .wav .ogg .oga .m4a .aac .flac .opus`; image `.png .jpg .jpeg .webp .gif .avif .bmp` |
| Largest file | 512 MiB |

Set your own allowed directories in the PI WEB config, then restart the session
daemon:

```json
{
  "plugins": {
    "media": { "settings": { "roots": ["/srv/renders", "/home/me/videos"] } }
  }
}
```

The plugin runs no commands and contacts no network service. Whether the browser
can play a format is up to the browser: MP4 (H.264/AAC), WebM, MP3, WAV and Ogg
play everywhere; MKV and MOV depend on the codecs inside. PNG, JPEG, WebP and GIF
show everywhere; AVIF and BMP depend on the browser.

## Development

```bash
npm test     # runs test/server.test.mjs against the server half
```

The tests read real media files from `/opt/h3-hrx/out`; point them at your own
files if that directory does not exist on your machine.

## License

[MIT](LICENSE)
