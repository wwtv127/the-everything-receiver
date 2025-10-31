(function (Scratch) {
  'use strict';

  class VideoOverlayCache {
    constructor () {
      this.overlays = {}; // key -> { key, name, spriteName, video, container, intervalId, target, acSource, url }
      this.root = document.createElement('div');
      this.root.style.position = 'absolute';
      this.root.style.left = '0';
      this.root.style.top = '0';
      this.root.style.width = '100%';
      this.root.style.height = '100%';
      this.root.style.pointerEvents = 'none';
      this.root.style.zIndex = 99999;
      document.body.appendChild(this.root);

      this.updateMs = 40;
      this.autoDetectOrientation = true;
      this._audioContext = null;
      this._loadGuards = {}; // key -> boolean to prevent simultaneous duplicate loads
      this._playingBySprite = {}; // spriteName -> overlay name currently playing
    }

    getInfo () {
      return {
        id: 'videoOverlay',
        name: 'Video Overlay',
        blocks: [
          {
            opcode: 'loadOverlay',
            blockType: Scratch.BlockType.COMMAND,
            text: 'load overlay video [NAME] from [URL] on sprite [SPRITE]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'v1' },
              URL: { type: Scratch.ArgumentType.STRING, defaultValue: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4' },
              SPRITE: { type: Scratch.ArgumentType.STRING, menu: 'spriteMenu' }
            }
          },
          {
            opcode: 'playOverlay',
            blockType: Scratch.BlockType.COMMAND,
            text: 'play overlay video [NAME] on sprite [SPRITE]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'v1' },
              SPRITE: { type: Scratch.ArgumentType.STRING, menu: 'spriteMenu' }
            }
          },
          {
            opcode: 'playOverlayAt',
            blockType: Scratch.BlockType.COMMAND,
            text: 'play overlay video [NAME] at [SECONDS] on sprite [SPRITE]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'v1' },
              SECONDS: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
              SPRITE: { type: Scratch.ArgumentType.STRING, menu: 'spriteMenu' }
            }
          },
          {
            opcode: 'stopOverlay',
            blockType: Scratch.BlockType.COMMAND,
            text: 'stop overlay video [NAME] on sprite [SPRITE]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'v1' },
              SPRITE: { type: Scratch.ArgumentType.STRING, menu: 'spriteMenu' }
            }
          },
          {
            opcode: 'unloadOverlay',
            blockType: Scratch.BlockType.COMMAND,
            text: 'unload overlay [NAME] from sprite [SPRITE]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'v1' },
              SPRITE: { type: Scratch.ArgumentType.STRING, menu: 'spriteMenu' }
            }
          },
          {
            opcode: 'setPlaybackRate',
            blockType: Scratch.BlockType.COMMAND,
            text: 'set playback rate of [NAME] on sprite [SPRITE] to [RATE]',
            arguments: {
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'v1' },
              SPRITE: { type: Scratch.ArgumentType.STRING, menu: 'spriteMenu' },
              RATE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 }
            }
          },
          {
            opcode: 'getVideoInfo',
            blockType: Scratch.BlockType.REPORTER,
            text: 'get video [INFO] of [NAME] on sprite [SPRITE]',
            arguments: {
              INFO: { type: Scratch.ArgumentType.STRING, menu: 'infoMenu' },
              NAME: { type: Scratch.ArgumentType.STRING, defaultValue: 'v1' },
              SPRITE: { type: Scratch.ArgumentType.STRING, menu: 'spriteMenu' }
            }
          },
          {
            opcode: 'currentVideoOnSprite',
            blockType: Scratch.BlockType.REPORTER,
            text: 'current video on [SPRITE]',
            arguments: {
              SPRITE: { type: Scratch.ArgumentType.STRING, menu: 'spriteMenu' }
            }
          },
          {
            opcode: 'getLoadedOverlaysFromSprite',
            blockType: Scratch.BlockType.REPORTER,
            text: 'get loaded overlays from [SPRITE]',
            arguments: {
              SPRITE: { type: Scratch.ArgumentType.STRING, menu: 'spriteMenu' }
            }
          }
        ],
        menus: {
          spriteMenu: 'getSpriteNames',
          infoMenu: {
            acceptReporters: false,
            items: ['duration', 'current time', 'is playing', 'playback rate']
          }
        }
      };
    }

    // helper: list sprite names
    getSpriteNames () {
      return Scratch.vm.runtime.targets
        .filter(t => !t.isStage && t.sprite && t.sprite.name)
        .map(t => t.sprite.name);
    }

    _getStageRect () {
      let canvas = document.querySelector('.stage canvas');
      if (!canvas) canvas = document.querySelector('canvas');
      return canvas ? canvas.getBoundingClientRect() : null;
    }

    _spriteToDomRect (target, video) {
      const stageRect = this._getStageRect();
      if (!stageRect) return null;

      const stageW = 480;
      const stageH = 360;

      const xScratch = (typeof target.x === 'number') ? target.x : 0;
      const yScratch = (typeof target.y === 'number') ? target.y : 0;
      const sizePct = ((typeof target.size === 'number') ? target.size : 100) / 100;

      const vidW = (video && video.videoWidth) || 16;
      const vidH = (video && video.videoHeight) || 9;
      const vidAspect = vidW / vidH;

      let costumePxW = stageRect.width * 0.2 * sizePct;
      let costumePxH = costumePxW / vidAspect;

      try {
        const drawable = target.drawable;
        if (drawable) {
          if (drawable.width && drawable.height) {
            costumePxW = drawable.width * sizePct;
            costumePxH = drawable.height * sizePct;
          } else if (drawable.skin && drawable.skin.size && drawable.skin.size[0] && drawable.skin.size[1]) {
            costumePxW = drawable.skin.size[0] * sizePct;
            costumePxH = drawable.skin.size[1] * sizePct;
          }
        }
      } catch (e) {}

      if (costumePxW / costumePxH > vidAspect) {
        costumePxW = costumePxH * vidAspect;
      } else {
        costumePxH = costumePxW / vidAspect;
      }

      const domX = (xScratch + stageW / 2) * (stageRect.width / stageW) + stageRect.left;
      const domY = (stageH / 2 - yScratch) * (stageRect.height / stageH) + stageRect.top;

      const direction = (typeof target.direction === 'number') ? target.direction : 90;
      const rotationStyle = (typeof target.rotationStyle !== 'undefined') ? target.rotationStyle : (target.rotationStyleName || 'all around');

      const flipHorizontally = (rotationStyle === 'left-right' || rotationStyle === 'leftRight' || rotationStyle === 'left right');

      return {
        left: domX - costumePxW / 2,
        top: domY - costumePxH / 2,
        width: costumePxW,
        height: costumePxH,
        direction,
        rotationStyle,
        flip: flipHorizontally
      };
    }

    async _createVideoElement (url) {
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const video = document.createElement('video');
        video.src = blobUrl;
        video.crossOrigin = 'anonymous';
        video.autoplay = false;
        video.loop = false;
        video.muted = false;
        video.playsInline = true;
        video.style.position = 'absolute';
        video.style.transformOrigin = 'center center';
        video.style.pointerEvents = 'auto';
        video.style.willChange = 'transform, width, height, opacity';

        await new Promise((resolve, reject) => {
          const onLoad = () => { cleanup(); resolve(); };
          const onError = () => { cleanup(); reject(new Error('video load error')); };
          const cleanup = () => {
            video.removeEventListener('loadeddata', onLoad);
            video.removeEventListener('error', onError);
          };
          video.addEventListener('loadeddata', onLoad);
          video.addEventListener('error', onError);
        });

        // orientation detection
        video._autoOrientationDeg = 0;
        if (this.autoDetectOrientation) {
          try {
            const sampleW = Math.max(2, Math.min(64, video.videoWidth || 2));
            const sampleH = Math.max(2, Math.min(64, video.videoHeight || 2));
            const sampleCanvas = document.createElement('canvas');
            sampleCanvas.width = sampleW;
            sampleCanvas.height = sampleH;
            const sampleCtx = sampleCanvas.getContext('2d');

            try {
              sampleCtx.drawImage(video, 0, 0, sampleCanvas.width, sampleCanvas.height);
              const drawnW = sampleCanvas.width;
              const drawnH = sampleCanvas.height;

              if (video.videoWidth && video.videoHeight) {
                if (video.videoWidth < video.videoHeight && drawnW > drawnH) {
                  video._autoOrientationDeg = 90;
                } else if (video.videoWidth > video.videoHeight && drawnH > drawnW) {
                  video._autoOrientationDeg = -90;
                } else {
                  video._autoOrientationDeg = 0;
                }
              } else {
                video._autoOrientationDeg = 0;
              }
            } catch (e) {
              if (video.videoWidth && video.videoHeight) {
                video._autoOrientationDeg = (video.videoWidth < video.videoHeight) ? 90 : 0;
              } else {
                video._autoOrientationDeg = 0;
              }
            }
          } catch (e) {
            video._autoOrientationDeg = 0;
          }
        }

        video._blobUrl = video.src;
        return video;
      } catch (err) {
        console.warn('VideoOverlayCache: failed to create video element', err);
        throw err;
      }
    }

    // Compose a unique key for a (name, spriteName) pair
    _keyFor (name, spriteName) {
      return `${name}@${spriteName}`;
    }

    // Find overlay by explicit name and spriteName key
    _getOverlayByNameAndSprite (name, spriteName) {
      if (!name) return null;
      if (spriteName) {
        const key = this._keyFor(name, spriteName);
        return this.overlays[key] || null;
      }
      return null;
    }

    // Find an overlay instance for a given name. Prefer the provided spriteName, then the caller, then any
    _findOverlayForName (name, spriteName) {
      if (spriteName) {
        const exact = this._getOverlayByNameAndSprite(name, spriteName);
        if (exact) return exact;
      }

      const editingTarget = (Scratch.vm && Scratch.vm.runtime && typeof Scratch.vm.runtime.getEditingTarget === 'function')
        ? Scratch.vm.runtime.getEditingTarget()
        : null;
      const callerSpriteName = editingTarget && editingTarget.sprite && editingTarget.sprite.name;
      if (callerSpriteName) {
        const k = this._keyFor(name, callerSpriteName);
        if (this.overlays[k]) return this.overlays[k];
      }

      const keys = Object.keys(this.overlays);
      for (let i = 0; i < keys.length; i++) {
        const info = this.overlays[keys[i]];
        if (info && info.name === name) return info;
      }
      return null;
    }

    // Attach a video element to a sprite target, startPlayback decides whether to call play()
    async _attachOverlayInternal (name, spriteName, video, target, startPlayback) {
      const key = this._keyFor(name, spriteName);

      if (this.overlays[key]) {
        try { clearInterval(this.overlays[key].intervalId); } catch (e) {}
        try {
          if (this.overlays[key].container && this.overlays[key].container.parentNode) {
            this.overlays[key].container.parentNode.removeChild(this.overlays[key].container);
          }
        } catch (e) {}
      }

      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.left = '0';
      container.style.top = '0';
      container.style.pointerEvents = 'none';
      container.style.width = '100%';
      container.style.height = '100%';
      container.appendChild(video);
      this.root.appendChild(container);

      const updateFn = () => {
        const rect = this._spriteToDomRect(target, video);
        if (!rect) return;

        video.style.display = (target.visible === false) ? 'none' : 'block';
        video.style.left = `${rect.left}px`;
        video.style.top = `${rect.top}px`;
        video.style.width = `${rect.width}px`;
        video.style.height = `${rect.height}px`;

        const cssRotation = rect.direction - 90;
        let flipScaleX = 1;
        if (rect.flip) {
          const d = ((rect.direction % 360) + 360) % 360;
          const facingLeft = (d > 90 && d < 270);
          if (facingLeft) flipScaleX = -1;
        }

        const extraRotation = video._autoOrientationDeg || 0;
        video.style.transformOrigin = 'center center';
        video.style.transform = `scaleX(${flipScaleX}) rotate(${cssRotation + extraRotation}deg)`;
      };

      updateFn();
      if (startPlayback) {
        try { await video.play(); } catch (e) {}
        // mark playing
        try { this._playingBySprite[spriteName] = name; } catch (e) {}
      }

      const intervalId = setInterval(updateFn, this.updateMs);
      this.overlays[key] = {
        key,
        name,
        spriteName,
        video,
        container,
        intervalId,
        target,
        acSource: null,
        url: video._blobUrl || null
      };
      return this.overlays[key];
    }

    // Pause + hide a named overlay instance and clear playing state if it was recorded
    _pauseAndHideOverlayInstance (info) {
      if (!info || !info.video) return;
      try { info.video.pause(); } catch (e) {}
      try {
        if (info.video) info.video.style.display = 'none';
        if (info.container) info.container.style.display = 'none';
      } catch (e) {}
      // if this overlay was recorded as playing for its sprite, clear it
      try {
        const sn = info.spriteName;
        if (sn && this._playingBySprite[sn] === info.name) {
          delete this._playingBySprite[sn];
        }
      } catch (e) {}
    }

    // Pause/hide other overlays that share the same sprite as the provided info instance
    _pauseAndHideOthersOnSameSpriteInstance (infoToKeep) {
      if (!infoToKeep || !infoToKeep.target) return;
      const keys = Object.keys(this.overlays);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const info = this.overlays[k];
        if (!info || info === infoToKeep) continue;
        if (!info.target) continue;
        if (info.target === infoToKeep.target || (info.target.sprite && infoToKeep.target.sprite && info.target.sprite.name === infoToKeep.target.sprite.name)) {
          this._pauseAndHideOverlayInstance(info);
        }
      }
    }

    // load overlay: allow same name+url on multiple sprites by using composite key
    async loadOverlay (args) {
      const name = args.NAME;
      const url = args.URL;
      const spriteName = args.SPRITE;

      const key = this._keyFor(name, spriteName);
      if (this._loadGuards[key]) return;
      this._loadGuards[key] = true;

      try {
        const target = Scratch.vm.runtime.targets.find(t => t.sprite && t.sprite.name === spriteName);
        if (!target) return;

        const existing = this.overlays[key];

        if (existing && existing.url && existing.url === url) {
          try {
            existing.target = target;
            if (existing.container && existing.container.parentNode !== this.root) {
              this.root.appendChild(existing.container);
            }
            return;
          } catch (e) {}
        }

        if (existing && existing.url && existing.url !== url) {
          this._unloadOverlayInternal(key);
        }

        const video = await this._createVideoElement(url);
        await this._attachOverlayInternal(name, spriteName, video, target, false);
        if (this.overlays[key]) this.overlays[key].url = url;
      } catch (e) {
        // ignore
      } finally {
        delete this._loadGuards[key];
      }
    }

    // play previously loaded overlay for a specific sprite (or fallback if sprite omitted)
    async playOverlay (args) {
      const name = args.NAME;
      const spriteName = args.SPRITE || null;
      const info = this._findOverlayForName(name, spriteName);
      if (!info || !info.video) return;
      const video = info.video;

      // Pause/hide overlays that share the same sprite as this overlay instance
      this._pauseAndHideOthersOnSameSpriteInstance(info);

      // Ensure container attached and visible
      try {
        if (info.container && info.container.parentNode !== this.root) {
          this.root.appendChild(info.container);
        }
        if (info.container) info.container.style.display = '';
        if (video) video.style.display = '';
      } catch (e) {}

      // Try unmuted play first with muted fallback
      try {
        video.muted = false;
        const p = video.play();
        if (p && p.catch) {
          await p.catch(async () => {
            try {
              video.muted = true;
              const p2 = video.play();
              if (p2 && p2.catch) await p2.catch(()=>{});
              const onPlaying = () => {
                try { setTimeout(() => { try { video.muted = false; } catch (e) {} }, 50); } catch (e) {}
                video.removeEventListener('playing', onPlaying);
              };
              video.addEventListener('playing', onPlaying);
            } catch (e) {}
          });
        }
        // mark playing state for this sprite
        try { this._playingBySprite[info.spriteName] = info.name; } catch (e) {}
      } catch (e) {
        try {
          video.muted = true;
          const p = video.play();
          if (p && p.catch) p.catch(()=>{});
          setTimeout(() => { try { video.muted = false; } catch (err) {} }, 50);
          try { this._playingBySprite[info.spriteName] = info.name; } catch (e) {}
        } catch (err) {}
      }
    }

    // play at seconds for a specific sprite (or fallback)
    async playOverlayAt (args) {
      const name = args.NAME;
      const seconds = Number(args.SECONDS) || 0;
      const spriteName = args.SPRITE || null;
      const info = this._findOverlayForName(name, spriteName);
      if (!info || !info.video) return;
      const video = info.video;

      this._pauseAndHideOthersOnSameSpriteInstance(info);

      // attach and show container
      try {
        if (info.container && info.container.parentNode !== this.root) {
          this.root.appendChild(info.container);
        }
        if (info.container) info.container.style.display = '';
        if (video) video.style.display = '';
      } catch (e) {}

      // clamp seek time
      let seekTime = seconds;
      try {
        if (isFinite(video.duration) && video.duration > 0) {
          if (seekTime < 0) seekTime = 0;
          if (seekTime > video.duration) seekTime = video.duration;
        } else if (seekTime < 0) {
          seekTime = 0;
        }
      } catch (e) {
        seekTime = Math.max(0, seekTime);
      }

      try {
        video.currentTime = seekTime;
      } catch (e) {
        try { await new Promise(resolve => setTimeout(resolve, 50)); video.currentTime = seekTime; } catch (err) {}
      }

      // autoplay-fallback
      try {
        video.muted = false;
        const p = video.play();
        if (p && p.catch) {
          await p.catch(async () => {
            try {
              video.muted = true;
              const p2 = video.play();
              if (p2 && p2.catch) await p2.catch(()=>{});
              const onPlaying = () => {
                try { setTimeout(() => { try { video.muted = false; } catch (e) {} }, 50); } catch (e) {}
                video.removeEventListener('playing', onPlaying);
              };
              video.addEventListener('playing', onPlaying);
            } catch (e) {}
          });
        }
        // mark playing state for this sprite
        try { this._playingBySprite[info.spriteName] = info.name; } catch (e) {}
      } catch (e) {
        try {
          video.muted = true;
          const p = video.play();
          if (p && p.catch) p.catch(()=>{});
          setTimeout(() => { try { video.muted = false; } catch (err) {} }, 50);
          try { this._playingBySprite[info.spriteName] = info.name; } catch (e) {}
        } catch (err) {}
      }
    }

    // stop overlay for a specific sprite (or fallback)
    stopOverlay (args) {
      const name = args.NAME;
      const spriteName = args.SPRITE || null;
      const info = this._findOverlayForName(name, spriteName);
      if (!info || !info.video) return;
      try { info.video.pause(); } catch (e) {}
      try {
        if (info.video) info.video.style.display = 'none';
        if (info.container) info.container.style.display = 'none';
      } catch (e) {}
      // clear playing record for this sprite if it was playing
      try {
        if (this._playingBySprite[info.spriteName] === info.name) {
          delete this._playingBySprite[info.spriteName];
        }
      } catch (e) {}
    }

    // unload overlay for a specific sprite (uses composite key)
    async unloadOverlay (args) {
      const name = args.NAME;
      const spriteName = args.SPRITE;
      const key = this._keyFor(name, spriteName);
      this._unloadOverlayInternal(key);
    }

    _unloadOverlayInternal (key) {
      const info = this.overlays[key];
      if (!info) return;
      try { clearInterval(info.intervalId); } catch (e) {}
      try { info.video.pause(); } catch (e) {}
      try { if (info.container && info.container.parentNode) info.container.parentNode.removeChild(info.container); } catch (e) {}
      try {
        const src = info.video && info.video._blobUrl;
        if (src && typeof src === 'string') {
          try { URL.revokeObjectURL(src); } catch (e) {}
        } else if (info.video && info.video.src && info.video.src.startsWith('blob:')) {
          try { URL.revokeObjectURL(info.video.src); } catch (e) {}
        }
      } catch (e) {}
      try { if (info.acSource) { try { info.acSource.disconnect(); } catch (e) {} info.acSource = null; } } catch (e) {}
      try { info.video.src = ''; } catch (e) {}
      // clear playing record if it referenced this overlay
      try {
        if (info.spriteName && this._playingBySprite[info.spriteName] === info.name) {
          delete this._playingBySprite[info.spriteName];
        }
      } catch (e) {}
      delete this.overlays[key];
    }

    // reporter: duration / current time / is playing / playback rate for a specific sprite (or fallback)
    getVideoInfo (args) {
      const name = args.NAME;
      const infoType = args.INFO;
      const spriteName = args.SPRITE || null;
      const overlay = this._findOverlayForName(name, spriteName);
      if (!overlay || !overlay.video) return '';
      const video = overlay.video;

      switch (infoType) {
        case 'duration':
          return isFinite(video.duration) ? video.duration : 0;
        case 'current time':
          return typeof video.currentTime === 'number' ? video.currentTime : 0;
        case 'is playing':
          return (!video.paused && !video.ended);
        case 'playback rate':
          return typeof video.playbackRate === 'number' ? video.playbackRate : 1;
        default:
          return '';
      }
    }

    // set playback rate for a specific sprite (or fallback)
    setPlaybackRate (args) {
      const name = args.NAME;
      const spriteName = args.SPRITE || null;
      const rate = Number(args.RATE);
      if (!isFinite(rate) || rate <= 0) return;
      const info = this._findOverlayForName(name, spriteName);
      if (!info || !info.video) return;
      try { info.video.playbackRate = rate; } catch (e) {}
    }

    // new reporter: return current video name playing on a specific sprite (or empty string)
    currentVideoOnSprite (args) {
      const spriteName = args.SPRITE;
      if (!spriteName) return '';
      try {
        return this._playingBySprite[spriteName] || '';
      } catch (e) {
        return '';
      }
    }

    // updated reporter: returns a JSON array string of loaded overlay NAMES for the chosen sprite
    getLoadedOverlaysFromSprite (args) {
      const spriteName = args.SPRITE;
      if (!spriteName) return '[]';
      const keys = Object.keys(this.overlays);
      const result = [];
      for (let i = 0; i < keys.length; i++) {
        const info = this.overlays[keys[i]];
        if (!info) continue;
        if (info.spriteName === spriteName) {
          if (result.indexOf(info.name) === -1) result.push(info.name);
        }
      }
      return JSON.stringify(result);
    }
  }

  Scratch.extensions.register(new VideoOverlayCache());
})(Scratch);
