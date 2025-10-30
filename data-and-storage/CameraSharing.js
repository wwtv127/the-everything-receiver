(function(Scratch) {
  'use strict';

  class CameraShareExtension {
    constructor() {
      this.video = document.createElement('video');
      this.video.setAttribute('playsinline', '');
      this.video.setAttribute('autoplay', '');
      this.video.style.display = 'none';
      document.body.appendChild(this.video);

      this.canvas = document.createElement('canvas');
      this.context = this.canvas.getContext('2d');

      this.stream = null;
      this.facingMode = 'user';
      this.resolutionScale = 1.0;
    }

    getInfo() {
      return {
        id: 'cameraShare',
        name: 'Camera Share',
        blocks: [
          {
            opcode: 'startCamera',
            blockType: Scratch.BlockType.COMMAND,
            text: 'Start camera'
          },
          {
            opcode: 'switchCamera',
            blockType: Scratch.BlockType.COMMAND,
            text: 'Switch camera to [MODE]',
            arguments: {
              MODE: {
                type: Scratch.ArgumentType.STRING,
                menu: 'cameraModes',
                defaultValue: 'front'
              }
            }
          },
          {
            opcode: 'getScreenshotDataURL',
            blockType: Scratch.BlockType.REPORTER,
            text: 'Latest camera screenshot'
          },
          {
            opcode: 'isCameraRunning',
            blockType: Scratch.BlockType.REPORTER,
            text: 'Is camera running?'
          },
          {
            opcode: 'setScreenshotScale',
            blockType: Scratch.BlockType.COMMAND,
            text: 'Set screenshot resolution scale to [SCALE]',
            arguments: {
              SCALE: {
                type: Scratch.ArgumentType.NUMBER,
                defaultValue: 1.0
              }
            }
          },
          {
            opcode: 'stopCamera',
            blockType: Scratch.BlockType.COMMAND,
            text: 'Stop camera'
          }
        ],
        menus: {
          cameraModes: {
            acceptReporters: true,
            items: ['front', 'back']
          }
        }
      };
    }

    async startCamera() {
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
      }

      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: this.facingMode }
        });

        this.video.srcObject = this.stream;
        await this.video.play();
      } catch (error) {
        console.error('Camera access error:', error);
      }
    }

    switchCamera(args) {
      this.facingMode = args.MODE === 'back' ? 'environment' : 'user';
      this.startCamera();
    }

    getScreenshotDataURL() {
      if (!this.video || this.video.readyState < 2) return '';

      const scale = Math.max(0.1, Math.min(1.0, this.resolutionScale));
      const width = Math.floor(this.video.videoWidth * scale);
      const height = Math.floor(this.video.videoHeight * scale);

      this.canvas.width = width;
      this.canvas.height = height;
      this.context.drawImage(this.video, 0, 0, width, height);
      return this.canvas.toDataURL('image/png');
    }

    isCameraRunning() {
      return this.stream && this.stream.active ? true : false;
    }

    setScreenshotScale(args) {
      const scale = parseFloat(args.SCALE);
      if (scale >= 0.1 && scale <= 1.0) {
        this.resolutionScale = scale;
      }
    }

    stopCamera() {
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
        this.video.srcObject = null;
      }
    }
  }

  Scratch.extensions.register(new CameraShareExtension());
})(Scratch);
